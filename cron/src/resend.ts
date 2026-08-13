type MovementEmailItem = {
  numeroExpediente: string;
  caratula: string;
  fechaUltimoMovimiento: Date;
  tituloUltimoMovimiento: string | null;
};

export async function sendMovementsEmail(items: MovementEmailItem[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const fromName = process.env.RESEND_FROM_NAME || 'MEV Monitor';
  const to = process.env.NOTIFY_EMAIL;

  if (!apiKey || !from || !to) {
    throw new Error('Faltan RESEND_API_KEY / RESEND_FROM_EMAIL / NOTIFY_EMAIL en el entorno');
  }
  if (items.length === 0) return;

  const rows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(i.numeroExpediente)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(i.caratula)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${i.fechaUltimoMovimiento.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(i.tituloUltimoMovimiento || '-')}</td>
      </tr>`,
    )
    .join('');

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      <h2>Movimientos detectados en MEV (${items.length})</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="text-align:left;background:#f4f4f4;">
            <th style="padding:8px;">Expediente</th>
            <th style="padding:8px;">Carátula</th>
            <th style="padding:8px;">Último movimiento</th>
            <th style="padding:8px;">Detalle</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${from}>`,
      to: [to],
      subject: `MEV: ${items.length} expediente(s) con movimientos nuevos`,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend respondió ${res.status}: ${body.slice(0, 500)}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
