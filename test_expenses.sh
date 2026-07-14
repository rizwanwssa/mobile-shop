#!/usr/bin/env bash
# Self-test for Module 7 — Expense Tracker
# Starts server on PORT 3105 with a temp DB, runs curl tests, prints exact
# curl commands + JSON output, then cleans up.
set -u
cd "$(dirname "$0")"

TMPDB="$(mktemp -t shop_expenses.XXXXXX).db"
PORT=3105
OWNER_PASS="${OWNER_PASS:-2eaede2c}"
export DB_PATH="$TMPDB" PORT OWNER_PASS

echo "=== TEMP DB: $TMPDB ==="

# Seed owner (admin / $OWNER_PASS)
node src/seed.js

# Insert a STAFF admin directly for the 403 test (password: staffpass)
node -e '
const db=require("./src/db");
const {hashPassword}=require("./src/auth");
db.prepare("INSERT INTO admin_users (name,username,password_hash,role,created_at) VALUES (?,?,?,?,?)")
  .run("Staff","staff1",hashPassword("staffpass"),"staff",Date.now());
console.log("[test] inserted staff admin staff1/staffpass");
'

# Start server in background
node server.js > /tmp/expenses_server.log 2>&1 &
SRV=$!
trap "kill $SRV 2>/dev/null; rm -f '$TMPDB' '${TMPDB}-wal' '${TMPDB}-shm'" EXIT

# Wait for server
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT/api/health"; then break; fi
  sleep 0.3
done

B="http://localhost:$PORT"
H_CT="Content-Type: application/json"

# Compute date ms for two days and a single-day range
read DAY1 DAY2 FROM TO < <(node -e '
const {dayStart,dayEnd}=require("./src/config");
const d1=Date.parse("2026-07-10T10:00:00Z");
const d2=Date.parse("2026-07-11T10:00:00Z");
const f=dayStart(d2), t=dayEnd(d2);
console.log(d1, d2, f, t);
')

echo
echo "======================== LOGIN OWNER ========================"
echo "$ curl -s -X POST $B/api/auth/login -H '$H_CT' -d '{\"username\":\"admin\",\"password\":\"$OWNER_PASS\"}'"
LOGIN=$(curl -s -X POST "$B/api/auth/login" -H "$H_CT" -d "{\"username\":\"admin\",\"password\":\"$OWNER_PASS\"}")
echo "$LOGIN"
TOKEN=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$LOGIN")
echo "TOKEN=$TOKEN"

echo
echo "======================== POST 3 EXPENSES ========================"
echo "$ curl -s -X POST $B/api/expenses -H 'Authorization: Bearer \$TOKEN' -H '$H_CT' \\"
echo "    -d '{\"category\":\"rent\",\"description\":\"Shop rent July\",\"amount\":5000,\"expenseDate\":$DAY1}'"
curl -s -X POST "$B/api/expenses" -H "Authorization: Bearer $TOKEN" -H "$H_CT" \
  -d "{\"category\":\"rent\",\"description\":\"Shop rent July\",\"amount\":5000,\"expenseDate\":$DAY1}"
echo

echo "$ curl -s -X POST $B/api/expenses -H 'Authorization: Bearer \$TOKEN' -H '$H_CT' \\"
echo "    -d '{\"category\":\"salary\",\"description\":\"Staff salary\",\"amount\":8000,\"expenseDate\":$DAY2}'"
curl -s -X POST "$B/api/expenses" -H "Authorization: Bearer $TOKEN" -H "$H_CT" \
  -d "{\"category\":\"salary\",\"description\":\"Staff salary\",\"amount\":8000,\"expenseDate\":$DAY2}"
echo

echo "$ curl -s -X POST $B/api/expenses -H 'Authorization: Bearer \$TOKEN' -H '$H_CT' \\"
echo "    -d '{\"category\":\"tea\",\"description\":\"Chai paani\",\"amount\":200,\"expenseDate\":$DAY2}'"
curl -s -X POST "$B/api/expenses" -H "Authorization: Bearer $TOKEN" -H "$H_CT" \
  -d "{\"category\":\"tea\",\"description\":\"Chai paani\",\"amount\":200,\"expenseDate\":$DAY2}"
echo

echo
echo "======================== INVALID CATEGORY -> 400 ========================"
echo "$ curl -s -o /dev/null -w HTTP:%{http_code} -X POST $B/api/expenses -H 'Authorization: Bearer \$TOKEN' -H '$H_CT' \\"
echo "    -d '{\"category\":\"bribe\",\"amount\":100}'"
curl -s -o /dev/null -w "HTTP:%{http_code}\n" -X POST "$B/api/expenses" -H "Authorization: Bearer $TOKEN" -H "$H_CT" \
  -d '{"category":"bribe","amount":100}'

echo
echo "======================== GET /api/expenses ========================"
echo "$ curl -s $B/api/expenses -H 'Authorization: Bearer \$TOKEN'"
curl -s "$B/api/expenses" -H "Authorization: Bearer $TOKEN"
echo

echo
echo "======================== GET /api/expenses/by-category (all) ========================"
echo "$ curl -s $B/api/expenses/by-category -H 'Authorization: Bearer \$TOKEN'"
curl -s "$B/api/expenses/by-category" -H "Authorization: Bearer $TOKEN"
echo

echo
echo "======================== GET /api/expenses/by-category?from=&to= (day2 only) ========================"
echo "$ curl -s '$B/api/expenses/by-category?from=$FROM&to=$TO' -H 'Authorization: Bearer \$TOKEN'"
curl -s "$B/api/expenses/by-category?from=$FROM&to=$TO" -H "Authorization: Bearer $TOKEN"
echo

echo
echo "======================== STAFF 403 ON POST ========================"
echo "$ curl -s -X POST $B/api/auth/login -H '$H_CT' -d '{\"username\":\"staff1\",\"password\":\"staffpass\"}'"
SLOGIN=$(curl -s -X POST "$B/api/auth/login" -H "$H_CT" -d '{"username":"staff1","password":"staffpass"}')
echo "$SLOGIN"
STOKEN=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).token)" "$SLOGIN")
echo
echo "$ curl -s -o /dev/null -w HTTP:%{http_code} -X POST $B/api/expenses -H 'Authorization: Bearer \$STOKEN' -H '$H_CT' \\"
echo "    -d '{\"category\":\"rent\",\"amount\":100}'"
curl -s -w "\nHTTP:%{http_code}\n" -X POST "$B/api/expenses" -H "Authorization: Bearer $STOKEN" -H "$H_CT" \
  -d '{"category":"rent","amount":100}'

echo
echo "======================== STAFF 403 ON GET LIST ========================"
echo "$ curl -s -o /dev/null -w HTTP:%{http_code} $B/api/expenses -H 'Authorization: Bearer \$STOKEN'"
curl -s -o /dev/null -w "HTTP:%{http_code}\n" "$B/api/expenses" -H "Authorization: Bearer $STOKEN"

echo
echo "=== DONE ==="
