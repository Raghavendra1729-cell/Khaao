# Khaao — Master Project Status

> **For the next agent:** This is the single source of truth. Read this top-to-bottom before touching any code. It contains the full why, what, how, what's done, what's next, and everything a new agent needs to pick up exactly where we left off.

Last updated: **2026-07-13**. All changes verified: `go build ./...` ✓ · `go vet ./...` ✓ · `go test ./...` ✓ · `tsc --noEmit` ✓

---

## 1. What is Khaao?

A **mobile-first installable PWA** for a single college canteen. Students sign in with their college Google account, build a cart, place one order at a time, and track it live. The shopkeeper/chef accepts orders, cooks to aggregate demand, hands items over one-by-one, and collects payment. No in-app payments, no OTP, no multi-canteen.

**Scale target:** ~2000 students, single college. Lunch/break rush = bursts of orders + ~1–2k long-lived SSE connections. Sustainably served by **one Go instance** (see §3 — topology decision).

---

## 2. Stack (v3, current — do not change without updating this doc)

| Layer | Details |
|---|---|
| **Backend** | Go 1.23 · Gin · GORM · **PostgreSQL only** (SQLite removed in v3) |
| **Architecture** | Layered SOLID: `controllers → services → repositories` with `authn`, `realtime`, `config`, `database` packages. Composition root in `cmd/server/main.go`. |
| **Auth** | Firebase Google sign-in only. Backend verifies Firebase ID tokens against Google's public certs (no Admin SDK, golang-jwt). Issues its own HS256 Khaao JWT. Role re-read from DB on every request — removing someone from the allowlist locks them out immediately. `FakeVerifier` for dev/e2e (disabled in production). |
| **Real-time** | Server-Sent Events. In-memory `realtime.Hub` in `internal/realtime/hub.go`. Students get `order_update` + `menu_update`. Shop gets `orders_update` + `prep_update` + `menu_update`. |
| **Frontend** | React 18 · TypeScript · Vite · Tailwind CSS 3.4 · TanStack Query · react-router · Firebase JS SDK · installable PWA (vite-plugin-pwa) |
| **Topology** | **ONE backend instance** (vertically scaled) behind a TLS reverse proxy (Caddy/nginx). This is an explicit, enforced constraint — see §3. |

---

## 3. Topology decision — why ONE instance (important for any new work)

This is a deliberate architectural choice, not an oversight. **Do not add Redis, distributed locks, or a distributed SSE transport.**

**Reasoning:**
- A single college canteen lunch rush = ~500–1000 orders in 30–60 min, ~1–2k concurrent SSE connections. Go handles this trivially on 2–4 vCPU.
- `PoolEngine.mu` (`sync.Mutex`) is correct and fast in one process. Each mutation is a single short DB transaction (single-digit ms). Even at 20 mutations/sec, queueing is imperceptible.
- Scaling out would require distributed locking (Postgres advisory locks) **and** distributed SSE (Redis/LISTEN NOTIFY) — weeks of work and new failure modes for a single canteen that will never need it.
- The DB is the ultimate arbiter: `SELECT … FOR UPDATE` is already in place inside every mutation transaction (see §4 — WP5 done), so a second instance would serialize correctly rather than corrupt data. But run one.

```
Students' phones (PWA)           Shopkeeper/Chef tablet
         │  HTTPS + SSE                    │
         ▼                                 ▼
┌────────────────────────────────────────────────────┐
│  Reverse proxy / TLS (Caddy or nginx)               │
│  • proxy_buffering off for /api/stream (SSE)        │
│  • long read timeout on SSE, short elsewhere        │
│  • gzip, security headers, HTTP/2                   │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│  ONE Go backend instance (2–4 vCPU, 1–2 GB RAM)    │
│  • in-process sync.Mutex  → correct, no dist. lock  │
│  • in-memory SSE hub      → correct, single process │
│  • ulimit nofile raised (each SSE = 1 fd)           │
│  • http.Server timeouts + body caps                 │
│  • SetMaxOpenConns(25) on sql.DB                    │
└────────────────────────────────────────────────────┘
         │  pooled conns
         ▼
┌────────────────────────────────────────────────────┐
│  Managed Postgres 15+ (citext ext, daily backups)   │
│  • SELECT … FOR UPDATE inside each mutation tx      │
│  • partial unique index + CHECK constraints         │
└────────────────────────────────────────────────────┘
```

