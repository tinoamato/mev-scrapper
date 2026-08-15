import { PrismaClient } from '@prisma/client';
import { checkExpedientes, type MevScrapeResult } from './mev-runner';
import { checkExpedientesHttp } from './mev-http-check';
import { compararResultados, enviarAlertaVerificacion } from './verificacion';
import { sendMovementsEmail, sendWeeklyDigestEmail } from './resend';

/**
 * Entrypoint standalone para el Railway Cron Job.
 * Puerto de MevService.checkAndUpdate() (legal-saas), pero:
 * - una sola organización (ORGANIZATION_ID), no hace falta el loop multi-org
 * - sin NestJS/DI, sin audit log, sin polling por minuto: el disparo lo hace
 *   el cron nativo de Railway, este script corre una vez y termina (exit 0).
 *
 * MEV_CHECK_MODE controla cómo se lee MEV:
 *   selenium  método original (Python + Selenium + Chromium). ~18 min.
 *   verify    corre los DOS y compara; Selenium sigue siendo la fuente de verdad
 *             para escribir en la base, y se alerta por mail si difieren. (default)
 *   http      solo el método nuevo. ~10 s, sin Chromium.
 */
type Modo = 'selenium' | 'verify' | 'http';

async function main() {
  const organizationId = requireEnv('ORGANIZATION_ID');
  const username = requireEnv('MEV_USERNAME');
  const password = requireEnv('MEV_PASSWORD');
  const modo = (process.env.MEV_CHECK_MODE || 'verify') as Modo;

  const prisma = new PrismaClient();

  try {
    const expedientes = await prisma.expedienteMev.findMany({
      where: { organizationId },
      orderBy: [{ updatedAt: 'desc' }],
    });

    if (expedientes.length === 0) {
      console.log('[mev-check] No hay expedientes para chequear.');
      return;
    }

    console.log(`[mev-check] Chequeando ${expedientes.length} expediente(s) — modo "${modo}"...`);
    const startedAt = Date.now();

    const entrada = expedientes.map((e) => ({
      id: e.id,
      numeroExpediente: e.numeroExpediente,
      url: e.mevUrl,
    }));

    const scrapeResults = await obtenerResultados(modo, username, password, entrada);

    const byId = new Map(scrapeResults.map((r) => [r.id, r]));
    const now = new Date();
    const updated: { numeroExpediente: string; caratula: string; fechaUltimoMovimiento: Date; tituloUltimoMovimiento: string | null }[] = [];

    for (const e of expedientes) {
      const remote = byId.get(e.id);
      if (!remote) {
        await prisma.expedienteMev.update({ where: { id: e.id }, data: { lastCheckedAt: now } });
        continue;
      }

      const remoteDate = new Date(remote.lastMovementAt);
      const storedDate = e.fechaUltimoMovimiento;
      const isNewer = !storedDate || remoteDate.getTime() > storedDate.getTime();

      if (!isNewer) {
        await prisma.expedienteMev.update({ where: { id: e.id }, data: { lastCheckedAt: now } });
        continue;
      }

      const row = await prisma.expedienteMev.update({
        where: { id: e.id },
        data: {
          fechaUltimoMovimiento: remoteDate,
          tituloUltimoMovimiento: remote.lastMovementTitle ?? null,
          lastCheckedAt: now,
          hasNewMovements: true,
          ...(remote.caratula && remote.caratula.length > (e.caratula?.length || 0) ? { caratula: remote.caratula } : {}),
        },
      });

      updated.push({
        numeroExpediente: row.numeroExpediente,
        caratula: row.caratula,
        fechaUltimoMovimiento: remoteDate,
        tituloUltimoMovimiento: remote.lastMovementTitle ?? null,
      });
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[mev-check] Listo en ${durationMs}ms. Movimientos nuevos: ${updated.length}.`);

    if (updated.length > 0) {
      await sendMovementsEmail(updated);
      console.log(`[mev-check] Mail enviado a ${process.env.NOTIFY_EMAIL}.`);
    }

    if (isMondayInArgentina()) {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const weekly = await prisma.expedienteMev.findMany({
        where: { organizationId, fechaUltimoMovimiento: { gte: sevenDaysAgo } },
        orderBy: [{ fechaUltimoMovimiento: 'desc' }],
      });

      if (weekly.length > 0) {
        await sendWeeklyDigestEmail(
          weekly.map((e) => ({
            numeroExpediente: e.numeroExpediente,
            caratula: e.caratula,
            fechaUltimoMovimiento: e.fechaUltimoMovimiento as Date,
            tituloUltimoMovimiento: e.tituloUltimoMovimiento,
          })),
        );
        console.log(`[mev-check] Resumen semanal enviado (${weekly.length} expediente(s)).`);
      } else {
        console.log('[mev-check] Lunes sin movimientos en los últimos 7 días, no se manda resumen semanal.');
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Ejecuta el/los método(s) según el modo y devuelve los resultados que se van a
 * escribir en la base. En "verify" corre los dos: primero HTTP (10s) y después
 * Selenium (18min), compara, alerta si difieren, y devuelve los de Selenium —
 * el método viejo sigue mandando hasta que la verificación demuestre que el
 * nuevo es equivalente.
 */
async function obtenerResultados(
  modo: Modo,
  username: string,
  password: string,
  entrada: { id: string; numeroExpediente: string; url: string | null }[],
): Promise<MevScrapeResult[]> {
  if (modo === 'selenium') {
    return checkExpedientes(username, password, entrada);
  }

  if (modo === 'http') {
    const t0 = Date.now();
    const { resultados, problemas } = await checkExpedientesHttp(username, password, entrada);
    console.log(`[mev-check] HTTP: ${resultados.length} leídos en ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
    if (problemas.length) {
      console.warn(`[mev-check] ${problemas.length} expediente(s) con problemas:`);
      for (const p of problemas) console.warn(`  - ${p.numeroExpediente}: ${p.motivo}${p.detalle ? ` (${p.detalle})` : ''}`);
    }
    return resultados;
  }

  // modo verify
  const tHttp = Date.now();
  let httpResultados: Awaited<ReturnType<typeof checkExpedientesHttp>>['resultados'] = [];
  let httpProblemas: Awaited<ReturnType<typeof checkExpedientesHttp>>['problemas'] = [];
  try {
    const r = await checkExpedientesHttp(username, password, entrada);
    httpResultados = r.resultados;
    httpProblemas = r.problemas;
  } catch (e) {
    // El método nuevo no debe poder romper el chequeo: si falla, se sigue con Selenium.
    console.error('[mev-check] El método HTTP falló entero, se continúa solo con Selenium:', e);
  }
  const msHttp = Date.now() - tHttp;
  console.log(`[mev-check] HTTP: ${httpResultados.length} leídos en ${(msHttp / 1000).toFixed(1)}s.`);

  const tSel = Date.now();
  const seleniumResultados = await checkExpedientes(username, password, entrada);
  const msSelenium = Date.now() - tSel;
  console.log(`[mev-check] Selenium: ${seleniumResultados.length} leídos en ${(msSelenium / 1000).toFixed(1)}s.`);

  const discrepancias = compararResultados(seleniumResultados, httpResultados, entrada);
  if (discrepancias.length === 0 && httpProblemas.length === 0) {
    console.log(`[mev-check] ✓ Verificación cruzada OK: los dos métodos coinciden en ${seleniumResultados.length}/${seleniumResultados.length}.`);
  } else {
    console.warn(`[mev-check] ⚠ ${discrepancias.length} discrepancia(s) y ${httpProblemas.length} problema(s). Se usa el resultado de Selenium.`);
    for (const d of discrepancias) {
      console.warn(`  - ${d.numeroExpediente} [${d.tipo}] selenium=${JSON.stringify(d.selenium)} http=${JSON.stringify(d.http)}`);
    }
    try {
      await enviarAlertaVerificacion(discrepancias, httpProblemas, {
        totalExpedientes: entrada.length,
        msSelenium,
        msHttp,
      });
    } catch (e) {
      console.error('[mev-check] No se pudo enviar la alerta de verificación:', e);
    }
  }

  return seleniumResultados;
}

function isMondayInArgentina(): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short',
  }).format(new Date());
  return weekday === 'Mon';
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[mev-check] Falló:', err);
    process.exit(1);
  });
