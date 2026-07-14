'use strict';
/*
 * Seed / ensure an owner admin. Run via `npm run seed`.
 * - If OWNER_PASS is set: the admin password is ALWAYS forced to OWNER_PASS
 *   (whether the admin already exists or not). This lets you set/reset the
 *   password via the OWNER_PASS env var and redeploy — no DB wipe needed.
 * - If OWNER_PASS is NOT set: behaves like before — random password only on
 *   first seed; keeps the existing admin on later runs.
 */
const db = require('./db');
const { hashPassword } = require('./auth');
const crypto = require('crypto');

const DEFAULT_USER = process.env.OWNER_USER || 'admin';
const OWNER_PASS = process.env.OWNER_PASS;

const exists = db.prepare('SELECT 1 FROM admin_users WHERE username = ?').get(DEFAULT_USER);

if (OWNER_PASS) {
  if (!exists) {
    db.prepare('INSERT INTO admin_users (name, username, password_hash, role, created_at) VALUES (?,?,?,?,?)')
      .run('Owner', DEFAULT_USER, hashPassword(OWNER_PASS), 'owner', Date.now());
    console.log('Seeded OWNER admin.');
  } else {
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?')
      .run(hashPassword(OWNER_PASS), DEFAULT_USER);
    console.log('Updated OWNER admin password from OWNER_PASS env.');
  }
  console.log('  username:', DEFAULT_USER);
  console.log('  password: (from OWNER_PASS env — set in your host dashboard)');
} else {
  if (!exists) {
    const rand = crypto.randomBytes(4).toString('hex');
    db.prepare('INSERT INTO admin_users (name, username, password_hash, role, created_at) VALUES (?,?,?,?,?)')
      .run('Owner', DEFAULT_USER, hashPassword(rand), 'owner', Date.now());
    console.log('Seeded OWNER admin.');
    console.log('  username:', DEFAULT_USER);
    console.log('  password:', rand, '(set OWNER_PASS env to override; change after first login)');
  } else {
    console.log('Owner admin already exists.');
  }
}
