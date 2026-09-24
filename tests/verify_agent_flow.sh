#!/usr/bin/env bash
# tests/verify_agent_flow.sh: APONIA.ro agent commerce verification harness.
#
# Self-contained: boots an isolated `wrangler pages dev` instance unless BASE_URL
# is specified. Runs the complete test battery across:
#  - Catalog contract (exact 7 keys, currency RON)
#  - Samples availability
#  - Discovery (.well-known/agent.json, agent-skills-discovery)
#  - Buy endpoint (Stripe 200, x402 402, idempotency, rate limiting)
#  - Deliveries endpoint (unpaid 402, paid 200 JSON & Markdown, held 403)
#  - Webhook settlement (HMAC-SHA256 verification, replay, daily cap enforcement)
#  - Zero em-dashes validation scan

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRET="${PAYMENT_WEBHOOK_SECRET:-aponia-test-secret-789}"
PORT="${PORT:-8796}"
STARTED=0
PASS=0
FAILS=0
T="/tmp/aponia_test_$$"

cleanup() {
  if [ -n "${SRVPID:-}" ]; then
    kill "$SRVPID" >/dev/null 2>&1 || true
  fi
  pkill -f "pages dev .*--port $PORT" >/dev/null 2>&1 || true
  rm -f "${T}"*
  return 0
}
trap cleanup EXIT INT TERM

if [ -z "${BASE_URL:-}" ]; then
  BASE_URL="http://127.0.0.1:${PORT}"
  W="${WRANGLER:-/Users/pc/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler}"
  NS="run_aponia_$(date +%s)_$$"
  LOG="/tmp/aponia-harness-${NS}.log"
  
  pkill -f "pages dev .*--port $PORT" >/dev/null 2>&1 || true
  sleep 1
  cd "$ROOT" || exit 2
  CI=1 "$W" pages dev . --port "$PORT" --kv AGENT_STORE \
    --binding PAYMENT_WEBHOOK_SECRET="$SECRET" \
    --binding X402_PAYTO_ADDRESS="0x1111111111111111111111111111111111111111" \
    --binding AGENT_STATE_NS="$NS" \
    --binding DAILY_CAP_RON_CENTS=10000 \
    --show-interactive-dev-session=false > "$LOG" 2>&1 &
  SRVPID=$!
  cd - >/dev/null || true
  STARTED=1

  code=""
  for i in $(seq 1 45); do
    if ! kill -0 "$SRVPID" 2>/dev/null; then
      echo "[FATAL] pages dev exited unexpectedly; see $LOG"
      tail -25 "$LOG" 2>/dev/null
      exit 2
    fi
    code=$(curl -s -m 2 -o /dev/null -w '%{http_code}' "$BASE_URL/api/catalog.json" 2>/dev/null || true)
    [ "$code" = "200" ] && break
    sleep 1
  done

  if [ "$code" != "200" ]; then
    echo "[FATAL] pages dev failed to start on $PORT; see $LOG"
    tail -25 "$LOG" 2>/dev/null
    exit 2
  fi
  echo "instance ready: $BASE_URL (ns=$NS, pid=$SRVPID)"
fi

