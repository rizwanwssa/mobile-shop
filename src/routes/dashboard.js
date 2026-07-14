'use strict';
/*
 * Module 1 — Dashboard / Reports
 *
 * NOTE on netProfit approximation (documented per contract):
 *   netProfit = totalSales
 *             - (SUM purchase_price of inventory_units where status='sold')
 *             - (SUM expenses.amount in range)
 *   The contract acknowledges this is an approximation (it sums purchase_price
 *   of all sold units rather than only those sold within the period, and totalSales
 *   is the simple sum of grand_total in range). This keeps the query tractable
 *   without cross-joining sales <-> sale_items <-> inventory_units under a temp DB.
 *
 * Routes:
 *   GET /api/dashboard/summary?from=&to=   (owner only) -> aggregates
 *   GET /api/reports/net-profit?from=&to=  (owner only) -> profit breakdown
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireOwner, logAction } = require('../auth');
const { money, parseRange } = require('../config');

// Reusable low-stock query (threshold default 5) — matches inventory module logic.
function lowStock(threshold) {
  const t = threshold !== undefined ? +threshold : 5;
  return db.prepare(
    `SELECT brand, model, COUNT(*) AS count
     FROM inventory_units
     WHERE status = 'in_stock'
     GROUP BY brand, model
     HAVING count <= ?
     ORDER BY count ASC, brand, model`
  ).all(t);
}

// ---------- Dashboard summary ----------
router.get('/dashboard/summary', authenticate, requireOwner, (req, res) => {
  const { from, to } = parseRange(req);
  try {
    // totalInvestment = money tied up in inventory still on hand
    const inv = db.prepare(
      "SELECT COALESCE(SUM(purchase_price),0) AS total FROM inventory_units WHERE status = 'in_stock'"
    ).get();
    const totalInvestment = money(inv.total);

    // totalSales = SUM(sales.grand_total) within range
    let salesTotal = 0;
    if (from != null && to != null) {
      const s = db.prepare(
        'SELECT COALESCE(SUM(grand_total),0) AS total FROM sales WHERE created_at >= ? AND created_at <= ?'
      ).get(from, to);
      salesTotal = money(s.total);
    } else {
      const s = db.prepare('SELECT COALESCE(SUM(grand_total),0) AS total FROM sales').get();
      salesTotal = money(s.total);
    }

    // netProfit approximation (see header note)
    const sold = db.prepare(
      "SELECT COALESCE(SUM(purchase_price),0) AS total FROM inventory_units WHERE status = 'sold'"
    ).get();
    const purchaseOfSold = money(sold.total);

    let expensesTotal = 0;
    if (from != null && to != null) {
      const e = db.prepare(
        'SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE expense_date >= ? AND expense_date <= ?'
      ).get(from, to);
      expensesTotal = money(e.total);
    } else {
      const e = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM expenses').get();
      expensesTotal = money(e.total);
    }

    const netProfit = money(salesTotal - purchaseOfSold - expensesTotal);

    // salesCount within range
    let salesCount = 0;
    if (from != null && to != null) {
      const c = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE created_at >= ? AND created_at <= ?').get(from, to);
      salesCount = c.n;
    } else {
      const c = db.prepare('SELECT COUNT(*) AS n FROM sales').get();
      salesCount = c.n;
    }

    logAction(req.admin.id, 'view', 'dashboard_summary', null, `from=${from} to=${to}`);

    res.json({
      totalInvestment,
      totalSales: salesTotal,
      netProfit,
      lowStock: lowStock(req.query.threshold),
      salesCount,
      dateRange: { from, to }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Net profit report ----------
router.get('/reports/net-profit', authenticate, requireOwner, (req, res) => {
  const { from, to } = parseRange(req);
  try {
    let salesTotal = 0;
    if (from != null && to != null) {
      const s = db.prepare(
        'SELECT COALESCE(SUM(grand_total),0) AS total FROM sales WHERE created_at >= ? AND created_at <= ?'
      ).get(from, to);
      salesTotal = money(s.total);
    } else {
      const s = db.prepare('SELECT COALESCE(SUM(grand_total),0) AS total FROM sales').get();
      salesTotal = money(s.total);
    }

    let expensesTotal = 0;
    if (from != null && to != null) {
      const e = db.prepare(
        'SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE expense_date >= ? AND expense_date <= ?'
      ).get(from, to);
      expensesTotal = money(e.total);
    } else {
      const e = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM expenses').get();
      expensesTotal = money(e.total);
    }

    const sold = db.prepare(
      "SELECT COALESCE(SUM(purchase_price),0) AS total FROM inventory_units WHERE status = 'sold'"
    ).get();
    const totalInvestmentSold = money(sold.total);

    const netProfit = money(salesTotal - totalInvestmentSold - expensesTotal);

    logAction(req.admin.id, 'view', 'net_profit_report', null, `from=${from} to=${to}`);

    res.json({
      totalSales: salesTotal,
      totalExpenses: expensesTotal,
      totalInvestmentSold,
      netProfit,
      period: { from, to }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
