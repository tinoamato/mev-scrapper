function baseUrl(): string {
  return requireEnv('MEV_SEARCH_URL').replace(/\/$/, '');
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${requireEnv('MEV_SEARCH_TOKEN')}` };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, { headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `mev-search respondió ${res.status}`);
  }
  return body as T;
}

export async function fetchDepartamentos(): Promise<string[]> {
  const body = await get<{ departamentos: string[] }>('/departamentos');
  return body.departamentos || [];
}

export async function fetchJuzgados(departamento: string): Promise<string[]> {
  const body = await get<{ juzgados: string[] }>(`/juzgados?departamento=${encodeURIComponent(departamento)}`);
  return body.juzgados || [];
}

export type MevSearchResult = { caratula: string; url: string; numeroExpediente?: string };

export async function search(departamento: string, juzgado: string, query: string): Promise<MevSearchResult[]> {
  const body = await get<{ results: MevSearchResult[] }>(
    `/search?departamento=${encodeURIComponent(departamento)}&juzgado=${encodeURIComponent(juzgado)}&query=${encodeURIComponent(query)}`,
  );
  return body.results || [];
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}
