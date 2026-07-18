# Khaao — Project Status

> **For the next agent:** read this top-to-bottom before touching code. It's the
> single source of truth for current state, architecture, and what's left. Full
> history of *how* we got here lives in `git log` (every change is committed with
> a descriptive message) — this file only tracks the *current* picture, not a
> session-by-session diary.

## Current state (2026-07-18)

**2026-07-18: a full code review (backend + frontend + mobile-first audit) was
performed and § 9 now contains a fresh, prioritized backlog derived from it.**
The app is feature-complete and all backend tests pass (`go build ./... && go
vet ./... && go test ./... -race` verified clean 2026-07-18), but the review
found real launch-affecting gaps — especially around mobile robustness
(§ 9 P0) — that should be fixed before the Deployment milestone.

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
- All backend unit tests pass (`go test ./... -race`); `scripts/smoke.sh`
  covers the full golden-path lifecycle live against Postgres

---

## 9. What's LEFT — review-driven backlog (2026-07-18, next agent starts here)

> Legend: **P0** = fix before launch (breaks the core mobile experience) ·
> **P1** = fix before real 2000-student use · **P2** = quality/reliability ·
> **P3** = tooling/process · **Deploy** = deployment milestone
>
> Source: full code review 2026-07-18 (backend + frontend + mobile-first
> audit). Every item below carries file references and a verification step —
> work them top-to-bottom, commit each one separately, and run the § 6
> verification suite before every commit. This app is **mobile-only for
> students** (phone PWA) and mobile-first for the shopkeeper; desktop is the
> lowest priority — evaluate every fix on a 375px viewport first.

### P0 — launch blockers (mobile robustness)

