// Khaao k6 load test — simulates the lunch-rush load pattern the app must
// survive: a burst of students placing orders, a large number of concurrent
// long-lived SSE connections (student /api/stream + shop /api/shop/stream),
// and a shopkeeper concurrently triaging/cooking/handing-over/collecting
// payment on whatever orders show up. See scripts/loadtest.md for the full
// write-up: how to scale this to the real ~2000-student target, what VU/ramp
// pattern approximates the actual rush, and how to correlate results with
// server-side contention (pprof/GODEBUG pointers).
//
// HONESTY NOTE ON SSE: k6's stock `http` module has no real EventSource
// client. This script approximates "N concurrent SSE connections under load"
// with a plain `http.get()` bounded by a per-request `timeout`, i.e. it opens
// the stream, holds it open, and force-closes it after LOADTEST_SSE_HOLD_SECONDS.
// That proves the server accepts and keeps open that many concurrent
// streaming connections (the fd/hub-registration cost that actually matters
// at 2000-student scale) — it does NOT parse or assert on individual
// `data: {...}` SSE frames, so it cannot tell you "the ready event arrived
// within Xms of the DB commit". If you need that, layer a real SSE client
// (xk6-sse) on top; this script deliberately keeps to k6's built-in http
// module for zero extra install steps.
//
// Requires: AUTH_FAKE=true on the target backend (fake:<email>[:<name>]
// tokens), a seeded shopkeeper email matching LOADTEST_SHOPKEEPER_EMAIL, and at
// least one seeded, orderable menu item (SEED_SAMPLE_MENU=true is enough).
//
// Quick smoke run (defaults are already smoke-scale):
//   k6 run scripts/loadtest.js
//
// Scaled run (see loadtest.md before pointing this at anything real):
//   BASE_URL=https://staging.khaao.example \
//   LOADTEST_STUDENT_VUS=300 LOADTEST_SSE_VUS=1800 LOADTEST_SHOPKEEPER_VUS=2 \
//   LOADTEST_DURATION=20m LOADTEST_RAMP_DURATION=3m \
//   k6 run scripts/loadtest.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

// ---------------------------------------------------------------------------
// Config (all overridable via env, no script edits needed to rescale)
// ---------------------------------------------------------------------------

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');

const STUDENT_VUS = intEnv('LOADTEST_STUDENT_VUS', 15); // order-placing burst
const SSE_VUS = intEnv('LOADTEST_SSE_VUS', 15); // concurrent long-held student SSE
const SHOPKEEPER_VUS = intEnv('LOADTEST_SHOPKEEPER_VUS', 1); // action workers (accept/prep/handover/paid)
const SHOPKEEPER_SSE_VUS = intEnv('LOADTEST_SHOPKEEPER_SSE_VUS', 1); // shop's own held SSE connections

const DURATION = __ENV.LOADTEST_DURATION || '30s'; // steady-state burst duration
const RAMP_DURATION = __ENV.LOADTEST_RAMP_DURATION || '5s'; // ramp up/down either side of the burst

const SSE_HOLD_SECONDS = intEnv('LOADTEST_SSE_HOLD_SECONDS', 10); // per-iteration held-open duration
const THINK_TIME = floatEnv('LOADTEST_THINK_TIME', 1); // seconds between a student's actions
const SHOP_TICK_INTERVAL = floatEnv('LOADTEST_SHOP_TICK_INTERVAL', 1); // seconds between shopkeeper sweeps
const MAX_ACTIONS_PER_TICK = intEnv('LOADTEST_MAX_ACTIONS_PER_TICK', 25); // cap per shopkeeper sweep
// Small gap between individual shop mutation calls within a sweep. The
// server's per-user rate limiter (middleware/ratelimit.go) gives a
// shopkeeper a 40-token burst refilling at 4/s — firing an entire backlog's
// worth of accept/prep-done/handover/paid calls back-to-back with zero
// pacing (as a real UI never would) blew through that burst instantly and
// turned "shop action errors" into a guaranteed-fail 429 storm rather than a
// meaningful signal. A single sweep spans four separate mutation categories
// (accept/prep-done/handover/paid), so even the 40-token burst alone isn't
// enough headroom once a category-by-category backlog piles up — 0.25s
// matches the limiter's actual 4/s sustained refill, the fastest a
// shopkeeper can clear a backlog indefinitely without 429s, which is still
// far faster than any human tapping through the same queue.
const SHOP_MUTATION_PACE = floatEnv('LOADTEST_SHOP_MUTATION_PACE', 0.25);

