'use strict';
/* Dashboard (Module 1). Owner-only summary with date-range filter. */
(function () {
  nav.mount();

  const denied = document.getElementById('denied');
  const content = document.getElementById('content');
  const rangeSel = document.getElementById('range');
  const fromEl = document.getElementById('from');
  const toEl = document.getElementById('to');
  const lowEl = document.getElementById('lowStock');

  if (!api.token) { api.redirectToLogin(); return; }

  // Staff cannot see the dashboard.
  if (!api.isOwner()) {
    content.classList.add('hidden');
    document.getElementById('rangeBar').classList.add('hidden');
    denied.classList.remove('hidden');
    return;
  }

  function rangeParams() {
    const v = rangeSel.value;
    const p = {};
    const now = Date.now();
    if (v === 'daily') {
      const d = new Date(); d.setHours(0,0,0,0);
      p.from = d.getTime(); p.to = d.getTime() + 24*3600*1000 - 1;
    } else if (v === 'weekly') {
      const d = new Date(); d.setHours(0,0,0,0);
      d.setDate(d.getDate() - 7);
      p.from = d.getTime(); p.to = now;
    } else if (v === 'monthly') {
      const d = new Date(); d.setHours(0,0,0,0);
      d.setMonth(d.getMonth() - 1);
      p.from = d.getTime(); p.to = now;
    } else if (v === 'custom') {
      if (fromEl.value) p.from = new Date(fromEl.value + 'T00:00:00').getTime();
      if (toEl.value) p.to = new Date(toEl.value + 'T23:59:59').getTime();
    }
    return p;
  }

  function buildQuery() {
    const p = rangeParams();
    return Object.keys(p).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
  }

  function fmt(n) { return ui.money(n); }

  async function load() {
    const q = buildQuery();
    try {
      const data = await api.get('/api/dashboard/summary' + (q ? '?' + q : ''), { allow404: true });
      if (data === null) { ui.showComingOnline(content, 'Dashboard summary is coming online — backend route /api/dashboard/summary is not ready yet.'); return; }

      document.getElementById('sInvest').textContent = fmt(data.totalInvestment);
      document.getElementById('sSales').textContent = fmt(data.totalSales);
      document.getElementById('sProfit').textContent = fmt(data.netProfit);
      document.getElementById('sStock').textContent = (data.unitsInStock != null) ? data.unitsInStock : '—';

      const low = data.lowStock || [];
      ui.renderList(lowEl, low, function (u) {
        return '<div class="row spread mb" style="border-bottom:1px solid var(--border);padding-bottom:6px;">' +
          '<span>' + ui.esc(u.brand + ' ' + u.model) + ' <span class="muted">(' + (u.count != null ? u.count : 'low') + ' left)</span></span>' +
          '<span class="badge badge--low">Low</span></div>';
      }, 'No low-stock items. 🎉');

    } catch (e) {
      ui.showError(e);
      ui.showComingOnline(content, 'Could not load dashboard (' + (e.message || 'error') + '). The feature may still be coming online.');
    }
  }

  rangeSel.addEventListener('change', function () {
    const custom = rangeSel.value === 'custom';
    fromEl.classList.toggle('hidden', !custom);
    toEl.classList.toggle('hidden', !custom);
    if (!custom) load();
  });
  fromEl.addEventListener('change', load);
  toEl.addEventListener('change', load);
  document.getElementById('refresh').addEventListener('click', load);

  // Load sample data (owner) — repopulates demo data after a deploy reset.
  const seedBtn = document.getElementById('seedBtn');
  if (seedBtn) {
    seedBtn.addEventListener('click', async function () {
      if (!confirm('Load sample inventory, customers, sales and expenses?')) return;
      seedBtn.disabled = true; seedBtn.textContent = 'Loading…';
      try {
        await api.post('/api/sample-data');
        ui.toast('Sample data loaded ✅');
        load();
      } catch (e) {
        ui.toast('Failed: ' + (e.message || 'error'), 'err');
      } finally {
        seedBtn.disabled = false; seedBtn.textContent = '＋ Load Sample Data';
      }
    });
  }

  load();
})();