echo "testing target: $BASE_URL"

ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAILS=$((FAILS+1)); echo "[FAIL] $1"; }
eq()   { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (got: ${2:-<empty>}, want: $1)"; fi; }

pyassert() {
  if python3 - "$1" "$2" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert eval(sys.argv[2]), f"assertion failed: {sys.argv[2]} -> {d}"
PY
  then ok "$3"; else bad "$3"; fi
}

sign() {
  python3 -c "import hmac,hashlib,sys;print('sha256='+hmac.new(sys.argv[2].encode(),sys.argv[1].encode(),hashlib.sha256).hexdigest())" "$1" "$SECRET"
}

# -----------------------------------------------------------------------------
# 1. CATALOG CONTRACT TESTS
# -----------------------------------------------------------------------------
echo ""
echo "=== 1. CATALOG CONTRACT (/api/catalog.json) ==="

code=$(curl -s -o "${T}_cat.json" -w '%{http_code}' "$BASE_URL/api/catalog.json")
eq 200 "$code" "GET /api/catalog.json returns 200"
pyassert "${T}_cat.json" "isinstance(d, list) and len(d) == 3" "catalog is array of 3 products"
pyassert "${T}_cat.json" "all(set(p.keys()) == {'checkout_type', 'currency', 'description', 'id', 'name', 'price_cents', 'sample_output_url'} for p in d)" "catalog conforms exactly to the 7-key contract"
pyassert "${T}_cat.json" "all(p['currency'] == 'RON' for p in d)" "catalog currency is RON everywhere"
pyassert "${T}_cat.json" "{p['id']: p['price_cents'] for p in d} == {'therapist-onboarding-kit': 14900, 'practice-protocol-templates': 9900, 'session-notes-prompt-pack': 4900}" "catalog prices: 14900, 9900, 4900 cents"
pyassert "${T}_cat.json" "{p['id']: p['checkout_type'] for p in d} == {'therapist-onboarding-kit': 'stripe_hosted', 'practice-protocol-templates': 'stripe_hosted', 'session-notes-prompt-pack': 'x402'}" "catalog checkout types match specs"
pyassert "${T}_cat.json" "all(p['sample_output_url'].startswith('https://aponia.ro/samples/') for p in d)" "sample URLs are absolute"

# -----------------------------------------------------------------------------
# 2. SAMPLES AVAILABILITY
# -----------------------------------------------------------------------------
echo ""
echo "=== 2. SAMPLES AVAILABILITY ==="

for sample in therapist-onboarding-kit-sample practice-protocol-templates-sample session-notes-prompt-pack-sample; do
  if [ -f "$ROOT/samples/${sample}.md" ]; then
    ok "local file exists: samples/${sample}.md"
  else
    bad "missing local file: samples/${sample}.md"
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/samples/${sample}.md")
  eq 200 "$code" "HTTP 200 on /samples/${sample}.md"
done

# -----------------------------------------------------------------------------
# 3. AGENT DISCOVERY (.well-known)
# -----------------------------------------------------------------------------
echo ""
echo "=== 3. AGENT DISCOVERY ==="

code=$(curl -s -o "${T}_agent.json" -w '%{http_code}' "$BASE_URL/.well-known/agent.json")
eq 200 "$code" "GET /.well-known/agent.json returns 200"
pyassert "${T}_agent.json" "d['name'] == 'APONIA.ro' and 'catalog' in d['endpoints'] and 'buy' in d['endpoints']" "agent.json exposes discovery endpoints"

code=$(curl -s -o "${T}_skills.json" -w '%{http_code}' "$BASE_URL/.well-known/agent-skills-discovery")
eq 200 "$code" "GET /.well-known/agent-skills-discovery returns 200"
pyassert "${T}_skills.json" "any(c.get('name') == 'agent_commerce' for c in d.get('capabilities', []))" "agent-skills-discovery advertises agent_commerce"

# -----------------------------------------------------------------------------
# 4. BUY ENDPOINT (/api/agent/buy)
# -----------------------------------------------------------------------------
echo ""
echo "=== 4. BUY ENDPOINT VALIDATION & RAILS ==="

# 4.1 CORS preflight
c=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$BASE_URL/api/agent/buy")
eq 204 "$c" "OPTIONS /api/agent/buy returns 204"

# 4.2 Malformed body / missing product / missing identity
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{invalid}' "$BASE_URL/api/agent/buy")
eq 400 "$c" "buy: malformed JSON returns 400"

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"agent_id":"test"}' "$BASE_URL/api/agent/buy")
eq 400 "$c" "buy: missing product_id returns 400"

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"product_id":"therapist-onboarding-kit"}' "$BASE_URL/api/agent/buy")
eq 400 "$c" "buy: missing identity returns 400"

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"product_id":"unknown-product","agent_id":"test"}' "$BASE_URL/api/agent/buy")
eq 404 "$c" "buy: unknown product returns 404"

