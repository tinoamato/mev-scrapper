import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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

const prisma = new PrismaClient();
const app = express();

// Railway está delante de un proxy TLS — sin esto, `cookie.secure` rechazaría todo.
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    name: 'mev.sid',
    secret: requireEnv('SESSION_SECRET'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
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
  res.type('html').send(dashboardPage({ csrfToken: issueCsrfToken(req), expedientes }));
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

app.get('/health', (_req, res) => res.status(200).send('ok'));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`[mev-viewer] escuchando en :${port}`));
