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
