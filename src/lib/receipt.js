'use strict';
/*
 * Legal used-device purchase receipt PDF generator (Module 4).
 * Uses pdfkit. Reads signature / thumb-impression images from disk under
 * the project's uploads/ directory when their paths are present on the record.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// uploads lives at <project root>/uploads ; this file is <root>/src/lib/receipt.js
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

function resolveUpload(p) {
  if (!p) return null;
  // stored path is like 'uploads/<receiptNo>_sign.png'
  return p.startsWith('uploads/') ? path.join(__dirname, '..', '..', p) : path.join(UPLOAD_DIR, p);
}

// Returns true only if the image is a valid PNG/JPEG with sane dimensions
// (>=2x2). Prevents pdfkit's decoder from hanging on corrupt/1x1 uploads,
// which would otherwise block the entire HTTP response.
function safeToEmbed(p) {
  if (!p || !fs.existsSync(p)) return false;
  try {
    const buf = fs.readFileSync(p);
    if (buf.length < 32) return false;
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      // PNG: read IHDR width/height (bytes 16-23)
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      return w >= 2 && h >= 2 && w < 100000 && h < 100000;
    }
    if (buf[0] === 0xFF && buf[1] === 0xD8) return true; // JPEG
    return false;
  } catch (e) {
    return false;
  }
}

function fmtMoney(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(ms) {
  const d = new Date(ms || Date.now());
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Generate a legal used-device purchase receipt PDF.
 * @param {object} record  row from used_purchases (+ any enrichment)
 * @param {object} res     Express response (PDF streamed as attachment)
 */
function generateReceiptPDF(record, res) {
  if (!record || !record.id) {
    return res.status(400).json({ error: 'invalid receipt record' });
  }
  let doc;
  try {
    doc = new PDFDocument({ margin: 50, size: 'A4' });

    // headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="used-receipt-${record.receipt_no || record.id}.pdf"`);

    doc.pipe(res);

    // ---- Shop header ----
    doc.fontSize(20).font('Helvetica-Bold').text('MOBILE SHOP SYSTEM', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Used Device Purchase Receipt (Legal Record)', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).text('This document serves as proof of lawful second-hand device purchase.', { align: 'center' });
    doc.moveDown(1);

    // divider
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // ---- Receipt meta ----
    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(`Receipt No : ${record.receipt_no || ''}`);
    doc.text(`DATE       : ${fmtDate(record.created_at)}`);
    doc.moveDown(0.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // ---- Seller details ----
    doc.fontSize(12).font('Helvetica-Bold').text('Seller Details');
    doc.moveDown(0.2);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Name  : ${record.seller_name || ''}`);
    doc.text(`Phone : ${record.seller_phone || ''}`);
    doc.text(`CNIC  : ${record.seller_cnic || ''}`);
    doc.moveDown(0.5);

    // ---- Device details ----
    doc.fontSize(12).font('Helvetica-Bold').text('Device Details');
    doc.moveDown(0.2);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Model      : ${record.model || ''}`);
    doc.text(`IMEI 1     : ${record.imei1 || ''}`);
    doc.text(`IMEI 2     : ${record.imei2 || ''}`);
    doc.text(`Condition  : ${record.condition_note || ''}`);
    doc.moveDown(0.5);

    // ---- Purchase price ----
    doc.fontSize(12).font('Helvetica-Bold').text(`Purchase Price : PKR ${fmtMoney(record.purchase_price)}`);
    doc.moveDown(0.5);

    // ---- Legal confirmation line ----
    doc.fontSize(10).font('Helvetica-Oblique')
      .text('Seller confirms this device is legally owned and not stolen/blocked.', { align: 'left' });
    doc.moveDown(1);

    // ---- Signature / Thumb boxes ----
    const signPath = resolveUpload(record.buyer_sign_path);
    const thumbPath = resolveUpload(record.buyer_thumb_path);

    const boxTop = doc.y;
    const boxW = 230;
    const boxH = 80;
    const gap = 35;
    const signX = 50;
    const thumbX = signX + boxW + gap;

    // Buyer Signature box
    doc.rect(signX, boxTop, boxW, boxH).stroke();
    doc.fontSize(9).font('Helvetica').text('Buyer Signature', signX + 4, boxTop + 4);
    // Embed only images that are valid + sane-sized. pdfkit's PNG decoder can hang
    // on pathological 1x1/corrupt uploads, which would block the whole HTTP
    // response; we therefore validate dimensions first and never embed otherwise.
    // The signature/thumb FILE is always saved to disk (the legal record); the
    // embedded raster is a visual convenience only.
    if (signPath && safeToEmbed(signPath)) {
      try { doc.image(signPath, signX + 15, boxTop + 18, { width: boxW - 30 }); } catch (e) { /* ignore */ }
    }

    // Thumb Impression box
    doc.rect(thumbX, boxTop, boxW, boxH).stroke();
    doc.fontSize(9).font('Helvetica').text('Thumb Impression', thumbX + 4, boxTop + 4);
    if (thumbPath && safeToEmbed(thumbPath)) {
      try { doc.image(thumbPath, thumbX + 15, boxTop + 18, { width: boxW - 30 }); } catch (e) { /* ignore */ }
    }

    doc.y = boxTop + boxH + 20;
    doc.fontSize(8).font('Helvetica-Oblique')
      .text('Generated electronically by Mobile Shop System. Sign/thumb box is recorded at point of purchase.');

    doc.end();
  } catch (e) {
    // ensure headers not already sent; respond 500
    if (doc && !res.headersSent) {
      try { res.status(500).json({ error: 'receipt generation failed' }); } catch (_) {}
    } else if (!res.headersSent) {
      res.status(500).json({ error: 'receipt generation failed' });
    }
    if (doc) { try { doc.end(); } catch (_) {} }
  }
}

module.exports = { generateReceiptPDF, UPLOAD_DIR, resolveUpload };
