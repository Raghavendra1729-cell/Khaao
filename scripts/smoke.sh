#!/usr/bin/env bash
# End-to-end runtime smoke test for the Khaao backend against a local Postgres.
# Boots the server with AUTH_FAKE on a throwaway DB and drives the full order
# lifecycle incl. trim/re-pool. Requires: local Postgres (createdb/dropdb on
# PATH), Go, curl, jq.
#
#   Usage:  scripts/smoke.sh
#   Env:    KHAAO_DB_USER (default: current user)  PORT (default: 8099)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8099}"
BASE="http://localhost:$PORT"
DB="khaao_smoke"
DB_USER="${KHAAO_DB_USER:-$(whoami)}"
BIN="$(mktemp -t khaao-smoke)"
PASS=0; FAIL=0
say()  { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
j()    { printf '%s' "$1" | jq -r "$2" 2>/dev/null; }

say "Reset smoke database"
dropdb --if-exists "$DB" 2>/dev/null
createdb "$DB" || { echo "createdb failed"; exit 1; }

say "Build backend"
( cd "$ROOT/backend" && go build -o "$BIN" ./cmd/server ) || { bad "go build"; exit 1; }
ok "built"

say "Boot server (AUTH_FAKE, seeded menu)"
APP_ENV=dev \
DATABASE_URL="postgres://$DB_USER@localhost:5432/$DB?sslmode=disable" \
JWT_SECRET="smoke-test-secret-must-be-at-least-32-bytes-long-xx" \
FIREBASE_PROJECT_ID="smoke" ALLOWED_EMAIL_DOMAIN="sst.scaler.com" \
SHOPKEEPER_EMAILS="shop@khaao.test" \
AUTH_FAKE=true SEED_SAMPLE_MENU=true HOLD_MINUTES=15 \
FRONTEND_ORIGIN="http://localhost:5173" PORT=$PORT \
"$BIN" > /tmp/khaao-smoke.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -f "$BIN"' EXIT

for _ in $(seq 1 40); do curl -sf "$BASE/api/menu" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "$BASE/api/menu" >/dev/null 2>&1 && ok "server up" || { bad "server did not start"; cat /tmp/khaao-smoke.log; exit 1; }

say "Auth (fake tokens)"
STU=$(curl -s -X POST "$BASE/api/auth/firebase" -H 'Content-Type: application/json' -d '{"id_token":"fake:alice@sst.scaler.com:Alice"}')
STU_T=$(j "$STU" .token); [ "$(j "$STU" .user.role)" = "student" ] && ok "student login" || bad "student login: $STU"
SHOP=$(curl -s -X POST "$BASE/api/auth/firebase" -H 'Content-Type: application/json' -d '{"id_token":"fake:shop@khaao.test:Keeper"}')
SHOP_T=$(j "$SHOP" .token); [ "$(j "$SHOP" .user.role)" = "shopkeeper" ] && ok "shop login" || bad "shop login: $SHOP"

say "Guards"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/firebase" -H 'Content-Type: application/json' -d '{"id_token":"fake:bob@gmail.com:Bob"}')" = "403" ] && ok "outside-domain 403" || bad "domain guard"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/shop/orders" -H "Authorization: Bearer $STU_T")" = "403" ] && ok "student blocked from shop 403" || bad "role guard"

say "Menu + order"
MID=$(j "$(curl -s "$BASE/api/menu")" '.items[0].id')
[ -n "$MID" ] && ok "menu item #$MID" || bad "no menu"
ORD=$(curl -s -X POST "$BASE/api/orders" -H "Authorization: Bearer $STU_T" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_item_id\":$MID,\"qty\":2}]}")
OID=$(j "$ORD" .order.id); ITEM_ID=$(j "$ORD" '.order.items[0].id')
[ "$(j "$ORD" .order.status)" = "submitted" ] && ok "order placed" || bad "create: $ORD"
DUP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/orders" -H "Authorization: Bearer $STU_T" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_item_id\":$MID,\"qty\":1}]}")
[ "$DUP" = "409" ] && ok "one-active-order 409" || bad "one-active-order (got $DUP)"

say "Accept -> cook -> ready"
[ "$(j "$(curl -s -X POST "$BASE/api/shop/orders/$OID/accept" -H "Authorization: Bearer $SHOP_T" -H 'Content-Type: application/json' -d '{"rejected_item_ids":[]}')" .order.status)" = "preparing" ] && ok "accepted" || bad "accept"
curl -s -X POST "$BASE/api/shop/prep/$MID/done" -H "Authorization: Bearer $SHOP_T" -d '{"qty":1}' >/dev/null
curl -s -X POST "$BASE/api/shop/prep/$MID/done" -H "Authorization: Bearer $SHOP_T" -d '{"qty":1}' >/dev/null
AO=$(curl -s "$BASE/api/orders/active" -H "Authorization: Bearer $STU_T")
[ "$(j "$AO" '.order.items[0].allocated_qty')" = "2" ] && [ "$(j "$AO" .order.status)" = "ready" ] && ok "FCFS allocated, ready" || bad "allocate: $AO"

say "Handover -> paid"
curl -s -X POST "$BASE/api/shop/orders/$OID/items/$ITEM_ID/handover" -H "Authorization: Bearer $SHOP_T" -d '{"qty":1}' >/dev/null
[ "$(j "$(curl -s -X POST "$BASE/api/shop/orders/$OID/items/$ITEM_ID/handover" -H "Authorization: Bearer $SHOP_T" -d '{"qty":1}')" .order.status)" = "awaiting_payment" ] && ok "awaiting_payment" || bad "handover"
[ "$(j "$(curl -s -X POST "$BASE/api/shop/orders/$OID/paid" -H "Authorization: Bearer $SHOP_T")" .order.status)" = "completed" ] && ok "completed & paid" || bad "paid"

say "Trim / re-pool"
ORD2=$(curl -s -X POST "$BASE/api/orders" -H "Authorization: Bearer $STU_T" -H 'Content-Type: application/json' -d "{\"items\":[{\"menu_item_id\":$MID,\"qty\":2}]}")
OID2=$(j "$ORD2" .order.id); IID2=$(j "$ORD2" '.order.items[0].id')
curl -s -X POST "$BASE/api/shop/orders/$OID2/accept" -H "Authorization: Bearer $SHOP_T" -H 'Content-Type: application/json' -d '{"rejected_item_ids":[]}' >/dev/null
curl -s -X POST "$BASE/api/shop/prep/$MID/done" -H "Authorization: Bearer $SHOP_T" -d '{"qty":1}' >/dev/null
[ "$(j "$(curl -s -X DELETE "$BASE/api/shop/orders/$OID2/items/$IID2" -H "Authorization: Bearer $SHOP_T")" .order.status)" = "rejected" ] && ok "order rejected after full trim" || bad "trim"
[ "$(curl -s "$BASE/api/shop/prep" -H "Authorization: Bearer $SHOP_T" | jq -r ".items[] | select(.menu_item_id==$MID) | .pool_qty")" = "1" ] && ok "unit returned to pool" || bad "re-pool"

printf '\n\033[1m== RESULT: %d passed, %d failed ==\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
