'use strict';
/* Used Phone Buying (Module 4). Signature + thumb capture -> base64 dataUrls. */
(function () {
  nav.mount();
  if (!api.token) { api.redirectToLogin(); return; }

  const body = document.getElementById('usedBody');
  const form = document.getElementById('usedForm');

  // ---- canvas setup (responsive width) ----
  function setupCanvas(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    return ctx;
  }

  function makePad(canvas) {
    const ctx = setupCanvas(canvas);
    let drawing = false, last = null;
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function start(e) { drawing = true; last = pos(e); e.preventDefault(); }
    function move(e) {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; e.preventDefault();
    }
    function end() { drawing = false; }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    return {
      clear: function () { ctx.clearRect(0, 0, canvas.width, canvas.height); },
      isEmpty: function () { return canvas.toDataURL().length < 2000; },
      toDataURL: function () { return canvas.toDataURL('image/png'); }
    };
  }

  const signPad = makePad(document.getElementById('signCanvas'));
  const thumbPad = makePad(document.getElementById('thumbCanvas'));
  document.getElementById('clearSign').addEventListener('click', function () { signPad.clear(); });
  document.getElementById('clearThumb').addEventListener('click', function () { thumbPad.clear(); });

  // Uploaded thumb file overrides drawn thumb.
  let thumbFileDataUrl = null;
  document.getElementById('thumbFile').addEventListener('change', async function (e) {
    const f = e.target.files[0];
    if (!f) { thumbFileDataUrl = null; return; }
    thumbFileDataUrl = await new Promise(function (res) {
      const r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(f);
    });
  });

  async function load() {
    try {
      const data = await api.get('/api/used', { allow404: true });
      const list = Array.isArray(data) ? data : (data && data.items ? data.items : []);
      ui.renderList(body, list, function (u) {
        const isSold = u.status === 'sold';
        const badge = isSold
          ? '<span class="badge badge--sold">Sold</span>'
          : '<span class="badge badge--in_stock">In Stock</span>';
        const actions = isSold
          ? '<a class="btn btn--sm btn--ghost" target="_blank" href="/api/invoices/' + (u.sold_sale_id || '') + '/pdf">Invoice</a>'
          : '<button class="btn btn--sm btn--primary" data-sell="' + u.id + '">Sell</button> ' +
            '<a class="btn btn--sm btn--ghost" target="_blank" href="/api/used/' + u.id + '/receipt/pdf">Receipt</a>';
        return '<tr><td>' + ui.esc(u.receipt_no || u.id) + '</td><td>' + ui.esc(u.seller_name || '—') +
          '</td><td>' + ui.esc(u.model || '—') + '</td><td>' + ui.money(u.purchase_price) +
          '</td><td>' + ui.money(u.sale_price) + '</td><td>' + badge +
          '</td><td class="cell-actions">' + actions + '</td></tr>';
      }, 'No used-phone purchases yet.');
    } catch (e) {
      ui.showComingOnline(body.closest('.card'), 'Used-buying is coming online — backend route /api/used is not ready yet.');
    }
  }

  // Sell button -> one-click resale (creates a sale + invoice).
  body.addEventListener('click', async function (e) {
    const sellId = e.target.getAttribute('data-sell');
    if (!sellId) return;
    if (!confirm('Sell this used phone? An invoice will be created.')) return;
    try {
      const res = await api.post('/api/used/' + sellId + '/sell', {});
      ui.toast('Sold — invoice ' + res.invoiceNo, 'success');
      load();
    } catch (err) {
      ui.showError(err);
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const payload = {
      sellerName: document.getElementById('u_name').value.trim(),
      sellerPhone: document.getElementById('u_phone').value.trim(),
      sellerCnic: document.getElementById('u_cnic').value.trim(),
      model: document.getElementById('u_model').value.trim(),
      imei1: document.getElementById('u_imei1').value.trim(),
      imei2: document.getElementById('u_imei2').value.trim(),
      conditionNote: document.getElementById('u_cond').value.trim(),
      purchasePrice: Number(document.getElementById('u_price').value || 0),
      salePrice: Number(document.getElementById('u_saleprice').value || 0),
      buyerSign: signPad.isEmpty() ? null : signPad.toDataURL(),
      buyerThumb: thumbFileDataUrl || (thumbPad.isEmpty() ? null : thumbPad.toDataURL())
    };
    try {
      const res = await api.post('/api/used', payload);
      ui.toast('Purchase saved', 'success');
      form.reset();
      signPad.clear(); thumbPad.clear(); thumbFileDataUrl = null;
      load();
      const id = res && (res.id || res.purchaseId);
    } catch (err) { ui.showError(err); }
  });

  load();
})();