---

## 4. Key workflows (for understanding state machine changes)

### Student
Login → Browse menu → Build cart → Place order (one active at a time) → Track live (SSE: Waiting → Cooking → Ready → Pay → Done) → Ready: chime + vibrate + browser notification → Pay at counter.

### Shopkeeper
Morning: update menu + set stock/availability. Triage incoming: Accept (can uncheck individual items to trim them) / Reject. Accepted orders enter the Prep pool. Hand over ready items ("Give 1" / "Give all N"). Remove item from an accepted order (prepared units return to pool → FCFS re-allocate). Collect payment. Close day (expire open orders, clear pool, reset stock).

### Chef / Prep screen
Sees aggregate remaining demand per menu item. Taps "+1 Done" per finished unit → unit enters the pool → FCFS allocated to the oldest waiting order for that item.

### State machines
```
Order:  submitted → preparing → partially_ready → ready
                             ↘ awaiting_payment → completed
        branch: submitted → cancelled (student)
        branch: submitted → rejected (shopkeeper)
        branch: ready → expired (15-min hold if nothing handed)

Item:   pending → queued → allocated → handed_over
        branch: rejected
```

Status is derived by a **pure `recomputeStatus` function** after every mutation. Prices are integers in **paise**. Daily order tokens reset per `BUSINESS_TIMEZONE` (default `Asia/Kolkata`).

---

## 5. Codebase map (where things live)

