import { PrismaClient } from '@prisma/client';
import { checkExpedientes } from './mev-runner';
import { sendMovementsEmail, sendWeeklyDigestEmail } from './resend';

/**
 * Entrypoint standalone para el Railway Cron Job.
 * Puerto de MevService.checkAndUpdate() (legal-saas), pero:
 * - una sola organización (ORGANIZATION_ID), no hace falta el loop multi-org
 * - sin NestJS/DI, sin audit log, sin polling por minuto: el disparo lo hace
 *   el cron nativo de Railway, este script corre una vez y termina (exit 0).
 */
async function main() {
  const organizationId = requireEnv('ORGANIZATION_ID');
  const username = requireEnv('MEV_USERNAME');
  const password = requireEnv('MEV_PASSWORD');

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

    console.log(`[mev-check] Chequeando ${expedientes.length} expediente(s)...`);
    const startedAt = Date.now();

    const scrapeResults = await checkExpedientes(
      username,
      password,
      expedientes.map((e) => ({ id: e.id, numeroExpediente: e.numeroExpediente, url: e.mevUrl })),
    );

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
