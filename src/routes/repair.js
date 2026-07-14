'use strict';
/*
 * Module 5 — Repair Tracker.
 * Profit is auto-computed = service_fee - parts_cost and stored.
 * STAFF must not see the `profit` field (stripped server-side); OWNER sees it.
 * DELETE is owner-only.
 */
const express = require('express');
const router = express.Router();

const db = require('../db');
const { authenticate, requireOwner, logAction } = require('../auth');
const config = require('../config');

const VALID_STATUS = ['pending', 'in_progress', 'ready'];

// strip profit for staff; leave untouched for owner
function sanitize(row, role) {
  if (!row) return row;
  if (role === 'staff') {
    const { profit, ...rest } = row;
    return rest;
  }
  return row;
}

// ---- POST /api/repairs ----
router.post('/repairs', authenticate, (req, res) => {
  const b = req.body || {};
  const { customerName, phone, deviceModel, problem, partsCost, serviceFee } = b;
  if (!customerName) return res.status(400).json({ error: 'customerName is required' });

  const tokenNo = config.genToken();
  const now = Date.now();
  const pc = config.money(partsCost || 0);
  const sf = config.money(serviceFee || 0);
  const profit = config.money(sf - pc);

  try {
    const info = db.prepare(`INSERT INTO repairs
      (token_no, customer_name, phone, device_model, problem, status,
       parts_cost, service_fee, profit, received_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(tokenNo, customerName, phone || null, deviceModel || null, problem || null,
        'pending', pc, sf, profit, now, now, now);
    logAction(req.admin.id, 'create', 'repairs', info.lastInsertRowid, `token ${tokenNo}`);
    const row = db.prepare('SELECT * FROM repairs WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(sanitize(row, req.admin.role));
  } catch (e) {
    res.status(500).json({ error: 'failed to create repair: ' + e.message });
  }
});

// ---- GET /api/repairs (list) ----
router.get('/repairs', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM repairs ORDER BY created_at DESC').all();
    res.json(rows.map(r => sanitize(r, req.admin.role)));
  } catch (e) {
    res.status(500).json({ error: 'failed to list repairs' });
  }
});

// ---- GET /api/repairs/token/:token (public-ish lookup by token) ----
router.get('/repairs/token/:token', authenticate, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM repairs WHERE token_no = ?').get(req.params.token);
    if (!row) return res.status(404).json({ error: 'repair not found for token' });
    res.json(sanitize(row, req.admin.role));
  } catch (e) {
    res.status(500).json({ error: 'lookup failed' });
  }
});

// ---- PUT /api/repairs/:id ----
router.put('/repairs/:id', authenticate, (req, res) => {
  const b = req.body || {};
  try {
    const existing = db.prepare('SELECT * FROM repairs WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const status = b.status != null ? b.status : existing.status;
    if (!VALID_STATUS.includes(status)) {
      return res.status(400).json({ error: 'invalid status; must be pending|in_progress|ready' });
    }
    const partsCost = b.partsCost != null ? config.money(b.partsCost) : existing.parts_cost;
    const serviceFee = b.serviceFee != null ? config.money(b.serviceFee) : existing.service_fee;
    const problem = b.problem != null ? b.problem : existing.problem;
    const profit = config.money(serviceFee - partsCost);
    const updatedAt = Date.now();

    db.prepare(`UPDATE repairs SET status=?, parts_cost=?, service_fee=?, profit=?, problem=?, updated_at=?
                 WHERE id=?`)
      .run(status, partsCost, serviceFee, profit, problem, updatedAt, existing.id);
    logAction(req.admin.id, 'update', 'repairs', existing.id, `status ${status}; profit ${profit}`);
    const row = db.prepare('SELECT * FROM repairs WHERE id = ?').get(existing.id);
    res.json(sanitize(row, req.admin.role));
  } catch (e) {
    res.status(500).json({ error: 'failed to update repair: ' + e.message });
  }
});

// ---- DELETE /api/repairs/:id (owner only) ----
router.delete('/repairs/:id', authenticate, requireOwner, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM repairs WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM repairs WHERE id = ?').run(existing.id);
    logAction(req.admin.id, 'delete', 'repairs', existing.id, `token ${existing.token_no}`);
    res.json({ ok: true, deleted: existing.id });
  } catch (e) {
    res.status(500).json({ error: 'failed to delete repair' });
  }
});

module.exports = router;