```
backend/
  cmd/server/main.go              → composition root, server lifecycle, expiry ticker
  internal/
    config/config.go              → fail-closed config: refuses production boot with dev defaults
    config/config_test.go         → table tests for every validation rule
    authn/authn.go                → TokenVerifier interface
    authn/firebase.go             → Firebase RS256 token verification (no Admin SDK)
    authn/fake.go                 → FakeVerifier for dev/e2e (AUTH_FAKE=true only)
    middleware/auth.go            → JWT bearer + ?token= parsing, RequireAuth, RequireRole
    middleware/cors.go            → CORS (single origin, set from FRONTEND_ORIGIN)
    middleware/security.go        → security headers (nosniff, X-Frame-Options, etc.)
    models/                       → GORM models with CHECK constraints + index tags
      user.go, menu_item.go, order.go, order_item.go,
      item_pool.go, order_event.go, shopkeeper_email.go
    database/database.go          → Open (GORM, citext, AutoMigrate, pool tuning), Seed
    repository/repository.go      → interfaces: UserRepo, MenuRepo, OrderRepo, PoolRepo, EventRepo, UnitOfWork
    repository/gorm.go            → GORM implementations of all interfaces
    realtime/hub.go               → in-memory SSE hub (fan-out by userID/role)
    services/
      errors.go                   → AppError (HTTP status + message), ErrBadRequest, ErrNotFound, ErrConflict, ErrInternal
      auth.go                     → AuthService: FirebaseLogin, GetUser, AuthConfig
      menu.go                     → MenuService: CRUD + stock toggle + delete safety
      orders.go                   → OrderService: ActiveOrder, OrderHistory, ShopOrders, ShopHistory
      pool.go                     → PoolEngine: CreateOrder, Accept, Reject, Cancel, Handover, Paid, MarkDone, RemoveItem, ExpiryTick, CloseDay, PrepList
      allocation.go               → FCFSAllocation (AllocationStrategy interface)
      auth_test.go                → auth domain/allowlist unit tests
      pool_test.go                → FCFS/status/recompute/RemoveItem/handover/paid unit tests
    controllers/
      auth.go                     → Firebase login, /auth/me, /auth/config + respondError helper
      menu.go                     → menu CRUD + stock endpoints
      orders.go                   → create/active/history/cancel/stream (SSE) endpoints
      shop.go                     → shop orders/history/accept/reject/handover/paid/remove/prep/closeday/stream
      health.go                   → GET /api/health (liveness probe, no auth)
    routes/routes.go              → Gin router setup, all routes + middleware

frontend/
  src/
    main.tsx                      → React root, QueryClient, BrowserRouter, providers
    App.tsx                       → Route tree (role-split: student vs shopkeeper)
    index.css                     → Tailwind + design tokens
    lib/
      firebase.ts                 → Firebase init + signInWithGoogle
      format.ts                   → formatPrice, formatTime, formatDateTime, formatCountdown, secondsUntil, rupeesToPaise, paiseToRupeesInput
      sound.ts                    → WebAudio beeps (no audio assets): playReadyChime, playIncomingAlert
    context/AuthContext.tsx       → AuthProvider + useAuth (loginWithGoogle, logout, isAuthenticated, user)
    hooks/useSSE.ts               → SSE hook with exponential backoff + MAX_RETRIES=8 cap
    api/
      types.ts                    → shared TypeScript types matching backend responses
      client.ts                   → apiFetch, getToken, getStoredUser, setAuthStorage, onUnauthorized
      auth.ts                     → fetchAuthConfig, loginWithFirebase, fetchMe, logout
      menu.ts                     → getMenu (student)
      orders.ts                   → createOrder, getActiveOrder, getOrderHistory, cancelOrder
      shop.ts                     → all shopkeeper API calls (menu, orders, history, prep, close-day)
    components/
      Layout.tsx                  → sticky header, bottom nav bar, badge counts, StudentRealtime/ShopRealtime mounted
      ProtectedRoute.tsx          → role gate (redirects to /login or back)
      StudentRealtime.tsx         → SSE handler: sets query cache, plays chime, browser notification, toasts
      ShopRealtime.tsx            → SSE handler: invalidates shop queries, plays incoming-order alert
      Button.tsx, Card.tsx, EmptyState.tsx, Spinner.tsx, Toast.tsx
      StatusBadge.tsx             → Badge, MenuStatusBadge, OrderStatusBadge, OrderItemStatusBadge
      OrderTicket.tsx             → daily token display
      QtyStepper.tsx              → +/- quantity control
    pages/
      Login.tsx                   → Google sign-in screen
      student/Menu.tsx            → menu browse + cart + checkout sheet + order submit
      student/OrderStatus.tsx     → active order timeline + item list + cancel + history
      shop/Orders.tsx             → 3-column kanban: Incoming / Cooking / Collect payment
      shop/Prep.tsx               → prep list with +1 Done tap targets
      shop/History.tsx            → date-filtered completed orders + total collected
      shop/MenuManage.tsx         → full menu CRUD + stock toggle + close-day

docs/
  SPEC.md                         → authoritative API contract + state machines
  01-flows.html                   → original flow diagrams (reference only)
  02-technical.html               → original technical brief (reference only)
scripts/
  smoke.sh                        → e2e smoke test script (boots server, tests full lifecycle)
```

---

## 6. Environment variables (copy `backend/.env.example` → `backend/.env`)

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `APP_ENV` | `dev` | `dev` / `test` / `production` — fail-closed validation runs only when `production` |
| `DATABASE_URL` | `postgres://...` | **Postgres only.** Must not be localhost URL in production. |
| `JWT_SECRET` | `dev-secret-change-me` | HS256 secret. **Must be ≥32 chars and not the default in production.** |
| `FIREBASE_PROJECT_ID` | *(empty)* | **Required in production.** Skip with `AUTH_FAKE=true` in dev. |
| `ALLOWED_EMAIL_DOMAIN` | `sst.scaler.com` | Students must have a Google account on this domain |
| `SHOPKEEPER_EMAILS` | *(empty)* | Comma-separated shopkeeper email allowlist, seeded to DB on boot |
| `AUTH_FAKE` | `false` | Dev/test only. Accepts `fake:<email>` tokens. **Rejected in production.** |
| `HOLD_MINUTES` | `15` | Minutes a fully-ready order holds before it expires |
| `BUSINESS_TIMEZONE` | `Asia/Kolkata` | IANA timezone for daily token reset, history dates, availability windows |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin. Must be `https://` in production. |
| `SEED_SAMPLE_MENU` | `true` | Seed ~6 sample items if menu table is empty on boot |

