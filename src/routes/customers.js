'use strict';
/*
 * Module 3 — Customers
 * Routes:
 *   GET    /api/customers            -> list (owner + staff)
 *   POST   /api/customers            -> create {name, phone, cnic}
 *   PUT    /api/customers/:id        -> update name/phone/cnic
 *   DELETE /api/customers/:id        -> delete (owner only)
 *   POST   /api/customers/:id/idcard -> upload id card front/back
 *        accepts JSON { side:'front'|'back', dataUrl } OR { side, filePath }
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticate, requireOwner, logAction } = require('../auth');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

function publicCustomer(c) {
  if (!c) return c;
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    cnic: c.cnic,
    id_card_front: c.id_card_front,
    id_card_back: c.id_card_back,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

// list
router.get('/customers', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM customers ORDER BY id DESC').all();
    res.json({ customers: rows.map(publicCustomer) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// create
router.post('/customers', authenticate, (req, res) => {
  const { name, phone, cnic } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const ts = Date.now();
    const info = db.prepare(
      'INSERT INTO customers (name, phone, cnic, created_at, updated_at) VALUES (?,?,?,?,?)'
    ).run(name, phone || null, cnic || null, ts, ts);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
    logAction(req.admin.id, 'create', 'customer', customer.id, `name=${name}`);
    res.status(201).json({ customer: publicCustomer(customer) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// update
router.put('/customers/:id', authenticate, (req, res) => {
  const id = +req.params.id;
  const { name, phone, cnic } = req.body || {};
  try {
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'customer not found' });
    const newName = name !== undefined ? name : existing.name;
    const newPhone = phone !== undefined ? phone : existing.phone;
    const newCnic = cnic !== undefined ? cnic : existing.cnic;
    if (!newName) return res.status(400).json({ error: 'name required' });
    db.prepare(
      'UPDATE customers SET name=?, phone=?, cnic=?, updated_at=? WHERE id=?'
    ).run(newName, newPhone, newCnic, Date.now(), id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    logAction(req.admin.id, 'update', 'customer', id, `name=${newName}`);
    res.json({ customer: publicCustomer(customer) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// delete (owner only)
router.delete('/customers/:id', authenticate, requireOwner, (req, res) => {
  const id = +req.params.id;
  try {
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'customer not found' });
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    logAction(req.admin.id, 'delete', 'customer', id, `name=${existing.name}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// id-card upload
router.post('/customers/:id/idcard', authenticate, (req, res) => {
  const id = +req.params.id;
  const { side, dataUrl, filePath } = req.body || {};
  if (!side || (side !== 'front' && side !== 'back')) {
    return res.status(400).json({ error: "side must be 'front' or 'back'" });
  }
  try {
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'customer not found' });

    let storedPath = null;
    if (dataUrl) {
      // dataUrl form: data:image/png;base64,....
      const m = /^data:(image\/\w+);base64,(.*)$/.exec(dataUrl);
      if (!m) return res.status(400).json({ error: 'invalid dataUrl' });
      const ext = m[1].split('/')[1] === 'jpeg' ? 'jpg' : 'png';
      const buf = Buffer.from(m[2], 'base64');
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const fname = `${id}_${side}.${ext}`;
      const full = path.join(UPLOAD_DIR, fname);
      fs.writeFileSync(full, buf);
      storedPath = `/uploads/${fname}`;
    } else if (filePath) {
      storedPath = filePath;
    } else {
      return res.status(400).json({ error: 'dataUrl or filePath required' });
    }

    const col = side === 'front' ? 'id_card_front' : 'id_card_back';
    db.prepare(`UPDATE customers SET ${col}=?, updated_at=? WHERE id=?`).run(storedPath, Date.now(), id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    logAction(req.admin.id, 'update', 'customer', id, `idcard ${side}`);
    res.json({ front: customer.id_card_front, back: customer.id_card_back });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
