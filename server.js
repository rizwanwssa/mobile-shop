'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');

// Ensure upload + public dirs exist
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
[UPLOAD_DIR, PUBLIC_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));

// ---- Ensure an owner admin exists on boot (idempotent) ----
// Runs regardless of start command so the DB always has a loggable owner,
// even on hosts that skip `npm run seed`. Password = OWNER_PASS or "shop1234".
(function ensureOwner() {
  try {
    const db = require('./src/db');
    const { hashPassword } = require('./src/auth');
    const pw = process.env.OWNER_PASS || 'shop1234';
    const user = process.env.OWNER_USER || 'admin';
    const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(user);
    if (!existing) {
      db.prepare('INSERT INTO admin_users (name, username, password_hash, role, created_at) VALUES (?,?,?,?,?)')
        .run('Owner', user, hashPassword(pw), 'owner', Date.now());
      console.log('[boot] created owner admin:', user);
    } else {
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(hashPassword(pw), user);
      console.log('[boot] aligned owner admin password:', user);
    }
  } catch (e) {
    console.error('[boot] ensureOwner failed:', e.message);
  }
})();

// ---- Auth routes (login) ----
const authCtrl = require('./src/authctrl');
app.post('/api/auth/login', authCtrl.login);

// ---- Module routers (mounted by assembler) ----
const routers = [
  'inventory', 'customers', 'sales', 'invoices',
  'usedbuying', 'repair', 'installments', 'expenses', 'dashboard', 'sample', 'config'
];
for (const name of routers) {
  try {
    const r = require(`./src/routes/${name}`);
    app.use('/api', r);
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    // module not built yet — skip; assembler enables when ready
    console.warn(`[mount] ${name} router not present yet — skipping`);
  }
}

// ---- Health ----
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- 404 ----
app.use((req, res) => res.status(404).json({ error: 'not found' }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Mobile Shop System running on http://localhost:${PORT}`));
}
module.exports = app;
