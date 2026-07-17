'use strict';
/*
 * Module 3 — Sales + invoice data
 * Routes:
 *   POST /api/sales   -> create a sale (marks inventory units sold)
 *   GET  /api/sales   -> list sales (owner + staff)
 *   GET  /api/sales/:id -> full invoice view { sale, items, customer }
 *
 * Body for POST:
 *   { customerId?, items:[{inventoryUnitId?, description, qty, unitPrice}], discount, paymentMethod, notes }
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, logAction } = require('../auth');
const { money, genInvoiceNo } = require('../config');

// create sale
router.post('/sales', authenticate, (req, res) => {
  const { customerId, items, discount, paymentMethod, notes } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required (array, min 1)' });
  }
  const disc = money(discount || 0);
  if (disc < 0) return res.status(400).json({ error: 'discount cannot be negative' });

  const tx = db.transaction(() => {
    let total = 0;
    const itemRows = [];
    for (const it of items) {
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      const unit = money(it.unitPrice);
      const lineTotal = money(qty * unit);
      let invUnitId = null;
      const description = it.description || '';

      if (it.inventoryUnitId) {
        invUnitId = +it.inventoryUnitId;
        const unitRow = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(invUnitId);
        if (!unitRow) throw { status: 400, message: `inventory unit ${invUnitId} not found` };
        if (unitRow.status !== 'in_stock') {
          throw { status: 409, message: `inventory unit ${invUnitId} is not in_stock (status=${unitRow.status})` };
        }
      }
      total += lineTotal;
      itemRows.push({ invUnitId, description, qty, unit, lineTotal });
    }

    const grandTotal = money(total - disc);
    const invoiceNo = genInvoiceNo();
    const ts = Date.now();
    const saleInfo = db.prepare(
      `INSERT INTO sales (invoice_no, customer_id, total, discount, grand_total, payment_method, notes, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      invoiceNo,
      customerId ? +customerId : null,
      money(total),
      disc,
      grandTotal,
      paymentMethod || null,
      notes || null,
      req.admin.id,
      ts
    );
    const saleId = saleInfo.lastInsertRowid;

    const insItem = db.prepare(
      `INSERT INTO sale_items (sale_id, inventory_unit_id, description, qty, unit_price, line_total)
       VALUES (?,?,?,?,?,?)`
    );
    const markSold = db.prepare("UPDATE inventory_units SET status='sold', updated_at=? WHERE id=?");
    const syncUsedSold = db.prepare("UPDATE used_purchases SET status='sold', sold_at=?, sold_sale_id=? WHERE inventory_unit_id=? AND status='in_stock'");
    for (const r of itemRows) {
      insItem.run(saleId, r.invUnitId, r.description, r.qty, r.unit, r.lineTotal);
      if (r.invUnitId) {
        markSold.run(Date.now(), r.invUnitId);
        // Keep the linked Used-Buying record in sync if this unit came from a used purchase.
        syncUsedSold.run(Date.now(), saleId, r.invUnitId);
      }
    }
    return { saleId, invoiceNo, grandTotal };
  });

  try {
    const result = tx();
    logAction(req.admin.id, 'create', 'sale', result.saleId, `inv=${result.invoiceNo} total=${result.grandTotal}`);
    res.status(201).json({ saleId: result.saleId, invoiceNo: result.invoiceNo, grandTotal: result.grandTotal });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message || 'sale failed' });
  }
});

// list sales
router.get('/sales', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM sales ORDER BY id DESC').all();
    res.json({ sales: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// single sale — full invoice view
router.get('/sales/:id', authenticate, (req, res) => {
  const id = +req.params.id;
  try {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!sale) return res.status(404).json({ error: 'sale not found' });
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC').all(id);
    let customer = null;
    if (sale.customer_id) {
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id);
    }
    res.json({ sale, items, customer });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
