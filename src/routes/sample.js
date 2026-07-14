'use strict';
/*
 * Sample-data loader (owner only). Lets an admin repopulate demo data after a
 * redeploy (free hosts wipe the SQLite file). Idempotent-ish: adds fresh rows
 * each call so repeated clicks grow the dataset; clear via DB reset if needed.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireOwner } = require('../auth');

const STOCK = [
  { brand: 'Samsung', model: 'Galaxy S23 Ultra', color: 'Phantom Black', specs: '12GB/256GB, Snapdragon 8 Gen 2', imei1: '351234567890123', imei2: '351234567890124', purchase_price: 98000, sale_price: 115000 },
  { brand: 'Samsung', model: 'Galaxy S23 Ultra', color: 'Green', specs: '12GB/256GB', imei1: '351234567890125', imei2: '351234567890126', purchase_price: 98000, sale_price: 115000 },
  { brand: 'Apple', model: 'iPhone 15 Pro', color: 'Natural Titanium', specs: '256GB, A17 Pro', imei1: '359591234567890', imei2: '359591234567891', purchase_price: 125000, sale_price: 145000 },
  { brand: 'Apple', model: 'iPhone 15 Pro', color: 'Blue Titanium', specs: '256GB', imei1: '359591234567892', imei2: '359591234567893', purchase_price: 125000, sale_price: 145000 },
  { brand: 'Xiaomi', model: 'Redmi Note 13 Pro', color: 'Midnight Black', specs: '8GB/256GB', imei1: '867534210987654', imei2: '867534210987655', purchase_price: 38000, sale_price: 46000 },
  { brand: 'Xiaomi', model: 'Redmi Note 13 Pro', color: 'Ice Blue', specs: '8GB/256GB', imei1: '867534210987656', imei2: '867534210987657', purchase_price: 38000, sale_price: 46000 },
  { brand: 'Vivo', model: 'V29', color: 'Noir Black', specs: '12GB/256GB', imei1: '868123456789001', imei2: '868123456789002', purchase_price: 52000, sale_price: 64000 },
  { brand: 'Oppo', model: 'Reno 11', color: 'Wave Green', specs: '12GB/256GB', imei1: '869123456789003', imei2: '869123456789004', purchase_price: 60000, sale_price: 73000 }
];

const CUSTOMERS = [
  { name: 'Ali Khan', phone: '03001234567', cnic: '3520212345678' },
  { name: 'Bilal Ahmed', phone: '03009876543', cnic: '3520298765432' },
  { name: 'Sara Malik', phone: '03211234567', cnic: '3520156789012' }
];

const EXPENSES = [
  { category: 'rent', description: 'Shop rent', amount: 25000 },
  { category: 'electricity', description: 'Electricity bill', amount: 6500 },
  { category: 'salary', description: 'Staff salary', amount: 15000 },
  { category: 'tea', description: 'Tea/snacks', amount: 2500 },
  { category: 'other', description: 'Shop cleaning', amount: 3000 }
];

router.post('/sample-data', authenticate, requireOwner, (req, res) => {
  try {
    const insUnit = db.prepare(`INSERT INTO inventory_units (brand,model,color,specs,imei1,imei2,purchase_price,sale_price,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'in_stock',?,?)`);
    const insCust = db.prepare(`INSERT INTO customers (name,phone,cnic,created_at,updated_at) VALUES (?,?,?,?,?)`);
    const insSale = db.prepare(`INSERT INTO sales (invoice_no,customer_id,total,created_at) VALUES (?,?,?,?)`);
    const insItem = db.prepare(`INSERT INTO sale_items (sale_id, inventory_unit_id, description, qty, unit_price, line_total) VALUES (?,?,?,?,?,?)`);
    const updStatus = db.prepare(`UPDATE inventory_units SET status='sold' WHERE id=?`);
    const insExp = db.prepare(`INSERT INTO expenses (category,description,amount,expense_date,created_at) VALUES (?,?,?,?,?)`);

    const tx = db.transaction(() => {
      const now = Date.now();
      for (const s of STOCK) insUnit.run(s.brand, s.model, s.color, s.specs, s.imei1, s.imei2, s.purchase_price, s.sale_price, now, now);
      const custIds = CUSTOMERS.map(c => { const r = insCust.run(c.name, c.phone, c.cnic, now, now); return r.lastInsertRowid; });
      const inStock = db.prepare(`SELECT id, brand, model, sale_price FROM inventory_units WHERE status='in_stock' ORDER BY id DESC LIMIT 3`).all();
      for (let i = 0; i < Math.min(3, inStock.length); i++) {
        const u = inStock[i];
        const total = u.sale_price;
        const invNo = 'SMP-' + now + '-' + i;
        const sr = insSale.run(invNo, custIds[i % custIds.length], total, now);
        insItem.run(sr.lastInsertRowid, u.id, `${u.brand} ${u.model}`, 1, u.sale_price, u.sale_price);
        updStatus.run(u.id);
      }
      for (const e of EXPENSES) insExp.run(e.category, e.description, e.amount, now, now);
      return true;
    });
    tx();
    res.json({ ok: true, message: 'Sample data loaded' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
