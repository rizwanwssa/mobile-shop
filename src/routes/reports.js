'use strict';
/*
 * Module 8 — Reporting: Daily Profit + New vs Used profit split.
 * Owner-only (per POS RBAC: profit is owner-only data).
 *
 * Routes:
 *   GET  /api/reports/daily?date=<ms epoch, optional; default today>
 *        -> { date, todaySales, todayExpenses, dayNetProfit, salesCount }
 *   GET  /api/reports/profit-split?from=&to=<ms epoch/ISO, optional; default all-time>
 *        -> { profitFromNew, profitFromUsed, totalProfit, period }
 *   POST /api/used/:id/mark-sold { soldPrice }   (owner)
 *        -> { id, soldPrice, soldAt }
 *
 * Profit model (documented):
 *   Daily net profit        = todaySales
 *                            - SUM(inventory_units.purchase_price for units sold that day)
 *                            - todayExpenses
 *   New profit (range)      = SUM(sale_items.line_total - inventory_units.purchase_price)
 *                            for inventory-linked sale items in range.
 *   Used profit (range)     = SUM(sold_price - purchase_price) for used_purchases
 *                            where sold_price IS NOT NULL (sold_at in range if provided).
 *   Used phones are bought via used_purchases and sold later through the normal
 *   sales flow but are NOT linked to inventory_units, so we track their resale
 *   pragmatically via a sold_price/sold_at pair on used_purchases.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireOwner, logAction } = require('../auth');
const { money, parseRange, dayStart, dayEnd } = require('../config');

// ---- Add sold_price / sold_at to used_purchases if missing (guarded) ----
function ensureUsedSoldColumns() {
  try {
    const cols = db.prepare('PRAGMA table_info(used_purchases)').all().map(c => c.name);
    if (!cols.includes('sold_price')) {
      db.prepare('ALTER TABLE used_purchases ADD COLUMN sold_price REAL').run();
    }
    if (!cols.includes('sold_at')) {
      db.prepare('ALTER TABLE used_purchases ADD COLUMN sold_at INTEGER').run();
    }
  } catch (e) {
    // Non-fatal: migration is best-effort; routes still work for new-profit.
    console.error('[reports] ensureUsedSoldColumns failed:', e.message);
  }
}
ensureUsedSoldColumns();

// ---------- Feature 3: Daily Profit Report ----------
router.get('/reports/daily', authenticate, requireOwner, (req, res) => {
  try {
    const raw = req.query.date ? (isNaN(+req.query.date) ? Date.parse(req.query.date) : +req.query.date) : Date.now();
    if (isNaN(raw)) return res.status(400).json({ error: 'invalid date' });
    const start = dayStart(raw);
    const end = dayEnd(raw);

    const salesRow = db.prepare(
      'SELECT COALESCE(SUM(grand_total),0) AS total, COUNT(*) AS n FROM sales WHERE created_at >= ? AND created_at <= ?'
    ).get(start, end);
    const todaySales = money(salesRow.total);
    const salesCount = salesRow.n;

    const expRow = db.prepare(
      'SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE expense_date >= ? AND expense_date <= ?'
    ).get(start, end);
    const todayExpenses = money(expRow.total);

    // COGS = purchase_price of inventory units sold that day (via sale_items join).
    const cogsRow = db.prepare(
      `SELECT COALESCE(SUM(iu.purchase_price),0) AS total
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       JOIN inventory_units iu ON si.inventory_unit_id = iu.id
       WHERE s.created_at >= ? AND s.created_at <= ?`
    ).get(start, end);
    const cogs = money(cogsRow.total);

    const dayNetProfit = money(todaySales - cogs - todayExpenses);

    logAction(req.admin.id, 'view', 'report_daily', null, `date=${start}`);

    res.json({
      date: start,
      todaySales,
      todayExpenses,
      dayNetProfit,
      salesCount
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Feature 4: New vs Used profit split ----------
router.get('/reports/profit-split', authenticate, requireOwner, (req, res) => {
  const { from, to } = parseRange(req);
  try {
    // New profit: inventory-linked sale items in range.
    let newRow;
    if (from != null && to != null) {
      newRow = db.prepare(
        `SELECT COALESCE(SUM(si.line_total - iu.purchase_price),0) AS total
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         JOIN inventory_units iu ON si.inventory_unit_id = iu.id
         WHERE si.inventory_unit_id IS NOT NULL
           AND s.created_at >= ? AND s.created_at <= ?`
      ).get(from, to);
    } else {
      newRow = db.prepare(
        `SELECT COALESCE(SUM(si.line_total - iu.purchase_price),0) AS total
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         JOIN inventory_units iu ON si.inventory_unit_id = iu.id
         WHERE si.inventory_unit_id IS NOT NULL`
      ).get();
    }
    const profitFromNew = money(newRow.total);

    // Used profit: used_purchases marked sold, sold_at in range if provided.
    let usedRow;
    if (from != null && to != null) {
      usedRow = db.prepare(
        `SELECT COALESCE(SUM(sold_price - purchase_price),0) AS total
         FROM used_purchases
         WHERE sold_price IS NOT NULL
           AND sold_at >= ? AND sold_at <= ?`
      ).get(from, to);
    } else {
      usedRow = db.prepare(
        `SELECT COALESCE(SUM(sold_price - purchase_price),0) AS total
         FROM used_purchases
         WHERE sold_price IS NOT NULL`
      ).get();
    }
    const profitFromUsed = money(usedRow.total);

    const totalProfit = money(profitFromNew + profitFromUsed);

    logAction(req.admin.id, 'view', 'report_profit_split', null, `from=${from} to=${to}`);

    res.json({
      profitFromNew,
      profitFromUsed,
      totalProfit,
      period: { from, to }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Mark a used purchase as resold ----------
router.post('/used/:id/mark-sold', authenticate, requireOwner, (req, res) => {
  const id = +req.params.id;
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const soldPrice = money(req.body && req.body.soldPrice);
  if (soldPrice == null || isNaN(soldPrice)) {
    return res.status(400).json({ error: 'soldPrice is required' });
  }
  try {
    const existing = db.prepare('SELECT id FROM used_purchases WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'used purchase not found' });

    const soldAt = Date.now();
    db.prepare('UPDATE used_purchases SET sold_price = ?, sold_at = ? WHERE id = ?')
      .run(soldPrice, soldAt, id);

    logAction(req.admin.id, 'update', 'used_purchases', id, `mark-sold soldPrice=${soldPrice}`);

    res.json({ id, soldPrice, soldAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
