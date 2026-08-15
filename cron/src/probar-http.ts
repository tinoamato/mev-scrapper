/**
 * Prueba de solo lectura del método HTTP contra MEV real.
 * NO escribe en la base. Sirve para validar el módulo antes de activarlo en el cron.
 *
 *   railway run --service mev-cron --environment mev -- node dist/probar-http.js
 */
import { PrismaClient } from '@prisma/client';
import { checkExpedientesHttp } from './mev-http-check';

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
    console.log(`Leyendo ${expedientes.length} expedientes por HTTP (sin escribir nada)...\n`);

    const t0 = Date.now();
    const { resultados, problemas } = await checkExpedientesHttp(
      username,
      password,
      expedientes.map((e) => ({ id: e.id, numeroExpediente: e.numeroExpediente, url: e.mevUrl })),
    );
    const ms = Date.now() - t0;

    const porId = new Map(expedientes.map((e) => [e.id, e]));
    let iguales = 0;
    const distintos: string[] = [];

    for (const r of resultados) {
      const e = porId.get(r.id)!;
      // La base guarda "hora de pared" como si fuera UTC; el método HTTP emite
      // la misma convención, así que se comparan los dígitos directamente.
      const guardado = e.fechaUltimoMovimiento ? e.fechaUltimoMovimiento.toISOString().slice(0, 19) : null;
      if (guardado === r.lastMovementAt) iguales++;
      else distintos.push(`  ${e.numeroExpediente.padEnd(22)} base=${guardado ?? '(vacío)'} http=${r.lastMovementAt}  ${r.lastMovementTitle}`);
    }

    console.log(`leídos OK          ${resultados.length}/${expedientes.length}`);
    console.log(`iguales a la base  ${iguales}/${resultados.length}`);
    console.log(`tiempo             ${(ms / 1000).toFixed(1)}s (${Math.round(ms / expedientes.length)}ms por expediente)`);
    console.log(`memoria            ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB`);

    if (distintos.length) {
      console.log(`\ndifieren de la base (${distintos.length}) — puede ser novedad real o desfasaje de zona horaria:`);
      distintos.forEach((d) => console.log(d));
    }
    if (problemas.length) {
      console.log(`\nproblemas (${problemas.length}):`);
      problemas.forEach((p) => console.log(`  ${p.numeroExpediente}: ${p.motivo}${p.detalle ? ` — ${p.detalle}` : ''}`));
    }
  } finally {
    await prisma.$disconnect();
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Falló:', e);
  process.exit(1);
});
