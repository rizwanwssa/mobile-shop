'use strict';
/*
 * Auth + RBAC middleware.
 * Roles: 'owner' (full: reports, delete, see purchase price/profit)
 *        'staff' (sales entry + customer add only; NO profit, NO delete, NO reports)
 */
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-prod';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function hashPassword(pw) {
  const bcrypt = require('bcryptjs');
  return bcrypt.hashSync(pw, 10);
}
function verifyPassword(pw, hash) {
  const bcrypt = require('bcryptjs');
  return bcrypt.compareSync(pw, hash);
}

function login(username, password) {
  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return null;
  }
  const token = jwt.sign({ sub: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '12h' });
  const expires = Date.now() + TOKEN_TTL_MS;
  db.prepare('INSERT INTO admin_sessions (admin_id, token, created_at, expires_at) VALUES (?,?,?,?)')
    .run(admin.id, token, Date.now(), expires);
  return { token, admin: publicAdmin(admin) };
}

function publicAdmin(a) {
  return { id: a.id, name: a.name, username: a.username, role: a.role };
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(payload.sub);
    if (!admin) return res.status(401).json({ error: 'Invalid admin' });
    req.admin = publicAdmin(admin);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// owner-only gate
function requireOwner(req, res, next) {
  if (req.admin.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
}

function logAction(adminId, action, entity, entityId, detail) {
  try {
    db.prepare(`INSERT INTO admin_action_log (admin_id, action, entity, entity_id, detail, created_at)
                VALUES (?,?,?,?,?,?)`)
      .run(adminId || null, action, entity || null, entityId || null, detail || null, Date.now());
  } catch (e) { /* non-fatal */ }
}

module.exports = { JWT_SECRET, login, authenticate, requireOwner, logAction, hashPassword, publicAdmin };
