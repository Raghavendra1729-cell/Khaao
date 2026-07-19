# Khaao — Project Status

> **For the next agent:** read this top-to-bottom before touching code. It's the
> single source of truth for current state, architecture, and what's left. Full
> history of *how* we got here lives in `git log` (every change is committed with
> a descriptive message) — this file only tracks the *current* picture, not a
> session-by-session diary.

## Current state (2026-07-20)

**2026-07-20 (later): a NEW frontend backlog — the G-series (§ 9.3) — is
authorized and open.** The project owner explicitly requested a next round
of frontend work, which supersedes the earlier "no new backlog until D-6"
rule for frontend items only. The G-series was authored after a grounded
re-read of the post-F-series code (Menu, OrderStatus, History, MenuItemCard,
Login, index.html, tailwind.config.js) — every item is anchored to real
files and real gaps, not speculation. It is **depth-of-use work** (search,
re-order, insight legibility, a11y parity), not another polish pass — the
F-series already fixed everything a fix-pass would find. § 9.4 records
backend-needed / decision-needed items for LATER (recorded, not
authorized). § 9.5 is the ready-to-paste brief for the agent that picks
this up. Deployment (D-1..D-7) remains the human-led milestone in
parallel.

**2026-07-20: the § 9.2 F-series design-polish backlog (F1–F24) is fully
implemented, reviewed, and committed.** Executed as five parallel agents in
isolated git worktrees, one per disjoint file-ownership group (student Menu
surface; Order Status/ready-moment; shop Orders/Prep/OrderModal/Layout; shop
History/MenuManage; shared components + Login + PWA meta) — each briefed
with the exact F-items and files in scope, each self-verified against the
tsc/lint/test/build gate, each reviewed diff-by-diff before merging (not
just trusted on their self-report). All five merged clean, no conflicts.
Two real issues surfaced in review and were fixed directly rather than sent
back: `ConfirmDialog`'s Hindi-paired defaults were correctly gated on
`user.role === 'shopkeeper'` (not just `language`) by the implementing
agent itself, catching a real leak-into-student-session bug on a shared
device before it shipped; a narrower timing gap in `InstallPrompt`'s
iOS-hint announcement (computed inside a mount effect, one render-tick too
late for `PushNotificationSetup`'s F9 coordination check to see it on a
fresh iOS visit) was caught in review and fixed by making the check
synchronous. A final integration pass then closed out the remaining items
that don't belong to any one file-group: F22 (Modal focus trap — every
overlay in the app routes through this one component), F16 (wired quiet
ink-line glyphs into the four highest-traffic empty states), F24 (the one
still-dead keyframe, `animate-status-in`, now drives history-card entrances
— zero dead animation tokens left), plus one Hindi-pairing miss (the
MenuManage page header) spotted during review. Gate on the fully merged
tree: `tsc -b --noEmit` clean, `npm run lint` 0 errors (23 pre-existing
warnings, none new), `npm test` 53/53, `npm run build` succeeds at 249.37 KB
raw initial student JS (still under the ~250 KB do-not-regress line from
R24, though it's now snug — see § 9.1.8 before adding more to the eager
bundle). § 9.2 below is left as a historical record of the plan; nothing
further is pending from it. **The only remaining milestone is Deployment
(D-1..D-7)** — see below, human-led.

**2026-07-19: the entire R1–R24 review backlog from 2026-07-18 is
implemented, verified, and fully committed.** R1–R11 landed as one commit
each; the R12–R24 batch landed as 10 logical commits (`08be195`…`b47e7a6`,
including one extra fix found while reviewing the batch: a TOCTOU race in
the R8 menu-response cache). Per-item detail lives in `git log`, per this
file's charter.

**R25 is now done too** — all six data pages (`student/Menu.tsx`,
`student/OrderStatus.tsx`, `shop/Orders.tsx`, `shop/Prep.tsx`,
`shop/History.tsx`, `shop/MenuManage.tsx`) gate their error UI on
`isError && data === undefined`, so a failed *background* refetch no
longer replaces a perfectly good cached screen with "Couldn't load" —
only a genuine no-data failure does. Covered by a new
`student/Menu.test.tsx` (2 tests: cached data survives a failed
refetch; a real no-data failure still shows the error state) —
verified the test actually catches the regression by reverting the
fix locally and watching it fail, before restoring the fix. `npm test`
now 47/47. **R26 is the next task.**

Rechecked 2026-07-19 (second pass, clean tree) before R25: backend
`go build ./... && go vet ./... && go test ./... -race` ✓ ·
`golangci-lint run` 0 issues ✓ · frontend `npx tsc -b --noEmit` ✓ ·
`npm run lint` 0 errors ✓ · `npm build` ✓ (index 247 KB raw, Firebase
155 KB lazy — unchanged by R25).

**2026-07-19 (third pass): a fresh review of the corners the R1–R24
review touched least** — SSE plumbing end-to-end (`useSSE.ts`,
`sse_ticket.go`, the `streamSSE` handler, hub), the service worker
(`sw.ts`), `api/client.ts`, the rate limiter, the FCFS allocator, and
the server lifecycle — found four new small items (R28–R31) plus one
accepted-risk note added to § 11 (an open SSE stream survives
shopkeeper de-provisioning until it reconnects). Files verified clean
in that pass and deliberately left alone: the ticket service
(mint/consume/sweep all correct), the allocator, the rate limiter
(bounded memory, correct per-role buckets), `StudentRealtime`'s
transition logic, and the audio-unlock path.

**2026-07-19 (fourth pass): R26–R31 all done, and the pre-deploy GATE
is clear.** R26 (Prettier `--write` across 27 files + `format:check`
in CI), R27 (dropped `ConfirmDialog`'s dead `busy` prop), R28 (jittered
SSE reconnect backoff, 0.5x-1.5x, capped after jitter), R29
(`Hub.CloseAll()` closes every SSE stream before `srv.Shutdown` so a
graceful restart no longer stalls the full 10s timeout), R30 (push
listener always shows a fallback notification + a `url` in the payload
so `notificationclick` opens `/shop` or `/order` instead of always
`/`), R31 (`apiFetch` now has a 15s `AbortSignal.timeout`) — each with
a regression test verified to actually fail without its fix first.
`npm test` now 50/50.

