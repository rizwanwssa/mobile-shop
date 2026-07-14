'use strict';
/* Expenses (Module 7). Owner-only. */
(function () {
  nav.mount();
  if (!api.token) { api.redirectToLogin(); return; }

  const content = document.getElementById('content');
  const denied = document.getElementById('denied');
  const body = document.getElementById('expBody');
  const form = document.getElementById('expForm');

  if (!api.isOwner()) {
    content.classList.add('hidden');
    denied.classList.remove('hidden');
    return;
  }

  async function load() {
    try {
      const data = await api.get('/api/expenses', { allow404: true });
      const list = ui.toArray(data);
      ui.renderList(body, list, function (e) {
        return '<tr><td>' + ui.dateStr(e.expense_date || e.created_at) + '</td><td>' +
          '<span class="badge">' + ui.esc(e.category) + '</span></td><td>' + ui.esc(e.description || '—') +
          '</td><td>' + ui.money(e.amount) + '</td></tr>';
      }, 'No expenses recorded yet.');
    } catch (e) {
      ui.showComingOnline(body.closest('.card'), 'Expenses are coming online — backend route /api/expenses is not ready yet.');
    }
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    const payload = {
      category: document.getElementById('e_cat').value,
      amount: Number(document.getElementById('e_amount').value || 0),
      description: document.getElementById('e_desc').value.trim(),
      expenseDate: Date.now()
    };
    try {
      await api.post('/api/expenses', payload);
      ui.toast('Expense saved', 'success');
      form.reset();
      load();
    } catch (err) { ui.showError(err); }
  });

  load();
})();