const STUDENT_DOMAIN = __ENV.LOADTEST_STUDENT_DOMAIN || 'sst.scaler.com';
const SHOPKEEPER_EMAIL = __ENV.LOADTEST_SHOPKEEPER_EMAIL || 'loadtest-shopkeeper@example.com';
const RUN_ID = __ENV.LOADTEST_RUN_ID || `${Date.now()}`;

const TOTAL_SECONDS = 2 * toSeconds(RAMP_DURATION) + toSeconds(DURATION);
const HOLD_SCENARIO_GRACE = `${SSE_HOLD_SECONDS + 20}s`;

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const orderCreateErrors = new Rate('khaao_order_create_errors'); // true unexpected failures only (not 409 conflicts)
const orderConflicts = new Counter('khaao_order_conflicts'); // expected 409s (student already has an active order)
const ordersCreated = new Counter('khaao_orders_created');
const sseHoldSuccess = new Rate('khaao_sse_hold_success'); // did the stream stay open for the intended hold duration
const shopActionErrors = new Rate('khaao_shop_action_errors');
const shopActionsPerformed = new Counter('khaao_shop_actions_performed');
const authFailures = new Counter('khaao_auth_failures');

// ---------------------------------------------------------------------------
// k6 scenarios
// ---------------------------------------------------------------------------

export const options = {
  scenarios: {
    // Burst of distinct students each authenticating, browsing the menu, and
    // placing exactly one order — this is the write-path the p95/error-rate
    // thresholds below are scoped to.
    student_order_rush: {
      executor: 'ramping-vus',
      exec: 'studentOrderFlow',
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: STUDENT_VUS },
        { duration: DURATION, target: STUDENT_VUS },
        { duration: RAMP_DURATION, target: 0 },
      ],
      gracefulRampDown: '5s',
    },

    // Background concurrent SSE load: each VU is one authenticated student
    // who just holds /api/stream open, back-to-back, for the whole test —
    // approximates the ~1-2k long-lived connections the hub must sustain.
    student_sse_hold: {
      executor: 'constant-vus',
      exec: 'studentSSEHold',
      vus: SSE_VUS,
      duration: `${TOTAL_SECONDS}s`,
      gracefulStop: HOLD_SCENARIO_GRACE,
    },

    // The shopkeeper: polls incoming/prep/in-progress/awaiting-payment state
    // and drives every order through accept -> prep-done -> handover -> paid.
    shopkeeper_actions: {
      executor: 'constant-vus',
      exec: 'shopkeeperFlow',
      vus: SHOPKEEPER_VUS,
      duration: `${TOTAL_SECONDS}s`,
    },

    // The shopkeeper's own held SSE connection(s) (counter/tablet screens).
    shopkeeper_sse_hold: {
      executor: 'constant-vus',
      exec: 'shopkeeperSSEHold',
      vus: SHOPKEEPER_SSE_VUS,
      duration: `${TOTAL_SECONDS}s`,
      gracefulStop: HOLD_SCENARIO_GRACE,
    },
  },

  thresholds: {
    // Pass/fail signal for the actual write path under burst load. Scoped to
    // the student_order_rush scenario only — the *_sse_hold scenarios
    // intentionally hold requests open for seconds, which would otherwise
    // blow out an unscoped http_req_duration/http_req_failed threshold.
    'http_req_duration{scenario:student_order_rush}': ['p(95)<500'],
    'http_req_failed{scenario:student_order_rush}': ['rate<0.01'],

    // Shopkeeper action latency/error budget (slightly looser: each tick can
    // fan out into several sequential mutating calls).
    'http_req_duration{scenario:shopkeeper_actions}': ['p(95)<800'],

    // Custom, scenario-agnostic signals.
    khaao_order_create_errors: ['rate<0.01'],
    khaao_shop_action_errors: ['rate<0.05'],
    khaao_sse_hold_success: ['rate>0.95'],
  },

  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

