'use strict';
/*
 * Module 4 — Used-Buying: legal receipt + buyer signature/thumb upload.
 * Only files in this module are touched here.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const db = require('../db');
const { authenticate, requireOwner, logAction } = require('../auth');
const config = require('../config');
const { generateReceiptPDF } = require('../lib/receipt');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// decode "data:image/png;base64,...." -> write file, return stored path (uploads/<name>)
function saveDataUrl(dataUrl, fileName) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  const full = path.join(UPLOAD_DIR, `${fileName}.${ext}`);
  fs.writeFileSync(full, buf);
  return `uploads/${fileName}.${ext}`;
}

// ---- POST /api/used ----
router.post('/used', authenticate, (req, res) => {
  const b = req.body || {};
  const { sellerName, sellerPhone, sellerCnic, model, imei1, imei2, conditionNote, purchasePrice, buyerSign, buyerThumb } = b;
  if (!sellerName || purchasePrice == null) {
    return res.status(400).json({ error: 'sellerName and purchasePrice are required' });
  }
  const receiptNo = config.genReceiptNo();
  const createdAt = Date.now();

  const signPath = saveDataUrl(buyerSign, `${receiptNo}_sign`);
  const thumbPath = saveDataUrl(buyerThumb, `${receiptNo}_thumb`);

  try {
    const info = db.prepare(`INSERT INTO used_purchases
      (receipt_no, seller_name, seller_phone, seller_cnic, model, imei1, imei2, condition_note,
       purchase_price, buyer_sign_path, buyer_thumb_path, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(receiptNo, sellerName, sellerPhone || null, sellerCnic || null, model || null,
        imei1 || null, imei2 || null, conditionNote || null,
        config.money(purchasePrice), signPath, thumbPath, req.admin.id, createdAt);
    logAction(req.admin.id, 'create', 'used_purchases', info.lastInsertRowid, `receipt ${receiptNo}`);
    res.status(201).json({ id: info.lastInsertRowid, receiptNo, buyerSignPath: signPath, buyerThumbPath: thumbPath });
  } catch (e) {
    res.status(500).json({ error: 'failed to record used purchase: ' + e.message });
  }
});

// ---- GET /api/used (list) ----
router.get('/used', authenticate, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM used_purchases ORDER BY created_at DESC').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'failed to list used purchases' });
  }
});

// ---- GET /api/used/:id (detail) ----
router.get('/used/:id', authenticate, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM used_purchases WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: 'failed to fetch used purchase' });
  }
});

// ---- GET /api/used/:id/receipt/pdf ----
router.get('/used/:id/receipt/pdf', authenticate, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM used_purchases WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    generateReceiptPDF(row, res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: 'receipt generation failed' });
  }
});

// (DELETE not specified for used-buying; owner delete reserved for other modules)

module.exports = router;