# 4.3 Stripe hosted purchase
c=$(curl -s -o "${T}_stripe.json" -D "${T}_stripe.h" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: idem-stripe-001' \
  -d '{"product_id":"therapist-onboarding-kit","agent_id":"agent-stripe-1","email":"therapist@example.com"}' \
  "$BASE_URL/api/agent/buy")
eq 200 "$c" "buy: therapist-onboarding-kit (stripe_hosted) returns 200"
pyassert "${T}_stripe.json" "d['checkout_type'] == 'stripe_hosted' and d['price_cents'] == 14900 and d['currency'] == 'RON' and 'order_token' in d and 'checkout_url' in d" "stripe buy returns order_token and checkout_url"

TOKEN_STRIPE=$(python3 -c "import json; print(json.load(open('${T}_stripe.json'))['order_token'])")

# 4.4 Idempotent replay
c=$(curl -s -o "${T}_stripe_replay.json" -D "${T}_stripe_replay.h" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: idem-stripe-001' \
  -d '{"product_id":"therapist-onboarding-kit","agent_id":"agent-stripe-1","email":"therapist@example.com"}' \
  "$BASE_URL/api/agent/buy")
eq 200 "$c" "buy: idempotent replay returns 200"
pyassert "${T}_stripe_replay.json" "d['order_token'] == '$TOKEN_STRIPE'" "replay returns identical order_token"
if grep -qi '^Idempotency-Replayed: true' "${T}_stripe_replay.h"; then
  ok "idempotency header Idempotency-Replayed is present"
else
  bad "idempotency header Idempotency-Replayed is missing"
fi

# 4.5 Rate limiting (max 3 buy attempts per 10 minutes)
# We already made 1 fresh attempt for agent-stripe-1 (the replay does not count).
# Let's perform attempt 2 and 3:
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"product_id":"practice-protocol-templates","agent_id":"agent-stripe-1"}' "$BASE_URL/api/agent/buy"
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"product_id":"session-notes-prompt-pack","agent_id":"agent-stripe-1"}' "$BASE_URL/api/agent/buy"

# 4th attempt must be 429
c=$(curl -s -o "${T}_rl.json" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"therapist-onboarding-kit","agent_id":"agent-stripe-1"}' \
  "$BASE_URL/api/agent/buy")
eq 429 "$c" "buy: 4th attempt returns 429 rate limit"
pyassert "${T}_rl.json" "d['error'] == 'rate_limited' and d['retry_after_seconds'] == 600" "rate limit payload includes error and retry_after_seconds"

# 4.6 x402 programmatic purchase
c=$(curl -s -o "${T}_x402.json" -D "${T}_x402.h" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"session-notes-prompt-pack","agent_id":"agent-x402-1"}' \
  "$BASE_URL/api/agent/buy")
eq 402 "$c" "buy: session-notes-prompt-pack (x402) returns 402"
pyassert "${T}_x402.json" "d['error'] == 'payment_required' and d['price_cents'] == 4900 and d['currency'] == 'RON' and d['rail'] == 'x402'" "402 body specifies price and rail"
pyassert "${T}_x402.json" "d['settlement']['signature_header'] == 'X-Signature' and d['settlement']['algorithm'] == 'hmac-sha256'" "402 settlement recipe provided"

TOKEN_X402=$(python3 -c "import json; print(json.load(open('${T}_x402.json'))['order_token'])")

# Verify x402 response headers
if grep -qi '^X-402-Payment-Required: true' "${T}_x402.h"; then
  ok "x402 header X-402-Payment-Required present"
else
  bad "x402 header X-402-Payment-Required missing"
fi
if grep -qi '^X-402-Price-Cents: 4900' "${T}_x402.h"; then
  ok "x402 header X-402-Price-Cents present"
else
  bad "x402 header X-402-Price-Cents missing"
fi

# -----------------------------------------------------------------------------
# 5. DELIVERIES ENDPOINT (/api/agent/deliveries/:token)
# -----------------------------------------------------------------------------
echo ""
echo "=== 5. DELIVERIES ENDPOINT ==="

c=$(curl -s -o "${T}_del_unpaid.json" -w '%{http_code}' "$BASE_URL/api/agent/deliveries/$TOKEN_X402")
eq 402 "$c" "deliveries: unpaid order returns 402"

