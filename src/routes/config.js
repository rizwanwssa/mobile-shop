'use strict';
/* Config + auto-login (owner convenience mode).
 * When AUTO_LOGIN is not '0', the frontend skips the login screen and signs in
 * as the owner automatically. The manual login route still works for staff /
 * other accounts. This does NOT remove API auth — every request is still
 * verified; it only removes the human typing step for trusted deployments. */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { login } = require('../auth');

const AUTO_LOGIN = process.env.AUTO_LOGIN !== '0'; // on unless explicitly '0'

router.get('/config', (req, res) => {
  res.json({ autoLogin: AUTO_LOGIN, shopName: process.env.SHOP_NAME || 'Mobile Shop' });
});

router.post('/auto-login', (req, res) => {
  if (!AUTO_LOGIN) return res.status(403).json({ error: 'Auto-login disabled' });
  const admin = db.prepare("SELECT * FROM admin_users WHERE role='owner' LIMIT 1").get();
  if (!admin) return res.status(401).json({ error: 'No owner account' });
  const pw = process.env.OWNER_PASS || 'shop1234';
  const result = login(admin.username, pw);
  if (!result) return res.status(401).json({ error: 'Auto-login failed' });
  res.json(result);
});

module.exports = router;
