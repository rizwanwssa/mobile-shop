'use strict';
/*
 * Module 4 — Used-Buying + Resale.
 * On a purchase we auto-create a linked inventory unit (so the used phone
 * becomes sellable stock tagged as "Used"). A one-click Sell route sells the
 * unit (creating a normal sale + invoice), and the status stays in sync if the
 * unit is sold through the regular Inventory/Sales flow too.
 * Only files in this module are touched here.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const db = require('../db');
const { authenticate, requireOwner, logAction } = require('../auth');
const config = require('../config');
const { generateReceiptPDF } = require('../lib/receipt');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// decode "data:image/png;base64,...." -> write file, return stored path (uploads/<name>)
function saveDataUrl(dataUrl, fileName) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  const full = path.join(UPLOAD_DIR, `${fileName}.${ext}`);
  fs.writeFileSync(full, buf);
  return `uploads/${fileName}.${ext}`;
}

// Create the linked inventory unit for a used purchase (so it can be resold).
function createLinkedUnit(p) {
  const ts = Date.now();
  const specs = (p.model ? (p.model + ' ') : '') + '· Used' + (p.conditionNote ? ' · ' + p.conditionNote : '');
  const info = db.prepare(
    `INSERT INTO inventory_units
      (brand, model, color, specs, imei1, imei2, purchase_price, sale_price, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'in_stock', ?, ?)`
  ).run(
    'Used', p.model || 'Unknown', null, specs, p.imei1 || null, p.imei2 || null,
    config.money(p.purchasePrice), config.money(p.salePrice || 0), ts, ts
  );
  return info.lastInsertRowid;
}

function markUsedSold(purchaseId, saleId) {
  db.prepare(
    `UPDATE used_purchases SET status='sold', sold_at=?, sold_sale_id=? WHERE id=?`
  ).run(Date.now(), saleId || null, purchaseId);
}

// ---- POST /api/used ----
router.post('/used', authenticate, (req, res) => {
  const b = req.body || {};
  const { sellerName, sellerPhone, sellerCnic, model, imei1, imei2, conditionNote, purchasePrice, salePrice, buyerSign, buyerThumb } = b;
  if (!sellerName || purchasePrice == null) {
    return res.status(400).json({ error: 'sellerName and purchasePrice are required' });
  }
  const receiptNo = config.genReceiptNo();
  const createdAt = Date.now();

  const signPath = saveDataUrl(buyerSign, `${receiptNo}_sign`);
  const thumbPath = saveDataUrl(buyerThumb, `${receiptNo}_thumb`);

  try {
    const tx = db.transaction(() => {
      const info = db.prepare(`INSERT INTO used_purchases
        (receipt_no, seller_name, seller_phone, seller_cnic, model, imei1, imei2, condition_note,
         purchase_price, sale_price, status, source, buyer_sign_path, buyer_thumb_path, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'in_stock', 'purchase',?,?,?,?)`)
        .run(receiptNo, sellerName, sellerPhone || null, sellerCnic || null, model || null,
          imei1 || null, imei2 || null, conditionNote || null,
          config.money(purchasePrice), config.money(salePrice || 0),
          signPath, thumbPath, req.admin.id, createdAt);
      const purchaseId = info.lastInsertRowid;
      const unitId = createLinkedUnit({ model, imei1, imei2, conditionNote, purchasePrice, salePrice });
      db.prepare('UPDATE used_purchases SET inventory_unit_id=? WHERE id=?').run(unitId, purchaseId);
      return { id: purchaseId, unitId };
    });
    const { id, unitId } = tx();
    logAction(req.admin.id, 'create', 'used_purchases', id, `receipt ${receiptNo} (unit ${unitId})`);
    res.status(201).json({ id, receiptNo, inventoryUnitId: unitId, buyerSignPath: signPath, buyerThumbPath: thumbPath });
  } catch (e) {
    res.status(500).json({ error: 'failed to record used purchase: ' + e.message });
  }
});

// ---- GET /api/used (list) ----
router.get('/used', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM used_purchases ORDER BY created_at DESC').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'failed to list used purchases' });
  }
});

// ---- GET /api/used/:id (detail) ----
router.get('/used/:id', authenticate, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM used_purchases WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: 'failed to fetch used purchase' });
  }
});

// ---- PUT /api/used/:id (update resale price / condition / mark sold) ----
router.put('/used/:id', authenticate, requireOwner, (req, res) => {
  const id = +req.params.id;
  try {
    const existing = db.prepare('SELECT * FROM used_purchases WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const tx = db.transaction(() => {
      const sets = [];
      const vals = [];
      if (req.body.conditionNote !== undefined) { sets.push('condition_note = ?'); vals.push(req.body.conditionNote); }
      if (req.body.salePrice !== undefined) { sets.push('sale_price = ?'); vals.push(config.money(req.body.salePrice)); }
      if (req.body.model !== undefined) { sets.push('model = ?'); vals.push(req.body.model); }
      if (req.body.status === 'sold' && existing.status !== 'sold') {
        sets.push("status = 'sold'", 'sold_at = ?'); vals.push(Date.now());
        // also sell the linked unit if still in stock
        if (existing.inventory_unit_id) {
          db.prepare("UPDATE inventory_units SET status='sold', updated_at=? WHERE id=? AND status='in_stock'")
            .run(Date.now(), existing.inventory_unit_id);
        }
      }
      if (!sets.length) return;
      sets.push('id = ?'); vals.push(id);
      db.prepare(`UPDATE used_purchases SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

      // keep linked inventory unit's sale_price / specs in sync
      if (existing.inventory_unit_id && (req.body.salePrice !== undefined || req.body.conditionNote !== undefined || req.body.model !== undefined)) {
        const u = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(existing.inventory_unit_id);
        if (u) {
          const newSpecs = (req.body.model || u.model || 'Unknown') + ' · Used' + (req.body.conditionNote !== undefined ? (req.body.conditionNote ? ' · ' + req.body.conditionNote : ' · Used') : (u.specs || '').replace(/^.*? · Used(.*)$/, ' · Used$1'));
          db.prepare('UPDATE inventory_units SET model=?, sale_price=?, specs=? WHERE id=?')
            .run(req.body.model || u.model, req.body.salePrice !== undefined ? config.money(req.body.salePrice) : u.sale_price, newSpecs, existing.inventory_unit_id);
        }
      }
    });
    tx();

    const updated = db.prepare('SELECT * FROM used_purchases WHERE id = ?').get(id);
    logAction(req.admin.id, 'update', 'used_purchases', id, 'resale fields');
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'failed to update used purchase: ' + e.message });
  }
});

// ---- POST /api/used/:id/sell  (one-click resell) ----
// Body: { customerId?, paymentMethod?, notes? }
// Creates a normal sale for the linked inventory unit, producing an invoice.
router.post('/used/:id/sell', authenticate, (req, res) => {
  const id = +req.params.id;
  const { customerId, paymentMethod, notes } = req.body || {};
  try {
    const purchase = db.prepare('SELECT * FROM used_purchases WHERE id = ?').get(id);
    if (!purchase) return res.status(404).json({ error: 'used purchase not found' });
    if (purchase.status === 'sold') return res.status(409).json({ error: 'this phone is already sold' });
    if (!purchase.inventory_unit_id) return res.status(400).json({ error: 'no linked stock unit (bad data)' });

    const unit = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(purchase.inventory_unit_id);
    if (!unit) return res.status(400).json({ error: 'linked stock unit missing' });
    if (unit.status !== 'in_stock') return res.status(409).json({ error: 'linked stock unit is not in_stock (status=' + unit.status + ')' });

    const salePayload = {
      customerId: customerId ? +customerId : null,
      paymentMethod: paymentMethod || null,
      notes: notes || ('Used phone resale — ' + (purchase.receipt_no || '')),
      items: [{
        inventoryUnitId: unit.id,
        description: (unit.model || 'Used phone') + ' · Used',
        qty: 1,
        unitPrice: Number(purchase.sale_price) || Number(unit.sale_price) || 0
      }]
    };

    const result = db.transaction(() => {
      const total = config.money(salePayload.items[0].unitPrice);
      const invoiceNo = config.genInvoiceNo();
      const ts = Date.now();
      const saleInfo = db.prepare(
        `INSERT INTO sales (invoice_no, customer_id, total, discount, grand_total, payment_method, notes, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(invoiceNo, salePayload.customerId, total, 0, total, salePayload.paymentMethod, salePayload.notes, req.admin.id, ts);
      const saleId = saleInfo.lastInsertRowid;
      db.prepare(
        `INSERT INTO sale_items (sale_id, inventory_unit_id, description, qty, unit_price, line_total)
         VALUES (?,?,?,?,?,?)`
      ).run(saleId, unit.id, salePayload.items[0].description, 1, salePayload.items[0].unitPrice, total);
      db.prepare("UPDATE inventory_units SET status='sold', updated_at=? WHERE id=?").run(Date.now(), unit.id);
      markUsedSold(id, saleId);
      return { saleId, invoiceNo, grandTotal: total };
    })();

    logAction(req.admin.id, 'create', 'sale', result.saleId, `used resale ${result.invoiceNo}`);
    res.status(201).json({ saleId: result.saleId, invoiceNo: result.invoiceNo, grandTotal: result.grandTotal });
  } catch (e) {
    res.status(500).json({ error: 'used resale failed: ' + e.message });
  }
});

// ---- GET /api/used/:id/receipt/pdf ----
router.get('/used/:id/receipt/pdf', authenticate, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM used_purchases WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    generateReceiptPDF(row, res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'receipt generation failed' });
  }
});

// (DELETE not specified for used-buying; owner delete reserved for other modules)

module.exports = router;
