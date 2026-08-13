import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';

declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    csrfToken?: string;
  }
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

type AttemptState = { count: number; lockedUntil: number | null };
const attemptsByIp = new Map<string, AttemptState>();

function getState(ip: string): AttemptState {
  return attemptsByIp.get(ip) ?? { count: 0, lockedUntil: null };
}

export function isLockedOut(ip: string): boolean {
  const state = getState(ip);
  if (state.lockedUntil && Date.now() < state.lockedUntil) return true;
  return false;
}

export function registerFailedAttempt(ip: string): void {
  const state = getState(ip);
  state.count += 1;
  if (state.count >= MAX_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCKOUT_MS;
    state.count = 0;
  }
  attemptsByIp.set(ip, state);
}

export function resetAttempts(ip: string): void {
  attemptsByIp.delete(ip);
}

/** Compara strings en tiempo constante (evita timing attack sobre el username). */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Igual comparamos algo del mismo largo que b para no filtrar el largo real por timing.
    timingSafeEqual(bufB, bufB);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const expectedUsername = requireEnv('VIEWER_USERNAME');
  const expectedHash = requireEnv('VIEWER_PASSWORD_HASH');

  const userOk = timingSafeStringEqual(username, expectedUsername);
  // Siempre corremos bcrypt.compare (aunque el usuario ya haya fallado) para no filtrar
  // por timing si el username era correcto o no.
  const passOk = await bcrypt.compare(password, expectedHash);

  return userOk && passOk;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.authenticated) return next();
  res.redirect('/login');
}

export function issueCsrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function verifyCsrfToken(req: Request): boolean {
  const fromForm = typeof req.body?._csrf === 'string' ? req.body._csrf : '';
  const fromSession = req.session.csrfToken || '';
  if (!fromForm || !fromSession) return false;
  return timingSafeStringEqual(fromForm, fromSession);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}
