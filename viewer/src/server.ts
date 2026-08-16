import path from 'node:path';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Pool } from 'pg';
import connectPgSimple from 'connect-pg-simple';
import { PrismaClient } from '@prisma/client';
import {
  isLockedOut,
  registerFailedAttempt,
  resetAttempts,
  verifyCredentials,
  requireAuth,
  issueCsrfToken,
  verifyCsrfToken,
} from './auth';
import { loginPage, dashboardPage, errorPage } from './views';
import { fetchDepartamentos, fetchJuzgados, search as searchMev } from './mevSearch';
import { refrescarDesdeMev } from './refrescar';

const prisma = new PrismaClient();
const app = express();

const CRON_LABEL = process.env.CRON_LABEL || '9:00 AM';

// Railway está delante de un proxy TLS — sin esto, `cookie.secure` rechazaría todo.
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));

const PgSession = connectPgSimple(session);
const sessionPool = new Pool({ connectionString: requireEnv('DATABASE_URL') });

app.use(
  session({
    store: new PgSession({ pool: sessionPool, tableName: 'session', createTableIfMissing: true }),
    name: 'mev.sid',
    secret: requireEnv('SESSION_SECRET'),
    resave: false,
    saveUninitialized: false,
    rolling: true, // cada visita renueva el vencimiento — mientras entres al menos 1 vez cada 90 días, no te vuelve a pedir login
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 90 * 24 * 60 * 60 * 1000,
    },
  }),
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.type('html').send(loginPage({ csrfToken: issueCsrfToken(req) }));
});

