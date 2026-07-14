'use strict';
/* Customers & Sales (Module 3). Customer CRUD + ID-card upload + sales entry.
   Matches backend contract: idcard {side,dataUrl}; sales {customerId,items:[{description,qty,unitPrice}],discount,paymentMethod,notes}. */
(function () {
  nav.mount();
  if (!api.token) { api.redirectToLogin(); return; }

  const custBody = document.getElementById('custBody');
  const custCard = document.getElementById('custCard');
  const custForm = document.getElementById('custForm');
  const saleBody = document.getElementById('saleBody');
  const custSel = document.getElementById('s_customer');
  const itemsEl = document.getElementById('items');
  const totalEl = document.getElementById('s_total');

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Could not read file')); };
      r.readAsDataURL(file);
    });
  }

  function addItemRow(item) {
    const row = document.createElement('div');
    row.className = 'form-grid mb item-row';
    row.innerHTML =
      '<div class="field"><label>Description</label><input class="i_desc" placeholder="Item / phone"></div>' +
      '<div class="field"><label>Qty</label><input class="i_qty" type="number" min="1" value="1"></div>' +
      '<div class="field"><label>Unit Price</label><input class="i_price" type="number" step="0.01" min="0" value="0"></div>' +
      '<div class="field" style="justify-content:flex-end;"><button class="btn btn--sm btn--ghost i_rm" type="button">✕</button></div>';
    if (item) {
      row.querySelector('.i_desc').value = item.description || '';
      row.querySelector('.i_qty').value = item.qty || 1;
      row.querySelector('.i_price').value = item.unitPrice || item.unit_price || 0;
    }
    row.querySelector('.i_rm').addEventListener('click', function () { row.remove(); recalc(); });
    row.querySelectorAll('input').forEach(function (inp) { inp.addEventListener('input', recalc); });
    itemsEl.appendChild(row);
    recalc();
  }

  function recalc() {
    let total = 0;
    itemsEl.querySelectorAll('.item-row').forEach(function (row) {
      const q = Number(row.querySelector('.i_qty').value || 0);
      const p = Number(row.querySelector('.i_price').value || 0);
      total += q * p;
    });
    const disc = Number(document.getElementById('s_discount').value || 0);
    totalEl.textContent = ui.money(Math.max(0, total - disc));
  }

  function readItems() {
    const out = [];
    itemsEl.querySelectorAll('.item-row').forEach(function (row) {
      const description = row.querySelector('.i_desc').value.trim();
      const qty = Number(row.querySelector('.i_qty').value || 1);
      const unitPrice = Number(row.querySelector('.i_price').value || 0);
      if (description || unitPrice > 0) {
        out.push({ description: description, qty: qty, unitPrice: unitPrice });
      }
    });
    return out;
  }

  async function loadCustomers() {
    try {
      const data = await api.get('/api/customers', { allow404: true });
      const list = ui.toArray(data);
      ui.renderList(custBody, list, function (c) {
        return '<tr><td>' + ui.esc(c.name) + '</td><td>' + ui.esc(c.phone || '—') +
          '</td><td>' + ui.esc(c.cnic || '—') + '</td><td class="cell-actions">' +
          '<button class="btn btn--sm btn--ghost" data-idcard="' + c.id + '">ID</button></td></tr>';
      }, 'No customers yet. Add one above.');
      const cur = custSel.value;
      custSel.innerHTML = '<option value="">— walk-in —</option>' +
        list.map(function (c) { return '<option value="' + c.id + '">' + ui.esc(c.name) + '</option>'; }).join('');
      custSel.value = cur;
    } catch (e) {
      ui.showError(e);
      ui.showComingOnline(custBody.closest('.card'), 'Customers are coming online — backend route /api/customers is not ready yet.');
    }
  }

  async function loadSales() {
    try {
      const data = await api.get('/api/sales', { allow404: true });
      const list = ui.toArray(data);
      ui.renderList(saleBody, list, function (s) {
        const wa = 'https://wa.me/?text=' + encodeURIComponent('Invoice ' + (s.invoice_no || s.id) + ' total ' + ui.money(s.grand_total || s.total));
        return '<tr><td>' + ui.esc(s.invoice_no || s.id) + '</td><td>' + ui.dateStr(s.created_at) +
          '</td><td>' + ui.esc(s.customer_name || 'Walk-in') + '</td><td>' + ui.money(s.grand_total || s.total) +
          '</td><td class="cell-actions">' +
          '<a class="btn btn--sm btn--ghost" target="_blank" href="/api/invoices/' + s.id + '/pdf">PDF</a>' +
          '<a class="btn btn--sm btn--ghost" target="_blank" href="' + wa + '">WA</a></td></tr>';
      }, 'No sales recorded yet.');
    } catch (e) {
      ui.showComingOnline(saleBody.closest('.card'), 'Sales list is coming online — backend route /api/sales is not ready yet.');
    }
  }

  document.getElementById('addCustBtn').addEventListener('click', function () { custCard.classList.toggle('hidden'); });
  document.getElementById('custCancel').addEventListener('click', function () { custCard.classList.add('hidden'); });
  document.getElementById('addItem').addEventListener('click', function () { addItemRow(null); });
  document.getElementById('s_discount').addEventListener('input', recalc);
  addItemRow(null);

  custBody.addEventListener('click', async function (e) {
    const id = e.target.getAttribute('data-idcard');
    if (!id) return;
    const front = document.getElementById('c_front').files[0];
    const back = document.getElementById('c_back').files[0];
    if (!front && !back) { ui.toast('Choose a front/back image first', 'error'); return; }
    try {
      if (front) {
        const url = await fileToDataUrl(front);
        await api.post('/api/customers/' + id + '/idcard', { side: 'front', dataUrl: url });
      }
      if (back) {
        const url = await fileToDataUrl(back);
        await api.post('/api/customers/' + id + '/idcard', { side: 'back', dataUrl: url });
      }
      ui.toast('ID card uploaded', 'success');
    } catch (err) { ui.showError(err); }
  });

  custForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const payload = {
      name: document.getElementById('c_name').value.trim(),
      phone: document.getElementById('c_phone').value.trim(),
      cnic: document.getElementById('c_cnic').value.trim()
    };
    try {
      await api.post('/api/customers', payload);
      ui.toast('Customer saved', 'success');
      custForm.reset();
      custCard.classList.add('hidden');
      loadCustomers();
    } catch (err) { ui.showError(err); }
  });

  document.getElementById('saleForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const items = readItems();
    if (items.length === 0) { ui.toast('Add at least one line item', 'error'); return; }
    const payload = {
      customerId: custSel.value ? Number(custSel.value) : null,
      paymentMethod: document.getElementById('s_pay').value,
      discount: Number(document.getElementById('s_discount').value || 0),
      notes: document.getElementById('s_notes').value.trim(),
      items: items
    };
    try {
      const res = await api.post('/api/sales', payload);
      ui.toast('Sale recorded', 'success');
      document.getElementById('s_discount').value = 0;
      itemsEl.innerHTML = '';
      addItemRow(null);
      recalc();
      loadSales();
      const saleId = res && res.saleId;
      if (saleId) window.open('/api/invoices/' + saleId + '/pdf', '_blank');
    } catch (err) { ui.showError(err); }
  });

  loadCustomers();
  loadSales();
})();
