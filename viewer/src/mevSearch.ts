import { MevSearchSession } from './mev/search';

/**
 * Búsqueda de expedientes en MEV.
 *
 * Antes esto era un proxy HTTP al servicio mev-search (Python + Selenium + Chromium):
 * ~11s para traer los juzgados y ~43s para una búsqueda, más el cold start del sleep.
 * Ahora corre en proceso por HTTP: ~100ms y ~3s respectivamente. mev-search quedó sin uso.
 */

export type MevSearchResult = { caratula: string; url: string; numeroExpediente?: string };

/**
 * Se cachea la sesión entre requests del mismo usuario: el wizard hace 3 llamadas
 * seguidas (departamentos -> juzgados -> buscar) y reloguear en cada una es
 * desperdicio, además de castigar al servidor de MEV.
 */
let sesion: { s: MevSearchSession; creada: number } | null = null;
const VIDA_SESION_MS = 10 * 60 * 1000;

function obtenerSesion(): MevSearchSession {
  const ahora = Date.now();
  if (!sesion || ahora - sesion.creada > VIDA_SESION_MS) {
    sesion = { s: new MevSearchSession(requireEnv('MEV_USERNAME'), requireEnv('MEV_PASSWORD')), creada: ahora };
  }
  return sesion.s;
}

/** Si MEV cortó la sesión, se descarta y se reintenta una vez con una nueva. */
async function conReintento<T>(fn: (s: MevSearchSession) => Promise<T>): Promise<T> {
  try {
    return await fn(obtenerSesion());
  } catch (e) {
    sesion = null;
    return fn(obtenerSesion());
  }
}

export async function fetchDepartamentos(): Promise<string[]> {
  return conReintento((s) => s.departamentos());
}

export async function fetchJuzgados(departamento: string): Promise<string[]> {
  return conReintento((s) => s.juzgados(departamento));
}

export async function search(departamento: string, juzgado: string, query: string): Promise<MevSearchResult[]> {
  return conReintento((s) => s.buscar(departamento, juzgado, query));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}
