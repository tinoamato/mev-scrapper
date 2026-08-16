import * as cheerio from 'cheerio';
import { MevHttpClient } from './client';

/**
 * Chequeo de novedades por HTTP, para el botón "Actualizar desde MEV".
 *
 * Antes esto disparaba un redeploy de mev-cron por la API de Railway, lo que no
 * funcionaba: desde que ese servicio tiene cronSchedule, Railway marca el deploy
 * como buildOnly y sólo reconstruye la imagen sin ejecutarla. El botón devolvía
 * éxito y no pasaba nada. Ahora el chequeo corre acá mismo, en proceso, y tarda
 * ~10s en vez de "esperá 18 minutos".
 *
 * NOTA: es copia de cron/src/mev-http-check.ts (ver nota en client.ts sobre por
 * qué no se comparte el código). Si tocás uno, tocá el otro.
 *
 * IMPORTANTE sobre la fecha: producción guarda la "hora de pared" tal como la
 * muestra MEV (14/08/2026 15:53:03 -> "2026-08-14T15:53:03"). Se replica esa
 * convención a propósito: cambiarla haría que los 35 expedientes aparezcan como
 * "movidos" de golpe. La zona horaria es un arreglo aparte, con migración.
 */

export type ExpedienteInput = { id: string; numeroExpediente: string; url: string | null };

export type ResultadoHttp = {
  id: string;
  lastMovementAt: string;
  lastMovementTitle?: string | null;
  numeroExpediente?: string;
  caratula?: string;
  /** Deep link al proveído. MEV lo expone y hoy no se guarda. */
  proveidoUrl?: string | null;
  /** Cantidad de movimientos leídos, útil para diagnóstico. */
  totalMovimientos?: number;
};

export type ProblemaExpediente = {
  id: string;
  numeroExpediente: string;
  motivo: 'sin-url' | 'sin-movimientos' | 'no-es-ficha' | 'error';
  detalle?: string;
};

/**
 * MEV escribe la hora sin cero a la izquierda: "10/08/2026 8:44:55".
 * Exigir \d{2} para la hora descarta la fila y devuelve un movimiento viejo
 * como si fuera el último — falla silenciosa, ya la pisamos una vez.
 */
const FECHA_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

const BASE = 'https://mev.scba.gov.ar/';

function limpiar(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

type Movimiento = { iso: string; orden: number; titulo: string; proveidoUrl: string | null };

/** Parsea la ficha. Usa cheerio (DOM real) porque el HTML tiene tablas anidadas y tags sin cerrar. */
export function parseFicha(html: string): {
  esFicha: boolean;
  movimientos: Movimiento[];
  numeroExpediente: string | null;
  caratula: string | null;
} {
  const esFicha = /Pasos\s+Procesales/i.test(html);
  const $ = cheerio.load(html);
  const movimientos: Movimiento[] = [];

  $('tr').each((_i, tr) => {
    const tds = $(tr).find('> td');
    if (tds.length < 4) return;

    const m = limpiar($(tds[0]).text()).match(FECHA_RE);
    if (!m) return;

    const [, d, mo, y, h = '0', mi = '0', s = '0'] = m;
    // Hora de pared, misma convención que el path de Selenium (ver nota arriba).
    const iso = `${y}-${pad(+mo)}-${pad(+d)}T${pad(+h)}:${pad(+mi)}:${pad(+s)}`;
    const orden = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);

    const celda = $(tds[3]);
    const link = celda.find('a[href*="proveido.asp"]').first();
    const titulo = limpiar(link.length ? link.text() : celda.text());
    if (!titulo) return;

    const href = link.attr('href') || null;
    movimientos.push({
      iso,
      orden,
      titulo,
      proveidoUrl: href ? (href.startsWith('http') ? href : BASE + href.replace(/^\.?\//, '')) : null,
    });
  });

  movimientos.sort((a, b) => b.orden - a.orden);

  // Número y carátula salen de la URL del código de barras: ya vienen separados
  // y sin ruido de layout, más confiable que regexear el body.
  let numeroExpediente: string | null = null;
  let caratula: string | null = null;
  const barcode = $('img[src*="barcode.asp"]').attr('src') || '';
  if (barcode.includes('?')) {
    const c = new URLSearchParams(barcode.split('?')[1]).get('caratula');
    if (c) {
      const sep = c.indexOf('-');
      if (sep > 0) {
        numeroExpediente = limpiar(c.slice(0, sep)) || null;
        caratula = limpiar(c.slice(sep + 1)) || null;
      } else {
        caratula = limpiar(c) || null;
      }
    }
  }

  return { esFicha, movimientos, numeroExpediente, caratula };
}

export async function checkExpedientesHttp(
  username: string,
  password: string,
  expedientes: ExpedienteInput[],
  opts: { concurrencia?: number; throttleMs?: number } = {},
): Promise<{ resultados: ResultadoHttp[]; problemas: ProblemaExpediente[] }> {
  const resultados: ResultadoHttp[] = [];
  const problemas: ProblemaExpediente[] = [];
  if (expedientes.length === 0) return { resultados, problemas };

  const concurrencia = Math.max(1, Math.min(opts.concurrencia ?? 4, 6));
  const throttleMs = opts.throttleMs ?? 100;

  // Una sesión por worker: compartir una sola sesión ASP entre requests
  // concurrentes es lo que hace que devuelva vistas cruzadas.
  const clientes = await Promise.all(
    Array.from({ length: concurrencia }, async () => {
      const c = new MevHttpClient(username, password, throttleMs);
      await c.login();
      return c;
    }),
  );

  let siguiente = 0;
  async function worker(cliente: MevHttpClient) {
    for (;;) {
      const i = siguiente++;
      if (i >= expedientes.length) return;
      const exp = expedientes[i];

      if (!exp.url) {
        problemas.push({ id: exp.id, numeroExpediente: exp.numeroExpediente, motivo: 'sin-url' });
        continue;
      }

      try {
        const html = await cliente.fetchExpediente(exp.url);
        const ficha = parseFicha(html);

        if (!ficha.esFicha) {
          problemas.push({
            id: exp.id,
            numeroExpediente: exp.numeroExpediente,
            motivo: 'no-es-ficha',
            detalle: 'la página no contiene "Pasos Procesales" (¿causa inexistente o sin acceso?)',
          });
          continue;
        }
        if (ficha.movimientos.length === 0) {
          problemas.push({ id: exp.id, numeroExpediente: exp.numeroExpediente, motivo: 'sin-movimientos' });
          continue;
        }

        const ultimo = ficha.movimientos[0];
        resultados.push({
          id: exp.id,
          lastMovementAt: ultimo.iso,
          lastMovementTitle: ultimo.titulo || null,
          ...(ficha.numeroExpediente ? { numeroExpediente: ficha.numeroExpediente } : {}),
          ...(ficha.caratula ? { caratula: ficha.caratula } : {}),
          proveidoUrl: ultimo.proveidoUrl,
          totalMovimientos: ficha.movimientos.length,
        });
      } catch (e) {
        problemas.push({
          id: exp.id,
          numeroExpediente: exp.numeroExpediente,
          motivo: 'error',
          detalle: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  await Promise.all(clientes.map((c) => worker(c)));
  return { resultados, problemas };
}
