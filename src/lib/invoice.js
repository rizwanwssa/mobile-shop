'use strict';
/*
 * Module 3 — Invoice PDF helper
 * generateInvoicePDF(sale, items, customer, res)
 *   Uses pdfkit, pipes the document to `res` (an express response).
 *   On error, calls next(err) if available, else sends 500 JSON.
 */
const PDFDocument = require('pdfkit');
const { money } = require('../config');

const SHOP_NAME = process.env.SHOP_NAME || 'Mobile Shop System';

function generateInvoicePDF(sale, items, customer, res) {
  try {
    if (!sale) throw new Error('sale required');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // ---- Header ----
    doc.fontSize(20).font('Helvetica-Bold').text(SHOP_NAME, { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('Sales Invoice', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica-Bold').text(`Invoice No: ${sale.invoice_no}`);
    doc.fontSize(10).font('Helvetica')
      .text(`Date: ${new Date(sale.created_at).toLocaleString()}`);
    if (sale.payment_method) doc.text(`Payment Method: ${sale.payment_method}`);
    doc.moveDown(0.5);

    // ---- Customer ----
    doc.fontSize(12).font('Helvetica-Bold').text('Bill To:');
    doc.fontSize(10).font('Helvetica')
      .text(customer ? customer.name : 'Walk-in Customer');
    if (customer && customer.phone) doc.text(`Phone: ${customer.phone}`);
    if (customer && customer.cnic) doc.text(`CNIC: ${customer.cnic}`);
    doc.moveDown(1);

    // ---- Items table ----
    const tableTop = doc.y;
    const colX = { desc: 50, qty: 330, price: 380, total: 460 };
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('#', 50, tableTop);
    doc.text('Description', colX.desc, tableTop);
    doc.text('Qty', colX.qty, tableTop);
    doc.text('Unit Price', colX.price, tableTop);
    doc.text('Line Total', colX.total, tableTop);
    doc.moveDown(0.5);
    let y = doc.y;
    doc.fontSize(10).font('Helvetica');
    items.forEach((it, i) => {
      doc.text(String(i + 1), 50, y);
      doc.text(String(it.description || ''), colX.desc, y, { width: 260 });
      doc.text(String(it.qty), colX.qty, y);
      doc.text(money(it.unit_price).toFixed(2), colX.price, y);
      doc.text(money(it.line_total).toFixed(2), colX.total, y);
      y = doc.y + 4;
      doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#cccccc').stroke();
      y += 6;
    });
    doc.moveDown(1);

    // ---- Totals ----
    const rightX = 460;
    let ty = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Subtotal:', rightX - 60, ty);
    doc.text(money(sale.total).toFixed(2), rightX, ty);
    ty = doc.y + 2;
    if (sale.discount) {
      doc.text('Discount:', rightX - 60, ty);
      doc.text('-' + money(sale.discount).toFixed(2), rightX, ty);
      ty = doc.y + 2;
    }
    doc.fontSize(12);
    doc.text('Grand Total:', rightX - 60, ty);
    doc.text(money(sale.grand_total).toFixed(2), rightX, ty);

    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica-Oblique').text('Thank you for your business!', { align: 'center' });

    doc.end();
  } catch (e) {
    // If headers already sent (streaming started), we cannot send JSON; just end.
    if (res && !res.headersSent) {
      res.status(500).json({ error: e.message });
    } else if (res && typeof res.end === 'function') {
      try { res.end(); } catch (_) {}
    }
    // surface for logging
    console.error('[invoice] PDF error:', e.message);
  }
}

module.exports = { generateInvoicePDF, SHOP_NAME };