Then the GATE itself, live: **`scripts/smoke.sh` 15/15** against local
Postgres; **the full integration suite (5 `TestIntegration_*` cases,
including R14's 15-trial concurrent-Accept-vs-Set-paused proof) green
against real Postgres** (`TEST_DATABASE_URL=… go test -tags=integration
-p 1 ./... -race`); **`scripts/loadtest.js` re-run at smoke scale**
against a scratch backend — which surfaced and fixed two real bugs the
script itself had accumulated: it still connected SSE with the
pre-ticket-auth `?token=<jwt>` scheme (100% of SSE holds were silently
401ing on `missing_ticket` — nobody had run this script since P1-b
shipped), and the shopkeeper sweep fired all its mutations with zero
pacing, blowing through the 40-token rate-limit burst every tick (an
85% 429 rate). Both fixed (ticket minting; a 0.25s pace between
mutations matching the limiter's 4/s sustained refill) and re-verified
clean: every threshold passes, 0% errors. **CI is green on `main`**
— catch a golangci-lint-action version mismatch along the way (`v6`
doesn't support golangci-lint v2.x; bumped to `v7`) that had been
silently failing every push since the R23 commit introduced it.

**After this gate, the only remaining milestone is Deployment
(D-1..D-7)** — `deploy/RUNBOOK.md` is the step-by-step guide, and most
of it needs a human with domain/server/dashboard access, not an agent.
Per the GATE's own rule, further code changes should only come from
real-device findings during D-6.

**2026-07-19 (fifth pass): full frontend design review.** At the
project owner's request, every file under `frontend/src` (all 57,
plus `index.html`, `tailwind.config.js`, `vite.config.ts`) was
re-read as a design-lead pass — visual quality, § 9.1 rule
compliance, a11y, and copy. Findings are recorded as the **F-series
backlog in § 9.2**: F1–F12 are standing-rule violations and small
bugs (safe-area misses, sub-44px touch targets, off-token colors,
patchy Hindi coverage, a render-impurity in `StatusStamps`), F13–F24
are the deliberate beauty pass (login set-piece, the unused "ready"
signature animation, skeleton loading, shopkeeper tablet layout,
order-age display). § 9.2 also carries a per-file verdict table so
future agents know what was checked and found clean. No backend
items. § 9.2 is now the active *code* milestone alongside the
human-led Deployment table.

The entire pre-2026-07-15 backlog from the previous session's handoff is
**done, live-verified, and committed**. Everything in § 8 plus everything
below is feature-complete and works end-to-end.

| Item | Status |
|---|---|
| WP4 — versioned SQL migrations | **Done, verified, committed.** `golang-migrate` + embedded SQL, replacing `AutoMigrate`. |
| P1-b (SSE ticket auth) | **Done, live-verified, committed.** Booted a scratch backend (`AUTH_FAKE=true`) and drove it end-to-end over curl: ticket mint → SSE stream actually delivers a real event using the ticket → ticket is one-use (reuse → 401) → expired/garbage tickets → 401. All 9 checks green. |
| P1-c (rate limiting) | **Done, live-verified, committed.** Same scratch run: hammering a mutation endpoint trips 429 once the per-user burst (20) is exceeded; a second user is completely unaffected — confirms the limiter is keyed per-user, not global/per-IP. |
| P1-d (reject-with-stock-out) | **Done, committed.** Policy decided: the existing whole-order `RejectDialog` already had this (ticking an item marks it `out_of_stock` before rejecting) — the gap was that the same signal existed but did nothing in two other shopkeeper flows. Extended it to (1) `IncomingOrderCard`'s Accept flow — an unchecked pending item ("uncheck anything you're out of") now also calls `setMenuItemStock`, and (2) `OrderModal`'s post-accept item removal — a second confirm asks whether to also mark the item out of stock. Both mirror the existing `RejectDialog`/`rejectMutation` pattern (best-effort `Promise.allSettled`/`.catch`, invalidates `['shop','menu']` too). Frontend-only; no backend change needed. `tsc`/`build` clean. |
| P1-e (avail-window sanity warning) | **Done, committed.** Added `AvailWindowWarning` (non-blocking, `omitempty`) to `MenuItemResponse`, populated only on `Create`/`Update` when `avail_from >= avail_to`. Overnight windows still work exactly as before (`withinWindow` untouched) — this only adds a hint so a shopkeeper who typo'd a same-day window backwards notices. New `menu_test.go`, 4 subtests green. |
| P2-a (structured logging / slog) | **Done, live-verified, committed.** Replaced every `log.Printf`/`Println` with `log/slog` (JSON handler in production, text in dev/test). Added `middleware.RequestLogger()` (one structured line per request: method/path/status/latency/user_id) wired as the second global middleware. Central `respondError` now logs every 5xx at Error and every 409 at Warn — this alone surfaces "tx conflicts" and "order-state transition failures" for the whole app without instrumenting `pool.go`'s 17 individual `ErrConflict` sites. `middleware/auth.go` logs all 7 auth/role-check failure branches at Warn. Verified live: `scripts/smoke.sh` 15/15 with real structured log output inspected directly (see `/tmp/khaao-smoke.log` pattern — auth failures, 409 conflicts, and normal requests all logged at the right level with the right attrs). |
| P2-c (Postgres integration tests + CI) | **Done, live-verified, committed.** `TEST_DATABASE_URL=postgres://…khaao_test… go test -tags=integration -p 1 ./... -race` passes clean against a real local Postgres (unique/partial-index constraints, FK enforcement, concurrent order-create/allocation races, expiry-tick re-pooling). `.github/workflows/ci.yml` runs this same suite against a `postgres:16` service container. |
| P2-d — k6 load test script | **Done, verified** at smoke scale (15-32 VUs, 0% error rate) in the previous session. Real ~2000-student scale intentionally still not run — see `scripts/loadtest.md` for how to scale it up. |
| P2-e — SSE reconnect refetch | **Done, committed.** `useSSE()`'s `onOpen` callback fires on every successful (re)connect; `StudentRealtime`/`ShopRealtime` invalidate their TanStack Query keys there. Verified via source review (the mechanism is unconditional and correct) plus partial live confirmation in a scratch Playwright session — killing and restarting a scratch backend produced the expected batch of refetches (`orders/active` + `menu` + `shop-status`, exactly `handleOpen`'s invalidation set) after reconnect. A fully clean, deterministic browser demo was hampered by Vite-dev-proxy/EventSource timing quirks in the throwaway test harness, not by anything in the app code — re-attempt with a more controlled harness (e.g. a proxy you can pause/resume, not `kill -9` on the upstream) if you want a crisper demo. |
| Deployment artifacts (Caddyfile/systemd/runbook) | **Done, committed.** Caddyfile tool-validated via `caddy validate` in the previous session; systemd unit and runbook reviewed this session, both internally consistent with the actual code (10s graceful shutdown, fail-closed config, `LimitNOFILE`). |
| Hindi/English language toggle | **Done, committed, live-verified.** New `context/LanguageContext.tsx` + header toggle pill; every shopkeeper-facing bilingual spot (~19 across 8 files) converted from "always show both" to one language at a time. Verified live via Playwright: toggling works, and a student session never shows Hindi even with the preference stored as `'hi'` in `localStorage`. See § 8. |
| Security hardening (CSP, Gin release mode, trusted proxies) | **Done, committed.** See § 11 for the full detail — CSP added (Gin + Caddyfile), Gin `ReleaseMode` gated on `APP_ENV=production`, `SetTrustedProxies(nil)` set explicitly. |
| D-3 — Cloudinary account | **Done, resolved live.** The original account (cloud `dvxohpbde`) was confirmed via a direct signed-upload test (curl straight to Cloudinary's API, bypassing the app entirely) to be on the **Media Optimizer** product — got back the exact documented `403 "missing permissions (actions=[\"create\"])"`. Diagnosed as not a credential or code issue (the `.env` values were already correct; the signature computation succeeded — Cloudinary got far enough to check permissions and reject specifically on the upload action). User provisioned a new account (cloud `r2avfle3`); same direct-curl test against it returned `200` with a real `secure_url`, confirming Programmable Media. `backend/.env` updated, backend restarted, test asset cleaned up via Cloudinary's destroy API. |
| Repo cleanup | **Done.** Removed stray build/scratch clutter: `.DS_Store`, a checked-in-but-gitignored `backend/khaao-server` binary, `.playwright-mcp/` ad-hoc test output, and a previous session's forgotten `frontend/vite.qa.config.ts` (tracked in git, unused anywhere). Rewrote all three READMEs (root, `backend/`, `frontend/`) — they'd drifted from reality (stale "auto-migrates" wording, a `POST /api/shop/day/close` endpoint that no longer exists, "bilingual toggle" listed as out-of-scope when it's now built) and duplicated content STATUS.md already owns; `frontend/README.md` was still Vite's unedited default template. All three are now short pointers to this file instead of a second, drift-prone source of truth. |

**P2-b (`CloseDay` safety) is moot, not done** — the "Close day" feature it
was about no longer exists (removed in the v4 batch: no auto stock-reset,
`order_no` just resets per calendar day on its own). Left out of the table
above and out of § 9 below; if a manual end-of-day reconciliation feature is
ever added back, revisit hardening it then.

---

## 1. What is Khaao?

A **mobile-first installable PWA** for a single college canteen. Students sign
in with their college Google account, build a cart, place one order at a
time, and track it live. The shopkeeper/chef accepts orders, cooks to
aggregate demand, hands items over one-by-one, and collects payment. No
in-app payments, no OTP, no multi-canteen.

**Scale target:** ~2000 students, single college. Lunch/break rush = bursts of
orders + ~1–2k long-lived SSE connections. Sustainably served by **one Go
instance** (see § Topology decision).

---

## 2. Stack

| Layer | Details |
|---|---|
| **Backend** | Go 1.23 · Gin · GORM · **PostgreSQL only** |
| **Architecture** | Layered SOLID: `controllers → services → repositories` with `authn`, `realtime`, `config`, `database` packages. Composition root in `cmd/server/main.go`. |
| **Auth** | Firebase Google sign-in only. Backend verifies Firebase ID tokens against Google's public certs (no Admin SDK, golang-jwt). Issues its own HS256 Khaao JWT. Role re-read from DB on every request. `FakeVerifier` for dev/e2e (`AUTH_FAKE=true`, disabled in production). |
| **Real-time** | Server-Sent Events, in-memory `realtime.Hub`. Students get `order_update`/`menu_update`. Shop gets `orders_update`/`prep_update`/`menu_update`/`shop_status`. Plus best-effort Web Push (VAPID) so a shopkeeper is notified of a new order even with the app closed. SSE connections authenticate via a short-lived one-use ticket (`POST /api/auth/sse-ticket`), never the raw JWT. |
| **Observability** | Structured `log/slog` throughout (JSON in production, text in dev/test) — `middleware.RequestLogger()` logs one line per request (method/path/status/latency/user_id); the shared `respondError` logs every 5xx at Error and every 409 (conflict) at Warn, so tx-conflict/order-state-transition anomalies surface centrally without per-call-site instrumentation. |
| **Frontend** | React 18 · TypeScript · Vite · Tailwind CSS · TanStack Query · react-router · Firebase JS SDK · installable PWA (`injectManifest` mode, hand-written `frontend/src/sw.ts`) |
| **Uploads** | Menu photos go straight to Cloudinary via a backend-signed upload (image bytes never touch the Gin server). |
| **Topology** | **ONE backend instance** behind a TLS reverse proxy (Caddy/nginx). Deliberate, not deferred — see below. |

### Topology decision — why ONE instance

Deliberate architectural choice. **Do not add Redis, distributed locks, or a
distributed SSE transport** unless the scale target itself changes.

- A single canteen lunch rush = ~500–1000 orders in 30–60 min, ~1–2k concurrent
  SSE connections. Go handles this trivially on 2–4 vCPU.
- `PoolEngine.mu` (`sync.Mutex`) is correct and fast in one process — each
  mutation is a single short DB transaction (single-digit ms).
- Scaling out would need distributed locking (Postgres advisory locks) *and*
  distributed SSE (Redis/LISTEN-NOTIFY) — real cost for a scale this app will
  never hit.
- The DB is still the ultimate arbiter: `SELECT … FOR UPDATE` is already in
  every mutation transaction, so a second instance would serialize correctly
  rather than corrupt data if it ever came to that. But run one.

```
Students' phones (PWA)           Shopkeeper/Chef tablet
         │  HTTPS + SSE                    │
         ▼                                 ▼
┌────────────────────────────────────────────────────┐
│  Reverse proxy / TLS (Caddy or nginx)               │
│  • proxy_buffering off for /api/stream (SSE)        │
│  • long read timeout on SSE, short elsewhere        │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│  ONE Go backend instance (2–4 vCPU, 1–2 GB RAM)    │
│  • in-process sync.Mutex  → correct, no dist. lock  │
│  • in-memory SSE hub      → correct, single process │
│  • ulimit nofile raised (each SSE = 1 fd)           │
└────────────────────────────────────────────────────┘
         │  pooled conns
         ▼
┌────────────────────────────────────────────────────┐
│  Managed Postgres 15+ (citext ext, daily backups)   │
│  • SELECT … FOR UPDATE inside each mutation tx      │
└────────────────────────────────────────────────────┘
```

---

## 3. Key workflows

**Student:** Login → browse menu → cart → place order (one active at a time)
→ track live (SSE: Waiting → Cooking → Ready → Pay → Done) → ready triggers
chime + vibrate + push → pay at counter → optional post-order rating.

**Shopkeeper:** Set menu/stock/diet/tags in the morning → triage incoming
(accept with optional per-item trim, or reject) → Prep screen shows aggregate
remaining demand, mark units done → hand items over (per-item or bulk) →
collect payment → History shows completed orders + insights. Shop-status
control (open/paused/closed) blocks new orders and gates pause/close on
accepted-but-unfinished orders.

**State machines:**
```
Order:  submitted → preparing → partially_ready → ready
                             ↘ awaiting_payment → completed
        branch: submitted → cancelled (student, submitted-only)
        branch: submitted/preparing/partially_ready/ready → rejected (shopkeeper,
                 refused once anything's been handed over)
        branch: ready → expired (15-min hold if nothing handed)

Item:   pending → queued → allocated → handed_over
        branch: rejected
```

Status is derived by a pure `recomputeStatus` function after every mutation.
Prices are integers in **paise**. Daily order tokens reset per
`BUSINESS_TIMEZONE` (default `Asia/Kolkata`).

---

## 4. Codebase map

```
backend/
  cmd/server/main.go              → composition root, server lifecycle, expiry ticker
  internal/
    config/config.go              → fail-closed config (refuses prod boot with dev defaults)
    authn/                        → Firebase RS256 verification + FakeVerifier (dev/test only)
    middleware/                   → auth (+ SSE ticket auth), CORS, security headers,
                                     ratelimit.go (per-user token bucket + SSE conn cap),
                                     logging.go (structured per-request slog)
    models/                       → GORM models (user, menu_item, order, order_item, item_pool,
                                     order_event, shopkeeper_email, shop_status, item_rating,
                                     push_subscription)
    database/database.go          → Open (GORM, citext, versioned SQL migrations via
                                     golang-migrate, pool tuning), Seed
    repository/                   → interfaces (repository.go) + GORM impls (gorm.go)
    realtime/hub.go                → in-memory SSE hub (fan-out by userID/role)
    services/
      auth.go, menu.go, orders.go, shopstatus.go, ratings.go, push.go
      pool.go                     → PoolEngine: the core order/prep/handover/payment engine
      allocation.go                → FCFS allocation strategy
      *_test.go                    → unit tests (mocked repos)
    controllers/                   → auth, menu, orders, shop, shopstatus, push, cloudinary, health
    routes/routes.go               → all route wiring

frontend/
  src/
    main.tsx, App.tsx              → root, route tree (role-split: student vs shopkeeper)
    lib/                           → firebase init, format helpers, sound (WebAudio, no assets)
    context/AuthContext.tsx        → auth state
    context/LanguageContext.tsx    → shopkeeper-only Hindi/English toggle (localStorage-persisted)
    hooks/useSSE.ts                → SSE hook, exponential backoff, MAX_RETRIES cap
    api/                           → typed API clients per domain
    components/                    → Layout (header+nav+realtime handlers), shared UI, StatusStamps,
                                     InstallPrompt, PushNotificationSetup, OrderModal, Modal (portal-based)
    pages/student/                 → Menu (browse/cart/checkout), OrderStatus (tracking/history/rating)
    pages/shop/                    → Orders, Prep, History, MenuManage
    sw.ts                          → hand-written service worker (injectManifest mode — precache +
                                     /api NetworkOnly + push/notificationclick listeners)

docs/
  SPEC.md                          → frozen v3 baseline spec (auth, core lifecycle, DB schema) — see
                                     its header note for what it does NOT cover
scripts/
  smoke.sh                         → e2e smoke test (boots server, full lifecycle)
```

---

## 5. Environment variables

Backend (`backend/.env`, copy from `backend/.env.example`):

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `APP_ENV` | `dev` | `dev`/`test`/`production` — fail-closed validation only runs in `production` |
| `DATABASE_URL` | — | Postgres only. Must not be localhost in production. |
| `JWT_SECRET` | — | HS256 secret, ≥32 chars, must not be the default in production |
| `FIREBASE_PROJECT_ID` | — | Required in production. Skip with `AUTH_FAKE=true` in dev. |
| `ALLOWED_EMAIL_DOMAIN` | `sst.scaler.com` | Student email domain |
| `SHOPKEEPER_EMAILS` | — | Comma-separated allowlist, seeded to DB on boot |
| `AUTH_FAKE` | `false` | Dev/test only — accepts `fake:<email>` tokens. Rejected in production. |
| `HOLD_MINUTES` | `15` | Minutes a fully-ready order holds before expiring |
| `BUSINESS_TIMEZONE` | `Asia/Kolkata` | IANA tz for daily tokens, history dates, availability windows |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin, must be `https://` in production |
| `SEED_SAMPLE_MENU` | `true` | Seed sample menu if empty on boot |
| `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET` | — | Menu photo uploads. **Confirmed working (2026-07-15)** — cloud `r2avfle3`, a Programmable Media account (the original account, `dvxohpbde`, was on Media Optimizer, which blocks the signed classic-upload API this integration uses with a 403; see § 10). **Never regenerate** these once real menu photos exist. |
| `VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT` | — | Web Push. **Never regenerate — rotating invalidates every existing subscription.** |

Frontend (`frontend/.env`, copy from `frontend/.env.example`): `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.

---

## 6. How to run locally

```bash
createdb khaao
cp backend/.env.example backend/.env      # fill in Firebase/Cloudinary/VAPID values
cp frontend/.env.example frontend/.env
cd backend && go run ./cmd/server          # :8080, runs migrations, seeds sample menu
cd frontend && npm install && npm run dev  # :5173, proxies /api to backend
```

Testing without Firebase (dev only): `AUTH_FAKE=true` in `backend/.env`, then
`POST /api/auth/firebase {"id_token": "fake:someone@sst.scaler.com:Name"}`.
The UI always uses the real Google popup — fake tokens are for curl/Playwright,
not the login button.

**Verification before any commit:**
```bash
cd backend && go build ./... && go vet ./... && go test ./... -race
cd frontend && npx tsc -b --noEmit && npm run build
```

---

## 7. API surface

See `docs/SPEC.md` for the frozen v3 core contract (auth, orders, menu, shop
endpoints, state machines). Added since that doc was written:

- `POST /api/orders/:id/ratings` — student submits 1–5★ per item on a
  completed order (ownership-checked, re-rating is a no-op)
- `GET /api/menu` / `GET /api/shop/menu` — now include `avg_rating`,
  `rating_count`, `diet`, `tags`, `order_count_today`
- `GET /api/shop-status`, `POST /api/shop/status` — open/paused/closed
  control; pause/close refused (409) while any *accepted* order is still
  outstanding (submitted-but-not-yet-triaged orders don't block it)
- `POST /api/shop/menu/photo-signature` — signs a direct-to-Cloudinary upload
- `GET /api/push/vapid-public-key`, `POST /api/push/subscribe` — Web Push
- `GET /api/shop/history` — now includes an `insights` block (order_count,
  item_counts, customers)
- `POST /api/auth/sse-ticket` — mints a short-lived one-use ticket for `?ticket=`
  on the SSE endpoints (replaces the raw JWT in the query string)
- `POST /api/shop/menu` (create) / `PUT /api/shop/menu/:id` (update) responses
  now include `avail_window_warning` (non-blocking, omitted when empty) —
  set when `avail_from >= avail_to`, since that's ambiguous between a
  genuine overnight window and a same-day typo

---

## 8. What's DONE

- Full order lifecycle: cart → order → accept/reject/trim → prep pool → FCFS
  allocation → per-item handover → payment → history, with one active order
  per student enforced in code and at the DB level (partial unique index)
- Firebase Google auth, DB-driven role/allowlist (re-read every request, so
  removing a shopkeeper locks them out immediately)
- Shop status control (open/paused/closed), menu diet + tags + trending,
  history insights
- Item ratings (1–5★ per order item, menu-level average + count)
- Web Push notifications for new orders (best-effort, self-cleaning dead
  subscriptions), alongside the existing in-tab SSE sound
- Cloudinary signed photo uploads for menu items
- Installable PWA (custom service worker, offline shell, `/api` NetworkOnly)
- Real-time SSE for both roles; ready-chime + vibration + browser
  notification for students, incoming-order alert for shopkeepers
- Server hardening: fail-closed prod config, request timeouts/body caps,
  security headers, DB row-locking (`SELECT … FOR UPDATE`) + advisory locks
  for concurrency correctness
- Full mobile-first visual redesign (paper-chit/steel-counter theme), and a
  Hindi/English **language toggle** on shopkeeper-facing pages (a header
  pill, persisted to `localStorage`) — every previously-bilingual spot now
  shows one language at a time instead of both always. Student pages stay
  English-only by design, and are explicitly guarded against ever showing
  Hindi (`components/Layout.tsx`'s `AvatarMenu`) even if a shopkeeper's
  stored language preference is 'hi' on a shared device/browser.
- The full 2026-07-18 review backlog (R1–R24): root error boundary,
  crash-proof cart (localStorage + stale-entry pruning), network-tolerant
  SSE (no logout on flaky Wi-Fi), redirect sign-in for installed PWAs,
  student "order ready" push + SW notifications + gesture-unlocked audio,
  Cloudinary thumbnailing, menu-response caching, touched-only pool
  broadcasts, bounded history payloads, transactional shop-status changes,
  one `ConfirmDialog`/`Modal` system (no `window.confirm`), offline banner,
  ESLint/Prettier/Vitest (45 tests) + golangci-lint wired into CI, and
  route-group/Firebase code-splitting (456 KB → 247 KB initial)
- All backend unit tests pass (`go test ./... -race`); `scripts/smoke.sh`
  covers the full golden-path lifecycle live against Postgres

---

## 9. What's LEFT (2026-07-20, next agent starts here)

**Everything code-side is done, including the design pass.** R1–R31 (the
full 2026-07-18 review backlog plus the 2026-07-19 third-pass follow-ups)
and F1–F24 (the 2026-07-20 § 9.2 frontend design-polish backlog) are all
implemented, tested, and committed — see Current state for the detail and
commit range. The pre-deploy GATE has run clean: § 6 suite green,
`scripts/smoke.sh` 15/15, the real-Postgres integration suite green,
`scripts/loadtest.js` green at smoke scale (after fixing two bugs in
the script itself — see Current state), and CI green on `main`.

**Two milestones are open (2026-07-20):**

1. **§ 9.3 — the G-series frontend backlog** (the active *code*
   milestone). Owner-authorized on 2026-07-20; this supersedes the
   earlier "no new backlog until D-6" rule for frontend items. If you're
   an agent picking this up: read § 9.1 first (binding for every
   frontend change), then work § 9.3 in order. § 9.5 is your brief.
   Frontend only — do not start anything from § 9.4.
2. **Deployment (D-1..D-7)** below — human-led, needs real infra access,
   not more code.

§ 9.2 is kept below as a historical record of the F-series design pass
(per-file verdicts, what shipped) — there is nothing actionable left in
it.

**Caveats worth knowing from the R12–R24 batch (recorded, not tasks):**

- **R14 residual race (documented in `shopstatus.go`):** the accepted-order
  check + status save are now atomic under the engine's advisory lock, but
  `RejectAllSubmitted` runs as a *separate* transaction afterwards (nesting
  would deadlock on the advisory lock). A concurrent Accept can still land in
  the commit-to-sweep gap, leaving the shop paused with one accepted order.
  Far narrower than the pre-fix race; closing it fully means restructuring
  `RejectAllSubmitted` to join the caller's transaction. Not worth it unless
  it's ever observed live.
- **R24 landed at 247 KB** raw initial student JS vs the "~200 KB" target
  (Firebase 155 KB + each page are now separate lazy chunks; down from one
  456 KB chunk). Good enough — treat **~250 KB as the do-not-regress line**.
- **R13:** student history is `LIMIT 20`; shop history caps the *response
  list* at 200 rows but computes insights/totals over the full day (tested).
- **R21:** a slow SSE consumer is now dropped by closing its channel →
  browser reconnects → `onOpen` refetch resyncs it. Drop = deliberate
  self-heal, not data loss.

### 9.1 Mobile design rules — read before ANY frontend change

Students use this exclusively on phones (installed PWA); the shopkeeper uses
a phone or counter tablet. These are standing rules, not suggestions:

1. **Design at 375×667 first** (iPhone SE class), then check ~360 px small
   Android and ~768–1024 px shopkeeper tablet. Desktop only needs to not
   break. DevTools device mode is the working canvas, but iOS-specific
   behavior is only ever proven on a real device (D-6).
2. **Touch targets ≥ 44×44 px** — `min-h-[44px]` is the established idiom.
   No hover-only affordances (hover doesn't exist on touch); `hover:` styles
   are progressive extras, tap feedback comes from `active:`/pressed states.
3. **Thumb zone:** primary actions live at the bottom — bottom nav, sticky
   footer CTAs, bottom sheets. `Modal` already renders as a bottom sheet on
   phones and a centered card at `sm:`. **Every overlay goes through
   `Modal`/`ConfirmDialog`** — never `window.confirm`, never a hand-rolled
   `fixed` div (§ 10: a `fixed` child of a `backdrop-filter` ancestor breaks;
   `Modal` portals to `document.body` for exactly that reason).
4. **Safe areas:** anything pinned to the bottom (nav, modal footers) needs
   the `pb-safe` utility, or the iOS home indicator overlaps it.
5. **No horizontal page scroll, ever.** Wide content scrolls inside its own
   `overflow-x-auto` container; long labels get `min-w-0` + truncation on
   flex children (Hindi item names run long).
6. **Inputs:** font-size ≥ 16 px on every input or iOS zooms the page on
   focus; set `inputmode`/`type` so the right keyboard opens (numeric for
   qty/price).
7. **The network is hostile** (campus Wi-Fi, elevators): every screen must
   stay usable on cached data — stale data + the offline banner beats an
   error state (`isError` alone must never replace rendered data; see R25).
   Never treat a network failure as an auth failure (R3). Every mutation
   shows a pending state and toasts on error.
8. **Performance budget:** initial student JS ≤ ~250 KB raw. New heavy
   dependencies must be lazy chunks (follow `App.tsx`'s route-group
   `lazy()` pattern; `lib/firebase` is dynamically imported at the moment of
   login). Menu photos always render through `cloudinaryThumb(url,
   2×display-px)` — never a raw `secure_url`.
9. **iOS installed-PWA rules** (standalone mode is the real target, and it
   has separate storage from Safari):
   - No `new Notification(...)` — only `registration.showNotification` via
     the service worker. No `navigator.vibrate`. WebAudio starts suspended —
     unlock on first user gesture (`lib/sound.ts` pattern). Web Push is the
     only screen-off signal.
   - Sign-in uses `signInWithRedirect` in standalone mode (popups break
     there) — keep both paths working when touching auth.
   - Feature-detect everything (`'Notification' in window`, etc.) — webview
     capability sets vary wildly.
10. **Visual language:** stay inside the paper-chit/steel-counter theme —
    the Tailwind tokens (`paper`, `ink`, `edge`, `steel`, `stamp`,
    `turmeric`, `brand`), `font-display` for headings, and the existing
    `Card`/`Button`/`EmptyState`/`StatusBadge`/`Modal` components. Don't
    invent new grays/shadows/radii; don't add a UI library. Animations use
    the keyframes in `tailwind.config.js` (e.g. `animate-slide-up`) —
    `tailwindcss-animate` is **not** installed, its class names are dead.
11. **Language:** shopkeeper-facing strings are paired via `useLanguage()`
    (`language === 'hi' ? … : …`); student-facing UI is English-only by
    design and guarded to stay that way (`Layout.tsx`).
12. **Orientation:** never lock it — the manifest deliberately has no
    `orientation` key (R18); shopkeeper tablets go landscape.

### 9.2 Frontend design-polish backlog (F-series) — added 2026-07-19, **DONE 2026-07-20**

**Status: complete.** F1–F24 all implemented, reviewed file-by-file, and
committed — see Current state (2026-07-20) for how it was executed (five
parallel worktree agents by file-ownership group, each diff reviewed
before merging) and the final gate numbers. Kept below verbatim as the
historical plan/spec, including the per-file verdict table — nothing here
is an open task anymore.

Authorized by the project owner: make both faces of the app — the
student PWA and the shopkeeper counter tool — genuinely beautiful,
without breaking anything R1–R31 hardened. Every file under
`frontend/src` was re-read for this pass; findings below. § 9.1 remains
binding for every item here. Work F1→F24 in order (F1–F12 are the
floor: rule violations and small bugs; F13–F24 are the beauty pass —
don't polish on top of violations). One commit per item or per small
coherent batch, `fix(frontend):`/`feat(frontend):`/`polish(frontend):`
prefixes.

**GATE for every F-item:** `npx tsc -b --noEmit` · `npm run lint` ·
`npm test` · `npm run build` with raw initial student JS ≤ 250 KB ·
check at 375×667, ~360 px, and 768–1024 px · no horizontal page
scroll · `prefers-reduced-motion` still kills all animation. **No new
runtime dependencies** (no UI/animation/icon libraries — the theme is
hand-built and must stay that way). No new fonts, no new grays/shadows/
radii outside `tailwind.config.js` tokens.

#### Design direction (read before F13–F24)

The identity is already chosen and it is good: **the paper chit and
the steel counter.** Every order is a kraft-paper token stamped as it
moves down the line; the app around it is the cool institutional
steel of a canteen counter. IBM Plex Mono is the "printed on the
chit" voice (numbers, prices, stamps, labels); IBM Plex Sans is
everything else. `brand` moss = the awning, `stamp` red = rubber-stamp
ink, `turmeric` = the kitchen. **Sharpen this identity; do not replace
it or dilute it toward a generic food-delivery look** (no gradients,
no glassmorphism, no emoji-as-icon, no rounded-blob illustration
style).

The **signature element** is the rubber-stamp language — and its
proper stage is the **"ready" moment**, the emotional peak of the
whole product (your food is ready, go get it). The keyframes for it
(`ready-pop`, `ready-glow`, `tick-pop`, `status-in`) already exist in
`tailwind.config.js` and are currently **dead — referenced nowhere**.
Wiring them where they were designed to go is F13/F14/F19, and it is
the highest-leverage beauty work in this list. Spend boldness there;
keep everything else quiet and disciplined. Copy rules: plain verbs,
sentence case, name the action by what it does (`Place order` →
"Order placed"), errors say what to do next, and an action keeps one
name through its whole flow (Accept / Reject / Handover / Collect).

#### F1–F12 — fix first (violations & small bugs)

- **F1 · Safe-area misses.** `pages/student/Menu.tsx:317` — the sticky
  category-chip bar uses `top-14`, ignoring the notch inset the header
  already handles with `pt-safe`; in installed-PWA standalone on a
  notched iPhone the chips slide *under* the header. Use
  `top-[calc(3.5rem+env(safe-area-inset-top,0px))]`.
  `components/Toast.tsx:48` — the toast container is `top-0 … pt-4`
  with no safe-area padding, so toasts render under the notch/Dynamic
  Island. Add safe-area top padding. (§ 9.1.4.)
- **F2 · Sub-44 px touch targets** (§ 9.1.2) on the most-tapped
  student screens: `DietFilter.tsx` buttons (~34 px), Menu category
  chips (`Menu.tsx:321-333`, ~30 px), the rating stars in
  `OrderStatus.tsx:172-180` (also missing `type="button"` and
  per-star `aria-label`), and both prompt-card dismiss buttons
  (`InstallPrompt.tsx`, `PushNotificationSetup.tsx` — `h-6 w-6`).
  Keep the *visual* size; grow the hit area (padding / `min-h`
  / negative-margin technique).
- **F3 · Input rules** (§ 9.1.6). `pages/shop/History.tsx:73-78` — the
  date input is `text-sm` (14 px ⇒ iOS zooms on focus) and under 44 px
  tall; make it `text-base min-h-[44px]`. `MenuManage.tsx` price input:
  add `inputMode="decimal"` so phones open the right keyboard.
- **F4 · Off-token colors** (§ 9.1.10) in `pages/shop/MenuManage.tsx`:
  the armed tap-again state uses raw `ring-red-500`/`bg-red-500`
  (lines ~427, 485) — use `stamp` tokens; the Veg/Non-veg text pill
  uses raw `bg-green-100 text-green-700`/`bg-red-100 text-red-700`
  (lines ~455-459) — replace with the shared `VegMark` (the student
  side already speaks FSSAI mark; the shop side should too).
- **F5 · `StatusStamps.tsx:45-49` render impurity.** `nextFilterId()`
  mutates a module counter *during render* — a new SVG filter id every
  render, id churn under StrictMode, re-injected `<filter>` defs each
  time. Replace with React's `useId()`.
- **F6 · Cart bar is a clickable `<div>`** (`Menu.tsx:372-398`): not
  keyboard-reachable, no role, and it nests a `<Button>` that
  `stopPropagation()`s to do the same thing. Make the whole bar one
  `<button>`; give it an `animate-slide-up` entrance so it doesn't
  blink into existence. Bonus: when the shop pauses/closes with items
  in the cart the bar vanishes entirely — keep a view-only "View cart"
  affordance so students can still see what they'd picked.
- **F7 · Category-observer churn** (`Menu.tsx:208-234`): the
  IntersectionObserver effect lists `activeCategory` in its deps and
  also *sets* it from the callback, so the observer is torn down and
  rebuilt on every scroll transition. Drop it from the deps (functional
  update / ref). Also scroll the *active chip itself* into view inside
  the chip strip — on long menus the highlighted chip drifts
  off-screen.
- **F8 · Complete the Hindi pairing** (§ 9.1.11 — coverage is patchy;
  a Hindi-mode shopkeeper gets a half-translated UI). Missing strings,
  by file — pair each via the existing `language === 'hi' ? … : …`
  idiom, no i18n library: `shop/Orders.tsx` (RejectDialog body +
  title, "Already accepted", "Uncheck anything you're out of…", both
  empty states); `components/OrderModal.tsx` ("ready x/y · handed over
  x/y" line, "Waiting on the cook…", "Hand over every item to collect
  payment.", "✓ Handed over", remove/cancel ConfirmDialog copy);
  `shop/MenuManage.tsx` (every form label + placeholder, validation
  messages, "Uploading...", delete-confirm copy, page subtitle);
  `shop/Prep.tsx` (title, subtitle, empty state); `shop/History.tsx`
  (page header line, insight-card labels Orders/Top items/Regulars,
  empty states); `components/ShopStatusControl.tsx` (modal subtitle,
  the three explanation paragraphs, the pending-orders warning,
  "Cancel", "Already …"); `components/ConfirmDialog.tsx` (default
  Confirm/Cancel labels — accept overrides from callers);
  `components/PushNotificationSetup.tsx` (title + body, currently
  English-only for shop); `components/Layout.tsx` offline banner (shop
  side); shop-side mutation error toasts. Student-facing strings stay
  English-only — do not touch them.
- **F9 · Prompt-card collisions & consistency.** `InstallPrompt` and
  `PushNotificationSetup` both render `fixed inset-x-4 bottom-20
  z-40` — when both fire they overlap exactly. Coordinate them (show
  at most one; install wins, push waits for next session or for the
  install card's dismissal). Both hand-roll their CTA buttons — use
  `Button`. And `PushNotificationSetup.handleEnable`'s failure path is
  `console.error` only — surface a toast so a real user isn't left
  with a silently dead Enable button.
- **F10 · Permission race at checkout** (`Menu.tsx:418-421`):
  `Notification.requestPermission()` fires inside the Place-order
  click, so the native permission dialog lands at the same instant as
  the submit + navigation. Move it to the mutation's `onSuccess` (ask
  after the order exists) — `PushNotificationSetup` remains the owner
  of the full push-subscription flow.
- **F11 · History copy bugs.** Insights card says "completed today"
  even when a past date is selected; the header says "collected on
  2026-07-18" (raw ISO). Humanize the date once ("Fri 18 Jul") and
  reuse it in both places.
- **F12 · Two papercuts.** `Login.tsx:33-54` sets `submitting=true` on
  every mount, flashing the button spinner even when no redirect is
  pending — only show it once a pending redirect actually starts
  resolving to a user. `shop/Orders.tsx` accept flow: unchecking an
  item silently marks it out of stock globally (deliberate, P1-d) but
  nothing says so — add one quiet line under the checklist ("Unchecked
  items are also marked out of stock").

#### F13–F24 — the beauty pass

- **F13 · Login as the set-piece.** First impression of the whole
  product, currently the plainest screen. One orchestrated load
  sequence, ≤ 600 ms total: the ticket card rises (`slide-up`), then
  the "Order ahead · Skip the line" line lands as a rubber stamp
  (`animate-stamp`, slight rotation, `stamp` red) over the K-mark
  moment. Static under reduced motion. No new assets — type, tokens,
  and the existing keyframes only.
- **F14 · The Ready moment** (`OrderStatus.tsx` ReadyBanner +
  OrderTicket). This is what the dead keyframes were written for: when
  status transitions to `ready`, the banner enters with
  `animate-ready-pop` and idles with `animate-ready-glow`; the token
  ticket itself pops once. Chime/vibration/push already exist —
  this completes the moment visually. The stamp row (`StatusStamps`)
  already lands `READY`; make sure the choreography reads as one
  event, not three competing ones.
- **F15 · Skeletons over spinners.** Replace `FullPageSpinner` on
  Menu, Orders, Prep, History, MenuManage first-loads with
  paper-toned skeleton chits — `paper` blocks, `edge` bones,
  `animate-soft-pulse` shimmer (already in the reduced-motion kill
  list). Shaped like the real cards (menu row = photo square + two
  text bones + stepper block) so the page doesn't reflow when data
  lands.
- **F16 · Empty states with a face.** `EmptyState.tsx` is a bare text
  box. Add a small optional inline SVG glyph slot — hand-drawn-feel
  ink-line style (1.5–2 px stroke, `ink/25`): empty plate (menu), a
  blank chit (orders), a cold flame (prep), a ledger line (history).
  Quiet, ≤ 48 px, no color washes.
- **F17 · Menu-card photo parity.** `TrendingRail` has a kraft
  initial-letter placeholder when an item has no photo;
  `MenuItemCard` just omits the image, so list rows lose their
  rhythm. Add the same placeholder treatment to `MenuItemCard`.
- **F18 · Order age on incoming cards** (`shop/Orders.tsx`,
  IncomingOrderCard). The shopkeeper's real triage signal is *how
  long has this student been waiting* — show "2 min" (tabular mono,
  from `created_at`, tick every 30 s), quiet by default, `turmeric`
  past 5 min, `stamp` past 10. No layout change — it slots next to
  the existing `#token · time` line.
- **F19 · Prep board totals + tick.** Top strip above the prep grid:
  "14 units across 5 items" in the chalkboard voice (ink block, paper
  digits — the PrepRow tally style). On a successful Done, the row's
  tally re-renders with `animate-tick-pop` (dead keyframe, written
  for exactly this).
- **F20 · Shopkeeper tablet layout** (§ 9.1.1's 768–1024 target).
  `shop/Orders.tsx` keeps the phone segmented-control on a tablet
  where both columns fit — at `lg:` show New and In-progress
  side-by-side (two columns, headers instead of tabs, badges intact).
  Check the bottom nav on tablet too: 4 tabs stretched across
  `max-w-6xl` is a reach — cap the nav grid (`max-w-md mx-auto`)
  while keeping the bar full-width.
- **F21 · Status-bar seam.** `theme_color` is brand-dark `#2c4434`
  (index.html + manifest) but the header/page is steel `#DCE4DE` — on
  Android the system bar shows a dark green band over a pale app.
  Decide once: either theme-color → steel to make the seam invisible,
  or restyle the header as a brand-dark band (paper text, K-mark
  inverted) so the app "hangs from the awning". The second is the
  braver, more identity-forward choice; prototype both at 375 px
  before committing. Update index.html and vite.config.ts together.
- **F22 · Modal a11y.** `Modal.tsx` has Escape/backdrop/scroll-lock
  but no focus management: move focus into the dialog on open, trap
  Tab inside, return focus on close. `AvatarMenu` (Layout.tsx) could
  take arrow-key navigation, lower priority.
- **F23 · Copy pass** (writing rules above): unify canteen/shop
  naming, make every error state say the next action, sentence case
  throughout, replace remaining generic "Something went wrong" where
  a specific message exists. Small diffs, many files — batch as one
  commit.
- **F24 · Keyframe reconciliation.** After F13/F14/F19, `status-in`
  is the only still-unused animation — either wire it (history/list
  entrances) or delete it from `tailwind.config.js` *and* the
  reduced-motion kill list in `index.css`. No dead design tokens.

#### Per-file review verdicts (2026-07-19 — what was checked, what was found)

| File | Verdict |
|---|---|
| `App.tsx`, `main.tsx`, `vite-env.d.ts` | Clean — route-group lazy pattern is right, keep it. |
| `index.html`, `vite.config.ts` | Clean except the theme-color seam → F21. |
| `index.css`, `tailwind.config.js` | Clean; 4 dead keyframes → F13/F14/F19/F24. |
| `pages/Login.tsx` | Works; spinner flash → F12; design set-piece → F13. |
| `pages/student/Menu.tsx` | Biggest file, mostly sound → F1 (chip safe-area), F2 (chips), F6 (cart bar), F7 (observer), F10 (permission race), F15. |
| `pages/student/OrderStatus.tsx` | Sound → F2 (stars), F14 (ready moment), F15. |
| `pages/shop/Orders.tsx` | Sound → F8, F12 (stock-out hint), F18, F20, F15. |
| `pages/shop/Prep.tsx` | Sound; chalkboard tally is the best moment in the shop UI → F8, F19, F15. |
| `pages/shop/History.tsx` | Sound → F3 (date input), F8, F11, F15. |
| `pages/shop/MenuManage.tsx` | Sound → F3 (inputMode), F4 (off-token colors), F8, F15. |
| `components/Layout.tsx` | Sound; tablet nav width → F20. |
| `components/Button.tsx`, `Card.tsx`, `Spinner.tsx`, `VegMark.tsx`, `OrderTicket.tsx`, `QtyStepper.tsx` | Clean — the component floor is solid. |
| `components/Modal.tsx` | Sound (portal rationale documented) → F22 focus management. |
| `components/ConfirmDialog.tsx` | Clean → F8 (default labels). |
| `components/Toast.tsx` | Sound → F1 (safe-area). Top placement is fine, keep. |
| `components/StatusStamps.tsx` | Signature component, love it → F5 (useId). |
| `components/StatusBadge.tsx`, `DietFilter.tsx` | Clean → F2 (DietFilter hit area). |
| `components/MenuItemCard.tsx`, `TrendingRail.tsx` | Clean → F17 (placeholder parity). TrendingRail's rank numbering is genuinely ordinal — keep. |
| `components/EmptyState.tsx` | Clean → F16. |
| `components/OrderModal.tsx` | Sound → F8. |
| `components/ShopStatusControl.tsx` | Sound → F8. |
| `components/InstallPrompt.tsx`, `PushNotificationSetup.tsx` | Working → F2, F9. |
| `components/ErrorBoundary.tsx`, `ProtectedRoute.tsx` | Clean. |
| `components/StudentRealtime.tsx`, `ShopRealtime.tsx`, `shopNotifications.ts` | Clean — transition logic re-verified this pass (vibrate is feature-detected, SW notification path correct). |
| `context/AuthContext.tsx`, `LanguageContext.tsx` | Clean. |
| `hooks/useSSE.ts`, `useOnlineStatus.ts` | Clean (R28 jitter present and correct). |
| `lib/cart.ts`, `format.ts`, `image.ts`, `sound.ts`, `firebase.ts` | Clean; sound design (distinct chimes per event) is good. |
| `api/*` | Clean — covered by R1–R31 passes + tests; nothing design-facing. |
| `sw.ts` | Clean (R30 fallback + url routing present). |
| All `*.test.*`, `test/setup.ts` | Not design surface; 50/50 green at last GATE. |

### 9.3 Frontend depth backlog (G-series) — added 2026-07-20, **ACTIVE**

Owner-authorized next round of frontend work. Unlike the F-series (a
fix-and-polish pass), this is **depth-of-use** work: the features a
daily-use canteen app is still missing, plus the accessibility parity the
chime/vibration path never got. Every item below was grounded against the
actual post-F-series code on 2026-07-20 — file references are real.

**Work G1 → G8 in order.** G1 is the floor (small compliance fixes found
in the 2026-07-20 re-read); G2–G7 are the feature round; G8 is the one
product-shaped item — if its scope feels doubtful mid-flight, finish
G1–G7, then stop and ask the owner (per § 9.5) rather than guessing.
One commit per item, `feat(frontend):` / `fix(frontend):` /
`polish(frontend):` prefixes.

**GATE for every G-item** (identical to the F-series gate): `npx tsc -b
--noEmit` · `npm run lint` (0 errors) · `npm test` (all green — 53/53
baseline, plus any new tests) · `npm run build` with raw initial student
JS ≤ 250 KB — **currently 249.37 KB, snug**: no new runtime dependencies
of any kind, hand-built code only, and re-check the build number after
every item; if the initial chunk crosses the line, stop and report
instead of shipping. Check 375×667, ~360 px, and 768–1024 px · no
horizontal page scroll · `prefers-reduced-motion` still kills all
animation. § 9.1 is binding throughout — student strings English-only,
shopkeeper strings Hindi-paired via `useLanguage()`.

**Design direction for this round:** the identity (paper chit / steel
counter, § 9.2's direction block) is settled — do not restyle anything.
New UI must read as if it was always there: existing tokens, existing
components, mono for data / sans for prose. Spend the round's boldness
on **G3 (Order again)** — the moment that turns the history ledger from
a record into a tool; everything else stays quiet. Copy rules carry
over: plain verbs, sentence case, an action keeps one name through its
whole flow, every error says what to do next.

- **G1 · Floor sweep (small fixes first).**
  (a) Thumbnails outside `MenuItemCard` never got lazy-loading: add
  `loading="lazy" decoding="async"` to the `<img>`s in
  `pages/student/OrderStatus.tsx` (active-order item rows ~line 122 and
  history rows ~line 329) and `pages/shop/History.tsx` (order-log grid
  ~line 251); add `decoding="async"` to `MenuItemCard.tsx`'s already-lazy
  img; check `OrderModal.tsx` for the same while there.
  (b) `OrderStatus.tsx` RatingPrompt's "Skip" is a bare text link under
  44 px (~line 221) — keep the visual size, grow the hit area to
  `min-h-[44px]` (§ 9.1.2).
  (c) While in those files, sanity-check no other sub-44 target crept in
  post-F2.
- **G2 · Menu search** (`pages/student/Menu.tsx`). The single
  highest-value missing student feature — there is no way to find a dish
  by name on a long menu. A quiet full-width search input above the
  "Main Menu" header row: client-side, case-insensitive match on item
  name and tags over the already-loaded `items` (no debounce needed, no
  network). While a query is active: hide `TrendingRail` and the sticky
  chip bar, render one flat "Results (n)" section (diet filter still
  composes with it), and give the no-match case a real empty state
  ("No dishes match 'x'") with a ≥44 px clear action. Input rules
  § 9.1.6: `type="search"`, `text-base` (16 px — iOS zoom),
  `min-h-[44px]`, `enterKeyHint="search"`; style it as a paper chit
  (`bg-paper border-edge`), not a floating pill. Keep the scroll-spy
  effects keyed on `allCategories` exactly as they are (F7) so clearing
  the query doesn't churn observers.
- **G3 · "Order this again"** (`pages/student/OrderStatus.tsx` +
  `lib/cart.ts`). On completed-order history cards: one secondary
  button, "Order this again", that refills today's cart from that
  order. The merge logic is a pure helper in `lib/cart.ts`
  (`reorderIntoCart(cart, pastOrder, menu)` or similar) with unit tests
  — only items still on today's menu **and orderable** are added,
  quantities merge additively into any existing cart. Because the Menu
  page is unmounted on `/order`, write the merged cart straight to the
  `khaao_cart_v2` localStorage key (same `{date, items}` shape,
  today-keyed) and `navigate('/')` — `Menu`'s `loadStoredCart` picks it
  up on mount and the existing cart bar slide-up is the arrival moment
  (no new animation needed). Toast the outcome honestly: full ("3 items
  added to your cart"), partial ("2 of 3 added — Vada Pav isn't on
  today's menu"), none (error toast, don't navigate). Hide or disable
  the button with a stated reason while an active order exists.
- **G4 · Diet filter persistence** (`pages/student/Menu.tsx`). A veg
  student re-selects "Veg" every single visit. Initialize `dietFilter`
  from localStorage (`khaao_diet_filter_v1`), validate the stored value
  against the actual `DietFilterValue` union before trusting it, persist
  on change.
- **G5 · History date stepper** (`pages/shop/History.tsx`). The native
  date input is the only navigation — flipping through days is the #1
  history gesture and it takes three taps. Flank the input with ◀ / ▶
  buttons (≥44 px, `aria-label`s Hindi-paired), ▶ disabled at today;
  show a "Today" quick-jump pill when `date !== todayLocal()`. Do the
  date arithmetic on the `YYYY-MM-DD` parts in local time (same
  reasoning as `todayLocal()`'s doc comment — never `toISOString()`).
- **G6 · Top-items ledger bars** (`pages/shop/History.tsx` insights).
  The "Top items" card lists name + count but the proportions are
  invisible. Add a quiet proportional bar per row — hand-built divs
  (width = qty / max qty), `bg-brand-light` fill, ledger feel, sitting
  under each row's text line; `aria-hidden="true"` on the bars (the
  numbers stay the accessible content). **Load the `dataviz` skill
  before writing this item** — it is chart-shaped work. No chart
  library under any circumstances (§ 9.1.8).
- **G7 · Live status announcements (a11y parity).** Status changes
  arrive as chime + vibration + visual stamp — a screen-reader user
  gets silence. Add one visually-hidden `aria-live="polite"` region
  (Layout-level, `sr-only`) fed by the transition detection that
  already exists — `StudentRealtime.tsx` / `ShopRealtime.tsx` both have
  the `prevStatusRef` idiom; reuse it, do not duplicate transition
  logic. Announce exactly the transitions that already chime (student:
  "Order #12 is ready — pick it up at the counter"; shop: new incoming
  order, Hindi-paired). Nothing more — a live region that narrates
  every refetch is worse than none.
- **G8 · "Your usuals" — local favorites** (`MenuItemCard.tsx` +
  `pages/student/Menu.tsx`). The same student orders the same dosa most
  days. A quiet pin toggle on each menu card (≥44 px hit area, inline
  ink-line SVG in the `EmptyStateIcons` style — **not** an emoji, per
  the design direction), ids stored in `khaao_favorites_v1`
  localStorage. When ≥1 favorite is on today's menu, render a "Your
  usuals" strip above the Main Menu header — visually distinct from
  `TrendingRail` (that one is everyone's data; this one is yours —
  label it accordingly). Device-local by design; cross-device sync is
  § 9.4-B2, not this item.

### 9.4 Deferred backlog — recorded for LATER, **NOT authorized**

Backend work, product decisions, or deliberately-postponed frontend.
Nothing here may be started as part of the G-series — it's written down
so it isn't lost, and so the owner can pick from it deliberately later.

| # | What | Why it's deferred |
|---|---|---|
| B1 | Order notes to kitchen ("less spicy") | Backend: new order field + validation; UI on both faces. |
| B2 | Favorites sync across devices | Backend: table + endpoints. G8 ships device-local first. |
| B3 | Menu item descriptions | Backend: new column + API field; would unlock a student item-detail sheet. |
| B4 | Scheduled pickup time slots | Product decision + backend scheduling; changes the FCFS model. |
| B5 | Student history beyond `LIMIT 20` | Backend pagination param (R13) + UI. Not felt until months of use. |
| B6 | Weekly/range shop insights | Backend aggregation across days + a real dataviz pass. |
| B7 | Queue position / ETA for students | Backend derivation from pool state; needs careful honesty about accuracy. |
| B8 | Shopkeeper allowlist admin UI | Backend endpoints; today it's env-seeded (`SHOPKEEPER_EMAILS`), fine at this scale. |
| B9 | httpOnly cookie sessions | § 11.2 — an architecture project, not a task. |
| B10 | iOS splash screens (`apple-touch-startup-image`) | Pure asset generation; wait for D-6 real-device pass to prove it's worth the asset set. |
| B11 | SW update-prompt UX | `registerType` is `autoUpdate` today; switching to a "refresh for update" prompt is a product decision. |

### 9.5 Agent brief — how to hand this off

Paste this (or equivalent) to the implementing agent, verbatim:

> Read `STATUS.md` top-to-bottom before touching any code. § 9.1 (mobile
> design rules) is binding for every frontend change. Your task is the
> **G-series frontend backlog in § 9.3, and only that**: work G1 → G8 in
> order, one commit per item (`feat(frontend):` / `fix(frontend):` /
> `polish(frontend):`), and run the full GATE from § 9.3 after every
> item — `npx tsc -b --noEmit`, `npm run lint`, `npm test`,
> `npm run build` with raw initial student JS ≤ 250 KB (it is at
> 249.37 KB — if an item pushes it over, stop and report instead of
> shipping), checks at 375×667 / ~360 px / 768–1024 px, no horizontal
> page scroll, `prefers-reduced-motion` kills all animation. No new
> runtime dependencies of any kind. Do **not** touch `backend/`,
> `deploy/`, or anything listed in § 9.4 — those are recorded for later
> and not authorized. Before G6, load the `dataviz` skill. When the
> G-series is complete (or you are genuinely blocked), update the
> "Current state" and § 9.3 sections of `STATUS.md` to reflect what
> shipped, then **STOP and ask the project owner whether they want any
> other changes** — do not start new work, new backlogs, or § 9.4 items
> on your own.

### Deployment (the remaining human-led milestone — needs real infra, not just code)

**`deploy/RUNBOOK.md` is the expanded, step-by-step version of this table**
(each D-item maps to a runbook section) — follow it, don't re-derive.
Artifacts ready and committed: `deploy/Caddyfile` (tool-validated with
`caddy validate`), `deploy/khaao-backend.service`, `deploy/RUNBOOK.md`.
**Agent/human split:** almost everything below needs a human with
domain/server/dashboard access. An agent's useful roles here are (a) pair
on D-4/D-5 config and debugging once the human has access set up, (b)
verify D-6 findings and fix anything they surface, (c) keep this table and
the runbook in sync with reality as steps complete.

| # | What | Notes |
|---|---|---|
| D-1 | **Provision managed Postgres** | Runbook § 1. Supabase/Neon/Railway. Daily backups on from day one, test a restore *before* go-live. Confirm `citext` available. `?sslmode=require`. |
| D-2 | **Firebase setup** | Runbook § 2. Enable Google sign-in → **add authorized domains** (the #1 launch gotcha — sign-in silently fails on an unauthorized domain, and R4's redirect flow depends on it too). |
| ~~D-3~~ | ~~Cloudinary account check~~ | **Done (2026-07-15).** Live-verified via a direct signed-upload test against Cloudinary's API. Current `backend/.env` (cloud `r2avfle3`) is a working Programmable Media account. **Never regenerate the credentials** (§ 5). |
| D-4 | **Deploy backend** | Runbook § 4 + § 6. ONE instance (replicas=1 enforced). Raise `ulimit -n` (the systemd unit's `LimitNOFILE` covers it). Caddy in front: `proxy_buffering off` on `/api/stream`, long SSE read timeout — the committed Caddyfile already encodes this. `APP_ENV=production` (fail-closed config validates the rest). |
| D-5 | **Deploy frontend** | Runbook § 5. Static host (Netlify/Vercel/Cloudflare Pages), `VITE_FIREBASE_*` set at build time. |
| D-6 | **End-to-end production verification** | Runbook § 7. One real student + one real shopkeeper complete a full order lifecycle on production. **Must include the real-device checks:** (R4) Google sign-in *inside* the installed PWA on iOS and Android — not just in a browser tab (iOS standalone has separate storage, so this is the only place the redirect flow is truly exercised); (R5) the "ready" moment on a locked/backgrounded phone — push arrives, SW notification shows, chime plays after first-touch unlock; CSP console check per § 11.5 (no "Refused to …" errors during real Firebase login or Cloudinary photo upload — the CSP has never been exercised against the real providers). |
| D-7 | **Runbook for ongoing ops** | **Written** — Runbook § 8 covers rotate `JWT_SECRET`, add/remove a shopkeeper, check logs, restore a backup. Remaining: validate the steps against the real deployment during/after D-6 (a runbook that's never been executed is a draft). |

---

## 10. Operational lessons (worth 30 seconds before you repeat one)

- **Commit incrementally.** Everything is committed as of 2026-07-14 — keep it
  that way. A prior multi-session stretch where nothing was committed led to a
  `git checkout --` wiping real work, because with nothing committed "undo my
  last edit" and "wipe this file's entire uncommitted history" are the same
  command. `git checkout`/`git reset` only ever restore to the last commit.
- **Never batch-`mv` files with duplicate basenames into one destination** —
  silent overwrite, no warning (cost a from-scratch reconstruction of
  `services/push.go` once). Move one at a time to distinct paths, or use
  `git stash push --keep-index --include-untracked` (tracks full paths, no
  collision risk) if you genuinely need to isolate changes.
- **Never regenerate the VAPID key pair or Cloudinary credentials** —
  invalidates every existing push subscription / breaks uploads.
- **A `fixed`-positioned overlay must never be a literal DOM child of an
  element with `backdrop-filter`/`filter`/`transform`** — that ancestor
  becomes the fixed element's containing block instead of the viewport.
  Portal it to `document.body` (see `Modal.tsx`).
- **The menu mistouch-guard's ~3s auto-disarm can look like a missing
  feature** if you click-then-check across two separate tool round-trips (the
  timer expires in between). Test click+check inside one script, or you'll
  "rediscover" a nonexistent bug — this has happened more than once.
- **A long-lived browser tab in this scratch PWA setup can serve a stale
  service-worker precache** even though the Vite dev server is serving
  current source — if live behavior contradicts what's plainly in the code,
  check `navigator.serviceWorker.getRegistrations()` / `caches.keys()` before
  concluding it's a real bug.
- **`Playwright fullPage: true` screenshots can visually misplace
  `position: fixed` elements** (e.g. the bottom nav appearing to overlap
  content) — this is a capture artifact, not a rendering bug. Verify with a
  real scrolled-viewport screenshot or `getBoundingClientRect()` before
  "fixing" it.
- **Don't touch the shared `frontend/vite.config.ts` proxy target for a
  scratch/QA check if a real dev server might be running** — it hot-reloads
  the live session onto the scratch backend. Always use an isolated
  `vite.<name>.config.ts` + distinct port for scratch work — and remember
  that isolated config still needs the same `VitePWA` plugin as the real one
  (`main.tsx` imports `virtual:pwa-register`, which only exists if the plugin
  is present; a bare `react()`-only scratch config 500s on `main.tsx`).
- **Orphaned scratch server processes can silently hold a Postgres connection
  open for a full day**, blocking `scripts/smoke.sh`'s own `dropdb` with
  "database is being accessed by other users." Before assuming the script is
  broken, check `psql -c "SELECT pid,datname,client_port FROM
  pg_stat_activity"` and cross-reference with `ps aux` / `lsof -p <pid> -i` —
  match the Postgres `client_port` to the OS process's outbound port to
  confirm you're killing the orphaned scratch binary (e.g. one left in a
  previous session's `/tmp` or scratchpad) and not the real dev server
  (which will be connected to the real `khaao` db, not a `_smoke`/`_scratch`
  one).
- **`kill -9` on a scratch backend doesn't reliably or promptly propagate as
  an `EventSource.onerror` through a live Vite dev-proxy** in ad-hoc
  Playwright testing — reconnect/refetch behavior showed up in console logs
  (the right query keys refetching) but not cleanly enough to demo
  deterministically. Trust a correct source-code read (the `onopen` callback
  is unconditional) over fighting proxy/timing flakiness in a throwaway
  harness; if you need a crisp demo, pause/resume a proxy layer you control
  rather than killing the upstream process.
- **When a third-party integration fails (e.g. a 403 from Cloudinary), reproduce
  it directly against the provider's API with curl** — sign the same request the
  app would send and POST it straight to Cloudinary, bypassing the Go backend
  and browser entirely. This gives an unambiguous answer (exact status code +
  response body) about whether the fault is credentials, code, or the
  provider/account itself, in about 10 seconds, instead of guessing from a
  vague browser console error or asking the user to click around repeatedly.
  Used this to confirm the Media Optimizer product-tier 403 was real (not a
  `.env` typo) and later to confirm a replacement account actually worked,
  before ever touching the app's own upload flow.
- **The auto-mode permission classifier can deny `agy
  --dangerously-skip-permissions` case-by-case based on what a specific
  prompt touches** (e.g. it allowed a menu-availability change and a
  frontend UX change, then denied a broader prompt that touched
  `middleware/auth.go` and central error handling) — even within one session
  with no settings change in between. Don't assume one approved agy
  invocation means the next one will be; when denied, doing the work
  directly is a legitimate fallback, not a workaround.
- **A GitHub Actions step can be silently broken from the moment it's
  added and nobody notices until a human actually looks at the Actions
  tab** — R23 added `golangci-lint-action@v6` with `version: v2.12.2`;
  action v6 doesn't support golangci-lint v2.x at all ("you must update
  to golangci-lint-action v7"), so every CI run from that commit onward
  failed at the lint step, even though `golangci-lint run` was verified
  clean locally before every commit (§ 6 doesn't run in CI's exact
  container/action wrapper, so a locally-clean tool can still fail
  there). `git push` succeeding is not the same as CI passing — if you
  push and the user doesn't mention CI, check
  `gh run list`/`api.github.com/repos/<owner>/<repo>/actions/runs`
  yourself rather than assuming green. Fixed by bumping both
  `golangci-lint-action@v6` occurrences to `@v7`.
- **Local tool verification (`go test`, `golangci-lint run`, `npm test`,
  a local k6/smoke run) and CI-green are two different claims** — this
  session's GATE also caught `scripts/loadtest.js` itself carrying two
  real bugs (stale SSE auth scheme, unpaced shopkeeper mutations) that
  had sat undetected because the script simply hadn't been *run*
  end-to-end since the features it exercises (SSE tickets, the rate
  limiter) were added. A script/workflow that isn't part of routine
  verification can drift silently — the fix isn't "trust it more," it's
  "actually run it periodically."

---

## 11. Known security gaps (tracked)

1. ~~SSE token in the query string~~ — **fixed**: SSE now authenticates via a
   short-lived one-use ticket (`services/sse_ticket.go`), never the raw JWT.
2. `localStorage` JWT — still XSS-exfiltratable. Left as-is deliberately —
   fixing this properly means full cookie-based sessions (httpOnly + SameSite),
   a bigger architectural change than a hardening pass; revisit as its own
   project if it becomes a priority. **Partially mitigated (2026-07-15)** by
   the new CSP (`script-src 'self'`, no `unsafe-inline`/`unsafe-eval`) — this
   is the standard primary defense against the script-injection XSS that
   would actually be needed to read `localStorage` in the first place, so
   the realistic exposure is now much lower even with the token itself
   still sitting in `localStorage`.
3. ~~No rate limiting~~ — **fixed**: per-user token-bucket limiter on mutations
   plus a per-user SSE connection cap (`middleware/ratelimit.go`), live-verified.
4. Photo URLs are restricted to `http(s)://` only at the API layer
   (`services/menu.go` `validateAndNormalize`) — this was already true, not
   new this session. **Tightened further (2026-07-15)** via the new CSP's
   `img-src`, which only allows `'self'`, `blob:` (the local pre-upload
   preview), and `https://res.cloudinary.com` — an arbitrary external image
   URL a shopkeeper might set by hand (bypassing the UI, which only ever
   sets `photo_url` via the Cloudinary upload flow) will no longer actually
   load in the browser even though the API itself still accepts any
   http(s) URL as a value. Not tightened at the API layer itself this
   session — see the CSP comment in `middleware/security.go` for why (risk
   of quietly breaking a legitimate future use case without a product
   decision first).
5. ~~No CSP set~~ — **fixed (2026-07-15)**: `Content-Security-Policy` set in
   both `middleware/security.go` (Gin, defense in depth for API responses)
   and `deploy/Caddyfile` (the one that actually matters — Caddy serves the
   frontend's HTML/JS in production, not the Go backend). Scoped to what the
   code actually calls: Firebase Google sign-in (`*.firebaseapp.com`,
   `*.googleapis.com`), Cloudinary upload + photo hosting
   (`api.cloudinary.com`, `res.cloudinary.com`), Google profile photos
   (`*.googleusercontent.com`). Confirmed the production Vite build has zero
   inline `<script>` tags (so `script-src 'self'` with no `unsafe-inline`
   doesn't break anything) and confirmed via `caddy adapt` that the
   Caddyfile syntax is valid. **NOT YET live-verified against a real
   Firebase Google sign-in + Cloudinary upload** — this dev environment
   can't drive that OAuth popup end-to-end (`AUTH_FAKE` bypasses Firebase
   entirely). A CSP violation on those paths fails silently from the user's
   perspective (login or photo upload just stops working) — check the
   browser console for "Refused to ..." errors the first time this runs
   against real Firebase/Cloudinary, before fully trusting it.
6. **An already-open SSE stream survives shopkeeper de-provisioning**
   (noted 2026-07-19 third-pass review). REST auth re-reads the role from
   the DB on every request, so a removed shopkeeper is locked out of all
   *actions* immediately — but their existing `/api/shop/stream` connection
   was authorized at connect time and keeps delivering shop events
   (order/prep/menu broadcasts, read-only) until it next drops and fails to
   re-mint a ticket. Accepted as-is: exposure is read-only event metadata,
   the population is a hand-picked allowlist, and any reconnect (network
   blip, R21 drop, server restart) ends it. If it ever matters, the hook is
   easy: close the user's hub clients when their role/allowlist entry
   changes.

Also this session: Gin now runs in `ReleaseMode` when `APP_ENV=production`
(previously always defaulted to debug mode, which Gin's own startup banner
warns against in production — `cmd/server/main.go`), and
`SetTrustedProxies(nil)` is set explicitly (`internal/routes/routes.go`) —
harmless here since no code path ever reads client IP (rate limiting is
per-authenticated-user, not per-IP), but silences Gin's warning and makes
that non-use explicit rather than accidental.

Already correct, do not change: Firebase token verification pinned to RS256
(`authn/firebase.go` checks the signing method explicitly); CORS pinned to
`FRONTEND_ORIGIN` (no wildcard). **Correction (2026-07-18 review):** the app
JWT is *not* actually alg-pinned in code — `services/auth.go` `ParseToken`
has no `jwt.WithValidMethods` (not practically exploitable, but see § 9 R10
for the one-line fix that makes this claim true).