Frontend env (`frontend/.env.example` → `frontend/.env`):

| Var | Notes |
|---|---|
| `VITE_FIREBASE_API_KEY` | From Firebase console → Project settings → Web app |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Same as backend `FIREBASE_PROJECT_ID` |
| `VITE_FIREBASE_APP_ID` | From Firebase console |

---

## 7. API surface (base path `/api`)

All errors: `{"error": "message"}`. Auth: `Authorization: Bearer <token>` or `?token=` (SSE only).

**Public (no auth)**
- `GET /api/health` → `{"ok": true}` — liveness probe
- `GET /api/menu` → `{"items": [...]}` — student browseable menu
- `GET /api/auth/config` → `{"allowed_email_domain": "..."}`
- `POST /api/auth/firebase` `{id_token}` → `{token, user}`

**Authenticated**
- `GET /api/auth/me` → `{user}`

**Student** (authenticated + `role=student`)
- `POST /api/orders` `{items: [{menu_item_id, qty}]}` → `{order}`
- `GET /api/orders/active` → `{order}` or 404
- `GET /api/orders` → `{orders}` (history)
- `POST /api/orders/:id/cancel` → `{order}`
- `GET /api/stream` → SSE: `order_update`, `menu_update`

**Shopkeeper** (`/api/shop/*`, authenticated + `role=shopkeeper`)
- `GET /api/shop/menu` → all items incl. unavailable
- `POST /api/shop/menu` · `PUT /api/shop/menu/:id` · `DELETE /api/shop/menu/:id`
- `POST /api/shop/menu/:id/stock` `{out_of_stock}` → `{item}`
- `GET /api/shop/orders` → `{incoming, in_progress, awaiting_payment}`
- `GET /api/shop/history[?date=YYYY-MM-DD]` → `{orders, total_paid}`
- `POST /api/shop/orders/:id/accept` `{rejected_item_ids}` → `{order}`
- `POST /api/shop/orders/:id/reject` → `{order}`
- `DELETE /api/shop/orders/:id/items/:itemID` → `{order}` (trim + re-pool)
- `POST /api/shop/orders/:id/items/:itemID/handover` `{qty}` → `{order}`
- `POST /api/shop/orders/:id/paid` → `{order}`
- `GET /api/shop/prep` → `{items: [{menu_item_id, name, remaining_qty, pool_qty}]}`
- `POST /api/shop/prep/:menu_item_id/done` `{qty}` → triggers FCFS allocation
- `POST /api/shop/day/close` → expires open orders, clears pool
- `GET /api/shop/stream` → SSE: `orders_update`, `prep_update`, `menu_update`

---

## 8. What's DONE (all verified by build + tests + manual smoke)

### Core product — complete end-to-end
- [x] Firebase Google auth, server-side token verification (no Admin SDK), DB-allowlist shopkeepers, domain-gated students, Khaao JWT, DB-role-per-request
- [x] Full order lifecycle: cart → order → accept/reject/trim → Prep pool → FCFS allocation → per-item handover → awaiting_payment → paid
- [x] One active order per student enforced in code + partial unique index `uniq_active_order_per_user`
- [x] Menu CRUD + one-tap stock toggle; daily order tokens; order history; shopkeeper "collected today" total
- [x] Real-time SSE: student order updates, shop order/prep/menu updates, ready-chime + vibration + browser notification, new-order beep (WebAudio, no audio files)
- [x] Mobile-first installable PWA (service worker, offline shell, `/api` NetworkOnly)
- [x] All 6 test suites pass (`go test ./... -race`)

