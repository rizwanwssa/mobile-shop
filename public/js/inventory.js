'use strict';
/* Inventory (Module 2). Lists units, add/edit. Purchase price hidden for staff. */
(function () {
  nav.mount();
  if (!api.token) { api.redirectToLogin(); return; }

  const isOwner = api.isOwner();
  // Hide purchase-price UI for staff.
  document.querySelectorAll('.owner-only').forEach(function (el) { el.classList.add('hidden'); });

  const body = document.getElementById('invBody');
  const formCard = document.getElementById('formCard');
  const form = document.getElementById('invForm');
  const formTitle = document.getElementById('formTitle');
  const search = document.getElementById('search');

  let allItems = [];

  async function load() {
    try {
      const data = await api.get('/api/inventory', { allow404: true });
      allItems = ui.toArray(data);
      render();
    } catch (e) {
      ui.showError(e);
      ui.showComingOnline(body.closest('.card'), 'Inventory is coming online — backend route /api/inventory is not ready yet.');
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const list = allItems.filter(function (u) {
      if (!q) return true;
      return [u.brand, u.model, u.imei1, u.imei2].some(function (v) { return String(v || '').toLowerCase().includes(q); });
    });
    ui.renderList(body, list, function (u) {
      const low = (u.status === 'in_stock') && Number(u.quantity || 0) <= 0;
      const statusBadge = '<span class="' + (low ? 'badge badge--low' : 'badge badge--' + ui.esc(u.status)) + '">' +
        ui.esc(u.status) + (low ? ' (low)' : '') + '</span>';
      return '<tr>' +
        '<td>' + ui.esc(u.brand + ' ' + u.model) + '</td>' +
        '<td>' + ui.esc(u.color || '—') + '</td>' +
        '<td>' + ui.esc(u.imei1 || '—') + '</td>' +
        (isOwner ? '<td>' + ui.money(u.purchase_price) + '</td>' : '') +
        '<td>' + ui.money(u.sale_price) + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td class="cell-actions">' +
          '<button class="btn btn--sm btn--ghost" data-edit="' + u.id + '">Edit</button>' +
          (isOwner ? '<button class="btn btn--sm btn--danger" data-del="' + u.id + '">Del</button>' : '') +
        '</td></tr>';
    }, 'No units found.');
  }

  function openForm(unit) {
    form.reset();
    document.getElementById('unitId').value = unit ? unit.id : '';
    formTitle.textContent = unit ? 'Edit Unit' : 'Add Unit';
    if (unit) {
      document.getElementById('f_brand').value = unit.brand || '';
      document.getElementById('f_model').value = unit.model || '';
      document.getElementById('f_color').value = unit.color || '';
      document.getElementById('f_specs').value = unit.specs || '';
      document.getElementById('f_imei1').value = unit.imei1 || '';
      document.getElementById('f_imei2').value = unit.imei2 || '';
      document.getElementById('f_purchase').value = unit.purchase_price || '';
      document.getElementById('f_sale').value = unit.sale_price || '';
    }
    formCard.classList.remove('hidden');
    formCard.scrollIntoView({ behavior: 'smooth' });
  }

  document.getElementById('addBtn').addEventListener('click', function () { openForm(null); });
  document.getElementById('cancelBtn').addEventListener('click', function () { formCard.classList.add('hidden'); });
  search.addEventListener('input', render);

  body.addEventListener('click', async function (e) {
    const editId = e.target.getAttribute('data-edit');
    const delId = e.target.getAttribute('data-del');
    if (editId) {
      const u = allItems.find(function (x) { return String(x.id) === String(editId); });
      openForm(u);
    } else if (delId) {
      if (!confirm('Delete this unit?')) return;
      try {
        await api.del('/api/inventory/' + delId);
        ui.toast('Deleted', 'success');
        load();
      } catch (err) { ui.showError(err); }
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = document.getElementById('unitId').value;
    const payload = {
      brand: document.getElementById('f_brand').value.trim(),
      model: document.getElementById('f_model').value.trim(),
      color: document.getElementById('f_color').value.trim(),
      specs: document.getElementById('f_specs').value.trim(),
      imei1: document.getElementById('f_imei1').value.trim(),
      imei2: document.getElementById('f_imei2').value.trim(),
      sale_price: Number(document.getElementById('f_sale').value || 0)
    };
    if (isOwner) payload.purchase_price = Number(document.getElementById('f_purchase').value || 0);
    try {
      if (id) await api.put('/api/inventory/' + id, payload);
      else await api.post('/api/inventory', payload);
      ui.toast('Saved', 'success');
      formCard.classList.add('hidden');
      load();
    } catch (err) { ui.showError(err); }
  });

  load();
})();
