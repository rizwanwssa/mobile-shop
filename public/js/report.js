'use strict';
/* Reports page (Module 8). Owner-only. */
(function () {
  nav.mount();
  if (!api.token) { api.redirectToLogin(); return; }

  const content = document.getElementById('content');
  const denied = document.getElementById('denied');

  if (!api.isOwner()) {
    content.classList.add('hidden');
    denied.classList.remove('hidden');
    return;
  }

  const dateInput = document.getElementById('dailyDate');
  const printBtn = document.getElementById('printBtn');
  const dSales = document.getElementById('dSales');
  const dExpenses = document.getElementById('dExpenses');
  const dProfit = document.getElementById('dProfit');
  const dCount = document.getElementById('dCount');
  const pNew = document.getElementById('pNew');
  const pUsed = document.getElementById('pUsed');
  const pTotal = document.getElementById('pTotal');
  const pPeriod = document.getElementById('pPeriod');

  function isoDate(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function setProfitClass(el, v) {
    el.classList.remove('stat__value--profit', 'stat__value--loss');
    el.classList.add(v >= 0 ? 'stat__value--profit' : 'stat__value--loss');
  }

  async function loadDaily() {
    const ms = dateInput.valueAsNumber; // local midnight ms, or NaN
    const qs = isNaN(ms) ? '' : ('?date=' + ms);
    try {
      const data = await api.get('/api/reports/daily' + qs, { allow404: true });
      if (!data) {
        dSales.textContent = dExpenses.textContent = dProfit.textContent = '—';
        dCount.textContent = '';
        return;
      }
      dSales.textContent = ui.money(data.todaySales);
      dExpenses.textContent = ui.money(data.todayExpenses);
      dProfit.textContent = ui.money(data.dayNetProfit);
      setProfitClass(dProfit, data.dayNetProfit);
      dCount.textContent = data.salesCount + ' sale(s) · ' + ui.dateStr(data.date);
    } catch (e) {
      ui.showError(e);
    }
  }

  async function loadSplit() {
    try {
      const data = await api.get('/api/reports/profit-split', { allow404: true });
      if (!data) {
        pNew.textContent = pUsed.textContent = pTotal.textContent = '—';
        pPeriod.textContent = '';
        return;
      }
      pNew.textContent = ui.money(data.profitFromNew);
      pUsed.textContent = ui.money(data.profitFromUsed);
      pTotal.textContent = ui.money(data.totalProfit);
      const f = data.period && data.period.from;
      const t = data.period && data.period.to;
      pPeriod.textContent = (f && t) ? (ui.dateStr(f) + ' → ' + ui.dateStr(t)) : 'All time';
    } catch (e) {
      ui.showError(e);
    }
  }

  dateInput.value = isoDate(Date.now());
  dateInput.addEventListener('change', loadDaily);
  printBtn.addEventListener('click', function () { window.print(); });

  loadDaily();
  loadSplit();
})();
