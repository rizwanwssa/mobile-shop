'use strict';
/*
 * Backup job — copies the SQLite DB (and WAL) to /backups with a timestamp.
 * In production wire a cloud upload (S3/Dropbox) in uploadToCloud(). Idempotent, runnable
 * via `npm run backup` or a cron/setInterval every 24h.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function run() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const src = db.name;
  const dest = path.join(BACKUP_DIR, `shop-${stamp}.db`);
  // force a checkpoint so WAL is merged
  try { db.exec('PRAGMA wal_checkpoint(FULL);'); } catch (e) {}
  fs.copyFileSync(src, dest);
  console.log('[BACKUP] created', dest);
  return dest;
}

// Optional cloud upload hook (configure in prod)
function uploadToCloud(file) {
  // e.g. s3.putObject(...)
  return false;
}

// Realtime-safe shut down of WAL before OS-level copy if needed
if (require.main === module) {
  run();
}

module.exports = { run, uploadToCloud };
