'use strict';
/*
 * Database layer — SQLite via better-sqlite3 (synchronous, simple, zero-config).
 * This is the SINGLE SOURCE OF TRUTH for the schema. Every module's migrations
 * append their tables here so the whole schema lives in one place.
 *
 * Money columns are stored as REAL (2-decimal). Dates as ISO strings / unix ms.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'shop.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema bootstrap (idempotent) ----
const SCHEMA = `
-- ============ AUTH / RBAC ============
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff', -- 'owner' | 'staff'
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

-- ============ INVENTORY (Module 2) ============
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (brand_id) REFERENCES brands(id)
);
CREATE TABLE IF NOT EXISTS inventory_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  color TEXT,
  specs TEXT,                 -- free text specifications
  imei1 TEXT,
  imei2 TEXT,
  purchase_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_stock', -- in_stock | sold | reserved
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_status ON inventory_units(status);
CREATE INDEX IF NOT EXISTS idx_inv_model ON inventory_units(model);

-- ============ CUSTOMERS (Module 3) ============
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  cnic TEXT,
  id_card_front TEXT,         -- stored file path / url
  id_card_back TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ============ SALES / INVOICES (Module 3) ============
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER,
  total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  grand_total REAL NOT NULL DEFAULT 0,
  payment_method TEXT,        -- cash | card | transfer
  notes TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  inventory_unit_id INTEGER,
  description TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

-- ============ USED-BUYING (Module 4) ============
CREATE TABLE IF NOT EXISTS used_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT UNIQUE NOT NULL,
  seller_name TEXT NOT NULL,
  seller_phone TEXT,
  seller_cnic TEXT,
  model TEXT,
  imei1 TEXT,
  imei2 TEXT,
  condition_note TEXT,
  purchase_price REAL NOT NULL DEFAULT 0,
  buyer_sign_path TEXT,       -- signature image file path
  buyer_thumb_path TEXT,      -- thumb impression image file path
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES admin_users(id)
);

-- ============ REPAIR TRACKER (Module 5) ============
CREATE TABLE IF NOT EXISTS repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_no TEXT UNIQUE NOT NULL,
  customer_name TEXT,
  phone TEXT,
  device_model TEXT,
  problem TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | ready
  parts_cost REAL NOT NULL DEFAULT 0,
  service_fee REAL NOT NULL DEFAULT 0,
  profit REAL NOT NULL DEFAULT 0,
  received_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ============ INSTALLMENTS / KHATA (Module 6) ============
CREATE TABLE IF NOT EXISTS ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  balance REAL NOT NULL DEFAULT 0,   -- current outstanding balance
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  due_date INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'due', -- due | paid | overdue
  paid_at INTEGER,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ============ EXPENSES (Module 7) ============
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,     -- rent | electricity | salary | tea | other
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  expense_date INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`;

db.exec(SCHEMA);

module.exports = db;
