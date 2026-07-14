'use strict';
/*
 * Seed / ensure an owner admin. Run via `npm run seed` (also runs automatically
 * on `npm start`).
 * - OWNER_PASS env (if set) ALWAYS forces the admin password to that value,
 *   whether the admin is new or existing. Lets you set/reset via host dashboard.
 * - If OWNER_PASS is NOT set, the password defaults to "shop1234" (a known demo
 *   password) so a fresh deploy is always loggable without guessing a random pw.
 */
const db = require('./db');
const { hashPassword } = require('./auth');
const crypto = require('crypto');

const DEFAULT_USER = process.env.OWNER_USER || 'admin';
const OWNER_PASS = process.env.OWNER_PASS || 'shop1234';

const exists = db.prepare('SELECT 1 FROM admin_users WHERE username = ?').get(DEFAULT_USER);

if (!exists) {
  db.prepare('INSERT INTO admin_users (name, username, password_hash, role, created_at) VALUES (?,?,?,?,?)')
    .run('Owner', DEFAULT_USER, hashPassword(OWNER_PASS), 'owner', Date.now());
  console.log('Seeded OWNER admin.');
} else {
  // Always align the stored password with OWNER_PASS (or the shop1234 default),
  // so a redeploy/restart never leaves an unknown random password in place.
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?')
    .run(hashPassword(OWNER_PASS), DEFAULT_USER);
  console.log('Aligned OWNER admin password with OWNER_PASS (default shop1234).');
}
console.log('  username:', DEFAULT_USER);
console.log('  password: (OWNER_PASS env if set, else "shop1234")');
