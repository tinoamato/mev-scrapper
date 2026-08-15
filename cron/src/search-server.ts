import express from 'express';
import { catalogDepartamentos, catalogJuzgados, searchByCaratula } from './mev-runner';

/**
 * Entrypoint alternativo de la MISMA imagen que mev-cron (Python+Selenium+Chromium),
 * desplegado como servicio separado (mev-search) con Custom Start Command en vez de
 * Cron Schedule, y con Sleep Application activado: solo se prende cuando el viewer
 * necesita buscar un expediente para agregar, y se vuelve a dormir después.
 *
 * No expone esto a un browser directo — mev-viewer es el único cliente, autenticado
 * con un token compartido (MEV_SEARCH_TOKEN) que nunca llega al navegador del usuario.
 */
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.status(200).send('ok'));

app.use((req, res, next) => {
  const token = requireEnv('MEV_SEARCH_TOKEN');
  const auth = req.header('authorization') || '';
  if (auth !== `Bearer ${token}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
});

app.get('/departamentos', async (_req, res) => {
  try {
    const username = requireEnv('MEV_USERNAME');
    const password = requireEnv('MEV_PASSWORD');
    const departamentos = await catalogDepartamentos(username, password);
    res.json({ departamentos });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Error consultando MEV' });
  }
});

app.get('/juzgados', async (req, res) => {
  const departamento = String(req.query.departamento || '').trim();
  if (!departamento) return res.status(400).json({ error: 'Falta departamento' });
  try {
    const username = requireEnv('MEV_USERNAME');
    const password = requireEnv('MEV_PASSWORD');
    const juzgados = await catalogJuzgados(username, password, departamento);
    res.json({ juzgados });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Error consultando MEV' });
  }
});

app.get('/search', async (req, res) => {
  const departamento = String(req.query.departamento || '').trim();
  const juzgado = String(req.query.juzgado || '').trim();
  const query = String(req.query.query || '').trim();
  if (!departamento) return res.status(400).json({ error: 'Falta departamento' });
  if (!juzgado) return res.status(400).json({ error: 'Falta juzgado' });
  if (query.length < 3) return res.status(400).json({ error: 'La búsqueda necesita al menos 3 caracteres' });

  try {
    const username = requireEnv('MEV_USERNAME');
    const password = requireEnv('MEV_PASSWORD');
    const results = await searchByCaratula(username, password, departamento, juzgado, query);
    res.json({ results });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Error consultando MEV' });
  }
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`[mev-search] escuchando en :${port}`));