### Hardening pass (2026-07-13, first session) — all verified
- [x] **Fail-closed config** (`config/config.go`): in production, server refuses to boot if `JWT_SECRET` is default, `DATABASE_URL` is localhost, `FIREBASE_PROJECT_ID` is empty, `FRONTEND_ORIGIN` is non-https, or `APP_ENV` is unknown. `AUTH_FAKE` is dev/test only.
- [x] **`BUSINESS_TIMEZONE`** — all time operations use the configured timezone (daily token reset, availability windows, history dates, order expiry). Host timezone no longer matters.
- [x] **Role separation**: `RequireRole(student)` guards student routes; `RequireRole(shopkeeper)` guards shop routes. A shopkeeper token cannot call student endpoints.
- [x] **FCFS determinism**: `created_at ASC, id ASC` stable tiebreak at both orders and items level.
- [x] **Server hardening** (`middleware/security.go`, `main.go`): `ReadHeaderTimeout`, `ReadTimeout`, `IdleTimeout`, `MaxHeaderBytes`, 1 MiB body cap via `MaxBytesReader`; security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- [x] **Post-accept item trim + re-pool** (`DELETE /api/shop/orders/:id/items/:itemID`): shopkeeper removes an item from an accepted order; unhanded prepared units return to the pool; FCFS re-allocates to the next waiting order; total/status recompute; refuses if student has started collecting (409). Full unit test coverage + smoke.
- [x] **DB-level concurrency** (WP5): `SELECT … FOR UPDATE` on order/items/pool inside every mutation transaction, Postgres advisory lock for multi-process safety; `order_no` retry-once on unique violation; active-order check inside tx mapped to 409.
- [x] **Shop history `?date=` param** now correctly applied in business timezone.
- [x] **Frontend UX**: notification permission requested on order submit; vibrate on ready; "Give all N" handover; checkout sheet closes on backdrop tap; ready banner shows live countdown (not hardcoded "15 min"); token notifications use `order_no` not internal `id`.
- [x] **`MarkDone` validation**: menu item must exist; `qty` must be ≥1 and ≤ a sane upper bound.

### Cleanup pass (2026-07-13, second session)
- [x] Removed `backend/khaao.db` (SQLite leftover in a Postgres-only repo)
- [x] Removed `.DS_Store`
- [x] Fixed duplicate `useNavigate` import in `Menu.tsx` (was imported twice)
- [x] Fixed all toast/notification messages to use `order.order_no` (daily token) instead of `order.id` (DB primary key)
- [x] Removed trailing blank line in `services/orders.go`
- [x] Rewrote `backend/README.md` to match v3 stack (Postgres-only, Firebase auth, correct env vars and all current routes)

### Correctness + hardening pass (2026-07-13, third session)
- [x] **SSE retry bounding** (`hooks/useSSE.ts`): after `MAX_RETRIES=8` consecutive failures (~2 min of exponential backoff), stops reconnecting and dispatches `khaao:unauthorized` to force a re-login. Prevents infinite loops on expired/revoked tokens.
- [x] **`broadcast()` error logging** (`services/pool.go`): was silently swallowing DB errors with `_`; now logs them with `log.Printf` and returns early.
- [x] **Server-side menu validation strengthened** (`services/menu.go`): name max 100 chars, price must be > 0 (not ≥ 0), photo URL must be `http://` or `https://`, and both `avail_from`+`avail_to` are required together or both empty (was frontend-only before).
- [x] **Menu delete safety** (`services/menu.go` + `repository/gorm.go` + `repository/repository.go`): `DELETE /shop/menu/:id` returns 409 Conflict if any active (non-terminal) order has a non-rejected item for that menu item. Prevents orphaned `order_items`.
- [x] **Health endpoint** (`controllers/health.go`): `GET /api/health` → `{"ok": true}`, unauthenticated, suitable for reverse-proxy/k8s liveness probes.
- [x] **DB connection pool tuned** (`database/database.go`): `SetMaxOpenConns(25)`, `SetMaxIdleConns(5)`, `SetConnMaxLifetime(1h)`. Caps concurrent Postgres connections well within default `max_connections=100`.

---

## 9. What's LEFT — priority order (next agent starts here)

> Legend: **P0** = blocks 2000-student launch · **P1** = correctness/security before real use · **P2** = reliability/ops · **Deploy** = deployment milestone

### P0 — must do before real deployment

| # | What | Where | Notes |
|---|---|---|---|
| WP4 | **Versioned SQL migrations** | `database/database.go`, new `migrations/` dir | Replace AutoMigrate with golang-migrate. Add explicit FKs with `ON DELETE` semantics, CHECK constraints for every status enum, all indexes. Verify schema in CI. AutoMigrate is fine for dev but not for production schema evolution. |

