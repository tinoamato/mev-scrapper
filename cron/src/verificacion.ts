import type { MevScrapeResult } from './mev-runner';
import type { ProblemaExpediente, ResultadoHttp } from './mev-http-check';

/**
 * Verificación cruzada entre el método viejo (Selenium) y el nuevo (HTTP).
 *
 * Existe porque los errores de este scraping son SILENCIOSOS: si el parser se
 * equivoca, no tira excepción — devuelve un movimiento viejo como si fuera el
 * último. Un monitor de plazos que falla en silencio es peor que uno que se cae.
 * Durante la transición corren los dos y Selenium sigue mandando; el HTTP solo
 * se compara y se reporta.
 */

export type Discrepancia = {
  id: string;
  numeroExpediente: string;
  tipo: 'fecha' | 'titulo' | 'falta-en-http' | 'falta-en-selenium';
  selenium?: { fecha?: string; titulo?: string | null };
  http?: { fecha?: string; titulo?: string | null };
};

/** Normaliza para comparar: ignora mayúsculas, espacios repetidos y puntuación al borde. */
function normTitulo(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim();
}

export function compararResultados(
  selenium: MevScrapeResult[],
  http: ResultadoHttp[],
  expedientes: { id: string; numeroExpediente: string }[],
): Discrepancia[] {
  const porId = new Map(expedientes.map((e) => [e.id, e.numeroExpediente]));
  const sel = new Map(selenium.map((r) => [r.id, r]));
  const htt = new Map(http.map((r) => [r.id, r]));
  const discrepancias: Discrepancia[] = [];

  for (const [id, s] of sel) {
    const h = htt.get(id);
    const numero = porId.get(id) ?? id;

    if (!h) {
      discrepancias.push({
        id,
        numeroExpediente: numero,
        tipo: 'falta-en-http',
        selenium: { fecha: s.lastMovementAt, titulo: s.lastMovementTitle },
      });
      continue;
    }

    // Ambos métodos emiten "hora de pared" (YYYY-MM-DDTHH:MM:SS), así que la
    // comparación es directa y no depende de zona horaria.
    if (s.lastMovementAt !== h.lastMovementAt) {
      discrepancias.push({
        id,
        numeroExpediente: numero,
        tipo: 'fecha',
        selenium: { fecha: s.lastMovementAt, titulo: s.lastMovementTitle },
        http: { fecha: h.lastMovementAt, titulo: h.lastMovementTitle },
      });
      continue;
    }

    if (normTitulo(s.lastMovementTitle) !== normTitulo(h.lastMovementTitle)) {
      discrepancias.push({
        id,
        numeroExpediente: numero,
        tipo: 'titulo',
        selenium: { titulo: s.lastMovementTitle },
        http: { titulo: h.lastMovementTitle },
      });
    }
  }

  for (const [id, h] of htt) {
    if (!sel.has(id)) {
      discrepancias.push({
        id,
        numeroExpediente: porId.get(id) ?? id,
        tipo: 'falta-en-selenium',
        http: { fecha: h.lastMovementAt, titulo: h.lastMovementTitle },
      });
    }
  }

  return discrepancias;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Mail de alerta al equipo (no al cliente): solo se manda si hay diferencias. */
export async function enviarAlertaVerificacion(
  discrepancias: Discrepancia[],
  problemas: ProblemaExpediente[],
  stats: { totalExpedientes: number; msSelenium: number; msHttp: number },
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const fromName = process.env.RESEND_FROM_NAME || 'MEV Monitor';
  // Por defecto va al mismo destinatario, pero se puede separar con VERIFY_EMAIL.
  const to = process.env.VERIFY_EMAIL || process.env.NOTIFY_EMAIL;

  // Con las notificaciones desactivadas no hay destinatario: las discrepancias y
  // los fallos quedan sólo en los logs de Railway (ya se imprimen antes de llamar acá).
  if (!apiKey || !from || !to) {
    console.log('[verificacion] Mail desactivado, el detalle queda en los logs.');
    return;
  }

  const filas = discrepancias
    .map(
      (d) => `<tr>
        <td style="padding:6px;border-bottom:1px solid #eee;">${esc(d.numeroExpediente)}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${d.tipo}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${esc(d.selenium?.fecha ?? '')} ${esc(d.selenium?.titulo ?? '')}</td>
        <td style="padding:6px;border-bottom:1px solid #eee;">${esc(d.http?.fecha ?? '')} ${esc(d.http?.titulo ?? '')}</td>
      </tr>`,
    )
    .join('');

  const filasProblemas = problemas
    .map((p) => `<li>${esc(p.numeroExpediente)} — ${p.motivo}${p.detalle ? `: ${esc(p.detalle)}` : ''}</li>`)
    .join('');

  const html = `
    <div style="font-family:sans-serif;max-width:760px;margin:0 auto;">
      <h2>Verificación cruzada MEV — ${discrepancias.length} discrepancia(s)</h2>
      <p style="color:#555;">
        Selenium tardó ${(stats.msSelenium / 1000).toFixed(1)}s y HTTP ${(stats.msHttp / 1000).toFixed(1)}s
        sobre ${stats.totalExpedientes} expedientes.
        <strong>La base se actualizó con el resultado de Selenium</strong> (el método viejo sigue mandando).
      </p>
      ${
        discrepancias.length
          ? `<table style="border-collapse:collapse;width:100%;font-size:13px;">
               <thead><tr style="background:#f4f4f4;text-align:left;">
                 <th style="padding:6px;">Expediente</th><th style="padding:6px;">Tipo</th>
                 <th style="padding:6px;">Selenium (se usó)</th><th style="padding:6px;">HTTP (nuevo)</th>
               </tr></thead>
               <tbody>${filas}</tbody>
             </table>`
          : '<p>Sin discrepancias.</p>'
      }
      ${filasProblemas ? `<h3>Expedientes con problemas en el método HTTP</h3><ul>${filasProblemas}</ul>` : ''}
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${fromName} <${from}>`,
      to: [to],
      subject: `[MEV] Verificación cruzada: ${discrepancias.length} discrepancia(s)`,
      html,
    }),
  });
  if (!res.ok) {
    console.error(`[verificacion] Resend respondió ${res.status}`);
  }
}
