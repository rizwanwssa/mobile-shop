'use strict';
/*
 * Module 6 — Installments & Khata (udhaar)
 * Routes (all mounted under /api):
 *   POST   /api/ledgers                     -> create ledger for a customer (returns existing if present)
 *   GET    /api/ledgers                     -> list ledgers joined with customer name (owner + staff)
 *   GET    /api/ledgers/:id                 -> ledger + its installments
 *   GET    /api/ledgers/:id/statement       -> owner-only summary { customer, balance, installments, totalPaid, totalDue }
 *   POST   /api/ledgers/:id/installment     -> add a due installment { amount, dueDate }
 *   POST   /api/installments/:id/pay        -> mark installment paid, reduce ledger balance
 *   GET    /api/installments/due?days=N     -> due installments within next N days (default 3)
 *   POST   /api/installments/remind-due     -> SMS reminder hook for due installments (sets reminder_sent)
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireOwner, logAction } = require('../auth');
const { money, nowMs } = require('../config');
const { sendSMS } = require('../sms');

const DAY_MS = 86400000;

function publicLedger(l) {
  if (!l) return l;
  return {
    id: l.id,
    customer_id: l.customer_id,
    balance: money(l.balance),
    customer_name: l.customer_name || null,
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}

function publicInstallment(i) {
  if (!i) return i;
  return {
    id: i.id,
    ledger_id: i.ledger_id,
    customer_id: i.customer_id,
    amount: money(i.amount),
    due_date: i.due_date,
    status: i.status,
    paid_at: i.paid_at,
    reminder_sent: i.reminder_sent,
    created_at: i.created_at,
  };
}

// ---- Create ledger for a customer (one per customer) ----
router.post('/ledgers', authenticate, (req, res) => {
  const { customerId, openingBalance } = req.body || {};
  const cid = +customerId;
  if (!cid) return res.status(400).json({ error: 'customerId required' });
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(cid);
    if (!customer) return res.status(404).json({ error: 'customer not found' });

    const existing = db.prepare('SELECT * FROM ledgers WHERE customer_id = ?').get(cid);
    if (existing) {
      const withName = db.prepare(
        'SELECT l.*, c.name AS customer_name FROM ledgers l JOIN customers c ON c.id = l.customer_id WHERE l.id = ?'
      ).get(existing.id);
      return res.json({ ledger: publicLedger(withName), existing: true });
    }

    const balance = money(openingBalance || 0);
    const ts = nowMs();
    const info = db.prepare(
      'INSERT INTO ledgers (customer_id, balance, created_at, updated_at) VALUES (?,?,?,?)'
    ).run(cid, balance, ts, ts);
    const ledger = db.prepare(
      'SELECT l.*, c.name AS customer_name FROM ledgers l JOIN customers c ON c.id = l.customer_id WHERE l.id = ?'
    ).get(info.lastInsertRowid);
    logAction(req.admin.id, 'create', 'ledger', ledger.id, `customer=${cid} opening=${balance}`);
    res.status(201).json({ ledger: publicLedger(ledger) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- List ledgers with customer name ----
router.get('/ledgers', authenticate, (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT l.*, c.name AS customer_name FROM ledgers l JOIN customers c ON c.id = l.customer_id ORDER BY l.id DESC'
    ).all();
    res.json({ ledgers: rows.map(publicLedger) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Owner-only statement ----
router.get('/ledgers/:id/statement', authenticate, requireOwner, (req, res) => {
  const id = +req.params.id;
  try {
    const ledger = db.prepare(
      'SELECT l.*, c.name AS customer_name, c.phone FROM ledgers l JOIN customers c ON c.id = l.customer_id WHERE l.id = ?'
    ).get(id);
    if (!ledger) return res.status(404).json({ error: 'ledger not found' });

    const installments = db.prepare('SELECT * FROM installments WHERE ledger_id = ? ORDER BY due_date ASC').all(id);
    const totalPaid = money(installments.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0));
    const totalDue = money(installments.filter(i => i.status === 'due').reduce((s, i) => s + i.amount, 0));

    res.json({
      customer: { id: ledger.customer_id, name: ledger.customer_name, phone: ledger.phone },
      balance: money(ledger.balance),
      installments: installments.map(publicInstallment),
      totalPaid,
      totalDue,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Ledger + its installments ----
router.get('/ledgers/:id', authenticate, (req, res) => {
  const id = +req.params.id;
  try {
    const ledger = db.prepare(
      'SELECT l.*, c.name AS customer_name FROM ledgers l JOIN customers c ON c.id = l.customer_id WHERE l.id = ?'
    ).get(id);
    if (!ledger) return res.status(404).json({ error: 'ledger not found' });
    const installments = db.prepare('SELECT * FROM installments WHERE ledger_id = ? ORDER BY due_date ASC').all(id);
    res.json({ ledger: publicLedger(ledger), installments: installments.map(publicInstallment) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Add installment to ledger ----
router.post('/ledgers/:id/installment', authenticate, (req, res) => {
  const id = +req.params.id;
  const { amount, dueDate } = req.body || {};
  const amt = money(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'amount required (>0)' });

  let due;
  if (dueDate === undefined || dueDate === null || dueDate === '') {
    return res.status(400).json({ error: 'dueDate required' });
  }
  due = isNaN(+dueDate) ? Date.parse(dueDate) : +dueDate;
  if (!due || isNaN(due)) return res.status(400).json({ error: 'invalid dueDate (ISO or ms)' });

  try {
    const ledger = db.prepare('SELECT * FROM ledgers WHERE id = ?').get(id);
    if (!ledger) return res.status(404).json({ error: 'ledger not found' });

    const info = db.prepare(
      'INSERT INTO installments (ledger_id, customer_id, amount, due_date, status, reminder_sent, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(id, ledger.customer_id, amt, due, 'due', 0, nowMs());
    const installment = db.prepare('SELECT * FROM installments WHERE id = ?').get(info.lastInsertRowid);
    logAction(req.admin.id, 'create', 'installment', installment.id, `ledger=${id} amount=${amt} due=${due}`);
    res.status(201).json({ installment: publicInstallment(installment) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Pay an installment (reduce ledger balance) ----
router.post('/installments/:id/pay', authenticate, (req, res) => {
  const id = +req.params.id;
  try {
    const installment = db.prepare('SELECT * FROM installments WHERE id = ?').get(id);
    if (!installment) return res.status(404).json({ error: 'installment not found' });
    if (installment.status === 'paid') {
      return res.status(409).json({ error: 'installment already paid' });
    }

    const ledger = db.prepare('SELECT * FROM ledgers WHERE id = ?').get(installment.ledger_id);
    if (!ledger) return res.status(404).json({ error: 'ledger not found' });

    const newBalance = money(Math.max(0, ledger.balance - installment.amount));
    const tx = db.transaction(() => {
      db.prepare("UPDATE installments SET status='paid', paid_at=? WHERE id=?").run(nowMs(), id);
      db.prepare('UPDATE ledgers SET balance=?, updated_at=? WHERE id=?').run(newBalance, nowMs(), ledger.id);
    });
    tx();

    const updated = db.prepare(
      'SELECT l.*, c.name AS customer_name FROM ledgers l JOIN customers c ON c.id = l.customer_id WHERE l.id = ?'
    ).get(ledger.id);
    logAction(req.admin.id, 'pay', 'installment', id, `amount=${installment.amount} newBalance=${newBalance}`);
    res.json({ installment: publicInstallment(db.prepare('SELECT * FROM installments WHERE id = ?').get(id)), ledger: publicLedger(updated) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Due installments within next N days ----
router.get('/installments/due', authenticate, (req, res) => {
  const days = parseInt(req.query.days, 10) || 3;
  try {
    const now = nowMs();
    const rows = db.prepare(
      "SELECT i.*, c.name AS customer_name, c.phone FROM installments i JOIN customers c ON c.id = i.customer_id " +
      "WHERE i.status='due' AND i.due_date >= ? AND i.due_date <= ? ORDER BY i.due_date ASC"
    ).all(now, now + days * DAY_MS);
    res.json({ installments: rows.map(publicInstallment) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- SMS reminder hook ----
router.post('/installments/remind-due', authenticate, (req, res) => {
  const days = parseInt(req.query.days, 10) || parseInt(req.body && req.body.days, 10) || 3;
  try {
    const now = nowMs();
    const due = db.prepare(
      "SELECT i.*, c.name AS customer_name, c.phone FROM installments i JOIN customers c ON c.id = i.customer_id " +
      "WHERE i.status='due' AND i.reminder_sent=0 AND i.due_date >= ? AND i.due_date <= ? ORDER BY i.due_date ASC"
    ).all(now, now + days * DAY_MS);

    let sent = 0;
    const failures = [];
    for (const i of due) {
      if (!i.phone) continue;
      const dateStr = new Date(i.due_date).toISOString().slice(0, 10);
      const msg = `Reminder: your installment of Rs ${money(i.amount)} is due on ${dateStr}.`;
      try {
        sendSMS(i.phone, msg);
        db.prepare('UPDATE installments SET reminder_sent=1 WHERE id=?').run(i.id);
        sent++;
        logAction(req.admin.id, 'remind', 'installment', i.id, `sms->${i.phone}`);
      } catch (smsErr) {
        failures.push({ id: i.id, error: smsErr.message });
      }
    }
    res.json({ sent, total: due.length, failures: failures.length ? failures : undefined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