export function setup() {
  const res = http.get(`${BASE_URL}/api/health`);
  if (res.status !== 200) {
    throw new Error(
      `khaao backend not reachable/healthy at ${BASE_URL}/api/health (status ${res.status}). ` +
        'Start the scratch backend before running this script.'
    );
  }
  console.log(`\n[loadtest] target: ${BASE_URL}`);
  console.log(
    `[loadtest] student_order_rush: ${STUDENT_VUS} VUs, ramp ${RAMP_DURATION} / hold ${DURATION} / ramp ${RAMP_DURATION}`
  );
  console.log(`[loadtest] student_sse_hold: ${SSE_VUS} concurrent held connections (${SSE_HOLD_SECONDS}s each, looping)`);
  console.log(`[loadtest] shopkeeper_actions: ${SHOPKEEPER_VUS} worker(s) as ${SHOPKEEPER_EMAIL}`);
  console.log(`[loadtest] shopkeeper_sse_hold: ${SHOPKEEPER_SSE_VUS} held connection(s)`);
}

export function teardown() {
  console.log('\n[loadtest] ==================== WHAT TO LOOK AT ====================');
  console.log('[loadtest] http_req_duration{scenario:student_order_rush} p(95)  -> target: <500ms');
  console.log('[loadtest] http_req_failed{scenario:student_order_rush} rate     -> target: <1%');
  console.log('[loadtest] khaao_order_create_errors rate  -> real order-create failures (5xx/timeouts), excludes expected 409s');
  console.log('[loadtest] khaao_order_conflicts (count)   -> expected 409s (student already has an active order) — informational only');
  console.log('[loadtest] khaao_sse_hold_success rate     -> target: >95% of held SSE connections stayed open the full hold window');
  console.log('[loadtest] khaao_shop_action_errors rate   -> target: <5% of shopkeeper accept/prep/handover/paid calls failed');
  console.log('[loadtest] If thresholds FAILED: check server logs for tx conflicts, and re-run with fewer VUs to bisect.');
  console.log('[loadtest] This run did NOT validate the real ~2000-student target — see scripts/loadtest.md before trusting it at scale.');
  console.log('[loadtest] ===========================================================\n');
}

// ---------------------------------------------------------------------------
// Student: order-placing burst
// ---------------------------------------------------------------------------

export function studentOrderFlow() {
  const iter = exec.vu.iterationInScenario;
  const email = `loadtest-student-${RUN_ID}-${exec.vu.idInTest}-${iter}@${STUDENT_DOMAIN}`;
  const token = authenticate(email, 'LoadStudent');
  if (!token) {
    sleep(THINK_TIME);
    return;
  }
  const headers = authHeaders(token);

  const menuRes = http.get(`${BASE_URL}/api/menu`, { tags: { name: 'menu_list' } });
  const menuOk = check(menuRes, { 'menu list 200': (r) => r.status === 200 });
  if (!menuOk) {
    orderCreateErrors.add(1);
    sleep(THINK_TIME);
    return;
  }

  let items = [];
  try {
    items = JSON.parse(menuRes.body).items || [];
  } catch (e) {
    items = [];
  }
  const orderable = items.filter((i) => i.orderable);
  if (orderable.length === 0) {
    sleep(THINK_TIME);
    return;
  }

  const chosen = pickRandomItems(orderable, randInt(1, 2));
  const payload = JSON.stringify({
    items: chosen.map((i) => ({ menu_item_id: i.id, qty: randInt(1, 2) })),
  });
  const orderRes = http.post(`${BASE_URL}/api/orders`, payload, {
    headers: jsonHeaders(headers),
    tags: { name: 'order_create' },
  });

  if (orderRes.status === 201) {
    orderCreateErrors.add(0);
    ordersCreated.add(1);
  } else if (orderRes.status === 409) {
    // Expected: one-active-order-per-student guard, or the canteen is
    // paused/closed. Not a script-level or server-level error.
    orderConflicts.add(1);
  } else {
    orderCreateErrors.add(1);
  }
  check(orderRes, {
    'order create expected status (201 or 409)': (r) => r.status === 201 || r.status === 409,
  });

  sleep(THINK_TIME);
}

