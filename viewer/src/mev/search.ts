import { MevHttpClient } from './client';
import { parseSelect, parseResultadosBusqueda, busquedaSinResultados, type ResultadoBusqueda } from './parser';

/**
 * Búsqueda de expedientes en MEV, por HTTP. Reemplaza al servicio mev-search
 * (Python + Selenium + Chromium), que tardaba ~43s en el mismo flujo; acá son ~3s.
 *
 * El flujo replica el del navegador:
 *   1. login          -> POSLoguin.asp trae el <select name="DtoJudElegido">
 *   2. departamento   -> POST a POSLoguin.asp devuelve el <select name="JuzgadoElegido">
 *   3. carátula       -> POST a Busqueda.asp devuelve los links a procesales.asp
 *
 * El paso 3 tiene una trampa: el form tiene dos campos ocultos (OpcionBusqueda y
 * busca) que MEV llena por JavaScript recién al hacer submit. Sin ellos la
 * búsqueda devuelve 0 resultados sin ningún error. Los valores salen de mev.js:
 * OpcionBusqueda=0 es "por carátula" y `busca` lleva el mismo texto que `caratula`.
 */

/** El cliente vive mientras dura la sesión de búsqueda del usuario, para no reloguear por paso. */
export class MevSearchSession {
  private cliente: MevHttpClient;
  private paginaDepartamentos: string | null = null;

  constructor(username: string, password: string) {
    // Sin throttle: son acciones interactivas y de a una, no un barrido masivo.
    this.cliente = new MevHttpClient(username, password, 0);
  }

  async departamentos(): Promise<string[]> {
    const html = await this.cliente.getPagina('POSLoguin.asp');
    this.paginaDepartamentos = html;
    return parseSelect(html, 'DtoJudElegido').map((o) => o.text);
  }

  private async valorDepartamento(nombre: string): Promise<string> {
    if (!this.paginaDepartamentos) {
      this.paginaDepartamentos = await this.cliente.getPagina('POSLoguin.asp');
    }
    const opciones = parseSelect(this.paginaDepartamentos, 'DtoJudElegido');
    const exacto = opciones.find((o) => o.text.toLowerCase() === nombre.toLowerCase());
    if (exacto) return exacto.value;
    const parcial = opciones.find(
      (o) => o.text.toLowerCase().includes(nombre.toLowerCase()) || nombre.toLowerCase().includes(o.text.toLowerCase()),
    );
    if (parcial) return parcial.value;
    throw new Error(`No se encontró el departamento "${nombre}"`);
  }

  async juzgados(departamento: string): Promise<string[]> {
    const valor = await this.valorDepartamento(departamento);
    const html = await this.cliente.postFormulario('POSLoguin.asp', {
      DtoJudElegido: valor,
      Aceptar: 'Aceptar',
    });
    return parseSelect(html, 'JuzgadoElegido').map((o) => o.text);
  }

  async buscar(departamento: string, juzgado: string, query: string): Promise<ResultadoBusqueda[]> {
    if (query.trim().length < 3) throw new Error('La búsqueda necesita al menos 3 caracteres');

    // Seleccionar departamento deja el juzgado disponible en la sesión de MEV.
    const valorDepto = await this.valorDepartamento(departamento);
    const htmlJuzgados = await this.cliente.postFormulario('POSLoguin.asp', {
      DtoJudElegido: valorDepto,
      Aceptar: 'Aceptar',
    });

    const opciones = parseSelect(htmlJuzgados, 'JuzgadoElegido');
    const valorJuzgado = matchJuzgado(opciones, juzgado);

    const html = await this.cliente.postFormulario('Busqueda.asp', {
      OpcionBusqueda: '0', // 0 = por carátula (lo setea mev.js al submit)
      busca: query.trim(),
      JuzgadoElegido: valorJuzgado,
      radio: 'xCa',
      caratula: query.trim(),
      TipoCausa: 'Am', // Am = activas y archivadas
      Buscar: 'Buscar',
    });

    if (busquedaSinResultados(html)) return [];
    return parseResultadosBusqueda(html);
  }
}

/** MEV escribe los juzgados de forma inconsistente ("Nro. 1" vs "N° 1"), así que se compara normalizado. */
function matchJuzgado(opciones: { value: string; text: string }[], buscado: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[°º]/g, '').replace(/nro\.?\s*/g, 'n').replace(/\s+/g, ' ').trim();
  const objetivo = norm(buscado);

  const exacto = opciones.find((o) => o.text === buscado) || opciones.find((o) => norm(o.text) === objetivo);
  if (exacto) return exacto.value;

  const parcial = opciones.find((o) => norm(o.text).includes(objetivo) || objetivo.includes(norm(o.text)));
  if (parcial) return parcial.value;

  throw new Error(`No se encontró el juzgado "${buscado}"`);
}
