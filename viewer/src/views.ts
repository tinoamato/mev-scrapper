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
    --teal-500: #2A7B7B;
    --teal-600: #226363;
    --teal-400: #3A9E9E;
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
  .wrap { max-width: 1080px; margin: 0 auto; }
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
    align-items: flex-start; margin-bottom: 28px;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; }

  .btn {
    font-family: 'Outfit', sans-serif; font-weight: 500; font-size: 14px;
    border-radius: 8px; padding: 10px 20px; border: none; cursor: pointer;
    transition: background-color 150ms;
  }
  .btn-primary { background: var(--burgundy-500); color: var(--bg-secondary); }
  .btn-primary:hover { background: var(--burgundy-600); }
  .btn-secondary {
    background: transparent; color: var(--text-primary);
    border: 1px solid var(--border-strong);
  }
  .btn-secondary:hover { background: var(--bg-secondary); }
  .btn-ghost {
    background: transparent; color: var(--text-secondary);
    border: 1px dashed var(--border-strong); cursor: default;
  }

  .card {
    background: var(--bg-tertiary); border: 1px solid var(--border-default);
    border-radius: 12px; padding: 24px; box-shadow: var(--shadow-sm);
  }
  .card-title { font-size: 18px; font-weight: 500; margin: 0 0 2px; }
  .card-desc { color: var(--text-secondary); font-size: 13px; margin: 0; }
  .card-header {
    display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between;
    align-items: flex-start; margin-bottom: 16px;
  }

  input[type="text"], input[type="password"] {
    background: var(--bg-secondary); border: 1px solid var(--border-default);
    border-radius: 8px; padding: 10px 14px; font-family: 'Outfit', sans-serif;
    font-size: 14px; color: var(--text-primary); width: 100%;
  }
  input:focus { outline: none; border-color: var(--teal-400); box-shadow: 0 0 0 2px rgba(58, 158, 158, 0.2); }
  input::placeholder { color: var(--text-tertiary); }
  label { display: block; font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px; }
  .field { margin-bottom: 16px; }

  table { border-collapse: collapse; width: 100%; }
  thead th {
    text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--text-secondary);
    border-bottom: 1px solid var(--border-default); padding: 10px 8px;
  }
  tbody td { padding: 12px 8px; font-size: 14px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  tbody tr:hover { background: var(--bg-secondary); }

  .badge {
    background: var(--badge-error-bg); color: var(--badge-error-fg);
    border-radius: 999px; padding: 2px 10px; font-size: 11px; font-weight: 600;
    margin-left: 6px; white-space: nowrap;
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

function layout(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${THEME_STYLE}</style></head><body><div class="wrap">${body}</div></body></html>`;
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

export function loginPage(opts: { csrfToken: string; error?: string }): string {
  return layout(
    'MEV — Themis',
    `
    <div class="navbar">${logoSvg(24)}<span class="wordmark">Themis</span></div>
    <div class="card center" style="max-width:380px;margin:60px auto;">
      <div class="center" style="margin-bottom:20px;">${logoSvg(40)}</div>
      <h2 class="card-title" style="text-align:center;">MEV</h2>
      <p class="card-desc" style="text-align:center;margin-bottom:20px;">Seguimiento automático de expedientes</p>
      ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ''}
      <form method="post" action="/login">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <div class="field"><input type="text" name="username" placeholder="Usuario" autocomplete="username" required /></div>
        <div class="field"><input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" required /></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Entrar</button>
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
  fechaUltimoMovimiento: Date | null;
  tituloUltimoMovimiento: string | null;
  hasNewMovements: boolean;
  lastCheckedAt: Date | null;
};

function fmt(d: Date | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

export function dashboardPage(opts: {
  csrfToken: string;
  expedientes: ExpedienteRow[];
  cronSchedule: string;
}): string {
  const rows = opts.expedientes
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.numeroExpediente)}${e.hasNewMovements ? '<span class="badge">nuevo</span>' : ''}</td>
        <td>${escapeHtml(e.jurisdiccion || '-')}</td>
        <td>${escapeHtml(e.caratula)}</td>
        <td>${fmt(e.fechaUltimoMovimiento)}</td>
        <td>${escapeHtml(e.tituloUltimoMovimiento || '-')}</td>
        <td>${fmt(e.lastCheckedAt)}</td>
        <td>
          ${e.hasNewMovements ? `<form method="post" action="/expedientes/${e.id}/marcar-visto" style="display:inline;">
              <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
              <button type="submit" class="btn btn-secondary" style="padding:4px 10px;font-size:12px;">Marcar visto</button>
            </form>` : ''}
          <form method="post" action="/expedientes/${e.id}/eliminar" style="display:inline;" onsubmit="return confirm('¿Eliminar este expediente del seguimiento?')">
            <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
            <button type="submit" class="btn btn-secondary" style="padding:4px 10px;font-size:12px;">Eliminar</button>
          </form>
        </td>
      </tr>`,
    )
    .join('');

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
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('add-dialog').showModal()">+ Agregar expediente</button>
        <button type="button" class="btn btn-primary" id="refresh-btn" onclick="triggerRefresh()">↻ Actualizar desde MEV</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <p class="card-title" style="margin:0;">Expedientes guardados</p>
          <p class="card-desc">Se actualizan con "Actualizar desde MEV" o solos, todos los días</p>
        </div>
        <input type="text" id="filter-input" placeholder="Filtrar por carátula o número..." style="max-width:280px;" oninput="filterRows()" />
      </div>
      <div style="overflow-x:auto;">
        <table id="exp-table">
          <thead><tr><th>Expediente</th><th>Jurisdicción</th><th>Carátula</th><th>Último movimiento</th><th>Detalle</th><th>Último chequeo</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted">No hay expedientes cargados todavía.</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <dialog id="add-dialog">
      <div class="dialog-body">
        <p class="dialog-title">Agregar expediente</p>
        <p class="card-desc" style="margin-bottom:18px;">Se suma a la lista que revisa el chequeo diario.</p>
        <form method="post" action="/expedientes">
          <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
          <div class="field"><label>Número de expediente</label><input type="text" name="numeroExpediente" required /></div>
          <div class="field"><label>Carátula</label><input type="text" name="caratula" required /></div>
          <div class="field"><label>Jurisdicción (opcional)</label><input type="text" name="jurisdiccion" /></div>
          <div class="field"><label>URL de MEV (opcional)</label><input type="text" name="mevUrl" placeholder="procesales.asp?..." /></div>
          <div class="dialog-actions">
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('add-dialog').close()">Cancelar</button>
            <button type="submit" class="btn btn-primary">Agregar</button>
          </div>
        </form>
      </div>
    </dialog>

    <dialog id="refresh-dialog">
      <div class="dialog-body center">
        <p class="dialog-title">Buscar expediente en MEV</p>
        <p class="card-desc" id="refresh-status">Conectando con MEV...</p>
        <div class="spinner" id="refresh-spinner"></div>
        <p class="muted" id="refresh-detail">Este proceso puede tardar unos minutos.</p>
        <div class="dialog-actions" id="refresh-close-wrap" style="display:none;">
          <button type="button" class="btn btn-primary" onclick="location.reload()">Ver resultados</button>
        </div>
      </div>
    </dialog>

    <script>
      function filterRows() {
        const q = document.getElementById('filter-input').value.trim().toLowerCase();
        document.querySelectorAll('#exp-table tbody tr').forEach((tr) => {
          tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      }

      async function triggerRefresh() {
        const dialog = document.getElementById('refresh-dialog');
        const status = document.getElementById('refresh-status');
        const spinner = document.getElementById('refresh-spinner');
        const detail = document.getElementById('refresh-detail');
        const closeWrap = document.getElementById('refresh-close-wrap');
        closeWrap.style.display = 'none';
        spinner.style.display = 'block';
        status.textContent = 'Conectando con MEV...';
        detail.textContent = 'Este proceso puede tardar unos minutos.';
        dialog.showModal();

        const res = await fetch('/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: '_csrf=' + encodeURIComponent('${opts.csrfToken}'),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          spinner.style.display = 'none';
          status.textContent = 'No se pudo disparar el chequeo';
          detail.textContent = body.error || 'Probá de nuevo en unos minutos.';
          closeWrap.style.display = 'flex';
          return;
        }

        status.textContent = 'Revisando expedientes en MEV...';
        const poll = setInterval(async () => {
          const s = await fetch('/trigger-status').then((r) => r.json());
          if (s.done) {
            clearInterval(poll);
            spinner.style.display = 'none';
            status.textContent = 'Listo';
            detail.textContent = 'Se actualizaron los expedientes.';
            closeWrap.style.display = 'flex';
          }
        }, 15000);
      }
    </script>
    `,
  );
}

export function errorPage(message: string): string {
  return layout('Error — MEV', `<p class="error">${escapeHtml(message)}</p><p><a class="icon-link" href="/">Volver</a></p>`);
}
