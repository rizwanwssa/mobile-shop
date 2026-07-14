'use strict';
/*
 * PERSONAL VERIFICATION HARNESS — runs against a LIVE server.
 * Exercises all 8 modules end-to-end with real HTTP calls. Asserts the ACTUAL
 * response shapes produced by the module routers (wrapped objects: {unit}, {units},
 * {customer}, {saleId}, {id}, {ledger}, {installment}, {expense}, {byCategory}...).
 * Exits non-zero if any check fails. Used by the lead agent to certify the build.
 *
 * USAGE:
 *   The server and this script must point at the SAME database file. Both read
 *   DB_PATH from the environment. Start the server with a known DB_PATH, then run
 *   this script with the SAME DB_PATH so its RBAC test-user insert lands in the
 *   server's database (not the default data/shop.db).
 *
 *   DB_PATH=data/test.db PORT=3400 OWNER_PASS=verify123 node src/seed.js
 *   PORT=3400 OWNER_PASS=verify123 DB_PATH=data/test.db node server.js &
 *   DB_PATH=data/test.db OWNER_PASS=verify123 PORT=3400 node src/verify.js
 */
// Point this script's own DB connection at the same file the server uses.
process.env.DB_PATH = process.env.DB_PATH || 'data/shop.db';
const BASE = `http://localhost:${process.env.PORT || 3400}`;
const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.OWNER_PASS || 'admin';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; fails.push(name); console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, raw: text, contentType: res.headers.get('content-type') };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function main() {
  console.log('=== MOBILE SHOP SYSTEM — PERSONAL VERIFICATION ===');
  console.log('Target:', BASE);

  // 1. Auth
  const login = await call('POST', '/api/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
  ok('owner login returns token', login.status === 200 && typeof login.body.token === 'string', login.body);
  const token = login.body.token;

  // 2. Inventory + Dashboard (Modules 2,1)
  const inv = await call('POST', '/api/inventory', { token, body: {
    brand: 'Samsung', model: 'Galaxy S23', color: 'Black', specs: '256GB', imei1: '111', imei2: '222',
    purchase_price: 80000, sale_price: 95000 } });
  ok('POST /api/inventory creates unit', inv.status === 201 && inv.body.unit && inv.body.unit.id, inv.body);
  const invId = inv.body.unit.id;

  const invList = await call('GET', '/api/inventory', { token });
  ok('GET /api/inventory lists units', invList.status === 200 && Array.isArray(invList.body.units) && invList.body.units.length >= 1);
  ok('owner sees purchase_price', invList.body.units[0] && invList.body.units[0].purchase_price !== undefined);
  ok('owner inventory shape {units}', invList.body.units !== undefined);

  const low = await call('GET', '/api/inventory/low-stock?threshold=5', { token });
  ok('GET /api/inventory/low-stock', low.status === 200 && Array.isArray(low.body.lowStock));

  const dash = await call('GET', '/api/dashboard/summary', { token });
  ok('GET /api/dashboard/summary returns numbers',
     dash.status === 200 && typeof dash.body.totalInvestment === 'number' && typeof dash.body.netProfit === 'number', dash.body);

  // 3. Customers + Sales + Invoice (Module 3)
  const cust = await call('POST', '/api/customers', { token, body: { name: 'Test Cust', phone: '03001234567', cnic: '12345' } });
  ok('POST /api/customers', cust.status === 201 && cust.body.customer && cust.body.customer.id, cust.body);
  const custId = cust.body.customer.id;

  const idcard = await call('POST', `/api/customers/${custId}/idcard`, { token, body: { side: 'front', dataUrl: PNG } });
  ok('POST /api/customers/:id/idcard uploads', idcard.status === 200 && idcard.body.front, idcard.body);

  const sale = await call('POST', '/api/sales', { token, body: {
    customerId: custId,
    items: [{ inventoryUnitId: invId, description: 'Galaxy S23', qty: 1, unitPrice: 95000 }],
    discount: 0, paymentMethod: 'cash' } });
  ok('POST /api/sales creates sale + marks unit sold', sale.status === 201 && sale.body.saleId, sale.body);
  const saleId = sale.body.saleId;

  const sold = await call('GET', '/api/inventory', { token });
  const unit = sold.body.units.find(u => u.id === invId);
  ok('sold unit status updated to sold', unit && unit.status === 'sold', unit);

  const saleView = await call('GET', `/api/sales/${saleId}`, { token });
  ok('GET /api/sales/:id returns items', saleView.status === 200 && Array.isArray(saleView.body.items) && saleView.body.items.length === 1);

  const pdf = await call('GET', `/api/invoices/${saleId}/pdf`, { token });
  const looksPdf = typeof pdf.raw === 'string' && pdf.raw.startsWith('%PDF');
  ok('GET /api/invoices/:id/pdf returns PDF', pdf.status === 200 && looksPdf, { status: pdf.status, ct: pdf.contentType, len: pdf.raw.length });

  const wa = await call('GET', `/api/invoices/${saleId}/whatsapp`, { token });
  ok('GET /api/invoices/:id/whatsapp returns wa.me url', wa.status === 200 && typeof wa.body.url === 'string' && wa.body.url.includes('wa.me'), wa.body);

  // 4. Used-buying + receipt (Module 4)
  const used = await call('POST', '/api/used', { token, body: {
    sellerName: 'Seller A', sellerPhone: '03007654321', sellerCnic: '999', model: 'iPhone 12',
    imei1: '333', imei2: '444', conditionNote: 'good', purchasePrice: 40000, buyerSign: PNG, buyerThumb: PNG } });
  ok('POST /api/used creates legal receipt', used.status === 201 && used.body.id && used.body.receiptNo, used.body);
  const usedId = used.body.id;
  const rpdf = await call('GET', `/api/used/${usedId}/receipt/pdf`, { token });
  ok('GET /api/used/:id/receipt/pdf returns PDF', rpdf.status === 200 && typeof rpdf.raw === 'string' && rpdf.raw.startsWith('%PDF'), { status: rpdf.status, len: rpdf.raw.length });

  // 5. Repair (Module 5)
  const rep = await call('POST', '/api/repairs', { token, body: {
    customerName: 'Rep Cust', phone: '03001112233', deviceModel: 'Pixel 6', problem: 'screen', partsCost: 2000, serviceFee: 5000 } });
  ok('POST /api/repairs creates token + profit', rep.status === 201 && rep.body.id && rep.body.profit === 3000, rep.body);
  const repUpd = await call('PUT', `/api/repairs/${rep.body.id}`, { token, body: { status: 'ready' } });
  ok('PUT /api/repairs/:id updates status', repUpd.status === 200 && repUpd.body.status === 'ready', repUpd.body);
  const repToken = await call('GET', `/api/repairs/token/${repUpd.body.token_no}`, { token });
  ok('GET /api/repairs/token/:token', repToken.status === 200 && repToken.body.id === rep.body.id, repToken.body);

  // 6. Installments + Khata + SMS (Module 6)
  const led = await call('POST', '/api/ledgers', { token, body: { customerId: custId, openingBalance: 5000 } });
  ok('POST /api/ledgers', led.status === 201 && led.body.ledger && led.body.ledger.id, led.body);
  const ledId = led.body.ledger.id;
  const inst = await call('POST', `/api/ledgers/${ledId}/installment`, { token, body: { amount: 1000, dueDate: Date.now() + 2 * 86400000 } });
  ok('POST installment scheduled', inst.status === 201 && inst.body.installment && inst.body.installment.id, inst.body);
  const instId = inst.body.installment.id;
  const remind = await call('POST', '/api/installments/remind-due', { token });
  ok('POST /api/installments/remind-due sends SMS', remind.status === 200 && remind.body.sent >= 1, remind.body);
  const pay = await call('POST', `/api/installments/${instId}/pay`, { token });
  ok('POST installment pay reduces balance to 4000', pay.status === 200 && pay.body.ledger && pay.body.ledger.balance === 4000, pay.body);
  const due = await call('GET', '/api/installments/due?days=3', { token });
  ok('GET /api/installments/due', due.status === 200 && Array.isArray(due.body.installments));

  // 7. Expenses + net profit (Module 7)
  const exp = await call('POST', '/api/expenses', { token, body: { category: 'rent', description: 'July rent', amount: 5000, expenseDate: Date.now() } });
  ok('POST /api/expenses (owner)', exp.status === 201 && exp.body.expense && exp.body.expense.id, exp.body);
  const expCat = await call('GET', '/api/expenses/by-category', { token });
  ok('GET /api/expenses/by-category', expCat.status === 200 && Array.isArray(expCat.body.byCategory), expCat.body);

  // 8. dashboard reflects sale + expense (net profit moved)
  const dash2 = await call('GET', '/api/dashboard/summary', { token });
  ok('dashboard totalSales reflects sale (>=95000)', dash2.status === 200 && dash2.body.totalSales >= 95000, dash2.body);
  const net = await call('GET', '/api/reports/net-profit', { token });
  ok('GET /api/reports/net-profit owner-only', net.status === 200 && typeof net.body.netProfit === 'number', net.body);

  // ---- RBAC: staff cannot access owner endpoints, can do sales ----
  const adb = require('./db');
  const { hashPassword } = require('./auth');
  // idempotent: clear any prior staff1 (and its FK references) from crashed runs
  try {
    const prior = adb.prepare("SELECT id FROM admin_users WHERE username='staff1'").get();
    if (prior) {
      adb.prepare('DELETE FROM admin_action_log WHERE admin_id=?').run(prior.id);
      adb.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(prior.id);
    }
    adb.prepare("DELETE FROM admin_users WHERE username='staff1'").run();
  } catch (e) { /* ignore */ }
  const staffId = adb.prepare("INSERT INTO admin_users (name,username,password_hash,role,created_at) VALUES (?,?,?,?,?)")
    .run('Staff', 'staff1', hashPassword('staffpass'), 'staff', Date.now()).lastInsertRowid;
  const slogin = await call('POST', '/api/auth/login', { body: { username: 'staff1', password: 'staffpass' } });
  const stoken = slogin.body.token;
  ok('staff login works', !!stoken, slogin.body);

  const sDash = await call('GET', '/api/dashboard/summary', { token: stoken });
  ok('staff 403 on dashboard/owner data', sDash.status === 403, sDash.body);
  const sExp = await call('POST', '/api/expenses', { token: stoken, body: { category: 'rent', amount: 1 } });
  ok('staff 403 on expenses', sExp.status === 403, sExp.body);
  const sSale = await call('POST', '/api/sales', { token: stoken, body: { items: [{ description: 'Accessory', qty: 1, unitPrice: 500 }] } });
  ok('staff can create sale', sSale.status === 201 && sSale.body.saleId, sSale.body);
  const sInv = await call('GET', '/api/inventory', { token: stoken });
  ok('staff hidden purchase_price', Array.isArray(sInv.body.units) && sInv.body.units[0] && sInv.body.units[0].purchase_price === undefined, sInv.body.units && sInv.body.units[0]);
  const sRep = await call('GET', '/api/repairs', { token: stoken });
  ok('staff repair list strips profit', Array.isArray(sRep.body) && (!sRep.body[0] || sRep.body[0].profit === undefined), Array.isArray(sRep.body) ? sRep.body[0] : sRep.body);

  // cleanup (clear FK references in action log first, then the user)
  try {
    adb.prepare('DELETE FROM admin_action_log WHERE admin_id=?').run(staffId);
    adb.prepare('DELETE FROM admin_sessions WHERE admin_id=?').run(staffId);
    adb.prepare('DELETE FROM admin_users WHERE id=?').run(staffId);
  } catch (e) { /* best-effort cleanup */ }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('FAILED:', fails.join(', ')); process.exit(1); }
  console.log('ALL CHECKS PASSED ✓');
  process.exit(0);
}

main().catch(e => { console.error('VERIFY CRASHED:', e); process.exit(2); });
