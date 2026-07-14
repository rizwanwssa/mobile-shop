#!/usr/bin/env bash
# self-test for Module 3 (customers, sales, invoices) on a temp DB
set -e
cd "$(dirname "$0")"   # project root: Mobile Shop System
ROOT="$(pwd)"
PORT=3102
DB="$(mktemp -t shop_test_XXXXXX.db)"
rm -f "$DB"
export DB_PATH="$DB"
export PORT="$PORT"
export JWT_SECRET="test-secret"
export SHOP_NAME="Test Mobile Shop"
export OWNER_PASS="2eaede2c"

# seed owner (admin/2eaede2c) into the temp DB
node "$ROOT/src/seed.js"

SERVER_LOG="$(mktemp -t shop_srv_XXXXXX.log)"
# start server
node "$ROOT/server.js" > "$SERVER_LOG" 2>&1 &
SRV_PID=$!
trap 'kill $SRV_PID 2>/dev/null; rm -f "$DB" "$DB-wal" "$DB-shm" "$SERVER_LOG" /tmp/x.pdf /tmp/idfront.png "$ROOT/uploads/${CID}_front.png" "$ROOT/uploads/${CID}_back.png" 2>/dev/null' EXIT

echo "Waiting for server on :$PORT ..."
for i in $(seq 1 30); do
  if curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.3
done

BASE="http://localhost:$PORT"
echo "=== LOGIN (admin) ==="
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"2eaede2c"}')
echo "$LOGIN"
TOKEN=$(echo "$LOGIN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).token)}catch(e){console.log("")}})')
echo "TOKEN: ${TOKEN:0:20}..."

AUTH="Authorization: Bearer $TOKEN"

echo; echo "=== CREATE CUSTOMER ==="
CUST=$(curl -s -X POST "$BASE/api/customers" -H 'Content-Type: application/json' -H "$AUTH" -d '{"name":"Ali Khan","phone":"03001234567","cnic":"12345-6789012-3"}')
echo "$CUST"
CID=$(echo "$CUST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).customer.id))')

echo; echo "=== LIST CUSTOMERS ==="
curl -s "$BASE/api/customers" -H "$AUTH"

echo; echo "=== INSERT DUMMY IN_STOCK INVENTORY UNIT (test only) ==="
UNIT_ID=$(node -e "const db=require('$ROOT/src/db');const r=db.prepare(\"INSERT INTO inventory_units (brand,model,color,specs,imei1,purchase_price,sale_price,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)\").run('Samsung','Galaxy S21','Black','128GB','111111111111111',40000,55000,'in_stock',Date.now(),Date.now());console.log(r.lastInsertRowid)")
echo "inventory_unit_id=$UNIT_ID"

echo; echo "=== POST /api/sales (with inventoryUnitId) ==="
SALE=$(curl -s -X POST "$BASE/api/sales" -H 'Content-Type: application/json' -H "$AUTH" -d "{\"customerId\":$CID,\"items\":[{\"inventoryUnitId\":$UNIT_ID,\"description\":\"Samsung Galaxy S21 Black\",\"qty\":1,\"unitPrice\":55000}],\"discount\":5000,\"paymentMethod\":\"cash\",\"notes\":\"test sale\"}")
echo "$SALE"
SID=$(echo "$SALE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).saleId))')

echo; echo "=== VERIFY UNIT MARKED SOLD ==="
curl -s "$BASE/api/health" >/dev/null
node -e "const db=require('$ROOT/src/db');const u=db.prepare('SELECT id,status FROM inventory_units WHERE id=?').get($UNIT_ID);console.log('unit status =',u.status)"

echo; echo "=== GET /api/sales/:id ==="
curl -s "$BASE/api/sales/$SID" -H "$AUTH"

echo; echo "=== GET /api/sales (list) ==="
curl -s "$BASE/api/sales" -H "$AUTH"

echo; echo "=== GET /api/invoices/:saleId/pdf -> /tmp/x.pdf ==="
curl -s "$BASE/api/invoices/$SID/pdf" -H "$AUTH" -o /tmp/x.pdf
echo "file type:"; file /tmp/x.pdf
echo "size bytes:"; wc -c < /tmp/x.pdf

echo; echo "=== GET /api/invoices/:saleId/whatsapp ==="
curl -s "$BASE/api/invoices/$SID/whatsapp" -H "$AUTH"

echo; echo "=== CUSTOMER ID-CARD UPLOAD (front, base64 PNG) ==="
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
IDCARD=$(curl -s -X POST "$BASE/api/customers/$CID/idcard" -H 'Content-Type: application/json' -H "$AUTH" -d "{\"side\":\"front\",\"dataUrl\":\"data:image/png;base64,$PNG\"}")
echo "$IDCARD"
echo "uploads dir:"; ls -la "$ROOT/uploads" | grep "$CID" || echo "(no file?)"

echo; echo "=== DELETE CUSTOMER (owner only) ==="
curl -s -X DELETE "$BASE/api/customers/$CID" -H "$AUTH"

echo; echo "=== ALL TESTS DONE ==="
