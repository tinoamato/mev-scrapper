import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export type MevScrapeResult = {
  id: string;
  lastMovementAt: string; // ISO
  lastMovementTitle?: string | null;
  numeroExpediente?: string;
  caratula?: string;
};

export type MevSearchResult = {
  caratula: string;
  url: string;
  numeroExpediente?: string;
};

type ExpedienteInput = { id: string; numeroExpediente: string; url: string | null };

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_WATCHDOG_TICK_MS = 5000;

function getScriptPath(): string {
  const candidates = [
    join(process.cwd(), 'scripts', 'mev_scraper.py'),
    join(process.cwd(), 'cron', 'scripts', 'mev_scraper.py'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error('No se encontró scripts/mev_scraper.py junto al ejecutable.');
  }
  return found;
}

function getPythonCommand(): string {
  return process.env.MEV_PYTHON_PATH?.trim() || 'python3';
}

/**
 * Invoca el mismo scripts/mev_scraper.py de legal-saas (copiado verbatim) vía stdin/stdout JSON.
 * Puerto directo de MevService.executePython, sin el límite de concurrencia (acá cada acción es
 * un proceso propio, y run-mev-check/search-server no corren búsquedas concurrentes entre sí
 * porque son servicios separados) ni el manejo de cancelación por request.
 */
async function runMevAction<T>(input: unknown, idleTimeoutMs?: number): Promise<T> {
  const scriptPath = getScriptPath();
  const pythonCmd = getPythonCommand();

  return new Promise<T>((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const child = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      detached: !isWindows,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const effectiveIdleTimeoutMs = idleTimeoutMs ?? (Number(process.env.MEV_CHECK_IDLE_TIMEOUT_MS) || DEFAULT_IDLE_TIMEOUT_MS);
    let lastActivityAt = Date.now();
    let settled = false;

    const killProcess = () => {
      if (isWindows) {
        child.kill();
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill();
        }
      } else {
        child.kill();
      }
    };

    const idleWatchdog = setInterval(() => {
      if (Date.now() - lastActivityAt <= effectiveIdleTimeoutMs) return;
      killProcess();
      settleReject(new Error(`Timeout por inactividad del scraper MEV (sin salida por ${Math.ceil(effectiveIdleTimeoutMs / 60000)} min)`));
    }, IDLE_WATCHDOG_TICK_MS);

    const settleResolve = (value: T) => {
      if (settled) return;
      settled = true;
      clearInterval(idleWatchdog);
      resolve(value);
    };
    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearInterval(idleWatchdog);
      reject(err);
    };

    child.stdout.on('data', (d) => {
      lastActivityAt = Date.now();
      stdoutChunks.push(Buffer.from(d));
    });
    child.stderr.on('data', (d) => {
      lastActivityAt = Date.now();
      stderrChunks.push(Buffer.from(d));
    });
    child.on('error', (err) => settleReject(err));

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (code !== 0) {
        settleReject(new Error(`Scraper MEV falló (code ${code}): ${(stderr || stdout || 'sin detalle').slice(0, 2000)}`));
        return;
      }
      try {
        const parsed = stdout ? JSON.parse(stdout) : null;
        settleResolve(parsed as T);
      } catch (e) {
        settleReject(new Error(`Salida inválida del scraper MEV: ${String(e)}`));
      }
    });

    child.stdin.write(JSON.stringify(input ?? {}));
    child.stdin.end();
  });
}

export async function checkExpedientes(
  username: string,
  password: string,
  expedientes: ExpedienteInput[],
): Promise<MevScrapeResult[]> {
  if (expedientes.length === 0) return [];
  const result = await runMevAction<MevScrapeResult[]>({
    username,
    password,
    action: 'check_last_movement',
    expedientes,
  });
  return Array.isArray(result) ? result : [];
}

const CATALOG_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export async function catalogDepartamentos(username: string, password: string): Promise<string[]> {
  const result = await runMevAction<string[]>(
    { username, password, action: 'catalog_departamentos' },
    CATALOG_IDLE_TIMEOUT_MS,
  );
  return Array.isArray(result) ? result : [];
}

export async function catalogJuzgados(username: string, password: string, departamento: string): Promise<string[]> {
  const result = await runMevAction<string[]>(
    { username, password, action: 'catalog_juzgados', departamento },
    CATALOG_IDLE_TIMEOUT_MS,
  );
  return Array.isArray(result) ? result : [];
}

export async function searchByCaratula(
  username: string,
  password: string,
  departamento: string,
  juzgado: string,
  query: string,
): Promise<MevSearchResult[]> {
  const result = await runMevAction<MevSearchResult[]>(
    { username, password, action: 'search_by_caratula', departamento, juzgado, query },
    CATALOG_IDLE_TIMEOUT_MS,
  );
  return Array.isArray(result) ? result : [];
}
