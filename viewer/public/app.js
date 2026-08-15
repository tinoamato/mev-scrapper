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

  const addDialog = document.getElementById('add-dialog');
  const openAddBtn = document.getElementById('open-add-dialog');
  const closeAddBtn = document.getElementById('close-add-dialog');
  if (addDialog && openAddBtn) openAddBtn.addEventListener('click', () => addDialog.showModal());
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
      detail.textContent = 'Este proceso puede tardar unos minutos.';
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
    });
  }

  const viewResultsBtn = document.getElementById('refresh-view-results');
  if (viewResultsBtn) viewResultsBtn.addEventListener('click', () => location.reload());
})();
