/**
 * Cliente HTTP de MEV — sin navegador.
 *
 * MEV es ASP server-rendered: la ficha del expediente viene como HTML terminado,
 * no necesita JavaScript. Medido contra los 35 expedientes reales: 4,4s el barrido
 * completo contra 1093s con Selenium+Chromium, y 145 MB de RAM contra ~1100 MB.
 *
 * Cuatro detalles que hacen fallar esto EN SILENCIO (devuelven un movimiento viejo
 * como si fuera el último, sin tirar error). Están todos contemplados acá y en el parser:
 *
 *  1. El POST de login responde 302 y ASP recién inicializa la sesión al seguir el
 *     redirect a POSLoguin.asp. Con la sesión a medio abrir, procesales.asp
 *     devuelve una vista incompleta con movimientos viejos.
 *  2. MEV responde `Content-Type: text/html` SIN charset, pero sirve windows-1252.
 *     Decodificar como UTF-8 rompe todas las ñ y tildes.
 *  3. La hora va sin cero a la izquierda: "10/08/2026 8:44:55" (ver parser).
 *  4. El HTML está malformado y tiene tablas anidadas (ver parser).
 *
 * NOTA: es copia de cron/src/mev-http-client.ts. Los dos servicios se buildean con
 * root directories distintos (/cron y /viewer) y no pueden compartir una carpeta
 * común sin reestructurar los Dockerfiles. Si tocás uno, tocá el otro.
 */

const BASE = 'https://mev.scba.gov.ar/';
const LOGIN_URL = BASE + 'loguin.asp';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class MevHttpClient {
  private cookies: Record<string, string> = {};
  private loggedIn = false;

  constructor(
    private readonly username: string,
    private readonly password: string,
    /** Pausa entre requests. Del otro lado hay un servidor del Poder Judicial. */
    private readonly throttleMs = 200,
  ) {}

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private absorbCookies(res: Response): void {
    const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of raw) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
  }

  private async raw(url: string, init: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: {
          Cookie: this.cookieHeader(),
          'User-Agent': UA,
          'Accept-Language': 'es-AR,es;q=0.9',
          ...(init.headers as Record<string, string> | undefined),
        },
        redirect: 'manual',
      });
      this.absorbCookies(res);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  /** windows-1252, no UTF-8. Ver nota (2) arriba. */
  private async decode(res: Response): Promise<string> {
    const buf = await res.arrayBuffer();
    return new TextDecoder('windows-1252').decode(buf);
  }

  private async follow(url: string, maxHops = 5): Promise<string> {
    let current = url;
    for (let i = 0; i < maxHops; i++) {
      const res = await this.raw(current);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        current = loc.startsWith('http') ? loc : BASE + loc.replace(/^\//, '');
        continue;
      }
      return this.decode(res);
    }
    throw new Error('Demasiados redirects en MEV');
  }

  async login(): Promise<void> {
    this.cookies = {};
    this.loggedIn = false;
    await this.raw(LOGIN_URL);

    const res = await this.raw(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: LOGIN_URL },
      body: new URLSearchParams({
        usuario: this.username,
        clave: this.password,
        Submit1: 'Ingresar',
      }).toString(),
    });

    const loc = res.headers.get('location');
    if (!loc) {
      const body = await this.decode(res);
      if (esPaginaDeLogin(body)) {
        throw new Error('MEV rechazó las credenciales (sigue mostrando el login)');
      }
      throw new Error(`Login inesperado: HTTP ${res.status} sin redirect`);
    }

    // Ver nota (1): completar la cadena o la sesión queda a medio abrir.
    await this.follow(loc.startsWith('http') ? loc : BASE + loc.replace(/^\//, ''));
    this.loggedIn = true;
  }

  /** Trae el HTML de un expediente, con reintentos y re-login si la sesión venció. */
  async fetchExpediente(url: string, intentos = 3): Promise<string> {
    if (!this.loggedIn) await this.login();

    let ultimoError: unknown = null;
    for (let intento = 1; intento <= intentos; intento++) {
      try {
        if (this.throttleMs > 0) await sleep(this.throttleMs);
        let html = await this.get(url);

        if (esPaginaDeLogin(html)) {
          await this.login();
          html = await this.get(url);
          if (esPaginaDeLogin(html)) throw new Error('No se pudo mantener la sesión con MEV');
        }
        return html;
      } catch (e) {
        ultimoError = e;
        if (intento < intentos) await sleep(1000 * intento); // backoff lineal
      }
    }
    throw ultimoError instanceof Error ? ultimoError : new Error(String(ultimoError));
  }

  private async get(url: string, timeoutMs = 30000): Promise<string> {
    const res = await this.raw(url, {}, timeoutMs);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) return this.follow(loc.startsWith('http') ? loc : BASE + loc.replace(/^\//, ''));
    }
    if (res.status >= 500) throw new Error(`MEV respondió HTTP ${res.status}`);
    return this.decode(res);
  }

  /** GET de una página relativa a MEV, asegurando sesión. Para el flujo de búsqueda. */
  async getPagina(path: string, timeoutMs = 60000): Promise<string> {
    if (!this.loggedIn) await this.login();
    let html = await this.get(BASE + path.replace(/^\//, ''), timeoutMs);
    if (esPaginaDeLogin(html)) {
      await this.login();
      html = await this.get(BASE + path.replace(/^\//, ''), timeoutMs);
    }
    return html;
  }

  /**
   * POST de un formulario de MEV (los selects de departamento/juzgado y la búsqueda
   * son forms clásicos). Sigue el redirect resultante y reintenta si la sesión venció.
   *
   * timeoutMs alto por defecto: la búsqueda por carátula de MEV tarda ~30-45s cuando
   * se la consulta desde Railway (medido: 43s con Selenium, ~33s por HTTP). Desde una
   * conexión argentina son ~3s, así que es latencia de red/geo del lado de MEV y no
   * algo que se arregle del lado nuestro.
   */
  async postFormulario(path: string, campos: Record<string, string>, timeoutMs = 120000): Promise<string> {
    if (!this.loggedIn) await this.login();
    const url = BASE + path.replace(/^\//, '');

    const enviar = async () => {
      const res = await this.raw(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
        body: new URLSearchParams(campos).toString(),
      }, timeoutMs);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (loc) return this.follow(loc.startsWith('http') ? loc : BASE + loc.replace(/^\//, ''));
      }
      return this.decode(res);
    };

    let html = await enviar();
    if (esPaginaDeLogin(html)) {
      await this.login();
      html = await enviar();
    }
    return html;
  }
}

export function esPaginaDeLogin(html: string): boolean {
  return /name=['"]?clave['"]?/i.test(html) && /name=['"]?usuario['"]?/i.test(html);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
