'use strict';
/*
 * Module 2 — Inventory
 *
 * Brand/model are free-text strings stored ON the unit (columns brand/model
 * on inventory_units). We also keep reference lists (brands, models) for the
 * UI; the unit itself stores the resolved free-text strings.
 *
 * Routes:
 *   GET    /api/brands              -> list distinct brands (owner-only write)
 *   POST   /api/brands              (owner) -> {name}
 *   GET    /api/models?brandId=     -> models for brand
 *   POST   /api/models              (owner) -> {brandId,name}
 *   GET    /api/inventory           -> list all units (owner sees purchase_price;
 *                                       staff get it stripped server-side)
 *   POST   /api/inventory           (authenticated) -> create unit
 *   PUT    /api/inventory/:id       (owner) -> update fields
 *   DELETE /api/inventory/:id       (owner) -> delete unit
 *   GET    /api/inventory/low-stock?threshold=5 -> low-stock model counts
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireOwner, logAction } = require('../auth');
const { money } = require('../config');

// Fields owned by OWNER only — never returned to staff.
const OWNER_ONLY_FIELDS = ['purchase_price'];

function stripOwnerFields(unit, role) {
  if (!unit) return unit;
  if (role === 'owner') return unit;
  const out = { ...unit };
  for (const f of OWNER_ONLY_FIELDS) delete out[f];
  return out;
}

// ---------- Brands ----------
router.get('/brands', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM brands ORDER BY name COLLATE NOCASE').all();
    res.json({ brands: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/brands', authenticate, requireOwner, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const info = db.prepare('INSERT INTO brands (name, created_at) VALUES (?,?)')
      .run(name, Date.now());
    const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(info.lastInsertRowid);
    logAction(req.admin.id, 'create', 'brand', brand.id, `name=${name}`);
    res.status(201).json({ brand });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Models ----------
router.get('/models', authenticate, (req, res) => {
  const brandId = req.query.brandId ? +req.query.brandId : null;
  try {
    const rows = brandId
      ? db.prepare('SELECT * FROM models WHERE brand_id = ? ORDER BY name COLLATE NOCASE').all(brandId)
      : db.prepare('SELECT * FROM models ORDER BY name COLLATE NOCASE').all();
    res.json({ models: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/models', authenticate, requireOwner, (req, res) => {
  const { brandId, name } = req.body || {};
  if (!brandId || !name) return res.status(400).json({ error: 'brandId & name required' });
  try {
    const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(+brandId);
    if (!brand) return res.status(404).json({ error: 'brand not found' });
    const info = db.prepare('INSERT INTO models (brand_id, name, created_at) VALUES (?,?,?)')
      .run(+brandId, name, Date.now());
    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(info.lastInsertRowid);
    logAction(req.admin.id, 'create', 'model', model.id, `brandId=${brandId} name=${name}`);
    res.status(201).json({ model });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Inventory units ----------
router.get('/inventory', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM inventory_units ORDER BY id DESC').all();
    const safe = rows.map(u => stripOwnerFields(u, req.admin.role));
    res.json({ units: safe });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/inventory', authenticate, (req, res) => {
  const { brand, model, color, specs, imei1, imei2, purchase_price, sale_price } = req.body || {};
  if (!brand || !model) return res.status(400).json({ error: 'brand & model required' });
  try {
    const ts = Date.now();
    const info = db.prepare(
      `INSERT INTO inventory_units
        (brand, model, color, specs, imei1, imei2, purchase_price, sale_price, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'in_stock', ?, ?)`
    ).run(
      brand, model, color || null, specs || null, imei1 || null, imei2 || null,
      money(purchase_price), money(sale_price), ts, ts
    );
    const unit = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(info.lastInsertRowid);
    logAction(req.admin.id, 'create', 'inventory_unit', unit.id, `brand=${brand} model=${model}`);
    res.status(201).json({ unit: stripOwnerFields(unit, req.admin.role) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/inventory/:id', authenticate, requireOwner, (req, res) => {
  const id = +req.params.id;
  const fields = ['brand', 'model', 'color', 'specs', 'imei1', 'imei2', 'purchase_price', 'sale_price', 'status'];
  try {
    const existing = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'unit not found' });
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body && req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(f === 'purchase_price' || f === 'sale_price' ? money(req.body[f]) : req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    sets.push('updated_at = ?');
    vals.push(Date.now());
    vals.push(id);
    db.prepare(`UPDATE inventory_units SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const unit = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(id);
    logAction(req.admin.id, 'update', 'inventory_unit', id, `fields=${fields.filter(f => req.body && req.body[f] !== undefined).join(',')}`);
    res.json({ unit: stripOwnerFields(unit, req.admin.role) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/inventory/:id', authenticate, requireOwner, (req, res) => {
  const id = +req.params.id;
  try {
    const existing = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'unit not found' });
    db.prepare('DELETE FROM inventory_units WHERE id = ?').run(id);
    logAction(req.admin.id, 'delete', 'inventory_unit', id, `brand=${existing.brand} model=${existing.model}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Low stock ----------
// Each row = 1 unit (no qty column). Low-stock = count of in_stock rows per
// (model, brand) <= threshold. Returns {model, brand, count}.
router.get('/inventory/low-stock', authenticate, (req, res) => {
  const threshold = req.query.threshold !== undefined ? +req.query.threshold : 5;
  try {
    const rows = db.prepare(
      `SELECT brand, model, COUNT(*) AS count
       FROM inventory_units
       WHERE status = 'in_stock'
       GROUP BY brand, model
       HAVING count <= ?
       ORDER BY count ASC, brand, model`
    ).all(threshold);
    res.json({ lowStock: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
