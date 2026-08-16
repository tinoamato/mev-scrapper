import * as cheerio from 'cheerio';

/**
 * Parsers del HTML de MEV. Se usa cheerio (DOM real) y no regex porque el HTML
 * está malformado a mano. Ejemplo textual de un <select> de MEV:
 *
 *   <option value=80 <H6>Avellaneda-Lanus</H6><option value=10 <H6>Azul</H6>
 *
 * Sin comillas en el value, sin cerrar el tag <option>, y con un <H6> abierto
 * adentro del propio tag. Un regex se rompe con esto; cheerio lo normaliza.
 */

const BASE = 'https://mev.scba.gov.ar/';

export type OpcionSelect = { value: string; text: string };

/** Extrae las opciones de un <select> por nombre, descartando el "Seleccione...". */
export function parseSelect(html: string, name: string): OpcionSelect[] {
  const $ = cheerio.load(html);
  const out: OpcionSelect[] = [];
  $(`select[name="${name}"] option`).each((_i, el) => {
    const value = ($(el).attr('value') || '').trim();
    const text = normalizar($(el).text());
    if (text && !/seleccione/i.test(text)) out.push({ value, text });
  });
  return out;
}

export type ResultadoBusqueda = {
  caratula: string;
  url: string;
  numeroExpediente?: string;
};

/**
 * Resultados de Busqueda.asp. Cada resultado es un link a procesales.asp; el número
 * de expediente vive en otra fila de la misma tabla, junto al último movimiento.
 */
export function parseResultadosBusqueda(html: string): ResultadoBusqueda[] {
  const $ = cheerio.load(html);
  const out: ResultadoBusqueda[] = [];
  const vistos = new Set<string>();

  $('a[href*="procesales.asp"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const caratula = normalizar($(el).text());
    if (!caratula || caratula.length < 4) return;

    const url = href.startsWith('http') ? href : BASE + href.replace(/^\.?\//, '');
    if (vistos.has(url)) return;
    vistos.add(url);

    // El número suele estar en la fila siguiente (formato "LM - 45579 - 2016" o "11870").
    const contexto = normalizar($(el).closest('tr').next('tr').text() || $(el).closest('tr').text());
    const m = contexto.match(/\b([A-Z]{2}\s*-\s*\d+\s*-\s*\d{4})\b/) || contexto.match(/^\s*(\d{4,6})\b/);

    out.push({ caratula, url, numeroExpediente: m ? normalizar(m[1]) : undefined });
  });

  return out;
}

/** ¿La búsqueda no encontró nada? MEV lo dice en texto, no con un código. */
export function busquedaSinResultados(html: string): boolean {
  const texto = cheerio.load(html)('body').text().toLowerCase();
  return texto.includes('no se encontraron') || texto.includes('no se encontró');
}

/**
 * MEV sirve algunos textos con la Ñ corrompida (DAÐOS en vez de DAÑOS). Pasa del
 * lado del servidor —Selenium devuelve exactamente lo mismo—, así que se corrige
 * al leer. En textos jurídicos argentinos la Ð no aparece nunca de forma legítima.
 */
function normalizar(s: string): string {
  return (s || '')
    .replace(/Ð/g, 'Ñ')
    .replace(/ð/g, 'ñ')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export { normalizar };
