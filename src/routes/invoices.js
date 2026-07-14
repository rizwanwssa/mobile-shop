'use strict';
/*
 * Module 3 — Invoices (digital bill, WhatsApp/print)
 * Routes:
 *   GET /api/invoices/:saleId/pdf      -> PDF download (inline with ?view=1)
 *   GET /api/invoices/:saleId/whatsapp -> { url } wa.me share link
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../auth');
const { money } = require('../config');
const { generateInvoicePDF } = require('../lib/invoice');

function loadSaleView(saleId) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(+saleId);
  if (!sale) return null;
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC').all(+saleId);
  let customer = null;
  if (sale.customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id);
  }
  return { sale, items, customer };
}

// PDF
router.get('/invoices/:saleId/pdf', authenticate, (req, res) => {
  try {
    const view = loadSaleView(req.params.saleId);
    if (!view) return res.status(404).json({ error: 'sale not found' });
    const { sale, items, customer } = view;
    const inline = req.query.view === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename=INV-${sale.invoice_no}.pdf`
    );
    generateInvoicePDF(sale, items, customer, res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// WhatsApp share
router.get('/invoices/:saleId/whatsapp', authenticate, (req, res) => {
  try {
    const view = loadSaleView(req.params.saleId);
    if (!view) return res.status(404).json({ error: 'sale not found' });
    const { sale, items, customer } = view;

    if (!customer || !customer.phone) {
      return res.json({ url: null });
    }

    const phone = String(customer.phone).replace(/\D/g, '');
    const lines = [];
    lines.push(`*${process.env.SHOP_NAME || 'Mobile Shop System'}*`);
    lines.push(`Invoice: ${sale.invoice_no}`);
    lines.push(`Date: ${new Date(sale.created_at).toLocaleString()}`);
    lines.push('----------------------');
    items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.description || 'Item'} x${it.qty} @ ${money(it.unit_price).toFixed(2)} = ${money(it.line_total).toFixed(2)}`);
    });
    lines.push('----------------------');
    if (sale.discount) lines.push(`Discount: -${money(sale.discount).toFixed(2)}`);
    lines.push(`*Total: ${money(sale.grand_total).toFixed(2)}*`);

    const text = encodeURIComponent(lines.join('\n'));
    const url = `https://wa.me/${phone}?text=${text}`;
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