app.post('/login', loginLimiter, async (req, res) => {
  const ip = req.ip || 'unknown';

  if (isLockedOut(ip)) {
    return res.status(429).type('html').send(
      loginPage({ csrfToken: issueCsrfToken(req), error: 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.' }),
    );
  }

  if (!verifyCsrfToken(req)) {
    return res.status(403).type('html').send(loginPage({ csrfToken: issueCsrfToken(req), error: 'Sesión inválida, reintentá.' }));
  }

  const { username, password } = req.body as { username?: string; password?: string };
  const ok = username && password ? await verifyCredentials(username, password) : false;

  if (!ok) {
    registerFailedAttempt(ip);
    return res.status(401).type('html').send(loginPage({ csrfToken: issueCsrfToken(req), error: 'Usuario o contraseña incorrectos.' }));
  }

  resetAttempts(ip);
  req.session.regenerate((err) => {
    if (err) return res.status(500).type('html').send(errorPage('Error de sesión'));
    req.session.authenticated = true;
    res.redirect('/');
  });
});

app.post('/logout', requireAuth, (req, res) => {
  if (!verifyCsrfToken(req)) return res.status(403).type('html').send(errorPage('Sesión inválida'));
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', requireAuth, async (req, res) => {
  const organizationId = requireEnv('ORGANIZATION_ID');
  const expedientes = await prisma.expedienteMev.findMany({
    where: { organizationId },
    orderBy: [{ hasNewMovements: 'desc' }, { fechaUltimoMovimiento: 'desc' }],
  });
  res.type('html').send(dashboardPage({ csrfToken: issueCsrfToken(req), expedientes, cronSchedule: CRON_LABEL }));
});

app.post('/expedientes/:id/marcar-visto', requireAuth, async (req, res) => {
  if (!verifyCsrfToken(req)) return res.status(403).type('html').send(errorPage('Sesión inválida'));
  const organizationId = requireEnv('ORGANIZATION_ID');
  await prisma.expedienteMev.updateMany({
    where: { id: req.params.id, organizationId },
    data: { hasNewMovements: false },
  });
  res.redirect('/');
});

app.post('/expedientes/marcar-todos-vistos', requireAuth, async (req, res) => {
  if (!verifyCsrfToken(req)) return res.status(403).type('html').send(errorPage('Sesión inválida'));
  const organizationId = requireEnv('ORGANIZATION_ID');
  await prisma.expedienteMev.updateMany({
    where: { organizationId, hasNewMovements: true },
    data: { hasNewMovements: false },
  });
  res.redirect('/');
});

app.post('/expedientes', requireAuth, async (req, res) => {
  if (!verifyCsrfToken(req)) return res.status(403).type('html').send(errorPage('Sesión inválida'));
  const organizationId = requireEnv('ORGANIZATION_ID');
  const { numeroExpediente, caratula, jurisdiccion, mevUrl } = req.body as Record<string, string>;

  if (!numeroExpediente?.trim() || !caratula?.trim()) {
    return res.status(400).type('html').send(errorPage('Número de expediente y carátula son requeridos'));
  }

  await prisma.expedienteMev.create({
    data: {
      organizationId,
      numeroExpediente: numeroExpediente.trim(),
      caratula: caratula.trim(),
      jurisdiccion: jurisdiccion?.trim() || null,
      mevUrl: mevUrl?.trim() || null,
    },
  });
  res.redirect('/');
});

app.post('/expedientes/from-search', requireAuth, async (req, res) => {
  if (!verifyCsrfToken(req)) return res.status(403).type('html').send(errorPage('Sesión inválida'));
  const organizationId = requireEnv('ORGANIZATION_ID');
  const { caratula, mevUrl, departamento, numeroExpediente } = req.body as Record<string, string>;

  if (!caratula?.trim() || !mevUrl?.trim()) {
    return res.status(400).type('html').send(errorPage('Faltan datos del resultado seleccionado'));
  }

  // Igual que legal-saas: si MEV no devolvió número de expediente, generamos uno
  // temporal único en vez de dejarlo vacío (rompería el @@unique del schema).
  let numero = numeroExpediente?.trim();
  if (!numero || numero === '-' || numero === '--') {
    numero = `PENDIENTE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  await prisma.expedienteMev.create({
    data: {
      organizationId,
      numeroExpediente: numero,
      caratula: caratula.trim(),
      jurisdiccion: departamento?.trim() || null,
      mevUrl: mevUrl.trim(),
    },
  });
  res.redirect('/');
});

app.get('/mev/departamentos', requireAuth, async (_req, res) => {
  try {
    res.json({ departamentos: await fetchDepartamentos() });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Error consultando MEV' });
  }
});

app.get('/mev/juzgados', requireAuth, async (req, res) => {
  const departamento = String(req.query.departamento || '').trim();
  if (!departamento) return res.status(400).json({ error: 'Falta departamento' });
  try {
    res.json({ juzgados: await fetchJuzgados(departamento) });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Error consultando MEV' });
  }
});

app.get('/mev/search', requireAuth, async (req, res) => {
  const departamento = String(req.query.departamento || '').trim();
  const juzgado = String(req.query.juzgado || '').trim();
  const query = String(req.query.query || '').trim();
  if (!departamento || !juzgado || query.length < 3) {
    return res.status(400).json({ error: 'Faltan parámetros de búsqueda' });
  }
  try {
    res.json({ results: await searchMev(departamento, juzgado, query) });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Error consultando MEV' });
  }
});

app.post('/expedientes/:id/eliminar', requireAuth, async (req, res) => {
  if (!verifyCsrfToken(req)) return res.status(403).type('html').send(errorPage('Sesión inválida'));
  const organizationId = requireEnv('ORGANIZATION_ID');
  await prisma.expedienteMev.deleteMany({
    where: { id: req.params.id, organizationId },
  });
  res.redirect('/');
});

/**
 * Chequeo a demanda. Corre acá mismo (sin Chromium tarda ~10s), así que responde
 * de forma sincrónica: no hace falta disparar otro servicio ni hacer polling.
 */
app.post('/trigger', requireAuth, async (req, res) => {
  if (!verifyCsrfToken(req)) return res.status(403).json({ error: 'Sesión inválida' });
  const organizationId = requireEnv('ORGANIZATION_ID');
  try {
    const r = await refrescarDesdeMev(prisma, organizationId);
    console.log(`[trigger] ${r.chequeados} chequeados en ${(r.ms / 1000).toFixed(1)}s, ${r.conNovedades} con novedades, ${r.problemas} con problemas.`);
    res.json({ ok: true, ...r });
  } catch (err) {
    console.error('[trigger] Falló el chequeo:', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Error al chequear MEV' });
  }
});

app.get('/health', (_req, res) => res.status(200).send('ok'));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`[mev-viewer] escuchando en :${port}`));
