import type { PrismaClient } from '@prisma/client';
import { checkExpedientesHttp } from './mev/check';

/**
 * Chequeo de novedades a demanda (botón "Actualizar desde MEV").
 *
 * Corre en proceso: sin Chromium tarda ~10s, así que no hace falta disparar otro
 * servicio ni hacer polling. Escribe las mismas columnas que el cron diario, de
 * modo que las dos vías dejan la base en el mismo estado.
 */

export type ResultadoRefresco = {
  chequeados: number;
  conNovedades: number;
  problemas: number;
  ms: number;
  novedades: { numeroExpediente: string; caratula: string; titulo: string | null }[];
};

/** Evita que dos clics simultáneos disparen dos barridos contra MEV. */
let enCurso: Promise<ResultadoRefresco> | null = null;

export function refrescarDesdeMev(prisma: PrismaClient, organizationId: string): Promise<ResultadoRefresco> {
  if (enCurso) return enCurso;
  enCurso = ejecutar(prisma, organizationId).finally(() => {
    enCurso = null;
  });
  return enCurso;
}

async function ejecutar(prisma: PrismaClient, organizationId: string): Promise<ResultadoRefresco> {
  const t0 = Date.now();
  const expedientes = await prisma.expedienteMev.findMany({
    where: { organizationId },
    orderBy: [{ updatedAt: 'desc' }],
  });

  if (expedientes.length === 0) {
    return { chequeados: 0, conNovedades: 0, problemas: 0, ms: Date.now() - t0, novedades: [] };
  }

  const { resultados, problemas } = await checkExpedientesHttp(
    requireEnv('MEV_USERNAME'),
    requireEnv('MEV_PASSWORD'),
    expedientes.map((e) => ({ id: e.id, numeroExpediente: e.numeroExpediente, url: e.mevUrl })),
  );

  const porId = new Map(resultados.map((r) => [r.id, r]));
  const ahora = new Date();
  const novedades: ResultadoRefresco['novedades'] = [];

  for (const e of expedientes) {
    const remoto = porId.get(e.id);
    if (!remoto) continue;

    const fechaRemota = new Date(remoto.lastMovementAt);
    const esNuevo = !e.fechaUltimoMovimiento || fechaRemota.getTime() > e.fechaUltimoMovimiento.getTime();

    if (!esNuevo) {
      await prisma.expedienteMev.update({ where: { id: e.id }, data: { lastCheckedAt: ahora } });
      continue;
    }

    const fila = await prisma.expedienteMev.update({
      where: { id: e.id },
      data: {
        fechaUltimoMovimiento: fechaRemota,
        tituloUltimoMovimiento: remoto.lastMovementTitle ?? null,
        lastCheckedAt: ahora,
        hasNewMovements: true,
        ...(remoto.caratula && remoto.caratula.length > (e.caratula?.length || 0) ? { caratula: remoto.caratula } : {}),
      },
    });

    novedades.push({
      numeroExpediente: fila.numeroExpediente,
      caratula: fila.caratula,
      titulo: remoto.lastMovementTitle ?? null,
    });
  }

  return {
    chequeados: resultados.length,
    conNovedades: novedades.length,
    problemas: problemas.length,
    ms: Date.now() - t0,
    novedades,
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}
