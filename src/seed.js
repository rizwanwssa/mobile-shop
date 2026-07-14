'use strict';
/* Seed an owner admin. Run via `npm run seed`. Default creds printed on first run. */
const db = require('./db');
const { hashPassword } = require('./auth');
const crypto = require('crypto');

const DEFAULT_USER = process.env.OWNER_USER || 'admin';
const DEFAULT_PASS = process.env.OWNER_PASS || crypto.randomBytes(4).toString('hex');

if (!db.prepare('SELECT 1 FROM admin_users WHERE username = ?').get(DEFAULT_USER)) {
  db.prepare('INSERT INTO admin_users (name, username, password_hash, role, created_at) VALUES (?,?,?,?,?)')
    .run('Owner', DEFAULT_USER, hashPassword(DEFAULT_PASS), 'owner', Date.now());
  console.log('Seeded OWNER admin.');
  console.log('  username:', DEFAULT_USER);
  console.log('  password:', DEFAULT_PASS, '(set OWNER_PASS env to override; change after first login)');
} else {
  console.log('Owner admin already exists.');
}
