function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BASE_STYLE = `
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 14px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e5e5; }
  th { background: #f4f4f4; }
  .badge { background: #d64545; color: white; border-radius: 4px; padding: 2px 6px; font-size: 12px; }
  .top { display: flex; justify-content: space-between; align-items: center; }
  form.inline { display: inline; }
  input, button { font-size: 14px; padding: 8px; }
  button { cursor: pointer; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 24px; margin-top: 40px; }
  .muted { color: #666; font-size: 13px; }
  .error { color: #c00; }
`;

export function loginPage(opts: { csrfToken: string; error?: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>MEV Monitor — Login</title><style>${BASE_STYLE}</style></head>
  <body>
    <div class="card" style="max-width:360px;">
      <h1>MEV Monitor</h1>
      ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ''}
      <form method="post" action="/login">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <p><input type="text" name="username" placeholder="Usuario" autocomplete="username" required style="width:100%;box-sizing:border-box;" /></p>
        <p><input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" required style="width:100%;box-sizing:border-box;" /></p>
        <button type="submit" style="width:100%;">Entrar</button>
      </form>
    </div>
  </body></html>`;
}

type ExpedienteRow = {
  id: string;
  numeroExpediente: string;
  caratula: string;
  jurisdiccion: string | null;
  fechaUltimoMovimiento: Date | null;
  tituloUltimoMovimiento: string | null;
  hasNewMovements: boolean;
  lastCheckedAt: Date | null;
};

export function dashboardPage(opts: { csrfToken: string; expedientes: ExpedienteRow[] }): string {
  const rows = opts.expedientes
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.numeroExpediente)} ${e.hasNewMovements ? '<span class="badge">nuevo</span>' : ''}</td>
        <td>${escapeHtml(e.caratula)}</td>
        <td>${e.fechaUltimoMovimiento ? new Date(e.fechaUltimoMovimiento).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '-'}</td>
        <td>${escapeHtml(e.tituloUltimoMovimiento || '-')}</td>
        <td>${e.lastCheckedAt ? new Date(e.lastCheckedAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '-'}</td>
        <td>
          ${
            e.hasNewMovements
              ? `<form class="inline" method="post" action="/expedientes/${e.id}/marcar-visto">
                   <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
                   <button type="submit">Marcar visto</button>
                 </form>`
              : ''
          }
        </td>
      </tr>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>MEV Monitor</title><style>${BASE_STYLE}</style></head>
  <body>
    <div class="top">
      <h1>Expedientes MEV</h1>
      <form method="post" action="/logout">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <button type="submit">Salir</button>
      </form>
    </div>
    <p class="muted">El chequeo corre una vez al día vía cron. Esta página solo lee lo último guardado.</p>
    <table>
      <thead><tr><th>Expediente</th><th>Carátula</th><th>Último movimiento</th><th>Detalle</th><th>Último chequeo</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">No hay expedientes cargados todavía.</td></tr>'}</tbody>
    </table>

    <div class="card">
      <h2>Agregar expediente a seguir</h2>
      <form method="post" action="/expedientes">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <p><input type="text" name="numeroExpediente" placeholder="Número de expediente" required style="width:100%;box-sizing:border-box;" /></p>
        <p><input type="text" name="caratula" placeholder="Carátula" required style="width:100%;box-sizing:border-box;" /></p>
        <p><input type="text" name="jurisdiccion" placeholder="Jurisdicción (opcional)" style="width:100%;box-sizing:border-box;" /></p>
        <p><input type="text" name="mevUrl" placeholder="URL de MEV (procesales.asp?...)" style="width:100%;box-sizing:border-box;" /></p>
        <button type="submit">Agregar</button>
      </form>
    </div>
  </body></html>`;
}

export function errorPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Error</title><style>${BASE_STYLE}</style></head>
  <body><p class="error">${escapeHtml(message)}</p><p><a href="/">Volver</a></p></body></html>`;
}
