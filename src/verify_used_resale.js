'use strict';
/* End-to-end verification of the Used-Buying -> Resale flow.
 * Spins up the real server on a throwaway DB and exercises:
 *   1. login
 *   2. POST /api/used  (buy used phone -> linked inventory unit created)
 *   3. GET  /api/used  (shows In Stock)
 *   4. POST /api/used/:id/sell  (one-click resale -> sale + invoice)
 *   5. confirm used_purchase + inventory_unit both = sold, sale + invoice exist
 * Usage:
 *   DB_PATH=data/test_used.db OWNER_PASS=verify123 PORT=3501 node src/verify_used_resale.js
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3501;
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER_PASS = process.env.OWNER_PASS || 'verify123';

function req(method, p, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(BASE + p, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null; try { json = JSON.parse(buf); } catch (e) {}
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const assert = (cond, msg) => { if (!cond) { throw new Error('ASSERT FAILED: ' + msg); } console.log('  ✓ ' + msg); };

  // 1. login
  const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: OWNER_PASS } });
  assert(login.status === 200 && login.json.token, 'login returns token');
  const token = login.json.token;

  // 2. buy used phone
  const buy = await req('POST', '/api/used', {
    token,
    body: { sellerName: 'Test Seller', sellerPhone: '03001234567', model: 'iPhone 12', imei1: '111222333444555', conditionNote: 'Scratches on back', purchasePrice: 50000, salePrice: 62000 }
  });
  assert(buy.status === 201 && buy.json.id, 'used purchase created (id=' + (buy.json.id) + ')');
  assert(buy.json.inventoryUnitId, 'linked inventory unit auto-created (' + buy.json.inventoryUnitId + ')');
  const purchaseId = buy.json.id;
  const unitId = buy.json.inventoryUnitId;

  // 3. list shows In Stock
  let list = await req('GET', '/api/used', { token });
  assert(list.status === 200, 'GET /api/used ok');
  const row = list.json.find((u) => u.id === purchaseId);
  assert(row && row.status === 'in_stock', 'used purchase status = in_stock before sale');
  assert(row && Number(row.sale_price) === 62000, 'resale price stored (' + row.sale_price + ')');

  // confirm inventory unit exists + in_stock
  const inv = await req('GET', '/api/inventory', { token });
  const unit = inv.json.units.find((u) => u.id === unitId);
  assert(unit && unit.status === 'in_stock', 'linked inventory unit is in_stock');
  assert(unit && unit.brand === 'Used' && /Used/.test(unit.specs || ''), 'inventory unit tagged Used w/ condition in specs');

  // 4. one-click resale
  const sell = await req('POST', `/api/used/${purchaseId}/sell`, { token, body: { notes: 'walk-in customer' } });
  assert(sell.status === 201 && sell.json.invoiceNo, 'resale created invoice ' + (sell.json && sell.json.invoiceNo));
  const saleId = sell.json.saleId;

  // 5. confirm sync
  list = await req('GET', '/api/used', { token });
  const row2 = list.json.find((u) => u.id === purchaseId);
  assert(row2 && row2.status === 'sold', 'used purchase flipped to sold after resale');
  assert(row2 && row2.sold_sale_id === saleId, 'sold_sale_id linked to sale ' + saleId);

  const inv2 = await req('GET', '/api/inventory', { token });
  const unit2 = inv2.json.units.find((u) => u.id === unitId);
  assert(unit2 && unit2.status === 'sold', 'inventory unit flipped to sold');

  const sale = await req('GET', `/api/sales/${saleId}`, { token });
  assert(sale.status === 200 && sale.json.sale && sale.json.items.length === 1, 'sale has 1 item');
  assert(Number(sale.json.sale.grand_total) === 62000, 'sale total = resale price 62000');

  // invoice PDF should be reachable (non-401)
  const invPdf = await req('GET', `/api/invoices/${saleId}/pdf`, { token });
  assert(invPdf.status === 200, 'invoice PDF generated (status ' + invPdf.status + ')');

  // re-selling should be rejected
  const resell = await req('POST', `/api/used/${purchaseId}/sell`, { token, body: {} });
  assert(resell.status === 409, 'second resale rejected (409 already sold)');

  console.log('\nALL USED-RESALE CHECKS PASSED');
}

const serverJs = path.join(__dirname, '..', 'server.js');
const child = spawn('node', [serverJs], {
  env: { ...process.env, PORT, OWNER_PASS, DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'test_used.db') },
  stdio: ['ignore', 'inherit', 'inherit']
});

let done = false;
async function shutdown(code) {
  if (done) return; done = true;
  child.kill();
  process.exit(code);
}

child.on('error', (e) => { console.error('server spawn error', e); shutdown(1); });
setTimeout(async () => {
  try {
    // wait for health
    for (let i = 0; i < 30; i++) {
      const h = await req('GET', '/api/health');
      if (h.status === 200) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await main();
    shutdown(0);
  } catch (e) {
    console.error('\n' + e.message);
    shutdown(1);
  }
}, 1200);
