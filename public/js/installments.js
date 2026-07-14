'use strict';
/* Installments / Khata (Module 6).
   Backend contract (ledger-based):
     GET  /api/ledgers              -> {ledgers:[{id,customer_id,customer_name,balance,...}]}
     POST /api/ledgers              -> {customerId} (creates/returns a ledger)
     POST /api/ledgers/:id/installment -> {amount, dueDate}
     POST /api/installments/:id/pay -> mark paid
     GET  /api/installments/due?days=N -> {installments:[...]}  (due reminders) */
(function () {
  nav.mount();
  if (!api.token) { api.redirectToLogin(); return; }

  const dueBody = document.getElementById('dueBody');
  const ledgerBody = document.getElementById('ledgerBody');
  const formCard = document.getElementById('formCard');
  const form = document.getElementById('instForm');
  const custSel = document.getElementById('i_customer');

  async function loadCustomers() {
    try {
      const data = await api.get('/api/customers', { allow404: true });
      const list = ui.toArray(data);
      custSel.innerHTML = list.map(function (c) { return '<option value="' + c.id + '">' + ui.esc(c.name) + '</option>'; }).join('') || '<option value="">— no customers —</option>';
    } catch (e) { /* non-fatal */ }
  }

  // ensure a ledger exists for the chosen customer; return its id
  async function ensureLedger(customerId) {
    const data = await api.get('/api/ledgers', { allow404: true });
    const ledgers = ui.toArray(data);
    const existing = ledgers.find(function (l) { return String(l.customer_id) === String(customerId); });
    if (existing) return existing.id;
    const created = await api.post('/api/ledgers', { customerId: Number(customerId) });
    return created && created.ledger ? created.ledger.id : null;
  }

  function rowHtml(i) {
    const badge = '<span class="badge badge--' + ui.esc(i.status) + '">' + ui.esc(i.status) + '</span>';
    const paidBtn = (i.status !== 'paid')
      ? '<button class="btn btn--sm btn--primary" data-paid="' + i.id + '">Mark Paid</button>'
      : '<span class="muted">✓</span>';
    return '<tr><td>' + ui.esc(i.customer_name || ('#'+i.customer_id)) + '</td><td>' + ui.money(i.amount) +
      '</td><td>' + ui.dateStr(i.due_date) + '</td><td>' + badge + '</td><td class="cell-actions">' + paidBtn + '</td></tr>';
  }

  async function load() {
    try {
      // ledgers (with their installments via /ledgers/:id) — fetch due list instead for a flat schedule view.
      const dueData = await api.get('/api/installments/due?days=3650', { allow404: true });
      const all = ui.toArray(dueData);
      const due = all.filter(function (i) { return i.status !== 'paid'; });
      ui.renderList(ledgerBody, all, rowHtml, 'No installments scheduled yet.');
      // Override the due table with only upcoming dues (next 7 days) if available.
      const dueData7 = await api.get('/api/installments/due?days=7', { allow404: true });
      const due7 = ui.toArray(dueData7);
      ui.renderList(dueBody, due7, rowHtml, 'No upcoming dues in the next 7 days. 🎉');
    } catch (e) {
      ui.showComingOnline(ledgerBody.closest('.card'), 'Installments are coming online — backend route /api/installments is not ready yet.');
    }
  }

  document.getElementById('addBtn').addEventListener('click', function () { formCard.classList.toggle('hidden'); });
  document.getElementById('cancelBtn').addEventListener('click', function () { formCard.classList.add('hidden'); });

  document.body.addEventListener('click', async function (e) {
    const id = e.target.getAttribute('data-paid');
    if (!id) return;
    try {
      await api.post('/api/installments/' + id + '/pay', {});
      ui.toast('Marked paid', 'success');
      load();
    } catch (err) { ui.showError(err); }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const customerId = Number(custSel.value);
    if (!customerId) { ui.toast('Pick a customer', 'error'); return; }
    try {
      const ledgerId = await ensureLedger(customerId);
      if (!ledgerId) throw new Error('Could not open a ledger for this customer');
      const payload = {
        amount: Number(document.getElementById('i_amount').value || 0),
        dueDate: new Date(document.getElementById('i_due').value + 'T23:59:59').getTime()
      };
      await api.post('/api/ledgers/' + ledgerId + '/installment', payload);
      ui.toast('Installment added', 'success');
      form.reset();
      formCard.classList.add('hidden');
      load();
    } catch (err) { ui.showError(err); }
  });

  loadCustomers();
  load();
})();
