# MOBILE SHOP SYSTEM — CONTRACT (read before writing any code)

A single Node.js/Express server. SQLite via `better-sqlite3`. NO external framework.

## File layout
```
server.js              # entry: creates app, mounts routers, starts listen
src/db.js              # SQLite connection + full schema (DO NOT redefine tables elsewhere)
src/auth.js            # login(), authenticate, requireOwner, logAction, hashPassword
src/sms.js             # sendSMS(phone, message) — stub in dev
src/backup.js          # run() nightly backup
src/config.js          # shared helpers
src/routes/<module>.js # Express Router for each module
src/lib/<module>.js    # optional business logic (PDF, calculations)
public/               # static frontend (served at /)
uploads/              # id-card / signature images (served statically at /uploads)
```

## Shared conventions (EVERY file must follow these)
- Require the DB via `const db = require('../db');`
- All timestamps = `Date.now()` (unix ms).
- Money = Number (2 decimals). Store REAL.
- Router pattern:
  ```js
  const express = require('express');
  const router = express.Router();
  const db = require('../db');
  const { authenticate, requireOwner, logAction } = require('../auth');
  // routes...
  module.exports = router;
  ```
- Protect every mutating/reading route with `authenticate`.
- Use `logAction(req.admin.id, 'action', 'entity', id, detail)` for any data change.
- Responses: JSON `{ ... }`. Errors: `res.status(4xx/5xx).json({ error: 'msg' })`.
- NEVER expose `purchase_price` or profit fields to `role === 'staff'` (owner-only).
- Invoice/used-buying/receipt PDFs use `pdfkit` and write to `public/` or return as download.

## RBAC rules (enforced in code)
- `owner`: full access — reports, delete, see purchase price & profit.
- `staff`: can POST sales + create customers + view own entries. 403 on: reports/dashboard profit, delete, expense mgmt, user mgmt.

## Modules & endpoints (implement in your file only)
1. inventory.js  — GET/POST/PUT/DELETE /api/inventory ; GET /api/inventory/low-stock ; GET /api/brands, /api/models (POST owner)
2. customers.js  — /api/customers (CRUD), POST /api/customers/:id/idcard (front/back upload)
3. sales.js      — POST /api/sales (items, marks unit sold), GET /api/sales, GET /api/sales/:id (invoice data)
4. invoices.js   — GET /api/invoices/:saleId/pdf (pdfkit download)
5. usedbuying.js — POST /api/used (legal receipt + signature/thumb upload), GET list
6. repair.js     — /api/repairs (CRUD, status, profit auto = fee - parts)
7. installments.js — /api/ledgers, /api/installments (schedule, due-date, SMS on reminder)
8. expenses.js   — /api/expenses (CRUD)
9. dashboard.js  — GET /api/dashboard/summary (investment, sales, net profit, low stock, date filter)
   GET /api/reports/net-profit?from&to  (OWNER only)

## Do NOT
- Do not modify src/db.js schema (it is complete). Add tables only via the lead if missing.
- Do not add npm dependencies beyond those in package.json.
- Do not write frontend files unless assigned the frontend task.
- Do not touch other modules' route files.