c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/agent/deliveries/ord_nonexistent")
eq 404 "$c" "deliveries: unknown order returns 404"

# -----------------------------------------------------------------------------
# 6. WEBHOOK SETTLEMENT (/api/agent/payments/webhook)
# -----------------------------------------------------------------------------
echo ""
echo "=== 6. WEBHOOK SETTLEMENT & HMAC VERIFICATION ==="

PAYLOAD="{\"order_token\":\"$TOKEN_X402\",\"status\":\"succeeded\",\"provider\":\"x402\",\"reference\":\"tx-test-1\"}"

# Unauthenticated request (no signature) -> 401
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" \
  "$BASE_URL/api/agent/payments/webhook")
eq 401 "$c" "webhook without X-Signature returns 401"

# Invalid signature -> 401
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H 'X-Signature: sha256=0000000000000000000000000000000000000000000000000000000000000000' \
  -d "$PAYLOAD" \
  "$BASE_URL/api/agent/payments/webhook")
eq 401 "$c" "webhook with invalid signature returns 401"

# Valid HMAC signature -> 200 paid
SIG=$(sign "$PAYLOAD")
c=$(curl -s -o "${T}_settle.json" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H "X-Signature: $SIG" \
  -d "$PAYLOAD" \
  "$BASE_URL/api/agent/payments/webhook")
eq 200 "$c" "webhook with valid HMAC returns 200"
pyassert "${T}_settle.json" "d['status'] == 'paid' and d['ledger_ron_cents'] == 4900" "order settled: status is paid, ledger is 4900 cents"

# Replay settlement idempotently -> 200 replayed
c=$(curl -s -o "${T}_settle_replay.json" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H "X-Signature: $SIG" \
  -d "$PAYLOAD" \
  "$BASE_URL/api/agent/payments/webhook")
eq 200 "$c" "webhook replay returns 200"
pyassert "${T}_settle_replay.json" "d.get('replayed') is True and d['status'] == 'paid'" "webhook replay returns replayed: true"

# Fetch paid deliverable as JSON
c=$(curl -s -o "${T}_del_paid.json" -w '%{http_code}' "$BASE_URL/api/agent/deliveries/$TOKEN_X402")
eq 200 "$c" "deliveries: paid order returns 200 JSON"
pyassert "${T}_del_paid.json" "d['status'] == 'paid' and d['deliverable']['unlock_key'] == 'APONIA-PROMPT-2026'" "deliveries payload contains unlock key"

# Fetch paid deliverable as Markdown (content negotiation)
ct=$(curl -s -o "${T}_del_paid.md" -w '%{content_type}' -H 'Accept: text/markdown' "$BASE_URL/api/agent/deliveries/$TOKEN_X402")
if echo "$ct" | grep -q "text/markdown"; then
  ok "deliveries: Accept text/markdown returns text/markdown"
else
  bad "deliveries: Content-Type is $ct, expected text/markdown"
fi

if grep -q "APONIA-PROMPT-2026" "${T}_del_paid.md"; then
  ok "deliveries markdown includes deliverable unlock key"
else
  bad "deliveries markdown missing unlock key"
fi

# -----------------------------------------------------------------------------
# 7. DAILY PROGRAMMATIC CAP ENFORCEMENT
# -----------------------------------------------------------------------------
echo ""
echo "=== 7. DAILY PROGRAMMATIC CAP ENFORCEMENT ==="
# Daily cap configured in harness: 10000 cents RON
# Current settled: 4900 cents
# Order 2: session-notes-prompt-pack (4900 cents) -> 4900 + 4900 = 9800 <= 10000 -> PAID
# Order 3: session-notes-prompt-pack (4900 cents) -> 9800 + 4900 = 14700 > 10000 -> HELD_FOR_REVIEW