| # | What | Detail |
|---|---|---|
| R1 | **Add a root React error boundary** | There is no ErrorBoundary anywhere (`grep -rn ErrorBoundary frontend/src` → nothing). Any render-time throw = permanent white screen — fatal in an installed PWA where there's no browser chrome to refresh with. Add a small class-component boundary around `<App />` in `frontend/src/main.tsx` with the app's paper/steel styling and a "Reload" button (`location.reload()`). Verify: throw inside a page component in dev, confirm the fallback renders instead of a blank screen. |
| R2 | **Cart checkout crash on deleted menu item** | `frontend/src/pages/student/Menu.tsx:384` — `items.find((i) => i.id === entry.menu_item_id)!` non-null-asserts. If a shopkeeper deletes/hides an item while it sits in a student's cart (menu refetches via SSE `menu_update`), `item` is `undefined` and `.name` throws → white screen (compounded by R1). Fix: derive `cartEntries` only from ids present in the current menu, silently drop stale lines (toast "Some items are no longer available and were removed from your cart"), and delete the `!`. Verify: add item to cart, delete it via the shop UI in a second session, open the cart sheet. |
| R3 | **SSE retry-exhaustion logs the user out on flaky networks** | `frontend/src/hooks/useSSE.ts` — after `MAX_RETRIES=8` consecutive failures (~75 s of bad connectivity: campus Wi-Fi dead zone, elevator, network switch) it dispatches `khaao:unauthorized`, bouncing a student with a perfectly valid token to the login screen. Only a **401 from the ticket mint** proves the session is dead — network errors (`ApiError` status 0) and `EventSource` errors must retry forever at the capped 15 s backoff instead of counting toward a logout. Keep a "reconnecting…" indicator out of scope. Verify: dev-tools offline mode for 3+ minutes → back online → stream reconnects, no logout. |
| R4 | **Google sign-in inside an installed PWA (esp. iOS)** | `frontend/src/lib/firebase.ts` uses `signInWithPopup` only. In standalone/installed mode (`display-mode: standalone`) popups are unreliable-to-broken, and on iOS the installed app has **separate storage from Safari**, so every iOS installer must log in *inside* the standalone app — exactly where the popup flow fails. Fix: detect standalone (`matchMedia('(display-mode: standalone)')` or `navigator.standalone`) and use `signInWithRedirect` + `getRedirectResult` there (handle the result in `Login.tsx` on mount); keep the popup elsewhere. Note D-2 (authorized domains) interacts with this. Verify: must be checked on a real phone during D-6 — add it to the D-6 checklist. |
| R5 | **"Order ready" is silent on iPhones** | For students, the ready moment relies on (a) `new Notification(...)` — the constructor is **not supported on iOS Safari** (only `registration.showNotification` from a SW is), (b) `navigator.vibrate` — doesn't exist on iOS, (c) a WebAudio chime whose `AudioContext` is created outside a user gesture (`frontend/src/lib/sound.ts`), which iOS keeps `suspended` — so an iOS student with the screen off gets *nothing*. Fixes, in value order: (1) extend Web Push to students — backend: send a push to the order's owner on the `ready` transition (`services/pool.go` recomputeStatus already knows `oldStatus != ready`; add a `PushService.NotifyOrderReady(userID, orderNo)` using the existing per-user subscriptions — `push_subscriptions` is already user-keyed) and surface the existing `PushNotificationSetup` prompt to students too (it's currently shop-only in `Layout.tsx`); (2) replace `new Notification` with `navigator.serviceWorker.ready.then(r => r.showNotification(...))`; (3) unlock audio on first touch: one-time `pointerdown` listener that creates/resumes the shared AudioContext. Verify: real-device check in D-6 (Android Chrome + iOS 16.4+ installed PWA). |

### P1 — before real 2000-student use

| # | What | Detail |
|---|---|---|
| R6 | **Cloudinary images served at original size** | `secure_url` is stored and rendered raw (`grep -rn cloudinary frontend/src` → only the upload call). A 4–8 MB phone photo is downloaded full-size into 48 px thumbnails by every student on mobile data, N items × every menu load. Fix: a `cloudinaryThumb(url, widthPx)` helper in `lib/format.ts` that injects `f_auto,q_auto,w_<2×display>` after `/upload/`, used at every `<img src={...photo_url}>` site (`MenuItemCard`, `TrendingRail`, `OrderStatus`, `Orders`, `OrderModal`); non-Cloudinary URLs pass through untouched. Also downscale before upload in `uploadMenuItemPhoto` (canvas, max edge ~1600 px, JPEG ~0.8) — campus uplink is the bottleneck. Verify: network tab shows transformed URLs and <100 KB thumbnails. |
| R7 | **Save-during-upload submits a `blob:` URL** | `frontend/src/pages/shop/MenuManage.tsx` `handlePhotoSelected` puts the local `blob:` preview into `form.photo_url`, and Save stays enabled while uploading — submitting then sends `blob:…` to the API (backend 400s it, but the shopkeeper just sees a confusing error). Keep the preview in separate state (never in the submitted field), disable Save while `uploadingPhoto`, and `URL.revokeObjectURL` the preview (currently leaked). Verify: pick a photo on a throttled network and hit Save immediately. |
| R8 | **Menu-refetch thundering herd at rush hour** | Every `menu_update` / `shop_status` SSE event is broadcast to *all* connected clients (`realtime/hub.go` `broadcastAll`), and each client immediately refetches `/api/menu` — which costs 3 queries (items + `SumOrderedQtyByDate` + `GetMenuAggregates`, `services/menu.go`). One stock toggle during rush = ~1–2 k simultaneous refetches ≈ 5–6 k queries in ~1 s. Fix server-side (client jitter alone is weaker): a tiny in-process cache of the `ListAvailable` response with ~3–5 s TTL, invalidated in `MenuService` mutations — same single-instance reasoning as the SSE hub, no Redis. The public `/api/menu` + `/api/shop-status` also have **no rate limiting at all** (GETs are exempt in `middleware/ratelimit.go`); the cache addresses the DB cost. Verify: `scripts/loadtest.js` k6 scenario with SSE-triggered refetch, watch query counts. |
| R9 | **Cart lost when the OS kills the PWA** | `frontend/src/pages/student/Menu.tsx` keeps the cart in `sessionStorage`, which dies with the process — building a cart, switching to WhatsApp, and returning after the OS reaps the app loses everything. Move to `localStorage` keyed with the business date (`khaao_cart_v2: {date, items}`), discard on a different day. Verify: kill and reopen the PWA mid-cart. |
| R10 | **Pin the app JWT's signing algorithm** | `backend/internal/services/auth.go` `ParseToken` has no `jwt.WithValidMethods([]string{"HS256"})` — § 11's "app JWT pinned to HS256" claim is currently *not true in code*. Not practically exploitable today (the []byte key is type-incompatible with RSA/ECDSA verification), but pinning is one line and makes the documented claim real. Add the option + a unit test that a token signed `alg: none`/`RS256` is rejected. |
| R11 | **Rune-unsafe tag truncation corrupts Hindi text** | `backend/internal/services/menu.go` `normalizeTags` does `t[:40]` on the raw string — byte slicing that can cut a UTF-8 rune in half (Hindi/Devanagari tags are 3 bytes per char), storing invalid UTF-8. Truncate by runes (`[]rune(t)[:40]`) or reject with a 400. Add a test with a Devanagari tag > 40 bytes. |
| R12 | **Backend broadcast storms hold the global engine lock** | `backend/internal/services/pool.go` — `MarkDone`, `Reject`, `RemoveItem` broadcast by reloading **every** in-progress order (`FindInProgress` + one `FindByID` per order inside `broadcast()`) while still holding `e.mu` (the deferred unlock). During rush with ~200 active orders, one "mark 1 samosa done" = ~200 sequential SELECTs serializing all other mutations behind it. The allocator already returns exactly the `touched` order IDs — broadcast only those (plus the acted-on order). Also fix the three ignored errors (`orders, _ := e.orderRepo.FindInProgress(ctx)` at ~pool.go:477, 756, 886) — log them at minimum. Verify: existing unit + integration suites stay green; add a unit test asserting broadcast count == touched count. |
| R13 | **Bound the student history payload** | `GET /api/orders` (`FindHistoryByUserID`, `backend/internal/repository/gorm.go`) has no LIMIT — a semester of orders (plus items, on a phone) in one response. Add `LIMIT 20` (newest first) now; real pagination only if a "see more" is ever asked for. Mirror a sensible cap on `FindTerminalByDate` if shop history grows. Update the frontend copy if it implies "all" history. |
| R14 | **Shop-status change races the order engine** | `backend/internal/services/shopstatus.go` `Set()` runs `CountAccepted` → `Save` → `RejectAllSubmitted` as three separate operations outside any transaction and without `PoolEngine.mu` — a concurrent `Accept` between check and save can leave the shop paused *with* an accepted order outstanding, the exact state the 409 guard exists to prevent. Wrap the check+save in `uow.WithTx` (the advisory lock in `WithTx` then serializes it against every engine mutation). Verify: integration test — concurrent Accept + Set(paused). |

### P2 — quality / reliability

| # | What | Detail |
|---|---|---|
| R15 | **Consolidate modals; drop `window.confirm`** | Three overlay implementations exist: `components/Modal.tsx` (portal, Esc, scroll-lock — the good one), the hand-rolled checkout sheet in `Menu.tsx`, and `RejectDialog` in `shop/Orders.tsx` (neither portaled, no Esc/scroll-lock). Plus 5 native `window.confirm` calls — `OrderModal.tsx` even chains two in a row for remove-item. Build a small `ConfirmDialog` on top of `Modal` (title, body, confirm variant, optional checkbox for "also mark out of stock") and migrate all five call sites + both hand-rolled overlays. Verify on 375px: focus, backdrop tap, background scroll locked. |
| R16 | **Duplicated FCFS reallocation loop in pool.go** | The "Allocate → FindByIDForUpdate → recomputeStatus → Save" block appears 5× (`Accept`, `Reject`, `RemoveItem`, `MarkDone`, `ExpiryTick`). Extract `(e *PoolEngine) reallocate(txCtx, menuItemID) ([]uint, error)`. Pure refactor — the full test suite is the safety net. Also fix the "canttenapp" typo comment while in there. |
| R17 | **Offline is a dead end** | SW precaches the shell, `/api` is NetworkOnly (correct for ordering), but offline the app renders generic "Network error" states everywhere. Add a lightweight `navigator.onLine`/fetch-failure banner ("You're offline — reconnecting…") in `Layout.tsx`, and let TanStack Query keep showing the last cached menu (it already does if `staleTime`/`gcTime` allow — verify, don't rebuild). |
| R18 | **Manifest locks orientation to portrait** | `frontend/vite.config.ts` manifest `orientation: 'portrait'` forces portrait even for the shopkeeper's counter **tablet** (a stated target, `Layout.tsx` comment). Remove the key (or `'any'`). |
| R19 | **Small frontend correctness papercuts** | (a) `PushNotificationSetup.tsx:31` reads `Notification.permission` without a `'Notification' in window` guard (StudentRealtime guards it; webviews without it would throw). (b) `InstallPrompt.tsx` iOS sniff misses iPadOS 13+ (reports as Mac); add `navigator.maxTouchPoints > 1 && /Mac/` to the check. (c) `MenuManage.tsx` uses `animate-in fade-in slide-in-from-bottom-2` — classes from the `tailwindcss-animate` plugin, which is **not installed** (`tailwind.config.js` plugins: []) — dead classes, no animation; use the existing `animate-slide-up` keyframe. (d) `Menu.tsx` `formatReopenTime` hardcodes `Asia/Kolkata`/`en-US` — use device-local formatting like `lib/format.ts` does. (e) Set `<html lang="hi">` while the shop UI is toggled to Hindi (screen readers), reset to `en` otherwise. (f) `khaao_rated_orders` in localStorage grows forever — cap it (keep last ~50 ids). |
| R20 | **Backend hygiene papercuts** | (a) `config.go` `devDefaultDatabaseURL` embeds a personal username (`lingaraghavendra`) — use `postgres://localhost:5432/khaao?sslmode=disable` and let libpq default the user, or read `$USER`. (b) `envOrInt`/`envOrBool` silently fall back on unparseable values — a typo'd `HOLD_MINUTES=1O` quietly becomes 15; fail closed (error at `Validate()`) and require `HoldMinutes > 0`. (c) `services/push.go` `send` uses webpush-go's default HTTP client (no timeout) — pass `Options.HTTPClient` with ~10 s timeout so a hung push endpoint can't strand goroutines. (d) `errors.go` exposes `ErrBadRequest` etc. as mutable package-level `var` function values — make them plain `func`s. (e) The GORM struct tags (constraints/indexes) are now dead weight next to the SQL migrations — document in `models/` that **migrations are the schema source of truth** so nobody edits a tag expecting a schema change. |
| R21 | **SSE hub silently drops events for slow consumers** | `realtime/hub.go` `send()` drops on a full 32-slot channel; the client only re-syncs on *reconnect* (`onOpen` invalidation), not on a drop, so a stale screen can persist until the next event. Cheap fix consistent with the topology: on drop, close the client's channel (forcing the stream handler to end → client reconnects → full refetch). Verify: unit test with a blocked reader. |

### P3 — tooling / process (do early; cheap, prevents regressions)

| # | What | Detail |
|---|---|---|
| R22 | **Frontend has no linter and no tests at all** | No ESLint config exists (a stray `eslint-disable-next-line` in `AuthContext.tsx` refers to a linter that isn't installed), no Prettier, no test runner, zero test files. Add: flat-config ESLint (`typescript-eslint` strict + `react-hooks` + `react-refresh`), Prettier, and Vitest + Testing Library. First tests where the review found risk: cart derivation incl. deleted-item case (R2), `useSSE` backoff/give-up logic (R3), `StudentRealtime` transition→notification decisions, `lib/format` money helpers. Wire `npm run lint` + `npm test` into `.github/workflows/ci.yml` frontend job. |
| R23 | **Backend has no linter beyond go vet** | Add `golangci-lint` (modest set: govet, staticcheck, errcheck, ineffassign, misspell) + CI step. `errcheck` alone would have caught the three ignored `FindInProgress` errors (R12). |
| R24 | **Bundle: one 456 KB JS chunk, Firebase for everyone** | `frontend/dist/assets/index-*.js` ≈ 456 KB raw — Firebase auth (used only at login) and all shop pages ship to every student on first load. `React.lazy` the shop pages and the student pages as route-group chunks, and dynamic-`import()` `lib/firebase.ts` inside the login action so the SDK loads only when someone actually signs in. Target: initial student chunk < ~200 KB raw. Verify: `npm run build` chunk report + the app still logs in (popup *and* R4's redirect path). |

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
