# Mobile Shop Management System

A web-based (cloud) shop-management / POS system for a mobile shop. Runs on a
laptop/desktop browser AND a phone browser. Built fresh per the Urdu/English
Software Specification Document.

## Modules (all 8 from the spec)
1. Dashboard & Analytics — total investment, sales, net profit; daily/weekly/monthly/custom date filter; low-stock alerts. (Owner-only.)
2. Inventory & Stock — brand, model, color, specs, IMEI-1 + IMEI-2, purchase & sale price, low-stock detection.
3. Sales & Customers — customer profile (name/phone/CNIC), ID-card upload (front/back), digital invoice PDF (print / WhatsApp share).
4. Used-Phone Buying — seller CNIC record + automated legal receipt PDF with buyer signature / thumb-impression box.
5. Repair Tracker — token number, status (pending / in-progress / ready), parts cost + service fee → profit.
6. Installments & Khata — customer ledger, monthly schedule + due dates, automatic SMS reminder hook.
7. Expense Tracker — rent / electricity / salary / tea / other; feeds net-profit. (Owner-only.)
8. Staff Roles & Security — Admin (owner: full) vs Staff (sales entry + customer add only; no profit, no delete, no reports). Enforced server-side.

## Stack
Node.js + Express + SQLite (better-sqlite3). PDF via pdfkit. No build step.
Frontend: plain HTML/CSS/vanilla JS (responsive, mobile-first).

## Run (development)
    npm install
    npm run seed          # creates owner admin (prints username/password)
    npm start             # http://localhost:3000
Open http://localhost:3000/login.html — log in with the seeded owner credentials.

Environment variables:
    PORT           (default 3000)
    DB_PATH        (default data/shop.db)
    OWNER_USER     (default admin)
    OWNER_PASS     (random if unset — set for a known password)
    JWT_SECRET     (set in production!)
    SMS_PROVIDER   (default 'dev' → logs to data/sms.log; wire twilio/etc. later)
    SHOP_NAME      (shows on invoices/receipts)
    BACKUP_DIR     (default ./backups)

## Verification
`src/verify.js` is the personal end-to-end test harness. It exercises every
module against a live server with real HTTP calls (34 assertions) and hard-fails
on any breakage. Run it with the SAME DB_PATH the server uses:

    DB_PATH=data/test.db PORT=3400 OWNER_PASS=verify123 node src/seed.js
    PORT=3400 OWNER_PASS=verify123 DB_PATH=data/test.db node server.js &
    DB_PATH=data/test.db OWNER_PASS=verify123 PORT=3400 node src/verify.js

Result: 34/34 passed (all 8 modules, RBAC, PDFs, SMS hook, net profit).

## What is verified vs. what needs your accounts
VERIFIED by the agent (real execution):
  - All backend logic: inventory, sales, customers, invoices (PDF), used-buying
    (legal receipt PDF), repairs, installments/Khata, expenses, dashboard/net
    profit, RBAC (owner vs staff).
  - SMS reminder hook fires (logged to data/sms.log in dev).
  - Invoice + legal-receipt PDFs are valid, openable files.
  - Responsive frontend built (all 9 pages served, JS valid, gracefully coded).

NOT verifiable from this sandbox (need YOUR accounts / hardware — code is ready,
just plug in credentials):
  - Live SMS delivery (needs a paid SMS provider account).
  - Real domain + SSL certificate (needs a domain you own + hosting).
  - Real biometric thumb scanner (legal receipt currently records an uploaded
    signature/thumb image; wire a scanner later if you have one).
  - Cloud auto-backup (nightly backup job works locally; point BACKUP_DIR at a
    synced/cloud folder or add an upload step for off-site).

## Project layout
    server.js                 entry point (mounts routers)
    src/db.js                 SQLite schema (all tables)
    src/auth.js               login + RBAC (owner/staff)
    src/routes/*.js           1 router per module (mounted under /api)
    src/lib/invoice.js        invoice PDF
    src/lib/receipt.js        used-buying legal receipt PDF
    src/sms.js                SMS stub (swap provider here)
    src/backup.js             nightly backup job
    src/verify.js             end-to-end test harness
    public/                   responsive web frontend (login.html, index.html, ...)
    uploads/                  ID cards / signatures / thumb images
