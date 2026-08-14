const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';

const REDEPLOY_MUTATION = `
  mutation($environmentId: String!, $serviceId: String!) {
    serviceInstanceRedeploy(environmentId: $environmentId, serviceId: $serviceId)
  }
`;

/**
 * Dispara un redeploy de mev-cron (que corre el chequeo de MEV una vez y se apaga)
 * usando la API pública de Railway. Reutiliza el cron pesado (Python+Selenium+Chromium)
 * en vez de duplicarlo en este servicio liviano.
 */
export async function triggerMevCronNow(): Promise<void> {
  const token = requireEnv('RAILWAY_API_TOKEN');
  const environmentId = requireEnv('RAILWAY_ENVIRONMENT_ID');
  const serviceId = requireEnv('MEV_CRON_SERVICE_ID');

  const res = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: REDEPLOY_MUTATION,
      variables: { environmentId, serviceId },
    }),
  });

  if (!res.ok) {
    throw new Error(`Railway API respondió ${res.status}`);
  }

  const body = (await res.json()) as { errors?: { message: string }[]; data?: { serviceInstanceRedeploy?: boolean } };
  if (body.errors?.length) {
    throw new Error(body.errors[0].message);
  }
  if (!body.data?.serviceInstanceRedeploy) {
    throw new Error('Railway no confirmó el redeploy');
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}
