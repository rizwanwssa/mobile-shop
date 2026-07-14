'use strict';
/*
 * Module — Print Bill (thermal receipt)
 * Routes:
 *   GET /api/sales/:id/receipt-html  -> self-contained printable HTML (58mm/80mm thermal)
 *                                        ?w=58  -> 58mm width (default 80mm)
 *                                        ?noprint=1 -> skip auto window.print() on load
 *
 * Mirrors invoices.js loadSaleView; receipts are staff-allowed (authenticate only).
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../auth');
const { money } = require('../config');

function loadSaleView(saleId) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(+saleId);
  if (!sale) return null;
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC').all(+saleId);
  let customer = null;
  if (sale.customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id);
  }
  return { sale, items, customer };
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildReceiptHtml(sale, items, customer, widthMm) {
  const shop = esc(process.env.SHOP_NAME || 'Mobile Shop');
  const date = new Date(sale.created_at).toLocaleString();
  const lines = items.map((it) => `
    <div class="line">
      <div class="desc">${esc(it.description || 'Item')}</div>
      <div class="qty">${Number(it.qty)}</div>
      <div class="price">${(money(it.unit_price)).toFixed(2)}</div>
      <div class="tot">${(money(it.line_total)).toFixed(2)}</div>
    </div>`).join('');

  const discount = Number(sale.discount) || 0;
  const discountRow = discount
    ? `<div class="row"><span>Discount</span><span>-${(money(discount)).toFixed(2)}</span></div>`
    : '';

  const custName = customer ? esc(customer.name) : 'Walk-in';
  const custPhone = customer && customer.phone ? esc(customer.phone) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${esc(sale.invoice_no)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: #f5f5f5;
    color: #000;
    font-family: "Courier New", Courier, monospace;
    font-size: 12px;
    line-height: 1.35;
  }
  #toolbar {
    position: sticky; top: 0; z-index: 10;
    background: #222; color: #fff;
    padding: 6px 8px; text-align: center;
  }
  #toolbar button {
    font: inherit; padding: 4px 10px; margin: 0 4px;
    background: #444; color: #fff; border: 1px solid #666; border-radius: 4px; cursor: pointer;
  }
  #receipt {
    width: ${widthMm}mm;
    max-width: 100%;
    margin: 8px auto;
    background: #fff;
    padding: 2mm 3mm;
  }
  .center { text-align: center; }
  .head { font-weight: bold; font-size: 14px; }
  .sub { font-size: 11px; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; }
  .line { display: flex; gap: 4px; margin: 2px 0; }
  .line .desc { flex: 1 1 auto; word-break: break-word; }
  .line .qty { width: 3ch; text-align: right; }
  .line .price { width: 8ch; text-align: right; }
  .line .tot { width: 9ch; text-align: right; }
  .colhead { display: flex; gap: 4px; font-weight: bold; border-bottom: 1px dashed #000; padding-bottom: 2px; }
  .grand { font-weight: bold; font-size: 13px; }
  .foot { margin-top: 6px; font-size: 11px; }

  @media print {
    html, body { background: #fff; font-size: 12px; }
    #toolbar { display: none !important; }
    #receipt { width: auto; margin: 0; padding: 0; box-shadow: none; }
  }
</style>
</head>
<body>
<div id="toolbar">
  <button onclick="toggleWidth()">Width: ${widthMm}mm</button>
  <button onclick="window.print()">Print</button>
</div>
<div id="receipt">
  <div class="center head">${shop}</div>
  <div class="center sub">${custName}${custPhone ? ' &middot; ' + custPhone : ''}</div>
  <hr>
  <div class="row"><span>Invoice</span><span>${esc(sale.invoice_no)}</span></div>
  <div class="row"><span>Date</span><span>${esc(date)}</span></div>
  <div class="row"><span>Payment</span><span>${esc(sale.payment_method || '-')}</span></div>
  <hr>
  <div class="colhead">
    <div class="desc">Item</div>
    <div class="qty">Qty</div>
    <div class="price">Price</div>
    <div class="tot">Total</div>
  </div>
  ${lines}
  <hr>
  ${discountRow}
  <div class="row grand"><span>GRAND TOTAL</span><span>${(money(sale.grand_total)).toFixed(2)}</span></div>
  <hr>
  <div class="center foot">Thank you for your business!<br>Please come again.</div>
</div>
<script>
  function toggleWidth() {
    var cur = parseInt(document.getElementById('receipt').style.width, 10) || ${widthMm};
    var next = cur === 80 ? 58 : 80;
    var q = new URLSearchParams(location.search);
    q.set('w', next);
    location.search = q.toString();
  }
  window.onload = function () {
    if (new URLSearchParams(location.search).get('noprint') !== '1') {
      window.print();
    }
  };
</script>
</body>
</html>`;
}

router.get('/sales/:id/receipt-html', authenticate, (req, res) => {
  try {
    const view = loadSaleView(req.params.id);
    if (!view) return res.status(404).json({ error: 'sale not found' });
    const { sale, items, customer } = view;
    const widthMm = req.query.w === '58' ? 58 : 80;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildReceiptHtml(sale, items, customer, widthMm));
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