### P1 — correctness + security (before real student use)

| # | What | Where | Notes |
|---|---|---|---|
| P1-a | **Dedupe `menu_item_id` in `CreateOrder`** | `services/pool.go` `CreateOrder` | A student can submit duplicate lines (same item twice), bypassing the per-line qty cap. Check for duplicate `MenuItemID` in input and return 400. |
| P1-b | **Session/token security** | `hooks/useSSE.ts`, `api/client.ts`, `middleware/auth.go` | SSE JWT is in the query string (visible in proxy logs, browser history). Options: (a) mint a short-lived one-use SSE ticket, (b) use an HttpOnly cookie. localStorage is XSS-exfiltratable for a 7-day token — consider `sessionStorage` + silent refresh, or full cookie-based sessions. |
| P1-c | **Rate limiting** | `routes/routes.go` or new middleware | Per-user/per-token rate limits on mutations (NOT per-IP — 2000 students share campus NAT). SSE connection cap per user (prevent one user holding 100 connections). |
| P1-d | **Reject-with-stock-out** | `services/pool.go` `Reject`, `services/menu.go` | When the shopkeeper rejects an order because an item is out of stock, optionally mark that item as `out_of_stock=true` on the menu. Currently reject just rejects the order. Decide policy and implement. |
| P1-e | **`avail_from` < `avail_to` validation** | `services/menu.go` `validateAndNormalize` | Currently validates format (HH:MM) and both-or-neither, but doesn't check that `avail_from` < `avail_to`. An overnight window (22:00–06:00) also needs thought. |

### P2 — reliability + ops

| # | What | Where | Notes |
|---|---|---|---|
| P2-a | **Structured logs + metrics** | throughout | Replace `log.Printf` with `slog` (stdlib, Go 1.21+). Add request-level structured logging in middleware. Metrics/alerts for: auth failures, tx conflicts, pool anomalies, order-state transition failures. |
| P2-b | **`CloseDay` safety** | `services/pool.go` `CloseDay` | Highly destructive — no confirmation token, no idempotency, no audit actor. Add: explicit confirmation param, idempotency key, log who closed the day and when, define policy for partially-handed orders. |
| P2-c | **Postgres integration tests + CI** | `*_integration_test.go` | Current tests are all unit mocks. Need tests that run against a real Postgres (disposable, e.g. via `ory/dockertest`). Test: unique constraint, FK enforcement, concurrent order creates, expiry tick, re-pool. Run `go test -race ./...` in CI. |
| P2-d | **Load test** | `scripts/` | k6 load test: 2000 concurrent SSE connections + burst of order creates. Measure p95 latency, mutex queue depth, fd usage, Postgres connection count. Tune instance size and pool. |
| P2-e | **SSE outbox / replay** | `realtime/hub.go`, new outbox | Currently: if the process restarts between a DB commit and the SSE broadcast, the client misses the event. Clients refetch on reconnect (TanStack Query), which limits damage. For production: either document the refetch guarantee explicitly, or implement a lightweight Postgres LISTEN/NOTIFY outbox. |

### Deployment (deferred milestone)

