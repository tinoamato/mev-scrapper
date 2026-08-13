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
 * Puerto directo de MevService.executePython, sin el límite de concurrencia (acá solo corre 1 proceso)
 * ni el manejo de cancelación por request (no aplica a un cron de un solo shot).
 */
async function runMevScraper(input: unknown): Promise<MevScrapeResult[]> {
  const scriptPath = getScriptPath();
  const pythonCmd = getPythonCommand();

  return new Promise<MevScrapeResult[]>((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const child = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      detached: !isWindows,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const idleTimeoutMs = Number(process.env.MEV_CHECK_IDLE_TIMEOUT_MS) || DEFAULT_IDLE_TIMEOUT_MS;
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
      if (Date.now() - lastActivityAt <= idleTimeoutMs) return;
      killProcess();
      settleReject(new Error(`Timeout por inactividad del scraper MEV (sin salida por ${Math.ceil(idleTimeoutMs / 60000)} min)`));
    }, IDLE_WATCHDOG_TICK_MS);

    const settleResolve = (value: MevScrapeResult[]) => {
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
        const parsed = stdout ? JSON.parse(stdout) : [];
        settleResolve(Array.isArray(parsed) ? parsed : []);
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
  return runMevScraper({
    username,
    password,
    action: 'check_last_movement',
    expedientes,
  });
}
