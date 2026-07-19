# Khaao — Project Status

> **For the next agent:** read this top-to-bottom before touching code. It's the
> single source of truth for current state, architecture, and what's left. Full
> history of *how* we got here lives in `git log` (every change is committed with
> a descriptive message) — this file only tracks the *current* picture, not a
> session-by-session diary.

## Current state (2026-07-19)

**2026-07-19: the entire R1–R24 review backlog from 2026-07-18 is
implemented, verified, and now fully committed** (C-1 done). The R12–R24
batch (32 files, ~3.6k insertions) that was sitting uncommitted went in as
10 logical commits — `git log --oneline` from `08be195` through `b47e7a6`
— split by R-item/coherent group (backend service-layer commits separated
from frontend UI/tooling commits, signature-changing refactors like R14
kept buildable at each commit). One extra fix not in the original R-list
rode along: a TOCTOU race in the R8 menu-response cache (a read that
started before a concurrent `invalidateCache()` could clobber it on
write-back, serving pre-mutation data for a full TTL) — `08be195`, found
during this session's review of the batch, not part of R1–R24.

Re-verified clean 2026-07-19 on the now-committed tree (not just the old
working copy): `go build ./... && go vet ./... && go test ./... -race` ✓ ·
`golangci-lint run` 0 issues ✓ · `npx tsc -b --noEmit` ✓ ·
`npm run lint` 0 errors ✓ · `npm test` 45/45 ✓ · `npm run build` ✓
(index 247 KB raw, Firebase 155 KB lazy — unchanged from pre-commit).

A same-day review of the batch (before it was committed) found a small
number of new follow-ups (§ 9: R25–R27) — none are launch blockers on the
scale of the original P0s. **R25 is the next task.** After that, what's
left is the Deployment milestone (D-1..D-7).

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

## 9. What's LEFT (2026-07-19, next agent starts here)

> Work the table top-to-bottom, commit each item separately, run the § 6
> verification suite before every commit. This app is **mobile-only for
> students** (phone PWA) and mobile-first for the shopkeeper; desktop is the
> lowest priority — evaluate every change on a 375px viewport first, and
> follow § 9.1 (mobile design rules) for anything that touches the frontend.

C-1 (commit the R12–R24 batch) is **done** — see Current state above for
the commit range. Start at R25.

### Backlog

| # | Priority | What | Detail |
|---|---|---|---|
| R25 | **P1** | **`isError` hides cached data on failed background refetch** | All six data pages (`student/Menu.tsx:242`, `student/OrderStatus.tsx:288`, `shop/Orders.tsx:359`, `shop/Prep.tsx:72`, `shop/History.tsx:45`, `shop/MenuManage.tsx:515`) do `if (query.isError) return <EmptyState …>`. TanStack Query sets `isError` after a failed **background refetch** too, while `query.data` still holds the last good response — so on flaky campus Wi-Fi (the exact scenario R3/R17 target) a perfectly renderable cached screen gets replaced by "Couldn't load". Fix: gate the error UI on `query.isError && query.data === undefined`; with cached data, render it (the R17 offline banner already communicates the degraded state). Add a vitest for the Menu case (cached data + refetch failure → menu still rendered). This completes R17's "let TanStack keep showing the last cached menu — verify" step, which the batch asserted but didn't actually verify. |
| R26 | **P3** | **Finish the Prettier adoption** | `.prettierrc.json`/`.prettierignore` and the `format`/`format:check` scripts exist, but `npm run format:check` currently fails on **27 files** (never ran `--write`) and CI doesn't enforce it — a half-adopted formatter is drift waiting to happen. Run `npm run format`, eyeball the diff (formatting only), commit it separately from everything else, then add `npm run format:check` to the frontend CI job. |
| R27 | **P3** | **`ConfirmDialog`'s `busy` prop is dead at every call site** | Every `onConfirm` handler does `setConfirming(false); mutation.mutate()` — the dialog is gone before `isPending` can ever render, so `busy={mutation.isPending}` never shows. Either keep the dialog open until the mutation settles (close in `onSuccess`/`onError`, letting `busy` disable double-taps) or drop the prop. Cosmetic; failures already surface via toast. |

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

### Deployment (deferred milestone — needs real infra, not just code)

**Artifacts ready and committed:** `deploy/Caddyfile` (tool-validated with `caddy validate`), `deploy/khaao-backend.service`, `deploy/RUNBOOK.md` — a config-and-runbook head start for D-3 through D-6 below. Still needs a human with actual server/domain/dashboard access to execute.

| # | What | Notes |
|---|---|---|
| D-1 | **Provision managed Postgres** | Supabase/Neon/Railway/cloud provider. Daily backups, test a restore. Confirm `citext` extension available. |
| D-2 | **Firebase setup** | Enable Google sign-in → **add authorized domains** (the #1 launch gotcha — sign-in silently fails on an unauthorized domain). |
| ~~D-3~~ | ~~Cloudinary account check~~ | **Done (2026-07-15).** Live-verified via a direct signed-upload test against Cloudinary's API. Current `backend/.env` (cloud `r2avfle3`) is a working Programmable Media account. |
| D-4 | **Deploy backend** | One instance (replicas=1 enforced). Raise `ulimit -n`. Caddy/nginx in front, `proxy_buffering off` on `/api/stream`, long read timeout for SSE. |
| D-5 | **Deploy frontend** | Static host (Netlify/Vercel/Cloudflare Pages), `VITE_FIREBASE_*` set at build time. |
| D-6 | **End-to-end production verification** | One real student + one real shopkeeper account complete a full order lifecycle on production. **Must include real-device checks from the § 9 review:** (R4) Google sign-in *inside* the installed PWA on iOS and Android — not just in the browser tab; (R5) the "ready" moment on a locked/backgrounded phone (push arrives, notification shows); CSP console check per § 11.5 (no "Refused to …" errors during login or photo upload). |
| D-7 | **Runbook** | How to: rotate `JWT_SECRET`, add/remove a shopkeeper, restore a backup, check logs. |

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