| # | What | Notes |
|---|---|---|
| D-1 | **Provision managed Postgres** | Supabase / Neon / Railway / cloud provider. Turn on daily backups, test restore. Confirm `citext` extension is available. |
| D-2 | **Firebase setup** | Create project → enable Google sign-in → **add authorized domains** (this is the #1 launch gotcha — sign-in popups fail on unauthorized domains) → copy 4 `VITE_FIREBASE_*` values + `FIREBASE_PROJECT_ID`. |
| D-3 | **Deploy backend** | One instance (replicas=1 enforced). Raise `ulimit -n`. Set all env vars. Put Caddy/nginx in front with `proxy_buffering off` on `/api/stream`, long read timeout for SSE, short elsewhere. |
| D-4 | **Deploy frontend** | Static host (Netlify/Vercel/Cloudflare Pages). Set 4 `VITE_FIREBASE_*` at build time. Point `VITE_API_URL` at backend. |
| D-5 | **End-to-end verification** | One real `@sst.scaler.com` student + one real shopkeeper email must successfully log in, place an order, and complete the full lifecycle on production. |
| D-6 | **Runbook** | How to: close the day, rotate `JWT_SECRET`, add a shopkeeper, restore a backup, check logs. |

---

## 10. Keys and secrets needed (6 total — never commit)

| Secret | Used by | How to get |
|---|---|---|
| `FIREBASE_PROJECT_ID` | backend | Firebase console → ⚙ Project settings → **Project ID** |
| `VITE_FIREBASE_API_KEY` | frontend | Firebase console → Project settings → Your apps → Web app → SDK config |
| `VITE_FIREBASE_AUTH_DOMAIN` | frontend | `<project>.firebaseapp.com` (from same SDK config) |
| `VITE_FIREBASE_PROJECT_ID` | frontend | Same as backend `FIREBASE_PROJECT_ID` |
| `VITE_FIREBASE_APP_ID` | frontend | From same SDK config |
| `JWT_SECRET` | backend | `openssl rand -base64 48` — rotate = invalidates all sessions |
| `DATABASE_URL` | backend | `postgres://user:pass@host:5432/khaao?sslmode=require` |
| `SHOPKEEPER_EMAILS` | backend | Actual Google emails of shopkeeper(s), comma-separated |

**Firebase "Authorized domains" is the #1 launch gotcha** — the sign-in popup will silently fail if your production domain isn't listed. Go to: Firebase console → Authentication → Settings → Authorized domains → Add your domain.

---

## 11. How to run locally

```bash
# 1. Create Postgres DB
createdb khaao

# 2. Copy env files and fill in Firebase values
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit both files

# 3. Run backend (port 8080, auto-migrates schema, seeds sample menu)
cd backend && go run ./cmd/server

# 4. Run frontend (port 5173, proxies /api to backend)
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. Install as PWA from the browser address bar.

**Testing without Firebase** (dev only): Set `AUTH_FAKE=true` in `backend/.env`. Then `POST /api/auth/firebase` accepts `{"id_token": "fake:someone@sst.scaler.com:Name"}`. The UI always uses the real Google popup.

---

## 12. Verification commands (run before every merge)

```bash
# Backend
cd backend
go build ./...        # must be clean
go vet ./...          # must be clean
go test ./... -race   # all pass

# Frontend
cd frontend
npx tsc --noEmit      # 0 errors
npm run build         # must succeed (for PWA asset check)
```

---

## 13. Security considerations (known gaps, do not forget)

1. **SSE token in query string** — visible in proxy/server logs and browser history. See P1-b above.
2. **`localStorage` JWT** — exfiltratable via XSS. See P1-b above.
3. **No rate limiting** — a determined user can flood order-creates or hold many SSE connections. See P1-c above.
4. **Photo URLs are unrestricted** — shopkeeper can set any URL. React prevents HTML injection but arbitrary remote URLs create tracking/content risks. Consider allowing only specific image hosts or a server-side upload pipeline.
5. **Firebase token pinned to RS256, app JWT pinned to HS256** — already enforced in `authn/firebase.go` and `middleware/auth.go`. Do not change.
6. **CORS** — origin is pinned to `FRONTEND_ORIGIN`. No wildcard. Correct.
7. **CSP** — not set. Set at the reverse proxy level or as a Gin middleware before launch.

---

## 14. What the next agent should work on first

Pick from §9 in priority order. The most impactful next items are:

1. **P1-a** — dedupe `menu_item_id` in `CreateOrder` (small, correctness, ~15 lines in `pool.go`)
2. **P1-c** — rate limiting middleware (per-user, NAT-aware — medium effort)
3. **P2-a** — structured logging with `slog` (good foundation for everything else)
4. **WP4** — versioned SQL migrations (high effort, but important for production schema safety)
5. **P2-c** — Postgres integration tests (important for confidence before real use)

All changes must:
- Keep `go build ./...`, `go vet ./...`, `go test ./...` clean
- Not touch topology (no Redis, no distributed locks, no multiple instances)
- Not change the API contract in `docs/SPEC.md` without documenting the change here
- Update §8 (done) and §9 (left) in this file after completing each item
