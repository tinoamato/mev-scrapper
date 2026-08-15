(function () {
  const csrfToken = document.body.getAttribute('data-csrf') || '';

  const filterInput = document.getElementById('filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      const q = filterInput.value.trim().toLowerCase();
      document.querySelectorAll('#exp-table tbody tr').forEach((tr) => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

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