// ---------------------------------------------------------------------------
// Student: background concurrent SSE hold
// ---------------------------------------------------------------------------

let sseAuthToken = null; // per-VU cache (each VU runs its own JS instance)

function getOrAuthStudentForSSE() {
  if (sseAuthToken) return sseAuthToken;
  const email = `loadtest-sse-${RUN_ID}-${exec.vu.idInTest}@${STUDENT_DOMAIN}`;
  sseAuthToken = authenticate(email, 'LoadSSE');
  return sseAuthToken;
}

export function studentSSEHold() {
  const token = getOrAuthStudentForSSE();
  if (!token) {
    sleep(1);
    return;
  }
  const ticket = mintSSETicket(token);
  if (!ticket) {
    sleep(1);
    return;
  }
  const res = http.get(`${BASE_URL}/api/stream?ticket=${encodeURIComponent(ticket)}`, {
    timeout: `${SSE_HOLD_SECONDS}s`,
    tags: { name: 'sse_student_hold' },
  });
  recordSSEHold(res);
}

// ---------------------------------------------------------------------------
// Shopkeeper: accept / prep / handover / paid
// ---------------------------------------------------------------------------

let shopAuthToken = null;

function getOrAuthShop() {
  if (shopAuthToken) return shopAuthToken;
  shopAuthToken = authenticate(SHOPKEEPER_EMAIL, 'LoadShopkeeper');
  return shopAuthToken;
}

export function shopkeeperFlow() {
  const token = getOrAuthShop();
  if (!token) {
    sleep(1);
    return;
  }
  const headers = jsonHeaders(authHeaders(token));

  const ordersRes = http.get(`${BASE_URL}/api/shop/orders`, { headers, tags: { name: 'shop_orders_list' } });
  recordShopAction(ordersRes);
  if (ordersRes.status !== 200) {
    sleep(SHOP_TICK_INTERVAL);
    return;
  }

  let body = {};
  try {
    body = JSON.parse(ordersRes.body);
  } catch (e) {
    body = {};
  }

  // 1. Triage: accept every incoming order in full (no rejects).
  const incoming = (body.incoming || []).slice(0, MAX_ACTIONS_PER_TICK);
  for (const order of incoming) {
    const res = http.post(
      `${BASE_URL}/api/shop/orders/${order.id}/accept`,
      JSON.stringify({ rejected_item_ids: [] }),
      { headers, tags: { name: 'shop_accept' } }
    );
    recordShopAction(res);
    sleep(SHOP_MUTATION_PACE);
  }

  // 2. Cook: mark whatever's queued as done so it can be allocated.
  const prepRes = http.get(`${BASE_URL}/api/shop/prep`, { headers, tags: { name: 'shop_prep_list' } });
  recordShopAction(prepRes);
  if (prepRes.status === 200) {
    let prepBody = {};
    try {
      prepBody = JSON.parse(prepRes.body);
    } catch (e) {
      prepBody = {};
    }
    for (const pi of prepBody.items || []) {
      if (pi.remaining_qty > 0) {
        const res = http.post(
          `${BASE_URL}/api/shop/prep/${pi.menu_item_id}/done`,
          JSON.stringify({ qty: pi.remaining_qty }),
          { headers, tags: { name: 'shop_prep_done' } }
        );
        recordShopAction(res);
        sleep(SHOP_MUTATION_PACE);
      }
    }
  }

  // 3. Hand over anything allocated-but-not-yet-handed.
  const inProgress = (body.in_progress || []).slice(0, MAX_ACTIONS_PER_TICK);
  for (const order of inProgress) {
    for (const item of order.items || []) {
      const remaining = (item.allocated_qty || 0) - (item.handed_qty || 0);
      if (remaining > 0) {
        const res = http.post(
          `${BASE_URL}/api/shop/orders/${order.id}/items/${item.id}/handover`,
          JSON.stringify({ qty: remaining }),
          { headers, tags: { name: 'shop_handover' } }
        );
        recordShopAction(res);
        sleep(SHOP_MUTATION_PACE);
      }
    }
  }

  // 4. Collect payment on anything fully handed over.
  const awaiting = (body.awaiting_payment || []).slice(0, MAX_ACTIONS_PER_TICK);
  for (const order of awaiting) {
    const res = http.post(`${BASE_URL}/api/shop/orders/${order.id}/paid`, null, {
      headers,
      tags: { name: 'shop_paid' },
    });
    recordShopAction(res);
    sleep(SHOP_MUTATION_PACE);
  }

  sleep(SHOP_TICK_INTERVAL);
}