c=$(curl -s -o "${T}_order2.json" -X POST -H 'Content-Type: application/json' -d '{"product_id":"session-notes-prompt-pack","agent_id":"agent-cap-2"}' "$BASE_URL/api/agent/buy")
TOKEN_O2=$(python3 -c "import json; print(json.load(open('${T}_order2.json'))['order_token'])")
PAYLOAD_O2="{\"order_token\":\"$TOKEN_O2\",\"status\":\"succeeded\",\"provider\":\"x402\"}"
SIG_O2=$(sign "$PAYLOAD_O2")
c=$(curl -s -o "${T}_settle_o2.json" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Signature: $SIG_O2" -d "$PAYLOAD_O2" "$BASE_URL/api/agent/payments/webhook")
eq 200 "$c" "webhook settle order 2 (under cap)"
pyassert "${T}_settle_o2.json" "d['status'] == 'paid' and d['ledger_ron_cents'] == 9800" "order 2 paid: ledger is 9800 cents"

# Order 3 pushes ledger above cap (10000 cents)
c=$(curl -s -o "${T}_order3.json" -X POST -H 'Content-Type: application/json' -d '{"product_id":"session-notes-prompt-pack","agent_id":"agent-cap-3"}' "$BASE_URL/api/agent/buy")
TOKEN_O3=$(python3 -c "import json; print(json.load(open('${T}_order3.json'))['order_token'])")
PAYLOAD_O3="{\"order_token\":\"$TOKEN_O3\",\"status\":\"succeeded\",\"provider\":\"x402\"}"
SIG_O3=$(sign "$PAYLOAD_O3")
c=$(curl -s -o "${T}_settle_o3.json" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Signature: $SIG_O3" -d "$PAYLOAD_O3" "$BASE_URL/api/agent/payments/webhook")
eq 200 "$c" "webhook settle order 3 (over cap)"
pyassert "${T}_settle_o3.json" "d['status'] == 'held_for_review' and d['reason'] == 'daily_programmatic_cap_exceeded' and d['ledger_ron_cents'] == 9800 and d['attempted_ron_cents'] == 14700" "order 3 held: ledger preserved at 9800"

# Fetching deliverable of held order returns 403
c=$(curl -s -o "${T}_del_held.json" -w '%{http_code}' "$BASE_URL/api/agent/deliveries/$TOKEN_O3")
eq 403 "$c" "deliveries: held order returns 403"
pyassert "${T}_del_held.json" "d['error'] == 'held_for_review' and d['reason'] == 'daily_programmatic_cap_exceeded'" "deliveries 403 explains cap exceeded"

# -----------------------------------------------------------------------------
# 8. ZERO EM-DASHES VERIFICATION
# -----------------------------------------------------------------------------
echo ""
echo "=== 8. ZERO EM-DASHES AUDIT ==="

EM_DASH_FAIL=0
FILES_TO_CHECK=(
  "$ROOT/lib/commerce.js"
  "$ROOT/api/catalog.json"
  "$ROOT/functions/api/catalog.json.js"
  "$ROOT/functions/api/agent/buy.js"
  "$ROOT/functions/api/agent/payments/webhook.js"
  "$ROOT/functions/api/agent/deliveries/[token].js"
  "$ROOT/functions/_middleware.js"
  "$ROOT/.well-known/agent.json"
  "$ROOT/.well-known/agent-skills-discovery"
  "$ROOT/samples/therapist-onboarding-kit-sample.md"
  "$ROOT/samples/practice-protocol-templates-sample.md"
  "$ROOT/samples/session-notes-prompt-pack-sample.md"
)

for file in "${FILES_TO_CHECK[@]}"; do
  if [ -f "$file" ]; then
    # Look for Unicode em-dash U+2014 and en-dash U+2013
    if python3 -c "
import sys
content = open(sys.argv[1], 'r', encoding='utf-8', errors='ignore').read()
if '\u2014' in content or '\u2013' in content:
    sys.exit(1)
" "$file"; then
      ok "zero em-dashes in $(basename "$file")"
    else
      bad "em-dash found in $(basename "$file")"
      EM_DASH_FAIL=$((EM_DASH_FAIL+1))
    fi
  fi
done

# -----------------------------------------------------------------------------
# SUMMARY
# -----------------------------------------------------------------------------
echo ""
echo "========================================================"
echo "VERIFICATION SUMMARY: $PASS PASSED, $FAILS FAILED"
echo "========================================================"

if [ "$FAILS" -gt 0 ]; then
  exit 1
fi
exit 0
