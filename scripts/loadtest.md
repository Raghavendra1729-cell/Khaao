# Khaao load test (k6) — `scripts/loadtest.js`

k6 script simulating the lunch-rush pattern Khaao must survive: a burst of
students placing orders, a large number of concurrent long-lived SSE
connections (student `/api/stream` + shop `/api/shop/stream`), and a
shopkeeper concurrently accepting/prepping/handing-over/collecting payment on
whatever shows up. See the header comment in `loadtest.js` for the mechanics;
this doc covers **how to run it**, **how to scale it to the real ~2000
student target**, and **what to watch for**.

## What was actually validated in this repo (and what wasn't)

This script was built and run once, at smoke scale, against a scratch backend
on a disposable local Postgres DB (`khaao_loadtest`) — **not** at the real
2000-student target, and **not** against staging/production. Do not treat a
clean smoke run as proof the app survives the real lunch rush; it only proves
the script itself works end-to-end (auth, order-create, SSE hold, shopkeeper
processing) with no script-level bugs. Scaling up (see below) still needs to
happen against a real staging environment before anyone trusts this for a
2000-student launch.

## Prerequisites

- `k6` installed (`brew install k6`).
- A target backend reachable at `BASE_URL`, booted with `AUTH_FAKE=true` (this
  script authenticates with `fake:<email>[:<name>]` tokens — never point it
  at a real production backend, `AUTH_FAKE` is refused there anyway).
- The shopkeeper email you pass as `LOADTEST_SHOPKEEPER_EMAIL` must be in that
  backend's `SHOPKEEPER_EMAILS` allowlist.
- At least one seeded, orderable menu item (`SEED_SAMPLE_MENU=true` is enough).
- A DB the backend points at that you're OK filling with load-test orders —
  use a disposable scratch DB, never a shared one.

## Running it