export function shopkeeperSSEHold() {
  const token = getOrAuthShop();
  if (!token) {
    sleep(1);
    return;
  }
  const ticket = mintSSETicket(token);
  if (!ticket) {
    sleep(1);
    return;
  }
  const res = http.get(`${BASE_URL}/api/shop/stream?ticket=${encodeURIComponent(ticket)}`, {
    timeout: `${SSE_HOLD_SECONDS}s`,
    tags: { name: 'sse_shop_hold' },
  });
  recordSSEHold(res);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function authenticate(email, name) {
  const res = http.post(
    `${BASE_URL}/api/auth/firebase`,
    JSON.stringify({ id_token: `fake:${email}:${name}` }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'auth_firebase' } }
  );
  const ok = check(res, { 'auth 200': (r) => r.status === 200 });
  if (!ok) {
    authFailures.add(1);
    return null;
  }
  try {
    return JSON.parse(res.body).token || null;
  } catch (e) {
    authFailures.add(1);
    return null;
  }
}

// SSE endpoints authenticate via a short-lived, single-use ticket
// (POST /api/auth/sse-ticket), never the raw JWT in the query string — see
// services/sse_ticket.go. A fresh ticket must be minted for every connection
// attempt; a stale one is rejected (one-use, ~60s TTL).
function mintSSETicket(token) {
  const res = http.post(`${BASE_URL}/api/auth/sse-ticket`, null, {
    headers: authHeaders(token),
    tags: { name: 'sse_ticket_mint' },
  });
  if (res.status !== 200) return null;
  try {
    return JSON.parse(res.body).ticket || null;
  } catch (e) {
    return null;
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(base) {
  return Object.assign({ 'Content-Type': 'application/json' }, base);
}

// A held SSE request always gets force-closed by our own client-side
// `timeout` rather than completing "naturally" (the server never closes the
// stream on its own). So the meaningful signal isn't res.status (which will
// be 0 on the client-side timeout abort) — it's whether the connection
// stayed open for close to the full intended hold duration. A connection
// that dies much earlier (reset, 401, proxy/server drop) shows up as a much
// shorter duration and is counted as a failure.
function recordSSEHold(res) {
  const heldFullDuration = res.timings.duration >= SSE_HOLD_SECONDS * 1000 * 0.85;
  const success = res.status === 200 || heldFullDuration;
  sseHoldSuccess.add(success ? 1 : 0);
  check(res, { 'sse connection stayed open for the hold window': () => success });
}

function recordShopAction(res) {
  const ok = res.status >= 200 && res.status < 300;
  shopActionErrors.add(ok ? 0 : 1);
  shopActionsPerformed.add(1);
  check(res, { 'shop action 2xx': () => ok });
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandomItems(list, n) {
  const copy = list.slice();
  const out = [];
  while (copy.length > 0 && out.length < n) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function intEnv(key, def) {
  const v = __ENV[key];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

function floatEnv(key, def) {
  const v = __ENV[key];
  if (v === undefined || v === '') return def;
  const n = parseFloat(v);
  return Number.isNaN(n) ? def : n;
}

// Parses simple k6-style durations ("30s", "5m", "1h", "500ms") to seconds.
// Falls back to treating the input as a plain number of seconds.
function toSeconds(d) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(d).trim());
  if (!m) return parseFloat(d) || 0;
  const val = parseFloat(m[1]);
  switch (m[2]) {
    case 'ms':
      return val / 1000;
    case 's':
      return val;
    case 'm':
      return val * 60;
    case 'h':
      return val * 3600;
    default:
      return val;
  }
}

// No scenario references the default export (every scenario sets its own
// `exec`) — present only because some k6 versions expect a default export.
export default function () {
  sleep(1);
}
