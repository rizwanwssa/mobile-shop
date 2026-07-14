'use strict';
/*
 * Module 7 — Expense Tracker
 * Routes (ALL owner-only; staff gets 403 on every endpoint):
 *   POST   /api/expenses                  -> create {category, description, amount, expenseDate?}
 *   GET    /api/expenses                  -> list all
 *   GET    /api/expenses/by-category      -> [{category, total}] (optional ?from&to range)
 *   PUT    /api/expenses/:id              -> update (owner only)
 *   DELETE /api/expenses/:id              -> delete (owner only)
 *
 * Categories per spec: rent | electricity | salary | tea | other
 * Net profit (dashboard.js) subtracts SUM(expenses.amount) from sales.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireOwner, logAction } = require('../auth');
const { money, parseRange } = require('../config');

const ALLOWED_CATEGORIES = ['rent', 'electricity', 'salary', 'tea', 'other'];

function publicExpense(e) {
  if (!e) return e;
  return {
    id: e.id,
    category: e.category,
    description: e.description,
    amount: e.amount,
    expense_date: e.expense_date,
    created_at: e.created_at,
  };
}

// Normalise expenseDate (ISO string or ms) to an integer ms timestamp.
function toDateMs(value) {
  if (value === undefined || value === null || value === '') return Date.now();
  const n = Number(value);
  if (!Number.isNaN(n) && String(value).trim() !== '') return Math.floor(n);
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return parsed;
  return Date.now();
}

// create (owner only)
router.post('/expenses', authenticate, requireOwner, (req, res) => {
  const { category, description, amount, expenseDate } = req.body || {};
  if (!ALLOWED_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category', allowed: ALLOWED_CATEGORIES });
  }
  if (amount === undefined || amount === null || Number.isNaN(Number(amount))) {
    return res.status(400).json({ error: 'amount required and must be numeric' });
  }
  try {
    const expense_date = toDateMs(expenseDate);
    const created_at = Date.now();
    const info = db.prepare(
      'INSERT INTO expenses (category, description, amount, expense_date, created_at) VALUES (?,?,?,?,?)'
    ).run(category, description || null, money(amount), expense_date, created_at);
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
    logAction(req.admin.id, 'create', 'expense', expense.id, `category=${category} amount=${expense.amount}`);
    res.status(201).json({ expense: publicExpense(expense) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// list (owner only; staff 403)
router.get('/expenses', authenticate, requireOwner, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC').all();
    res.json({ expenses: rows.map(publicExpense) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// aggregate by category (owner only; staff 403)
// optional ?from&to range filters expense_date
router.get('/expenses/by-category', authenticate, requireOwner, (req, res) => {
  try {
    const { from, to } = parseRange(req);
    let sql = 'SELECT category, SUM(amount) AS total FROM expenses WHERE 1=1';
    const params = [];
    if (from) { sql += ' AND expense_date >= ?'; params.push(from); }
    if (to) { sql += ' AND expense_date <= ?'; params.push(to); }
    sql += ' GROUP BY category ORDER BY category';
    const rows = db.prepare(sql).all(...params).map(r => ({ category: r.category, total: money(r.total) }));
    res.json({ byCategory: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// update (owner only)
router.put('/expenses/:id', authenticate, requireOwner, (req, res) => {
  const id = +req.params.id;
  const { category, description, amount, expenseDate } = req.body || {};
  try {
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'expense not found' });

    let newCategory = existing.category;
    if (category !== undefined) {
      if (!ALLOWED_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Invalid category', allowed: ALLOWED_CATEGORIES });
      }
      newCategory = category;
    }
    const newDescription = description !== undefined ? description : existing.description;
    const newAmount = amount !== undefined ? money(amount) : existing.amount;
    const newDate = expenseDate !== undefined ? toDateMs(expenseDate) : existing.expense_date;

    db.prepare(
      'UPDATE expenses SET category=?, description=?, amount=?, expense_date=? WHERE id=?'
    ).run(newCategory, newDescription, newAmount, newDate, id);
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    logAction(req.admin.id, 'update', 'expense', id, `category=${newCategory} amount=${expense.amount}`);
    res.json({ expense: publicExpense(expense) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// delete (owner only)
router.delete('/expenses/:id', authenticate, requireOwner, (req, res) => {
  const id = +req.params.id;
  try {
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'expense not found' });
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    logAction(req.admin.id, 'delete', 'expense', id, `category=${existing.category} amount=${existing.amount}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
