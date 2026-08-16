function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Paleta y tipografía tomadas de THEMIS-BRAND-SYSTEM.md (legal-saas) — solo light mode,
// sin Tailwind: server-rendered plano, mismo resultado visual con CSS puro.
const THEME_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Outfit:wght@300;400;500;600&display=swap');

  :root {
    --bg-primary: #FAF9F6;
    --bg-secondary: #F2F0EB;
    --bg-tertiary: #FFFFFF;
    --text-primary: #1A1A2E;
    --text-secondary: #6B6B8D;
    --text-tertiary: #B8B8D1;
    --border-default: #E8E6E1;
    --border-subtle: #F2F0EB;
    --border-strong: #6B6B8D;
    --burgundy-500: #7A2D3A;
    --burgundy-600: #62242E;
    --teal-50: #EEFAFA;
    --teal-100: #C8EDED;
    --teal-200: #91DBDB;
    --teal-500: #2A7B7B;
    --teal-600: #226363;
    --teal-700: #1A4B4B;
    --teal-400: #3A9E9E;
    --teal-900: #0A1B1B;
    --badge-error-bg: rgba(122, 45, 58, 0.12);
    --badge-error-fg: #9E4A5A;
    --shadow-sm: 0 1px 3px rgba(26, 26, 46, 0.06);
    --shadow-md: 0 4px 12px rgba(26, 26, 46, 0.08);
  }

  * { box-sizing: border-box; }
  body {
    font-family: 'Outfit', system-ui, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    margin: 0;
    padding: 0 24px 64px;
    font-size: 15px;
    line-height: 1.625;
  }
  .wrap { max-width: 1120px; margin: 0 auto; }
  .navbar {
    display: flex; align-items: center; gap: 12px;
    padding: 20px 0; border-bottom: 1px solid var(--border-default);
    margin-bottom: 32px;
  }
  .wordmark {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-weight: 300; font-size: 22px; letter-spacing: 0.15em;
    text-transform: uppercase; color: var(--text-primary);
  }
  h1 {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-weight: 300; font-size: 40px; letter-spacing: 0.02em;
    margin: 0 0 4px;
  }
  .subtitle { color: var(--text-secondary); font-size: 14px; margin: 0; }
  .top {
    display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between;
    align-items: flex-start; margin-bottom: 24px;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; }

  .btn {
    font-family: 'Outfit', sans-serif; font-weight: 500; font-size: 14px;
    border-radius: 8px; padding: 10px 20px; border: none; cursor: pointer;
    transition: background-color 150ms; display: inline-flex; align-items: center; gap: 6px;
  }
  .btn-primary { background: var(--burgundy-500); color: var(--bg-secondary); }
  .btn-primary:hover { background: var(--burgundy-600); }
  .btn-secondary {
    background: transparent; color: var(--text-primary);
    border: 1px solid var(--border-strong);
  }
  .btn-secondary:hover { background: var(--bg-secondary); }
  .btn-teal { background: transparent; color: var(--teal-700); border: 1px solid var(--teal-200); }
  .btn-teal:hover { background: var(--teal-50); }
  .btn-ghost {
    background: transparent; color: var(--text-secondary);
    border: 1px dashed var(--border-strong); cursor: default;
  }
  .icon-btn {
    background: transparent; border: 1px solid var(--border-default); border-radius: 6px;
    width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--text-secondary); padding: 0;
  }
  .icon-btn:hover { background: var(--bg-secondary); color: var(--text-primary); }
  .icon-btn.danger:hover { background: var(--badge-error-bg); color: var(--badge-error-fg); border-color: var(--badge-error-fg); }
  .icon-btn.teal:hover { background: var(--teal-50); color: var(--teal-700); border-color: var(--teal-200); }
  .btn:disabled, .icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .card {
    background: var(--bg-tertiary); border: 1px solid var(--border-default);
    border-radius: 12px; padding: 24px; box-shadow: var(--shadow-sm);
  }
  .card-teal { background: var(--teal-50); border-color: var(--teal-200); }
  .card-title { font-size: 18px; font-weight: 500; margin: 0 0 2px; display: flex; align-items: center; gap: 8px; }
  .card-desc { color: var(--text-secondary); font-size: 13px; margin: 0; }
  .card-header {
    display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between;
    align-items: flex-start; margin-bottom: 16px;
  }

  input[type="text"], input[type="password"], select {
    background: var(--bg-secondary); border: 1px solid var(--border-default);
    border-radius: 8px; padding: 10px 14px; font-family: 'Outfit', sans-serif;
    font-size: 14px; color: var(--text-primary); width: 100%;
  }
  input:focus, select:focus { outline: none; border-color: var(--teal-400); box-shadow: 0 0 0 2px rgba(58, 158, 158, 0.2); }
  input::placeholder { color: var(--text-tertiary); }
  label { display: block; font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px; }
  .field { margin-bottom: 16px; }
  .filters { display: flex; flex-wrap: wrap; gap: 10px; }
  .filters input { max-width: 260px; }
  .filters select { max-width: 220px; }

  table { border-collapse: collapse; width: 100%; }
  thead th {
    text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--text-secondary);
    border-bottom: 1px solid var(--border-default); padding: 10px 8px;
    white-space: nowrap;
  }
  th.sortable { cursor: pointer; user-select: none; }
  th.sortable:hover { color: var(--text-primary); }
  th.sortable .arrow { opacity: 0.4; margin-left: 3px; }
  th.sortable.active .arrow { opacity: 1; color: var(--teal-600); }
  tbody td { padding: 12px 8px; font-size: 14px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  tbody tr:hover { background: var(--bg-secondary); }
  tbody tr.is-new { background: var(--teal-50); }
  tbody tr.is-new:hover { background: var(--teal-100); }
  .actions-cell { display: flex; justify-content: flex-end; gap: 6px; white-space: nowrap; }

  .badge-new {
    display: inline-block; margin-top: 4px;
    background: var(--teal-100); color: var(--teal-700);
    border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600;
  }
  .muted { color: var(--text-secondary); font-size: 13px; }
  .error { color: var(--burgundy-500); font-size: 14px; }
  a.icon-link { color: var(--teal-600); text-decoration: none; font-size: 13px; }
  a.icon-link:hover { text-decoration: underline; }

  dialog {
    border: none; border-radius: 16px; padding: 0; max-width: 440px; width: 90vw;
    box-shadow: var(--shadow-md);
  }
  dialog::backdrop { background: rgba(26, 26, 46, 0.4); }
  .dialog-body { padding: 28px; }
  .dialog-title { font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; font-size: 24px; margin: 0 0 4px; }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
  .spinner {
    width: 28px; height: 28px; border-radius: 50%;
    border: 3px solid var(--border-default); border-top-color: var(--burgundy-500);
    animation: spin 0.8s linear infinite; margin: 8px auto 16px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .center { text-align: center; }
`;

function layout(title: string, body: string, opts?: { csrfToken?: string }): string {
  const dataCsrf = opts?.csrfToken ? ` data-csrf="${escapeHtml(opts.csrfToken)}"` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${THEME_STYLE}</style></head><body${dataCsrf}><div class="wrap">${body}</div><script src="/app.js" defer></script></body></html>`;
}

function logoSvg(size = 28): string {
  const main = '#1A1A2E';
  const platL = '#7A2D3A';
  const platR = '#2A7B7B';
  const w = 1.5 * (size / 80);
  return `<svg width="${size}" height="${size}" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="40,12 36,18 44,18" fill="${main}" />
    <line x1="40" y1="18" x2="40" y2="56" stroke="${main}" stroke-width="${w}" />
    <line x1="18" y1="30" x2="62" y2="30" stroke="${main}" stroke-width="${w}" />
    <path d="M12,38 Q18,48 24,38" stroke="${platL}" stroke-width="${w * 1.2}" fill="none" />
    <line x1="18" y1="30" x2="12" y2="38" stroke="${main}" stroke-width="${w * 0.8}" />
    <line x1="18" y1="30" x2="24" y2="38" stroke="${main}" stroke-width="${w * 0.8}" />
    <path d="M56,38 Q62,48 68,38" stroke="${platR}" stroke-width="${w * 1.2}" fill="none" />
    <line x1="62" y1="30" x2="56" y2="38" stroke="${main}" stroke-width="${w * 0.8}" />
    <line x1="62" y1="30" x2="68" y2="38" stroke="${main}" stroke-width="${w * 0.8}" />
    <line x1="30" y1="56" x2="50" y2="56" stroke="${main}" stroke-width="${w}" />
    <line x1="28" y1="60" x2="52" y2="60" stroke="${main}" stroke-width="${w * 0.8}" opacity="0.4" />
  </svg>`;
}

const ICON_EXTERNAL = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none"><path d="M3 8.5l3.2 3.2L13 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none"><path d="M2.5 4.5h11M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5M4.5 4.5l.6 8a1 1 0 001 .9h3.8a1 1 0 001-.9l.6-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none"><path d="M13 4.5A5.5 5.5 0 103 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M13 2v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function loginPage(opts: { csrfToken: string; error?: string }): string {
  return layout(
    'MEV — Themis',
    `
    <div class="navbar">${logoSvg(24)}<span class="wordmark">Themis</span></div>
    <div class="card center" style="max-width:380px;margin:60px auto;">
      <div class="center" style="margin-bottom:20px;">${logoSvg(40)}</div>
      <h2 class="card-title" style="justify-content:center;">MEV</h2>
      <p class="card-desc" style="text-align:center;margin-bottom:20px;">Seguimiento automático de expedientes</p>
      ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ''}
      <form method="post" action="/login">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <div class="field"><input type="text" name="username" placeholder="Usuario" autocomplete="username" required /></div>
        <div class="field"><input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" required /></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">Entrar</button>
      </form>
    </div>
    `,
  );
}

type ExpedienteRow = {
  id: string;
  numeroExpediente: string;
  caratula: string;
  jurisdiccion: string | null;
  mevUrl: string | null;
  fechaUltimoMovimiento: Date | null;
  tituloUltimoMovimiento: string | null;
  hasNewMovements: boolean;
  lastCheckedAt: Date | null;
};

function fmt(d: Date | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function openMevBtn(mevUrl: string | null): string {
  if (!mevUrl) return '';
  return `<a class="icon-btn" href="${escapeHtml(mevUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir en MEV">${ICON_EXTERNAL}</a>`;
}

export function dashboardPage(opts: {
  csrfToken: string;
  expedientes: ExpedienteRow[];
  cronSchedule: string;
}): string {
  const newMovements = opts.expedientes.filter((e) => e.hasNewMovements);
  const jurisdicciones = Array.from(new Set(opts.expedientes.map((e) => e.jurisdiccion).filter((j): j is string => !!j))).sort();

  const newMovementsBanner = newMovements.length
    ? `
    <div class="card card-teal" style="margin-bottom:24px;">
      <div class="card-header">
        <div>
          <p class="card-title" style="color:var(--teal-700);">${ICON_REFRESH} Nuevos movimientos (${newMovements.length})</p>
          <p class="card-desc">Expedientes con actualizaciones detectadas en el último chequeo</p>
        </div>
        <form method="post" action="/expedientes/marcar-todos-vistos">
          <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
          <button type="submit" class="btn btn-teal">${ICON_CHECK} Marcar todo como leído</button>
        </form>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Nro expediente</th><th>Jurisdicción</th><th>Carátula</th><th>Último movimiento</th><th>Título</th><th></th></tr></thead>
          <tbody>
            ${newMovements
              .map(
                (e) => `
              <tr>
                <td>${escapeHtml(e.numeroExpediente)}</td>
                <td>${escapeHtml(e.jurisdiccion || '-')}</td>
                <td>${escapeHtml(e.caratula)}</td>
                <td style="font-weight:600;color:var(--teal-700);">${fmt(e.fechaUltimoMovimiento)}</td>
                <td>${escapeHtml(e.tituloUltimoMovimiento || '-')}</td>
                <td>
                  <div class="actions-cell">
                    ${openMevBtn(e.mevUrl)}
                    <form method="post" action="/expedientes/${e.id}/marcar-visto">
                      <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
                      <button type="submit" class="icon-btn teal" title="Marcar como visto">${ICON_CHECK}</button>
                    </form>
                  </div>
                </td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`
    : '';

  const rows = opts.expedientes
    .map(
      (e) => `
      <tr class="${e.hasNewMovements ? 'is-new' : ''}" data-jurisdiccion="${escapeHtml(e.jurisdiccion || '')}">
        <td data-value="${escapeHtml(e.numeroExpediente)}">${escapeHtml(e.numeroExpediente)}${e.hasNewMovements ? '<span class="badge-new">Nuevo</span>' : ''}</td>
        <td>${escapeHtml(e.jurisdiccion || '-')}</td>
        <td data-value="${escapeHtml(e.caratula)}">${escapeHtml(e.caratula)}</td>
        <td data-value="${e.fechaUltimoMovimiento ? e.fechaUltimoMovimiento.toISOString() : ''}">${fmt(e.fechaUltimoMovimiento)}</td>
        <td>${escapeHtml(e.tituloUltimoMovimiento || '-')}</td>
        <td data-value="${e.lastCheckedAt ? e.lastCheckedAt.toISOString() : ''}">${fmt(e.lastCheckedAt)}</td>
        <td>
          <div class="actions-cell">
            ${e.hasNewMovements ? `<form method="post" action="/expedientes/${e.id}/marcar-visto">
                <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
                <button type="submit" class="icon-btn teal" title="Marcar como visto">${ICON_CHECK}</button>
              </form>` : ''}
            ${openMevBtn(e.mevUrl)}
            <form method="post" action="/expedientes/${e.id}/eliminar" class="js-confirm-delete">
              <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
              <button type="submit" class="icon-btn danger" title="Eliminar">${ICON_TRASH}</button>
            </form>
          </div>
        </td>
      </tr>`,
    )
    .join('');

  const jurisdiccionOptions = jurisdicciones.map((j) => `<option value="${escapeHtml(j)}">${escapeHtml(j)}</option>`).join('');

  return layout(
    'MEV — Themis',
    `
    <div class="navbar" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:10px;">${logoSvg(24)}<span class="wordmark">Themis</span></div>
      <form method="post" action="/logout">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <button type="submit" class="btn btn-secondary" style="padding:6px 14px;font-size:13px;">Salir</button>
      </form>
    </div>

    <div class="top">
      <div>
        <h1>MEV</h1>
        <p class="subtitle">Seguimiento automático de expedientes en MEV</p>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-ghost" title="El horario se configura desde Railway">Chequeo automático · ${escapeHtml(opts.cronSchedule)}</button>
        <button type="button" class="btn btn-secondary" id="open-add-dialog">+ Agregar expediente</button>
        <button type="button" class="btn btn-primary" id="refresh-btn">${ICON_REFRESH} Actualizar desde MEV</button>
      </div>
    </div>

    ${newMovementsBanner}

    <div class="card">
      <div class="card-header">
        <div>
          <p class="card-title" style="margin:0;">Expedientes guardados</p>
          <p class="card-desc">Se actualizan con "Actualizar desde MEV" o solos, todos los días</p>
        </div>
        <div class="filters">
          <input type="text" id="filter-input" placeholder="Filtrar por carátula o número..." />
          <select id="filter-jurisdiccion">
            <option value="">Todas las jurisdicciones</option>
            ${jurisdiccionOptions}
          </select>
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table id="exp-table">
          <thead>
            <tr>
              <th class="sortable" data-sort="0">Expediente <span class="arrow">↕</span></th>
              <th>Jurisdicción</th>
              <th class="sortable" data-sort="2">Carátula <span class="arrow">↕</span></th>
              <th class="sortable" data-sort="3">Último movimiento <span class="arrow">↕</span></th>
              <th>Detalle</th>
              <th class="sortable" data-sort="5">Último chequeo <span class="arrow">↕</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted">No hay expedientes cargados todavía.</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <dialog id="add-dialog" style="max-width:560px;">
      <div class="dialog-body">
        <p class="dialog-title">Buscar expediente en MEV</p>
        <p class="card-desc" id="wizard-subtitle" style="margin-bottom:18px;">Conectando con MEV...</p>

        <div id="wizard-loading" class="center">
          <div class="spinner"></div>
        </div>

        <div id="wizard-error" style="display:none;">
          <p class="error" id="wizard-error-msg"></p>
        </div>

        <div id="wizard-form" style="display:none;">
          <div class="field">
            <label>Departamento</label>
            <select id="wizard-departamento"><option value="">Seleccioná un departamento</option></select>
          </div>
          <div class="field">
            <label>Juzgado</label>
            <select id="wizard-juzgado" disabled><option value="">Primero seleccioná departamento</option></select>
          </div>
          <div class="field">
            <label>Carátula (mínimo 3 caracteres)</label>
            <div style="display:flex;gap:8px;">
              <input type="text" id="wizard-query" placeholder="Apellido, nombre..." disabled />
              <button type="button" class="btn btn-secondary" id="wizard-search-btn" disabled>Buscar</button>
            </div>
          </div>
          <div id="wizard-results"></div>
        </div>

        <p class="muted" style="margin-top:16px;">
          <a href="#" class="icon-link" id="toggle-manual">o cargar manualmente sin buscar</a>
        </p>

        <form method="post" action="/expedientes" id="manual-form" style="display:none;margin-top:12px;">
          <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
          <div class="field"><label>Número de expediente</label><input type="text" name="numeroExpediente" required /></div>
          <div class="field"><label>Carátula</label><input type="text" name="caratula" required /></div>
          <div class="field"><label>Jurisdicción (opcional)</label><input type="text" name="jurisdiccion" /></div>
          <div class="field"><label>URL de MEV (opcional)</label><input type="text" name="mevUrl" placeholder="procesales.asp?..." /></div>
          <div class="dialog-actions">
            <button type="submit" class="btn btn-primary">Agregar manualmente</button>
          </div>
        </form>

        <form method="post" action="/expedientes/from-search" id="from-search-form" style="display:none;">
          <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
          <input type="hidden" name="caratula" id="from-search-caratula" />
          <input type="hidden" name="mevUrl" id="from-search-url" />
          <input type="hidden" name="departamento" id="from-search-departamento" />
          <input type="hidden" name="numeroExpediente" id="from-search-numero" />
        </form>

        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" id="close-add-dialog">Cerrar</button>
        </div>
      </div>
    </dialog>

    <dialog id="refresh-dialog">
      <div class="dialog-body center">
        <p class="dialog-title">Buscar expediente en MEV</p>
        <p class="card-desc" id="refresh-status">Conectando con MEV...</p>
        <div class="spinner" id="refresh-spinner"></div>
        <p class="muted" id="refresh-detail">Revisando los expedientes en MEV, tarda unos segundos.</p>
        <div class="dialog-actions" id="refresh-close-wrap" style="display:none;">
          <button type="button" class="btn btn-primary" id="refresh-view-results">Ver resultados</button>
        </div>
      </div>
    </dialog>
    `,
    { csrfToken: opts.csrfToken },
  );
}

export function errorPage(message: string): string {
  return layout('Error — MEV', `<p class="error">${escapeHtml(message)}</p><p><a class="icon-link" href="/">Volver</a></p>`);
}
