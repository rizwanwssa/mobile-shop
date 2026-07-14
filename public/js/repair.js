'use strict';
/* Repairs (Module 5). List, add, update status. Profit hidden for staff. */
(function () {
  nav.mount();
  if (!api.token) { api.redirectToLogin(); return; }

  const isOwner = api.isOwner();
  document.querySelectorAll('.owner-only').forEach(function (el) { el.classList.add('hidden'); });

  const body = document.getElementById('repBody');
  const formCard = document.getElementById('formCard');
  const form = document.getElementById('repForm');

  async function load() {
    try {
      const data = await api.get('/api/repairs', { allow404: true });
      const list = ui.toArray(data);
      ui.renderList(body, list, function (r) {
        const badge = '<span class="badge badge--' + ui.esc(r.status) + '">' + ui.esc(r.status) + '</span>';
        const statusBtns =
          '<select data-status="' + r.id + '" class="btn btn--sm btn--ghost">' +
          ['pending', 'in_progress', 'ready'].map(function (s) {
            return '<option value="' + s + '"' + (r.status === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select>';
        return '<tr><td>' + ui.esc(r.token_no || r.id) + '</td><td>' + ui.esc(r.customer_name || r.name || '—') +
          '</td><td>' + ui.esc(r.device_model || r.deviceModel || '—') + '</td><td>' + badge + ' ' + statusBtns + '</td>' +
          '<td>' + ui.money(r.service_fee || r.serviceFee) + '</td>' +
          (isOwner ? '<td>' + ui.money(r.profit) + '</td>' : '') +
          '<td></td></tr>';
      }, 'No repairs yet.');
    } catch (e) {
      ui.showComingOnline(body.closest('.card'), 'Repairs are coming online — backend route /api/repairs is not ready yet.');
    }
  }

  document.getElementById('addBtn').addEventListener('click', function () { formCard.classList.toggle('hidden'); });
  document.getElementById('cancelBtn').addEventListener('click', function () { formCard.classList.add('hidden'); });

  body.addEventListener('change', async function (e) {
    const id = e.target.getAttribute('data-status');
    if (!id) return;
    try {
      await api.put('/api/repairs/' + id, { status: e.target.value });
      ui.toast('Status updated', 'success');
      load();
    } catch (err) { ui.showError(err); }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const payload = {
      customerName: document.getElementById('r_name').value.trim(),
      phone: document.getElementById('r_phone').value.trim(),
      deviceModel: document.getElementById('r_model').value.trim(),
      problem: document.getElementById('r_problem').value.trim(),
      partsCost: Number(document.getElementById('r_parts').value || 0),
      serviceFee: Number(document.getElementById('r_fee').value || 0)
    };
    try {
      await api.post('/api/repairs', payload);
      ui.toast('Repair added', 'success');
      form.reset();
      formCard.classList.add('hidden');
      load();
    } catch (err) { ui.showError(err); }
  });

  load();
})();
