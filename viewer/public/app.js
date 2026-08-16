(function () {
  const csrfToken = document.body.getAttribute('data-csrf') || '';

  function applyFilters() {
    const textInput = document.getElementById('filter-input');
    const jurisSelect = document.getElementById('filter-jurisdiccion');
    const q = textInput ? textInput.value.trim().toLowerCase() : '';
    const j = jurisSelect ? jurisSelect.value : '';
    document.querySelectorAll('#exp-table tbody tr').forEach((tr) => {
      const matchesText = !q || tr.textContent.toLowerCase().includes(q);
      const matchesJuris = !j || tr.getAttribute('data-jurisdiccion') === j;
      tr.style.display = matchesText && matchesJuris ? '' : 'none';
    });
  }

  const filterInput = document.getElementById('filter-input');
  const filterJuris = document.getElementById('filter-jurisdiccion');
  if (filterInput) filterInput.addEventListener('input', applyFilters);
  if (filterJuris) filterJuris.addEventListener('change', applyFilters);

  // Orden por columna: click en un <th class="sortable"> reordena las filas del <tbody>.
  document.querySelectorAll('#exp-table th.sortable').forEach((th) => {
    let dir = 1;
    th.addEventListener('click', () => {
      const colIndex = Number(th.getAttribute('data-sort'));
      const tbody = document.querySelector('#exp-table tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));

      document.querySelectorAll('#exp-table th.sortable').forEach((t) => t.classList.remove('active'));
      th.classList.add('active');
      th.querySelector('.arrow').textContent = dir === 1 ? '↑' : '↓';

      rows.sort((a, b) => {
        const cellA = a.children[colIndex];
        const cellB = b.children[colIndex];
        const valA = (cellA.getAttribute('data-value') ?? cellA.textContent).trim().toLowerCase();
        const valB = (cellB.getAttribute('data-value') ?? cellB.textContent).trim().toLowerCase();
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
      });
      rows.forEach((r) => tbody.appendChild(r));
      dir *= -1;
    });
  });

  // --- Wizard "Buscar expediente en MEV" (departamento -> juzgado -> carátula) ---
  const addDialog = document.getElementById('add-dialog');
  const openAddBtn = document.getElementById('open-add-dialog');
  const closeAddBtn = document.getElementById('close-add-dialog');
  const wizardSubtitle = document.getElementById('wizard-subtitle');
  const wizardLoading = document.getElementById('wizard-loading');
  const wizardErrorBox = document.getElementById('wizard-error');
  const wizardErrorMsg = document.getElementById('wizard-error-msg');
  const wizardForm = document.getElementById('wizard-form');
  const wizardDepto = document.getElementById('wizard-departamento');
  const wizardJuzgado = document.getElementById('wizard-juzgado');
  const wizardQuery = document.getElementById('wizard-query');
  const wizardSearchBtn = document.getElementById('wizard-search-btn');
  const wizardResults = document.getElementById('wizard-results');
  const manualForm = document.getElementById('manual-form');
  const toggleManual = document.getElementById('toggle-manual');
  const fromSearchForm = document.getElementById('from-search-form');

  function wizardShowError(msg) {
    wizardLoading.style.display = 'none';
    wizardForm.style.display = 'none';
    wizardErrorBox.style.display = 'block';
    wizardErrorMsg.textContent = msg;
    wizardSubtitle.textContent = 'No se pudo conectar con MEV';
  }

  async function wizardOpen() {
    wizardLoading.style.display = 'block';
    wizardErrorBox.style.display = 'none';
    wizardForm.style.display = 'none';
    wizardResults.innerHTML = '';
    wizardQuery.value = '';
    wizardJuzgado.innerHTML = '<option value="">Primero seleccioná departamento</option>';
    wizardJuzgado.disabled = true;
    wizardQuery.disabled = true;
    wizardSearchBtn.disabled = true;
    wizardSubtitle.textContent = 'Conectando con MEV...';
    manualForm.style.display = 'none';
    if (addDialog) addDialog.showModal();

    try {
      const res = await fetch('/mev/departamentos');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo cargar departamentos');

      wizardDepto.innerHTML = '<option value="">Seleccioná un departamento</option>' +
        (body.departamentos || []).map((d) => `<option value="${escapeAttr(d)}">${escapeAttr(d)}</option>`).join('');

      wizardLoading.style.display = 'none';
      wizardForm.style.display = 'block';
      wizardSubtitle.textContent = 'Seleccioná departamento y juzgado, luego buscá por carátula';
    } catch (err) {
      wizardShowError(err.message || 'No se pudo conectar con MEV');
    }
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  if (wizardDepto) {
    wizardDepto.addEventListener('change', async () => {
      wizardResults.innerHTML = '';
      wizardJuzgado.innerHTML = '<option value="">Cargando juzgados...</option>';
      wizardJuzgado.disabled = true;
      wizardQuery.disabled = true;
      wizardSearchBtn.disabled = true;
      if (!wizardDepto.value) {
        wizardJuzgado.innerHTML = '<option value="">Primero seleccioná departamento</option>';
        return;
      }
      try {
        const res = await fetch('/mev/juzgados?departamento=' + encodeURIComponent(wizardDepto.value));
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'No se pudo cargar juzgados');
        wizardJuzgado.innerHTML = '<option value="">Seleccioná un juzgado</option>' +
          (body.juzgados || []).map((j) => `<option value="${escapeAttr(j)}">${escapeAttr(j)}</option>`).join('');
        wizardJuzgado.disabled = false;
      } catch (err) {
        wizardJuzgado.innerHTML = '<option value="">Error cargando juzgados</option>';
      }
    });
  }

  if (wizardJuzgado) {
    wizardJuzgado.addEventListener('change', () => {
      const enabled = !!wizardJuzgado.value;
      wizardQuery.disabled = !enabled;
      wizardSearchBtn.disabled = !enabled;
      wizardResults.innerHTML = '';
    });
  }

  async function runSearch() {
    const departamento = wizardDepto.value;
    const juzgado = wizardJuzgado.value;
    const query = wizardQuery.value.trim();
    if (!departamento || !juzgado) return;
    if (query.length < 3) {
      wizardResults.innerHTML = '<p class="error">Ingresá al menos 3 caracteres</p>';
      return;
    }
    // La búsqueda de MEV tarda ~30-45s desde el servidor; avisar para que no
    // parezca que se colgó.
    wizardResults.innerHTML = '<div class="spinner"></div><p class="muted" style="text-align:center;">Buscando en MEV… puede tardar hasta un minuto.</p>';
    try {
      const res = await fetch(
        '/mev/search?departamento=' + encodeURIComponent(departamento) +
          '&juzgado=' + encodeURIComponent(juzgado) +
          '&query=' + encodeURIComponent(query),
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo buscar');
      const results = body.results || [];
      if (results.length === 0) {
        wizardResults.innerHTML = '<p class="muted">No se encontraron expedientes.</p>';
        return;
      }
      wizardResults.innerHTML = results
        .map(
          (r, i) => `<button type="button" class="btn btn-secondary" style="width:100%;justify-content:space-between;margin-bottom:6px;text-align:left;" data-result-index="${i}">
            <span>${escapeAttr(r.caratula)}${r.numeroExpediente ? ' — ' + escapeAttr(r.numeroExpediente) : ''}</span>
          </button>`,
        )
        .join('');
      wizardResults.querySelectorAll('[data-result-index]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const r = results[Number(btn.getAttribute('data-result-index'))];
          document.getElementById('from-search-caratula').value = r.caratula || '';
          document.getElementById('from-search-url').value = r.url || '';
          document.getElementById('from-search-departamento').value = departamento;
          document.getElementById('from-search-numero').value = r.numeroExpediente || '';
          fromSearchForm.submit();
        });
      });
    } catch (err) {
      wizardResults.innerHTML = '<p class="error">' + escapeAttr(err.message || 'No se pudo buscar') + '</p>';
    }
  }

  if (wizardSearchBtn) wizardSearchBtn.addEventListener('click', runSearch);
  if (wizardQuery) {
    wizardQuery.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearch();
      }
    });
  }

  if (toggleManual) {
    toggleManual.addEventListener('click', (e) => {
      e.preventDefault();
      const showingManual = manualForm.style.display !== 'none';
      manualForm.style.display = showingManual ? 'none' : 'block';
      wizardForm.style.display = showingManual ? 'block' : 'none';
      toggleManual.textContent = showingManual ? 'o cargar manualmente sin buscar' : 'volver a la búsqueda en MEV';
    });
  }

  if (addDialog && openAddBtn) openAddBtn.addEventListener('click', wizardOpen);
  if (addDialog && closeAddBtn) closeAddBtn.addEventListener('click', () => addDialog.close());

  document.querySelectorAll('form.js-confirm-delete').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!confirm('¿Eliminar este expediente del seguimiento?')) e.preventDefault();
    });
  });

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const dialog = document.getElementById('refresh-dialog');
      const status = document.getElementById('refresh-status');
      const spinner = document.getElementById('refresh-spinner');
      const detail = document.getElementById('refresh-detail');
      const closeWrap = document.getElementById('refresh-close-wrap');
      closeWrap.style.display = 'none';
      spinner.style.display = 'block';
      status.textContent = 'Conectando con MEV...';
      detail.textContent = 'Revisando los expedientes en MEV, tarda unos segundos.';
      dialog.showModal();

      let res;
      try {
        res = await fetch('/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: '_csrf=' + encodeURIComponent(csrfToken),
        });
      } catch (err) {
        spinner.style.display = 'none';
        status.textContent = 'No se pudo disparar el chequeo';
        detail.textContent = 'Error de red, probá de nuevo.';
        closeWrap.style.display = 'flex';
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        spinner.style.display = 'none';
        status.textContent = 'No se pudo disparar el chequeo';
        detail.textContent = body.error || 'Probá de nuevo en unos minutos.';
        closeWrap.style.display = 'flex';
        return;
      }

      // El chequeo corre en el propio viewer y tarda ~10s, así que la respuesta
      // ya trae el resultado: no hace falta hacer polling.
      const r = await res.json();
      spinner.style.display = 'none';
      status.textContent = 'Listo';
      const partes = [`${r.chequeados} expediente(s) revisados en ${(r.ms / 1000).toFixed(1)}s`];
      if (r.conNovedades > 0) partes.push(`${r.conNovedades} con movimientos nuevos`);
      else partes.push('sin movimientos nuevos');
      if (r.problemas > 0) partes.push(`${r.problemas} no se pudieron leer`);
      detail.textContent = partes.join(' · ');
      closeWrap.style.display = 'flex';
    });
  }

  const viewResultsBtn = document.getElementById('refresh-view-results');
  if (viewResultsBtn) viewResultsBtn.addEventListener('click', () => location.reload());
})();
