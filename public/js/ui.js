'use strict';
/*
 * Shared UI helpers: formatting, toasts, and a tiny list renderer.
 * Browser global `ui`.
 */
window.ui = (function () {
  function money(n) {
    const v = Number(n);
    if (!isFinite(v)) return '0.00';
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function dateStr(ms) {
    if (!ms) return '';
    const d = new Date(isNaN(+ms) ? Date.parse(ms) : +ms);
    if (isNaN(d.getTime())) return String(ms);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function dateTimeStr(ms) {
    if (!ms) return '';
    const d = new Date(isNaN(+ms) ? Date.parse(ms) : +ms);
    if (isNaN(d.getTime())) return String(ms);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Toast notifications (errors, success).
  let toastHost = null;
  function ensureHost() {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toast-host';
      toastHost.setAttribute('role', 'status');
      document.body.appendChild(toastHost);
    }
    return toastHost;
  }
  function toast(message, type) {
    const host = ensureHost();
    const el = document.createElement('div');
    el.className = 'toast toast--' + (type || 'info');
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast--show'));
    setTimeout(() => {
      el.classList.remove('toast--show');
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }
  function showError(e) {
    const msg = (e && e.message) ? e.message : String(e);
    toast(msg, 'error');
  }

  // Status badge class helper.
  function statusClass(status) {
    return 'badge badge--' + String(status || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }

  // Escape HTML for safe interpolation into innerHTML.
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Normalize a backend response (which may be a raw array or an envelope
  // like {units}, {customers}, {expenses}, {sales}, {items}, {sale}, {unit})
  // into a plain array. Returns [] if nothing usable.
  function toArray(data) {
    if (data == null) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.units)) return data.units;
    if (Array.isArray(data.customers)) return data.customers;
    if (Array.isArray(data.expenses)) return data.expenses;
    if (Array.isArray(data.sales)) return data.sales;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.repairs)) return data.repairs;
    if (Array.isArray(data.used)) return data.used;
    if (data.unit) return [data.unit];
    if (data.sale) return [data.sale];
    if (data.customer) return [data.customer];
    if (data.user) return [data.user];
    if (data.users) return Array.isArray(data.users) ? data.users : [data.users];
    return [];
  }

  // Empty/coming-online state for a container.
  function showComingOnline(container, label) {
    container.innerHTML = '<div class="coming-online">' +
      (label || 'This feature is coming online — the backend route is not ready yet.') + '</div>';
  }

  // Render a table or a friendly empty state.
  function renderList(container, items, rowFn, emptyText) {
    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = '<div class="empty-state">' + esc(emptyText || 'No records yet.') + '</div>';
      return;
    }
    container.innerHTML = items.map(rowFn).join('');
  }

  return { money, dateStr, dateTimeStr, toast, showError, statusClass, esc, toArray, showComingOnline, renderList };
})();
