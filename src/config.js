'use strict';
/* Shared helpers. */
const crypto = require('crypto');

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function nowMs() { return Date.now(); }

function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function dayEnd(ts) {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// Parse ?from&to (ISO date or ms) into inclusive [startMs, endMs]; default = all time
function parseRange(req) {
  let from = req.query.from ? (isNaN(+req.query.from) ? Date.parse(req.query.from) : +req.query.from) : null;
  let to = req.query.to ? (isNaN(+req.query.to) ? Date.parse(req.query.to) : +req.query.to) : null;
  if (from) from = dayStart(from);
  if (to) to = dayEnd(to);
  return { from, to };
}

function genInvoiceNo() {
  const d = new Date();
  const y = d.getFullYear();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `INV-${y}-${rand}`;
}
function genReceiptNo() {
  const d = new Date();
  const y = d.getFullYear();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `UR-${y}-${rand}`;
}
function genToken() {
  return 'R' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10);
}

module.exports = { money, nowMs, dayStart, dayEnd, parseRange, genInvoiceNo, genReceiptNo, genToken };