```bash
# 1. Build + boot a scratch backend on a disposable DB
createdb khaao_loadtest
cd backend && go build -o /tmp/khaao-loadtest ./cmd/server
PORT=18093 APP_ENV=test \
DATABASE_URL="postgres://$(whoami)@localhost:5432/khaao_loadtest?sslmode=disable" \
JWT_SECRET="dev-secret-change-me-but-long-enough-1234567890" \
AUTH_FAKE=true \
FRONTEND_ORIGIN="http://localhost:18172" \
SHOPKEEPER_EMAILS="loadtest-shopkeeper@example.com" \
ALLOWED_EMAIL_DOMAIN="sst.scaler.com" \
SEED_SAMPLE_MENU=true \
/tmp/khaao-loadtest &

# 2. Smoke-scale run (defaults are already smoke-scale — this is the
#    equivalent of just `k6 run scripts/loadtest.js` with BASE_URL set)
BASE_URL=http://localhost:18093 k6 run scripts/loadtest.js

# 3. Tear down
kill %1
dropdb khaao_loadtest
```

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:8080` | Target backend |
| `LOADTEST_STUDENT_VUS` | `15` | Concurrent VUs placing orders during the burst |
| `LOADTEST_SSE_VUS` | `15` | Concurrent VUs holding a long-lived student `/api/stream` connection |
| `LOADTEST_SHOPKEEPER_VUS` | `1` | Concurrent shopkeeper "worker" VUs driving accept/prep/handover/paid |
| `LOADTEST_SHOPKEEPER_SSE_VUS` | `1` | Concurrent shopkeeper `/api/shop/stream` holders |
| `LOADTEST_DURATION` | `30s` | Steady-state burst duration (after ramp-up, before ramp-down) |
| `LOADTEST_RAMP_DURATION` | `5s` | Ramp up/down either side of the burst |
| `LOADTEST_SSE_HOLD_SECONDS` | `10` | How long each SSE hold iteration keeps its connection open before cycling |
| `LOADTEST_THINK_TIME` | `1` | Seconds a student "thinks" between actions |
| `LOADTEST_SHOP_TICK_INTERVAL` | `1` | Seconds between shopkeeper sweeps |
| `LOADTEST_MAX_ACTIONS_PER_TICK` | `25` | Cap on orders processed per shopkeeper sweep (script-side throttle, not a server limit) |
| `LOADTEST_STUDENT_DOMAIN` | `sst.scaler.com` | Must match the backend's `ALLOWED_EMAIL_DOMAIN` |
| `LOADTEST_SHOPKEEPER_EMAIL` | `loadtest-shopkeeper@example.com` | Must be in the backend's `SHOPKEEPER_EMAILS` |
| `LOADTEST_RUN_ID` | current timestamp | Uniqueness seed for fake student emails (avoids collisions across repeated runs against the same DB) |

**Why `LOADTEST_*` and not `K6_*` as originally suggested:** k6 has a
built-in mechanism that maps env vars directly onto top-level run options —
e.g. `K6_VUS`, `K6_DURATION`, `K6_ITERATIONS` set `Options.VUs` /
`Options.Duration` / `Options.Iterations` directly. This repo's script
originally used `K6_STUDENT_VUS` / `K6_DURATION` per the initial brief, but
`K6_DURATION` collided with k6's own reserved `Options.Duration` — when set,
k6 prints `"env" level configuration overrode scenarios configuration
entirely` and silently **discards the whole custom `scenarios` block**,
falling back to a single anonymous 1-VU loop. This was caught during the
verification run in this session (first run showed exactly that warning and
ran only 1 iteration/sec with none of the four intended scenarios). All
custom env vars were renamed off the `K6_` prefix to `LOADTEST_` to avoid this
— and any future — collision with k6's reserved option names. Do not rename
them back to `K6_*` without checking each name against k6's `Options` struct
fields first.

## Scaling to the real ~2000-student target

STATUS.md's topology decision targets: **~500–1000 orders in a 30–60 min
lunch rush, ~1–2k concurrent SSE connections, one Go instance (2–4 vCPU)**.
A reasonable k6 invocation approximating that:

```bash
BASE_URL=https://staging.khaao.example \
LOADTEST_STUDENT_VUS=500 \
LOADTEST_SSE_VUS=1500 \
LOADTEST_SHOPKEEPER_VUS=2 \
LOADTEST_SHOPKEEPER_SSE_VUS=2 \
LOADTEST_DURATION=40m \
LOADTEST_RAMP_DURATION=5m \
LOADTEST_SSE_HOLD_SECONDS=60 \
LOADTEST_SHOPKEEPER_EMAIL=<real-staging-shopkeeper-allowlisted-email> \
LOADTEST_STUDENT_DOMAIN=<real-staging-allowed-domain> \
k6 run scripts/loadtest.js
```

Rationale for these numbers:
- **`LOADTEST_STUDENT_VUS=500`**: each `student_order_rush` iteration is one
  distinct simulated student placing exactly one order — 500 concurrent VUs
  ramping over 5 minutes and sustained for the 40-minute rush window will
  generate on the order of 500–1000+ total order-creates depending on think
  time, matching the target order volume. Turn `LOADTEST_THINK_TIME` down
  (e.g. to `0.3`) if you need to push harder toward the upper end.
- **`LOADTEST_SSE_VUS=1500`**: directly maps to concurrent held student SSE
  connections — this is the number that stresses `realtime.Hub` fan-out and
  the server's open-fd count (`ulimit -n`), independent of order volume.
- **`LOADTEST_SSE_HOLD_SECONDS=60`**: longer than smoke-scale so each held
  connection actually spans multiple 25s server heartbeat ticks — at 10s
  (the smoke default) most holds never see a single heartbeat, which is fine
  for validating the script but doesn't exercise the heartbeat path at scale.
- **`LOADTEST_SHOPKEEPER_VUS=2`** / **`_SSE_VUS=2`**: models a phone +
  counter-tablet, both hitting the API concurrently — the real shopkeeper
  workflow, not just one browser tab.
- Ramp over minutes, not seconds, at this scale — a instant 500-VU spike is a
  harsher and less realistic test than a real lunch rush, which builds over
  several minutes as people finish class and walk over.

Before running the above against a real staging environment:
- **Never run it against production** — `AUTH_FAKE` won't even be enabled
  there (fail-closed by design, see `config.Validate`), so it can't
  accidentally hit prod with fake orders, but confirm the `BASE_URL` anyway.
- Point `DATABASE_URL` for that staging backend at a DB you're fine filling
  with ~1000+ synthetic orders (or plan to truncate `orders`/`order_items`/
  `item_pool`/`order_events` after).
- Raise `ulimit -n` on the machine running k6 itself — 1500+ concurrent held
  HTTP connections from a single k6 process needs enough client-side file
  descriptors too (`ulimit -n 4096` or higher before `k6 run`).
- k6 itself becomes non-trivial resource pressure at 2000 VUs (goroutines +
  memory in the k6 process) — consider running it from a beefier machine than
  a laptop, or use k6's distributed/cloud execution if you have access to it.

## Correlating results with server-side contention

k6 can tell you client-observed latency and error rate, but it cannot see
`PoolEngine.mu` queue depth, Postgres connection pool saturation, or Go
runtime internals directly. If a scaled run shows p95 degrading or errors
climbing, correlate with the server side rather than guessing from k6 output
alone:

- **pprof**: wire up `net/http/pprof` on a *separate, non-public* port in
  `cmd/server/main.go` for the duration of the load test only (don't ship
  this to production without also locking it down — pprof exposes memory
  contents). While a scaled k6 run is in flight, capture:
  ```bash
  go tool pprof http://localhost:6060/debug/pprof/goroutine   # goroutine counts/stacks — look for pile-ups waiting on PoolEngine.mu
  go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30  # CPU profile during the burst
  ```
- **`GODEBUG=inittrace=1,gctrace=1`** (env var on the server process, not
  k6): `gctrace=1` prints a line per GC cycle to stderr — watch for GC pause
  times climbing under load, which shows up as latency jitter more than
  steady p95 growth.
- **Postgres**: `SELECT count(*) FROM pg_stat_activity WHERE datname =
  'khaao_...';` during the run to watch connection pool saturation against
  whatever `SetMaxOpenConns` is configured in `database/database.go`.
- **fd usage**: `lsof -p <server-pid> | wc -l` during the SSE-heavy portion
  of the run, compared against `ulimit -n` on the server host.

None of this is wired into the k6 script itself — it's a manual pointer for
whoever runs the scaled test, not an automated correlation. Building real
APM/tracing integration is out of scope for this load-test script (see
STATUS.md § P2-a for the broader structured-logging/metrics work item).
