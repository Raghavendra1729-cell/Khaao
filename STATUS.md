# Khaao — Project Status

> **For the next agent:** read this top-to-bottom before touching code. It is
> the single source of truth for current state, architecture, and what's left.
> The full history of *how* we got here lives in `git log` — every committed
> change has a descriptive message. This file tracks the *current picture and
> the open work*, not a session-by-session diary.
>
> **§ 12 is the working protocol.** Read it before you pick up a task.

## Current state (2026-07-26)

**The working tree is clean and everything previously planned is committed.**
R1–R31, F1–F24, the G-series, the T-series (2026-07-22 audit) and the U-series
(2026-07-25 audit) all landed. Verified baseline as of this rewrite:

| Gate | Result |
|---|---|
| `go build ./...` | clean |
| `go vet ./...` | clean |
| `gofmt -l .` | clean |
| `go test ./...` | all packages ok |
| `tsc -b --noEmit` | clean |
| `vitest run` | **78/78 passing**, 13 test files |
| `vite build` initial student JS | **239.57 KB raw — under the 250 KB hard stop, after H2 (§ 9.1.8)** |

**This document was rewritten on 2026-07-26** after a fresh full-stack audit.
The historical narrative of completed passes was removed (it lives in `git log`);
what replaces it is three new backlogs of open, unstarted work:

| Backlog | What | Size | Status |
|---|---|---|---|
| **§ 9.3 — V-series (V1–V10)** | Backend defects found in the 2026-07-26 audit | 10 tasks | **Done, gate green, uncommitted at time of writing** |
| **§ 9.4 — H-series (H1–H8)** | Frontend design + UX work | 8 tasks | **H2 done; H1/H3–H8 open, unstarted, authorized** |
| **§ 9.5 — Q-series (Q1–Q9)** | Testing, written as real student / real shopkeeper scenarios | 9 tasks | **Q1, Q2 done; Q3–Q9 open, unstarted, authorized** |
| § 9.6 — B-series (B1–B15) | Deferred product decisions | 15 items | **NOT authorized — owner picks deliberately** |
| Deployment D-1..D-7 | Human-led, needs real infra | 7 items | Open |

> **Numbering note:** older commit messages reference "§ 9.5 (T-series)" and
> "§ 9.6 (U-series)". Those backlogs are complete and were removed in this
> rewrite; § 9.3/9.4/9.5 now hold the *new* V/H/Q backlogs. When reading old
> commits, map T→ 2026-07-22 audit and U→ 2026-07-25 audit and go to `git log`.

### Start here

**2026-07-26 update: H2, all of V1–V10, and Q1/Q2 are implemented**, each with
a regression test written first and confirmed red against the unfixed code,
full backend/frontend gates green (build/vet/gofmt/`test -race`/lint/tsc/
eslint/vitest/build/format, plus the Postgres integration suite). Landed as
four parallel agent passes, re-verified together afterward. **Uncommitted at
the time of this note** — see the commits immediately following it in `git
log` for the actual landing.

Remaining, in priority order:

1. **H1** (the counter's cash moment) is now unblocked — H2 landed, so H1 can
   land behind its lazy boundary without touching the student bundle.
2. **H3** (surface the V3 price-drift on the student's ticket) is unblocked —
   V3's backend half (`expected_total` / `price_changed`) is in.
3. **Q3/Q4** ("the rush", "shopkeeper runs out mid-cook") are the next-highest
   value tests — they exercise the concurrency invariants V1/V2/V10 just
   hardened.
4. H4–H8 and Q5–Q9 remain open and authorized, unstarted.

---

## 1. What is Khaao?

A **mobile-first installable PWA** for a single college canteen. Students sign
in with their college Google account, build a cart, place one order at a time,
and track it live. The shopkeeper/chef accepts orders, cooks to aggregate
demand, hands items over one-by-one, and collects payment at the counter. No
in-app payments, no OTP, no multi-canteen.

**Scale target:** ~2000 students, single college. Lunch/break rush = bursts of
orders + ~1–2k long-lived SSE connections. Sustainably served by **one Go
instance** (see § 2 Topology decision).

---

## 2. Stack

| Layer | Details |
|---|---|
| **Backend** | Go 1.23 · Gin · GORM · **PostgreSQL only** |
| **Architecture** | Layered SOLID: `controllers → services → repositories` with `authn`, `realtime`, `config`, `database` packages. Composition root in `cmd/server/main.go`. |
| **Auth** | Firebase Google sign-in only. Backend verifies Firebase ID tokens against Google's public certs (no Admin SDK, golang-jwt). Issues its own HS256 Khaao JWT. Role re-read from DB on every request, including a live shopkeeper-allowlist re-check. `FakeVerifier` for dev/e2e (`AUTH_FAKE=true`, disabled in production). |
| **Real-time** | Server-Sent Events, in-memory `realtime.Hub`. Students get `order_update`/`menu_update`. Shop gets `orders_update`/`prep_update`/`menu_update`/`shop_status`. Plus best-effort Web Push (VAPID). SSE connections authenticate via a short-lived one-use ticket (`POST /api/auth/sse-ticket`), never the raw JWT. |
| **Observability** | Structured `log/slog` throughout (JSON in production, text in dev/test) — `middleware.RequestLogger()` logs one line per request; the shared `respondError` logs every 5xx at Error and every 409 at Warn. |
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
- Scaling out would need distributed locking *and* distributed SSE — real cost
  for a scale this app will never hit.
- The DB is still the ultimate arbiter: `SELECT … FOR UPDATE` plus a
  transaction-scoped `pg_advisory_xact_lock` is already in every mutation
  transaction, so a second instance would serialize correctly rather than
  corrupt data if it ever came to that. But run one.

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
        branch: ready → expired (15-min hold if nothing handed — see § 9.6-B12
                 for the gap this leaves once *something* has been handed)

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
                                     ⚠ integration tests cover schema constraints only, not queries
    realtime/hub.go               → in-memory SSE hub (fan-out by userID/role)
    services/
      auth.go, menu.go, orders.go, shopstatus.go, ratings.go, push.go, sse_ticket.go
      pool.go                     → PoolEngine: the core order/prep/handover/payment engine
      allocation.go               → FCFS allocation strategy
      *_test.go                   → unit tests (mocked repos)
    controllers/                  → auth, menu, orders, shop, shopstatus, push, cloudinary, health  ⚠ no tests
    routes/routes.go              → all route wiring  ⚠ no tests

frontend/
  src/
    main.tsx, App.tsx              → root, route tree (role-split: student vs shopkeeper)
    lib/                           → firebase init, format helpers, sound (WebAudio, no assets),
                                     cart.ts, liveAnnouncer.ts, promptCoordination.ts,
                                     shopNotifications.ts
    context/AuthContext.tsx        → auth state
    context/LanguageContext.tsx    → shopkeeper-only Hindi/English toggle
    hooks/useSSE.ts                → SSE hook, jittered exponential backoff (retries indefinitely)
    api/                           → typed API clients per domain
    components/ui/                 → Button, Card, Modal (portal-based), Toast, ConfirmDialog,
                                     EmptyState(+Icons), Spinner, StatusBadge, QtyStepper, VegMark
    components/layout/             → Layout (header+nav+realtime handlers), ProtectedRoute,
                                     ErrorBoundary, InstallPrompt, PushNotificationSetup
    components/student/            → MenuItemCard, OrderModal, OrderTicket, StudentRealtime,
                                     StatusStamps, TrendingRail / FavoritesRail, DietFilter,
                                     MenuSkeleton
    components/shop/               → ShopRealtime, ShopStatusControl  ⚠ ShopStatusControl untested
    pages/student/                 → Menu, OrderStatus
    pages/shop/                    → Orders, Prep ⚠, History ⚠, MenuManage
    sw.ts                          → hand-written service worker ⚠ untested

docs/SPEC.md                       → frozen v3 baseline spec — see its header for what it omits
scripts/smoke.sh                   → e2e smoke test (boots server, full lifecycle, curl-driven)
scripts/loadtest.js                → k6 script (NOT part of routine verification — see § 10)
deploy/                            → Caddyfile, systemd unit, RUNBOOK.md
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
| `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET` | — | Menu photo uploads. Cloud `r2avfle3`. **Never regenerate** once real photos exist (§ 10). |
| `VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT` | — | Web Push. **Never regenerate — rotating invalidates every existing subscription.** |

Frontend (`frontend/.env`): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.

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

**The gate — run all of it before any commit:**
```bash
cd backend  && go build ./... && go vet ./... && gofmt -l . && go test ./... -race && golangci-lint run ./...
cd backend  && go test -tags=integration ./...     # needs real Postgres
cd frontend && npx tsc -b --noEmit && npm run lint && npm test && npm run build && npm run format:check
```

---

## 7. API surface

See `docs/SPEC.md` for the frozen v3 core contract. Added since that doc:

- `POST /api/orders/:id/ratings` — student submits 1–5★ per item on a completed
  order (ownership-checked, re-rating is a no-op)
- `GET /api/menu` / `GET /api/shop/menu` — include `avg_rating`, `rating_count`,
  `diet`, `tags`, `order_count_today`
- `GET /api/shop-status`, `POST /api/shop/status` — open/paused/closed control;
  pause/close refused (409) while any *accepted* order is outstanding
- `POST /api/shop/menu/photo-signature` — signs a direct-to-Cloudinary upload
- `GET /api/push/vapid-public-key`, `POST /api/push/subscribe` — Web Push
- `GET /api/shop/history` — includes an `insights` block (order_count,
  item_counts, customers)
- `POST /api/auth/sse-ticket` — mints a short-lived one-use ticket for `?ticket=`
- `POST /api/shop/menu` / `PUT /api/shop/menu/:id` responses include
  `avail_window_warning` (non-blocking, omitted when empty)

---

## 8. What's DONE

- Full order lifecycle: cart → order → accept/reject/trim → prep pool → FCFS
  allocation → per-item handover → payment → history, with one active order per
  student enforced in code and at the DB level (partial unique index)
- Firebase Google auth, DB-driven role/allowlist re-read on every request
- Shop status control, menu diet + tags + trending, history insights with a day
  stepper and proportional ledger bars
- Item ratings, menu search, diet-filter persistence, "Order this again",
  device-local "Your usuals" favorites
- A visually-hidden `aria-live` region announcing status transitions
- Web Push for new orders (best-effort, self-cleaning dead subscriptions)
- Cloudinary signed photo uploads; installable PWA with a custom service worker
- Real-time SSE for both roles; ready-chime + vibration for students
- Server hardening: fail-closed prod config, request timeouts/body caps,
  security headers, row locking + advisory locks, per-user rate limiting,
  SSE-connection caps, push-endpoint SSRF allowlist
- Full mobile-first visual redesign (paper-chit/steel-counter theme, the "ready"
  moment as the signature animated beat), Hindi/English toggle on shop pages
- Structured `log/slog`, Postgres integration test suite + CI, root error
  boundary, crash-proof cart, network-tolerant SSE, redirect sign-in for
  installed PWAs, ESLint/Prettier/Vitest + golangci-lint in CI, code-splitting

---

## 9. What's LEFT

### 9.1 Mobile design rules — read before ANY frontend change

Students use this exclusively on phones (installed PWA); the shopkeeper uses a
phone or counter tablet. These are standing rules, not suggestions:

1. **Design at 375×667 first** (iPhone SE class), then check ~360 px small
   Android and ~768–1024 px shopkeeper tablet. Desktop only needs to not break.
   iOS-specific behavior is only ever proven on a real device (D-6).
2. **Touch targets ≥ 44×44 px** — `min-h-[44px]` is the established idiom. No
   hover-only affordances; `hover:` styles are progressive extras, tap feedback
   comes from `active:`/pressed states.
3. **Thumb zone:** primary actions live at the bottom. `Modal` already renders
   as a bottom sheet on phones and a centered card at `sm:`. **Every overlay
   goes through `Modal`/`ConfirmDialog`** — never `window.confirm`, never a
   hand-rolled `fixed` div (§ 10: a `fixed` child of a `backdrop-filter`
   ancestor breaks; `Modal` portals to `document.body` for exactly that reason).
4. **Safe areas:** anything pinned to the bottom needs the `pb-safe` utility, or
   the iOS home indicator overlaps it.
5. **No horizontal page scroll, ever.** Wide content scrolls inside its own
   `overflow-x-auto` container; long labels get `min-w-0` + truncation on flex
   children (Hindi item names run long).
6. **Inputs:** font-size ≥ 16 px on every input or iOS zooms the page on focus;
   set `inputmode`/`type` so the right keyboard opens. **Native `date`/`time`
   inputs are user-clearable** — always guard the `onChange` handler against an
   empty value rather than letting it flow into date arithmetic.
7. **The network is hostile** (campus Wi-Fi, elevators): every screen must stay
   usable on cached data — stale data + the offline banner beats an error state
   (`isError` alone must never replace rendered data). Never treat a network
   failure as an auth failure. Every mutation shows a pending state and toasts
   on error.
8. **Performance budget:** initial student JS ≤ ~250 KB raw. **Currently 250.24
   KB — over.** New heavy dependencies must be lazy chunks (follow `App.tsx`'s
   route-group `lazy()` pattern). Menu photos always render through
   `cloudinaryThumb(url, 2×display-px)` — never a raw `secure_url`.
9. **iOS installed-PWA rules** (standalone mode is the real target, with storage
   separate from Safari):
   - No `new Notification(...)` — only `registration.showNotification` via the
     service worker. No `navigator.vibrate`. WebAudio starts suspended — unlock
     on first user gesture (`lib/sound.ts` pattern). Web Push is the only
     screen-off signal.
   - Sign-in uses `signInWithRedirect` in standalone mode (popups break there).
   - Feature-detect everything (`'Notification' in window`, `window.matchMedia?.`).
10. **Visual language:** stay inside the paper-chit/steel-counter theme — the
    Tailwind tokens (`paper`, `ink`, `edge`, `steel`, `stamp`, `turmeric`,
    `brand`), `font-display` for headings, and the existing components. Don't
    invent new grays/shadows/radii; don't add a UI library. **A hardcoded base
    class merged with a caller `className` can silently lose the Tailwind
    cascade tie** — a `ring-*` box-shadow sidesteps the collision when a border
    override needs to win.
11. **Language:** shopkeeper-facing strings are paired via `useLanguage()`;
    student-facing UI is English-only by design and guarded to stay that way.
12. **Orientation:** never lock it — shopkeeper tablets go landscape.

### 9.2 Visual identity — binding design direction

The identity is the **paper chit and the steel counter**: kraft-paper order
tokens stamped as they move down the line, cool institutional steel around
them. IBM Plex Mono for the "printed on the chit" voice (numbers, prices,
stamps, labels); IBM Plex Sans for everything else. `brand` moss = the awning,
`stamp` red = rubber-stamp ink, `turmeric` = the kitchen. The signature element
is the rubber-stamp language on the **"ready" moment** — the emotional peak of
the product (`StatusStamps.tsx`, with its `feTurbulence` distressed-ink filter).

**Sharpen this direction, don't dilute it.** No gradients, no glassmorphism, no
emoji-as-icon, no generic food-delivery styling. Every new surface should be
answerable to the question *"what is this in a real canteen?"* — the prep board
is a chalkboard (ink background, paper mono digits), the history panel is a
ledger, the order is a chit. When § 9.4 asks for a new element, derive its form
from the counter, not from a component library.

**Writing rules** (they carry as much of the identity as the color does):
- Active voice, plain verbs, sentence case. A control says what happens:
  "Place order," not "Submit." The name survives the whole flow — a button that
  says "Hand over" produces a toast that says "Handed over."
- Errors explain what happened and what to do, in the interface's voice. They
  never apologize and are never vague. Empty screens invite an action.
- Name things by what the person controls, never by how the system is built.
  "Left to cook," not "remaining_qty."
- Shopkeeper strings need a Hindi pair via `useLanguage()`. Student strings are
  English-only by design.

---

### 9.3 Backend find-fix backlog (V-series) — DONE (2026-07-26)

Found in the 2026-07-26 full-backend audit. **All ten fixed**, each with a
regression test written first and confirmed red against the unfixed code, full
gate green (build/vet/gofmt/`test -race`/golangci-lint + the Postgres
integration suite). V8 was investigated per its own instructions and confirmed
to be a real defect (not a false alarm) — see its entry.

| # | Severity | One-line | Status |
|---|---|---|---|
| V1 | **HIGH** | A "your order is ready" push fires before the transaction commits — a rollback leaves the student with a phantom ready alert | **Fixed** — ready-transitions queued during the tx, flushed post-commit only |
| V2 | **HIGH** | `CreateOrder` checks shop-open outside the lock and outside the transaction — an order can be accepted into a just-closed shop and then sit forever | **Fixed** — check moved inside `WithTx`, ahead of the active-order lookup |
| V3 | **HIGH** | Menu prices can drift between the student's cart and the server's charge, silently | **Fixed** — optional `expected_total` in, `price_changed` out; order always created at live price |
| V4 | MEDIUM | `Accept` silently ignores `rejected_item_ids` that don't belong to the order | **Fixed** — foreign IDs now reject the whole call with `ErrBadRequest` |
| V5 | MEDIUM | A student is never notified when their order is rejected or expires | **Fixed** — `NotifyOrderRejected`/`NotifyOrderExpired` added, wired post-commit |
| V6 | MEDIUM | An expired order's items are left in `queued` status, not `rejected` — a terminal order with live-looking items | **Fixed** — expiring items now set to `ItemRejected`, mirroring `Cancel` |
| V7 | MEDIUM | `SubmitRatings` accepts an unbounded, un-deduplicated ratings array | **Fixed** — capped at 30, de-duplicated by `order_item_id` (last wins) |
| V8 | LOW | `GormOrderRepo.Save` implicitly upserts the whole `Items` association on every order mutation | **Confirmed real, fixed** — `.Omit(clause.Associations)`; a SQL-capturing test proved the extra per-item upserts existed |
| V9 | LOW | `Subscribe` stores unvalidated `p256dh`/`auth` key material of any length | **Fixed** — base64url charset + length-bound validation |
| V10 | LOW | `RejectAllSubmitted` reads orders without `FOR UPDATE`, unlike every sibling mutation | **Fixed** — new `FindIncomingForUpdate`, row-lock proven via a second-connection `NOWAIT` test |

---

#### V1 — [HIGH] The "order ready" push fires before the transaction commits

**Where:** `services/pool.go` — `recomputeStatus` → `notifyOrderReady`.

`recomputeStatus` calls `e.notifyOrderReady(order)` at the moment it flips an
order to `ready`. But `recomputeStatus` is only ever called from *inside* a
`uow.WithTx` callback — in `Accept`, `Handover`, `RemoveItem` and (via
`reallocate`) in `MarkDone`, `Reject` and `ExpiryTick`. The push goroutine is
launched immediately; the transaction commits later, and may not commit at all.

**Failure scenario:** the shopkeeper taps **Done** on the last unit of a dish.
`MarkDone` → `reallocate` → `recomputeStatus` flips order #14 to `ready` and
fires the push. The very next statement in the same transaction — the
`EventItemReady` log write, or the `orderRepo.Save` inside `reallocate` — fails
(deadlock, connection drop, constraint). The transaction rolls back: order #14
is still `preparing` in the database, nothing is cooked, and the pool units were
never deducted. Meanwhile the student's locked phone has already buzzed *"Order
#14 is ready — head to the counter."* They walk down for food that does not
exist. The `ready_at`/`expires_at` timestamps set in memory are also discarded,
so the 15-minute hold never starts.

The existing doc comment on `notifyOrderReady` acknowledges the transaction may
"still be rolled back by a later step" but treats that as a reason to detach the
*context*, not as a reason to defer the *send*. Detaching the context does not
help: it makes the phantom push more reliable, not less.

**Fix shape:** collect ready-transitions during the transaction instead of
sending them. Give `PoolEngine` a per-call slice (or have `recomputeStatus`
return the transition), and flush the pushes after `WithTx` returns `nil`,
alongside the existing `e.broadcast(...)` / `hub.Notify*` calls that are already
correctly placed post-commit. Do not send anything on the error path.

**Test first:** a `pool_test.go` case with a fake `orderNotifier` and a `uow`
stub whose `WithTx` runs the callback and then returns an error (simulating a
commit failure). Assert `NotifyOrderReady` was **not** called. Verify it fails
against today's code. Add the mirror case — successful commit *does* notify
exactly once — so the fix can't be "never send."

---

#### V2 — [HIGH] `CreateOrder` checks shop-open outside the lock and the transaction

**Where:** `services/pool.go` — `CreateOrder`, first line.

```go
if err := e.ensureShopOpen(ctx); err != nil { ... }   // ← unlocked, untransacted
...
e.mu.Lock()
defer e.mu.Unlock()
err = e.uow.WithTx(ctx, func(txCtx context.Context) error { ... })
```

`ensureShopOpen` reads `shop_status` on its own connection, before the engine
mutex is taken and before the transaction (and therefore before the advisory
lock) exists. Every other invariant in this engine is checked inside the
transaction that acts on it; this one is not.

**Failure scenario:** it's 3 pm and the shopkeeper taps **Close**.
`ShopStatusService.Set` saves `closed`, commits, then runs `RejectAllSubmitted`
to sweep away undecided orders. A student's phone, which has had the menu open
since lunch, submits an order in the gap. `ensureShopOpen` runs *before* the
close commits and reads `open` — the check passes. The engine then blocks on
the advisory lock until the close commits and the sweep finishes, and inserts a
brand-new `submitted` order **into a closed shop, after the sweep has already
run**. Nothing will ever reject it: the shop is closed so the shopkeeper isn't
looking at the Orders screen, `ExpiryTick` only touches `ready` orders, and the
student now holds their one-active-order slot indefinitely. They cannot place
another order tomorrow without someone manually resolving it. This is the same
class of gap as the known R14 residual (§ 9.6 caveats), but on the more common
path — students submit far more often than shopkeepers close.

**Fix shape:** move the `ensureShopOpen` read inside the existing `WithTx`
callback, ahead of the `FindActiveByUserIDForUpdate` call. The advisory lock
then serializes it against `ShopStatusService.Set`'s own transaction, so the
read either sees the pre-close state (and the sweep will catch the order) or
sees `closed` (and the order is refused with the existing 409). Keep the
error messages identical — "The canteen is closed." / "The canteen is on a
break." are already correct copy.

**Test first:** `pool_test.go` with a fake `shopStatusRepo` whose `Get` records
whether it was called with a transaction context (the existing test fakes can
inspect `txCtx`). Assert the shop-status read happens inside the transaction.
Better if feasible: an integration test (`-tags=integration`) that closes the
shop concurrently with a create and asserts the resulting order count is either
0, or 1-and-rejected — never 1-and-submitted.

---

#### V3 — [HIGH] Menu prices drift silently between the student's cart and the charge

**Where:** `services/pool.go` `CreateOrder` (`candidate.TotalPrice += mi.Price *
in.Qty`), `services/orders.go` (`OrderResponse`), and the student cart on the
frontend (see the paired **H3**).

The server correctly prices the order from the live `menu_items` row at submit
time. The student's cart total, though, is computed on the phone from whatever
menu payload it last fetched. There is no agreement between the two and no
signal when they disagree.

**Failure scenario:** a student builds a ₹120 cart at 12:40. The shopkeeper
edits the samosa from ₹20 to ₹30 at 12:44 (a real thing that happens — supply
prices move, and `MenuManage` makes it a two-tap edit). The student's phone is
in their pocket, screen off; the `menu_update` SSE event is delivered but the
refetch result never gets looked at. At 12:45 they hit **Place order** having
last seen ₹120. The server charges ₹140. The order ticket shows ₹140, the
counter asks for ₹140, and the student is certain they were shown ₹120. In a
canteen where payment is cash at a counter, that argument costs the shopkeeper
real time during a rush, and it is the app's fault.

The reverse direction is just as bad in trust terms: a price *drop* the student
never sees means the app under-delivers on a win.

**Fix shape (backend half):** the order response already carries the
authoritative `total_price`; the missing piece is telling the client that it
changed. Accept an optional `expected_total` on the create-order request. When
it is present and does not match the computed total, still create the order
(refusing it during a rush would be worse), but return the discrepancy in the
response — e.g. `price_changed: {expected, charged}` — so H3 can surface it
honestly on the ticket the student lands on. Do **not** silently refuse and do
not re-price to the stale value.

**Test first:** `pool_test.go` — create an order whose menu item price differs
from the submitted `expected_total`; assert the order is created at the live
price *and* the response carries the discrepancy. Second case: matching
expectation → no discrepancy field. Third: omitted `expected_total` → behaves
exactly as today (old clients must not break).

**Coordinate with H3.** Land the backend first; H3 consumes the new field.

---

#### V4 — [MEDIUM] `Accept` silently ignores unknown `rejected_item_ids`

**Where:** `services/pool.go` — `Accept`.

`rejectedSet` is built from the caller's IDs and then only ever *consulted*
while looping over `order.Items`. An ID that belongs to a different order, or
to no order at all, is silently discarded.

**Failure scenario:** the shop tablet has two incoming order cards open. A stale
render, a double-tap during a rush, or a retried request after a timeout sends
order #12's accept with item IDs that belong to order #11. The API returns
`200 OK` with a fully-accepted order. The shopkeeper's screen shows the trim
they asked for did not apply, and they cannot tell whether the tap registered —
so they tap again. Meanwhile the item they meant to drop is now queued for
cooking.

**Fix shape:** validate before mutating. Build the set of the order's own item
IDs; if any supplied ID is not in it, return `ErrBadRequest` naming the count
("2 of the items sent aren't part of this order"). Fail the whole call rather
than partially applying — a partially-applied trim is worse than a rejected one.

**Test first:** `pool_test.go` — `Accept` with one valid and one foreign item ID
returns a 400 and leaves every item's status untouched.

---

#### V5 — [MEDIUM] A student is never told their order was rejected or expired

**Where:** `services/push.go` (only `NotifyNewOrder` and `NotifyOrderReady`
exist), `services/pool.go` (`Reject`, `ExpiryTick`).

The push channel notifies the shopkeeper of a new order and the student of a
ready order. There is nothing for the two outcomes a student most needs to hear
about, both of which are decided by someone else while their phone is in their
pocket.

**Failure scenario A (reject):** a student orders at 12:30 and puts the phone
away. At 12:33 the shopkeeper runs out of paneer and rejects the order. The SSE
event fires into a backgrounded tab that iOS has already frozen. The student
walks to the counter at 12:50 expecting food, and finds out there. Worse, they
believe they still have an active order and cannot place a new one until they
open the app and see the REJECTED stamp.

**Failure scenario B (expire):** the 15-minute hold lapses on a ready order. The
student gets no warning before it happens and no notice after. From their side
the app simply stopped working.

**Fix shape:** add `NotifyOrderRejected(ctx, userID, orderNo, reason)` and
`NotifyOrderExpired(ctx, userID, orderNo)` alongside the existing notifiers,
with the same pure-payload-function shape (`rejectedPayload` /
`expiredPayload`, unit-testable without a fake endpoint) and a `URL` of
`/order`. Wire them from `Reject` and `ExpiryTick` — **post-commit, per V1's
rule**, not from inside the transaction. Extend the `orderNotifier` interface so
`pool_test.go` can assert on them. Copy must follow § 9.2: state what happened
and what to do ("Order #14 couldn't be prepared. Nothing to pay — order again
when you're ready."), never apologize, never blame the student.

**Consider (product call, flag it rather than deciding):** a warning push ~3
minutes before expiry is arguably more valuable than the after-the-fact one.
Implement the two above; note the warning as a follow-up.

**Test first:** `push_test.go` for the exact payload bytes; `pool_test.go`
asserting `Reject` and `ExpiryTick` each notify the right user exactly once, and
do not notify when the transaction fails.

---

#### V6 — [MEDIUM] Expired orders keep items in `queued` status

**Where:** `services/pool.go` — `ExpiryTick`.

When an order expires, allocated units are returned to the pool and the item is
walked *backwards*: `if it.Status == models.ItemAllocated { it.Status =
models.ItemQueued }`. The order itself is then terminal (`expired`), but its
items claim to be waiting to be cooked.

**Why it matters:** nothing reads it wrongly *today* — `remainingByMenuItem`
scans `FindInProgress`, which excludes expired orders — so this is latent, not
live. But it is a lie in the data, and the next thing to scan `order_items` by
status will believe it. Two of the already-planned items scan exactly that way:
§ 9.6-B15 (the business-day reset) and any future analytics or waste report. An
expired order's items were never handed over and never will be; `rejected` is
the status that means that, and it is what `Cancel` and `Reject` both use.

**Fix shape:** set `it.Status = models.ItemRejected` for every non-rejected item
on an expiring order, and save it — mirroring `Cancel`'s loop. Keep the pool
return exactly as it is.

**Test first:** `pool_test.go` — expire a ready order with one allocated and one
queued item; assert both end as `rejected` and the allocated qty went back to
the pool. Verify the current code fails the status assertion.

---

#### V7 — [MEDIUM] `SubmitRatings` accepts an unbounded, un-deduplicated array

**Where:** `services/ratings.go` — `SubmitRatings`.

Every element is validated individually (ownership, not-rejected, 1–5 stars),
but the slice length is never checked and duplicates within one request are
never collapsed. An order holds at most 30 lines; a request can carry 30,000
entries pointing at the same line, and they all reach `SaveAll` as a single
multi-row insert. The 1 MiB body cap is the only ceiling, and it permits roughly
30k entries. `SubmitRatings` also runs outside a transaction, so a partial
insert failure leaves whatever the DB accepted.

**Failure scenario:** low-drama but real — a buggy retry loop in a client, or one
bored student with curl, turns a rating submit into a multi-megabyte insert
during the lunch rush, on the same connection pool the order engine needs.

**Fix shape:** cap `len(inputs)` at a number derived from reality — an order
cannot have more than 30 lines, so 30 is the honest cap — and return
`ErrBadRequest` above it. De-duplicate by `order_item_id` (last value wins, or
first — pick one and say so in a comment). Keep the existing `ON CONFLICT DO
NOTHING` behavior for genuine re-rating.

**Test first:** `ratings_test.go` — 31 inputs → 400; duplicate `order_item_id`
in one request → exactly one row reaches the repo.

---

#### V8 — [LOW] `Save` implicitly upserts the whole `Items` association

**Where:** `repository/gorm.go` — `GormOrderRepo.Save`.

`getDB(ctx, r.db).Save(order)` is called with an `order` whose `Items` slice is
populated (every caller loads via `FindByIDForUpdate`, which fills it). GORM's
default `Save` also upserts loaded associations, so each order-status write also
emits an insert-with-conflict-clause for every order item — extra statements
inside the advisory-locked critical section, on the hottest path in the app.

**Verify before fixing.** Turn on GORM's SQL logging (or add a session-scoped
logger in a test) and confirm the association statements actually appear on the
current version. If they do not, close this task as not-a-defect and record that
here. If they do, the fix is `Session(&gorm.Session{SkipHooks: false}).Omit(clause.Associations).Save(order)`
— or an explicit `Select` of the columns `Save` is meant to own.

**Test first:** an integration-tagged test asserting the statement count for one
`Accept` (GORM's logger can count). If counting proves fiddly, a plain assertion
that item rows are untouched when `Save` is called with a deliberately-stale
in-memory `Items` slice is the more valuable test anyway.

---

#### V9 — [LOW] Push subscription key material is stored unvalidated

**Where:** `services/push.go` — `Subscribe`.

`endpoint` is properly validated against the vendor-host allowlist (the 2026-07-21
SSRF fix). `p256dh` and `auth`, however, are stored verbatim: any length, any
character set. A real subscription's `p256dh` is a 65-byte base64url-encoded
P-256 point and `auth` is 16 bytes; anything else can only be junk that will fail
at encryption time inside `webpush-go`, per row, per send, forever.

**Fix shape:** length-bound and charset-check both (base64url alphabet), and
reject on mismatch with a clear 400. Cheap, and it keeps the `push_subscriptions`
table honest.

**Note:** this touches the same file as V5. Sequence them (V5 first, it is the
larger change) or give both to one agent.

**Test first:** `push_test.go` — over-length and non-base64url values are
rejected; a real-shaped pair is accepted.

---

#### V10 — [LOW] `RejectAllSubmitted` reads without `FOR UPDATE`

**Where:** `services/pool.go` — `RejectAllSubmitted`; `repository/gorm.go` —
`FindIncoming`.

Every other engine mutation loads its target through a `…ForUpdate` variant.
This one uses the plain `FindIncoming` and then `Save`s the rows it read. It is
protected today by the advisory lock that `WithTx` takes, so this is a
consistency-of-idiom issue rather than a live race — but it is precisely the
"unlocked read then whole-row `Save`" shape that produced the 2026-07-24
`MenuService.Update` lost-update bug, and the next person to add a code path
that writes `orders` outside the advisory lock will be bitten by it.

**Fix shape:** add `FindIncomingForUpdate` (mirroring `findOrdersForUpdate`'s
existing pattern, filtering `status = submitted`) and use it here. Leave
`FindIncoming` for the read-only `ShopOrders` path.

**Note:** touches `repository/gorm.go`, shared with V8. Sequence or combine.

**Test first:** given the protection is already there, the honest test is at the
repository level under `-tags=integration`: assert `FindIncomingForUpdate` holds
a row lock (a second connection's `SELECT … FOR UPDATE NOWAIT` on the same row
errors).

---

### 9.4 Frontend design + UX backlog (H-series) — H2 DONE, H1/H3–H8 OPEN, AUTHORIZED, UNSTARTED

Written against § 9.1 (mobile rules) and § 9.2 (identity). **Read both before
starting any H-task.** The direction is already pinned — these tasks sharpen it;
none of them are licence to restyle the app.

| # | Priority | One-line | Files owned |
|---|---|---|---|
| H2 | **DONE** | Lazy-split the shop shell out of the student's initial chunk — buys the bundle headroom every other H-task spends | Bundle 250.24 KB → **239.57 KB**; `Layout.test.tsx` added |
| H1 | **HIGH** | The counter's cash moment has no interface — build it | `pages/shop/Orders.tsx`, new `components/shop/CashDrawer.tsx` |
| H3 | **HIGH** | Surface the price-drift V3 exposes, on the ticket the student lands on | `pages/student/OrderStatus.tsx`, `api/orders.ts`, `api/types.ts` |
| H4 | **HIGH** | A 422 at checkout throws away the whole cart instead of the one unavailable item | `pages/student/Menu.tsx`, `lib/cart.ts` |
| H5 | MEDIUM | The prep board shows *what* to cook but never *who is waiting* | `pages/shop/Prep.tsx` |
| H6 | MEDIUM | Terminal-state arrival is silent — no chime, no announcement, no closure | `components/student/StudentRealtime.tsx`, `lib/sound.ts` |
| H7 | MEDIUM | Low-contrast secondary text fails WCAG AA across both roles | `tailwind.config.js`, sweep across pages/components |
| H8 | LOW | Error and empty-state copy has drifted from the § 9.2 writing rules | copy-only sweep, all pages |

---

#### H2 — [DO FIRST] Lazy-split the shop shell out of the initial student chunk

Formerly § 9.6-B13; **promoted out of the deferred backlog and authorized**,
because the budget is now blocking: initial student JS is 250.24 KB against a
250 KB hard stop (§ 9.1.8). Every other H-task adds bytes.

`Layout.tsx` statically imports `ShopRealtime` and `ShopStatusControl`, and
carries the shop-only header/nav branches. All of it ships to every student's
phone, over campus Wi-Fi, on first load, and none of it will ever execute there.

**Fix shape:** put a `lazy()`/`Suspense` boundary around the shop-only realtime
and status components, following the route-group pattern already in `App.tsx`.
The shell is always mounted, so the boundary needs a fallback that renders
nothing visible and does not shift layout — the shopkeeper must never see a
flash of missing header controls.

**Verify:** `npm run build` and record the new number *in this file*. Then live-
verify both roles: a student session must never fetch the shop chunk (check the
network panel), and a shopkeeper's status control must still be interactive on
first paint. Reclaims far more than the 240 bytes currently over.

**Test:** existing `Orders.test.tsx` / `ShopRealtime.test.tsx` must stay green;
add a `Layout` test asserting the student render does not mount the shop
components.

---

#### H1 — [HIGH] The counter's cash moment has no interface

**The gap:** when an order reaches `awaiting_payment`, `Orders.tsx` renders
`{formatPrice(order.total_price)}` — a number in a row. That number is the
single most operationally loaded moment in the whole product: the student is
standing at the counter, there is a queue behind them, and cash is changing
hands. The app currently contributes nothing to it.

Everything else in this app was designed from the real object — the chit, the
chalkboard, the ledger. The cash moment has no such object yet, and it is the
one the shopkeeper touches most often.

**What to build:** the counter's cash surface. Concretely:
- The amount to collect, set at the largest type on the screen, in
  `font-display` tabular figures — readable at arm's length on a tablet propped
  behind a counter, not at reading distance.
- **Tender + change.** The shopkeeper taps what the student handed over (₹50 /
  ₹100 / ₹200 / ₹500, plus "exact") and the change to return is computed and
  shown at the same weight as the total. Indian canteen cash is overwhelmingly
  these denominations; a change subtraction under time pressure with a queue
  waiting is exactly the arithmetic worth removing. This is device-local UI
  state only — **no backend, no persistence, no new endpoint.** Clear it when
  the order is marked paid.
- **Mark paid** stays the committing action, unchanged in behavior, and stays in
  the thumb zone (§ 9.1.3).

**Design constraints:** derive the form from the counter, not from a payments
UI. No card/wallet iconography — there are no in-app payments and never will be
(§ 1). The denominations are physical notes: the existing `paper`/`edge` tokens
and mono numerals already speak that language. Spend the boldness here on
*scale and clarity*, not on new color — this is the one screen where a very
large number is the whole design. Keep the Hindi pairing (§ 9.1.11): "देना है"
/ "to return".

**Rules to honor:** 44 px targets on every denomination key; `pb-safe` if it
docks to the bottom; overlay (if any) goes through `Modal`; no horizontal
scroll at 375 px; the whole thing must be operable one-handed on a phone, since
the shopkeeper sometimes runs the counter off a phone.

**Test:** a new `CashDrawer.test.tsx` — tender below the total offers no
change and does not block; exact tender shows zero change; change math is right
across the denomination set; the panel resets after "Mark paid."

**Watch the budget:** this is shop-only code. It must land behind H2's lazy
boundary so it never reaches a student's bundle.

---

#### H3 — [HIGH] Surface the price drift on the ticket the student lands on

**Depends on V3.** Land V3 first.

Once the create-order response can report `price_changed`, `OrderStatus.tsx`
must tell the student, once, at the moment they arrive: what they last saw, what
they were charged, and that the order stands. One line, on the chit, in the
interface's voice — not a toast that vanishes while they are still reading it,
and not an apology.

Suggested copy (tune it, don't ceremonialize it): *"The samosa went from ₹20 to
₹30 while you were ordering. You'll pay ₹140 at the counter."*

Also send `expected_total` from the cart at submit time (`api/orders.ts`), taken
from the same `cartTotal` the student was actually shown — not recomputed at
submit, which would defeat the point.

**Test:** `OrderStatus.test.tsx` — a response carrying `price_changed` renders
both numbers; a response without it renders nothing extra; the notice does not
reappear on a later SSE-driven refetch of the same order.

---

#### H4 — [HIGH] A 422 at checkout throws away the whole cart

**Where:** `pages/student/Menu.tsx` `submitMutation.onError`, `lib/cart.ts`.

`CreateOrder` returns `422` with a message naming the offending item — *"Paneer
Roll is not orderable right now"* — the instant any one line has gone
unorderable. The client shows that message in a toast and leaves the cart
exactly as it was. U3 already prunes items the *menu payload* says are
unorderable, but that only helps when the phone has fresh menu data; the race
this covers is precisely the one where it does not.

**Failure scenario:** 12:47, the rush. A student has six items in the cart. The
shopkeeper marks paneer out of stock at 12:46:58. The student taps **Place
order** at 12:47:00 — before the `menu_update` refetch lands. They get a red
toast, an unchanged cart, and a **Place order** button that will fail
identically every time they tap it. There is no affordance telling them which
line to remove. Most students will tap three or four times and then close the
app.

**Fix shape:** parse the 422 (match on the returned item name against the cart's
own entries, or — better — coordinate a small backend change to return the
offending `menu_item_id`; if you take that route it belongs in V-series scope
and must be recorded here). Remove that line from the cart, mark it visually as
unavailable in the list, and re-open checkout with the corrected total so the
student can confirm and submit in one tap. Never silently re-submit on their
behalf — the total changed and they must see it.

**Test:** `Menu.test.tsx` — a 422 naming one cart item prunes exactly that item,
leaves the rest, and updates the displayed total. Verify the test fails today.

---

#### H5 — [MEDIUM] The prep board shows what to cook, never who is waiting

**Where:** `pages/shop/Prep.tsx`.

The board is an aggregate: dish name, "left to cook," a tally, a Done button.
That is the right primary abstraction — a chef cooks to total demand, not to
individual orders. But it flattens away the one thing that decides cooking
*order*: someone has been waiting nine minutes and someone else just ordered.

`Orders.tsx` already surfaces order age on incoming cards, so the pattern and
the data are both established; the prep board simply does not use them.

**Fix shape:** add the oldest waiting time per row — a small mono figure in the
existing chalkboard idiom (the row's tally block is already ink-on-paper). Sort
rows by it, so the board reads top-to-bottom as cooking order. Derive it from
the shop orders query already in the cache; **no new endpoint.** If the number
must fall back (query not loaded), fall back to today's ID sort silently rather
than showing a wrong time.

Keep it quiet: one figure, one unit, no color-coded urgency ramp. A red "late"
badge in a kitchen becomes wallpaper within a day.

**Test:** a new `Prep.test.tsx` — rows sort oldest-first; a row with no
derivable age still renders; the tally-tick animation still fires (don't break
the existing `expectTickRef` behavior).

---

#### H6 — [MEDIUM] Terminal-state arrival is silent

**Where:** `components/student/StudentRealtime.tsx`, `lib/sound.ts`.

`ready` chimes, vibrates and announces. `rejected` / `expired` / `cancelled`
arrive with no sound and — verify this — likely no `liveAnnouncer` call either.
The `StatusStamps` component already renders a proper REJECTED/EXPIRED stamp, so
the *visual* closure exists; a student who is not looking at the screen gets
nothing.

**Fix shape:** a distinct, quieter, lower tone for terminal states via the
existing WebAudio helper — deliberately **not** the ready chime, which must stay
unique to the good news. No vibration for bad news. Announce the transition
through `liveAnnouncer` exactly as the ready path does, so screen-reader parity
holds (this was G7's whole point). Respect the existing first-gesture unlock and
the reduced-motion / muted paths.

Pairs with **V5** (the push for the same transitions) but is independent of it:
V5 covers the phone in a pocket, H6 covers the phone in a hand.

**Test:** extend `StudentRealtime.test.tsx` — a submitted→rejected transition
announces once and plays the terminal tone, not the ready chime; no
double-announce on a repeated identical SSE payload.

---

#### H7 — [MEDIUM] Low-contrast secondary text fails WCAG AA

**The finding:** `text-ink/40` on the `paper` surface (`#211F1A` at 40 % over
`#EEDFBB`) computes to roughly **2.1:1** — well under the 4.5:1 AA threshold for
body text, and under 3:1 even for large text. It is used for the small
uppercase labels that carry real meaning ("left to cook" on the prep board is
one). `text-ink/50` and `text-paper/70` are in similar territory and need
measuring, not assuming.

This is not a theoretical audit item. The shopkeeper's tablet sits on a counter
under canteen lighting, often near a doorway; students read their phones
outdoors in Indian daylight. Low-contrast small caps are the first thing to
disappear.

**Fix shape:** measure every `/NN` opacity used on text against its actual
background (compiled CSS, not assumed source order — § 10). Define two or three
named token values that *pass* — e.g. an `ink-muted` that meets AA on `paper`
and one that meets AA on `ink` — and replace the ad-hoc opacities with them. Do
not simply darken everything: the visual hierarchy is doing real work, so
recover the hierarchy through weight, size and letter-spacing where contrast
must rise.

**Verify:** compute contrast ratios and record them here. Screenshot the prep
board and the student menu before/after.

**Test:** no unit test is meaningful for this; the deliverable is the recorded
measurements plus screenshots.

---

#### H8 — [LOW] Error and empty-state copy has drifted

A copy-only sweep against § 9.2's writing rules. Known offenders to check:
- *"Could not submit your order."* — says nothing about what to do next.
- *"Could not mark item done."* — same, and it is the message a shopkeeper sees
  mid-rush when they most need to know whether to tap again.
- *"Some items are no longer available and were removed from your cart."* —
  passive, and does not name the items (it can).

Rules: name what happened, name the next action, active voice, no apology, keep
the shopkeeper pairs in Hindi. Do not restructure components — text only.

**Test:** update any test asserting on the old strings. Nothing new needed.

---

### 9.5 Testing backlog (Q-series) — Q1/Q2 DONE, Q3–Q9 OPEN, AUTHORIZED, UNSTARTED

The gate is green, but green over the wrong surface. Two structural holes:

1. **`internal/controllers` and `internal/routes` have zero test files.** Every
   auth guard, every role gate and every status code in this app is currently
   unverified except incidentally, through `scripts/smoke.sh`'s golden path.
   `internal/repository` has 6 integration tests, but they all prove *schema*
   invariants (unique constraints, partial unique indexes, foreign keys) — the
   619 lines of hand-written query and locking logic in `gorm.go` are not
   covered by them.
2. **There is no browser-level end-to-end suite.** Playwright has been used
   interactively for verification, but nothing is checked in and nothing runs in
   CI.

The tasks below are deliberately written as **scenarios a real student and a
real shopkeeper would produce**, not as coverage targets. A test that mirrors a
real Tuesday at 12:45 catches bugs that a test named
`TestAcceptReturnsOrderResponse` never will.

| # | Priority | Scenario / target | Where |
|---|---|---|---|
| Q1 | **DONE** | Route-level auth and role matrix — every endpoint, every wrong-role and no-token case | `internal/routes/routes_test.go` — 31/31 routes, driven off Gin's live route table |
| Q2 | **DONE** | Repository SQL contracts against real Postgres | `internal/repository/integration_test.go` — 9 new tests, no bugs found |
| Q3 | **HIGH** | "The rush" — concurrent student orders against finite cooked units | `services/integration_test.go` |
| Q4 | **HIGH** | "The shopkeeper runs out mid-cook" — reject after accept, pool returns, next order advances | `services/integration_test.go` |
| Q5 | MEDIUM | "Two devices, one shopkeeper" — the counter tablet and the owner's phone disagree | `services/*_test.go` |
| Q6 | MEDIUM | "The student's phone dies" — SSE drop, reconnect, resync correctness | `hooks/useSSE.test.ts`, `StudentRealtime.test.tsx` |
| Q7 | MEDIUM | Browser end-to-end: one full lifecycle, both roles, checked in and runnable | new `frontend/e2e/` |
| Q8 | MEDIUM | The untested frontend surfaces: `Prep`, `History`, `ShopStatusControl`, `Layout` | new `*.test.tsx` |
| Q9 | LOW | Service worker behavior: precache, `/api` NetworkOnly, push + notificationclick | new `sw.test.ts` |

---

#### Q1 — [HIGH] The route auth and role matrix

Every route in `routes.go` is wired with some combination of `requireAuth`,
`requireStudent`/`requireShopkeeper`, `rateLimit`, `requireSSEAuth` and
`limitSSEConns`. A single misplaced middleware — one route registered on the
wrong group — is a total authorization failure, and nothing in the repo would
catch it. This is the highest-value missing test in the codebase.

**Build:** a table-driven test that boots the real `routes.Setup` against fake
services and asserts, for **every registered route**:
- no token → 401
- valid student token on a `/api/shop/*` route → 403
- valid shopkeeper token on a student route → 403
- the correct role → not 401/403
- public routes (`/api/health`, `GET /api/menu`, `GET /api/shop-status`,
  `GET /api/push/vapid-public-key`, `POST /api/auth/firebase`) → reachable
  with no token, and confirm that list is exactly right

Drive it off `router.Routes()` so a **newly added route that the table does not
cover fails the test.** That property is what makes this test keep paying.

**Also assert:** an SSE ticket is single-use (second connect with the same
ticket → 401), and a student cannot open `/api/shop/stream`.

---

#### Q2 — [HIGH] Repository SQL contracts against real Postgres

`repository/gorm.go` is 619 lines of hand-written queries, locking clauses, and
one raw `INSERT … ON CONFLICT`. The existing
`repository/integration_test.go` covers *schema* invariants only — unique
constraints, the partial unique index, foreign keys — not the query methods
themselves. The service tests all use fakes, which means **the fakes, not the
SQL, are what is verified.** Extend the existing file rather than replacing it.

**Build** (integration-tagged, real Postgres): per-method tests for the
non-obvious ones —
- `FindActiveByUserIDForUpdate` returns exactly one active order and locks it
- `FindPreparingOldestForUpdate` orders strictly oldest-first including items
- `PoolRepo.Add` with a negative delta on a missing row (the documented
  UPDATE-then-INSERT path — assert the CHECK constraint behavior it exists for)
- `GetMaxOrderNo` per business day, and the `idx_orders_date_no` conflict the
  create-order retry loop depends on
- `HasActiveItemsForMenuItem` across each order status
- `SumOrderedQtyByDate` excluding rejected orders
- soft-delete: a deleted menu item disappears from `FindAll` but its
  `order_items` snapshot still renders

Fixtures should read like real data: one shopkeeper, three students, a lunch
menu.

---

#### Q3 — [HIGH] "The rush"

**Scenario:** 12:45. Twelve students order the same dish within four seconds.
Seven units are cooked. The shopkeeper marks them done in two batches.

**Assert:** FCFS holds strictly by order creation time — the first seven orders
get their units, order eight through twelve stay `preparing`; the pool never
goes negative; total allocated never exceeds total cooked; every order that
went `ready` did so exactly once and got exactly one ready notification (which
also pins **V1**); no order gets a duplicate order number for the day.

Run the twelve creates genuinely concurrently (goroutines + `-race`), against
real Postgres. This is the test that proves the single-instance topology claim
in § 2 is actually true.

---

#### Q4 — [HIGH] "The shopkeeper runs out mid-cook"

**Scenario:** three orders queued for the same dish. Two units cooked and
allocated to orders #1 and #2. The shopkeeper discovers the paneer is finished
and rejects order #1.

**Assert:** #1's allocated unit returns to the pool; the freed unit is
re-allocated FCFS to #3, not back to #1; #3's status recomputes correctly; #1
is `rejected` with `total_price` zeroed; the student on #1 is notified (pins
**V5**); the shopkeeper's prep board tally reflects the new remaining demand.

Then the variant that matters most: **reject after partial handover must be
refused** — hand one unit of #2 over, then attempt to reject #2, and assert the
409 and that nothing changed. That refusal is the invariant protecting the
shopkeeper from giving away food they cannot account for.

---

#### Q5 — [MEDIUM] "Two devices, one shopkeeper"

This scenario has already produced two real bugs in this codebase (the
`ShopStatusControl` fix and the `MenuService.Update` lost-update race), which is
exactly why it deserves standing coverage rather than being re-discovered.

**Scenario:** the counter tablet and the owner's phone are both logged in as the
same shopkeeper.

**Assert:** tablet edits an item's price while the phone marks it out of stock →
both land, neither is silently reverted (this is the regression guard for the
2026-07-24 fix); tablet accepts an order while the phone tries to pause the shop
→ the pause is refused with the accepted-order 409, or succeeds and no accepted
order is left dangling; both devices mark the same prep unit done → the second
gets the "not needed right now" 409 rather than over-allocating.

---

#### Q6 — [MEDIUM] "The student's phone dies"

**Scenario:** a student is on the order screen when they walk into the lift.
SSE drops. Thirty seconds later they come out. In between, their order went
`ready`.

**Assert:** `useSSE` reconnects with jittered backoff and no attempt cap; on
reconnect, `onOpen` triggers a full refetch so the missed transition is picked
up from REST, not inferred; the ready chime and announcement fire **once** for
the state they arrive into, not once per reconnect; a network failure during the
gap never surfaces as an auth failure or a logout (§ 9.1.7).

Extend `useSSE.test.ts` and `StudentRealtime.test.tsx`. The double-fire case is
the one most likely to be broken today.

---

#### Q7 — [MEDIUM] A checked-in browser end-to-end test

One test, one lifecycle, both roles, running against a real backend with
`AUTH_FAKE=true`: student signs in → adds two items → places the order →
shopkeeper accepts → marks done → hands over → marks paid → student sees the
PAID stamp and can rate.

**Requirements:** committed under `frontend/e2e/`, runnable with one documented
command, and wired into CI **only if it is reliable** — a flaky e2e in CI is
worse than none, because the team learns to ignore red. Keep it to the golden
path; the edge cases belong in Q3–Q6 where they run in milliseconds.

Verify at 375×667 (§ 9.1.1), which also makes it a standing check against
horizontal-scroll and thumb-zone regressions.

---

#### Q8 — [MEDIUM] The untested frontend surfaces

`Prep.tsx`, `History.tsx`, `ShopStatusControl.tsx` and `Layout.tsx` have no
tests. Between them they hold the day stepper's local-date arithmetic (which has
already had a midnight-drift bug), the reopen-time picker (which has already had
an empty-input bug), the language guard that keeps Hindi out of student
sessions, and the prompt-coordination timing between `InstallPrompt` and
`PushNotificationSetup`.

Prioritize by prior blast radius: `ShopStatusControl` and `History` first — both
have already broken in production-shaped ways — then `Layout`'s language guard,
then `Prep` (which H5 will touch anyway; coordinate).

---

#### Q9 — [LOW] Service worker behavior

`sw.ts` is hand-written and completely untested: precache manifest handling,
`/api` NetworkOnly (a cached API response would be a correctness disaster in an
app whose whole point is live order state), the `push` listener, and
`notificationclick` focus/open routing to `/shop` vs `/order` (R30).

Unit-test the handlers directly with a mocked SW global rather than trying to
drive a real registration.

---

### 9.6 Deferred backlog — recorded for LATER, **NOT authorized**

Backend work, product decisions, or deliberately-postponed frontend. Nothing
here may be started without the owner picking it deliberately. **B13 was
promoted to § 9.4-H2 and is no longer deferred.**

| # | What | Why it's deferred |
|---|---|---|
| B1 | Order notes to kitchen ("less spicy") | Backend: new order field + validation; UI on both faces. |
| B2 | Favorites sync across devices | Backend: table + endpoints. G8 ships device-local first. |
| B3 | Menu item descriptions | Backend: new column + API field; would unlock a student item-detail sheet. |
| B4 | Scheduled pickup time slots | Product decision + backend scheduling; changes the FCFS model. |
| B5 | Student history beyond `LIMIT 20` | Backend pagination param + UI. Not felt until months of use. |
| B6 | Weekly/range shop insights | Backend aggregation across days + a real dataviz pass. |
| B7 | Queue position / ETA for students | Backend derivation from pool state; needs careful honesty about accuracy. |
| B8 | Shopkeeper allowlist admin UI | Backend endpoints; today it's env-seeded, fine at this scale. |
| B9 | httpOnly cookie sessions | § 11.2 — an architecture project, not a task. |
| B10 | iOS splash screens | Pure asset generation; wait for D-6 to prove it's worth the asset set. |
| B11 | SW update-prompt UX | `registerType` is `autoUpdate` today; switching to a prompt is a product decision. |
| B12 | Abandoned-order recovery | An order with *some* but not all items handed over, then abandoned, has no terminal path — `Reject` refuses once `handed_qty > 0`, and `ExpiryTick` skips any order with handover activity (matches § 3's documented state machine, not a bug). The order — and the student's one-active-order slot — stays stuck. A real fix needs an explicit shopkeeper "write off / abandon" action: endpoint + service + UI + copy + Hindi pairing, and a product decision on what it means (unpaid-completed? a new terminal status?). |
| ~~B13~~ | ~~Lazy-split the shop shell~~ | **Promoted to § 9.4-H2** — the bundle is now over budget, so this is blocking rather than optional. |
| B14 | "Accept" with every item unchecked silently rejects the order | Unchecking *all* pending items and pressing green **Accept** sends `rejectedItemIds = all`, which the backend turns into a full rejection. Defensible, but a green "Accept" producing a rejection is a UX trap. A fix would disable/relabel Accept when nothing is checked — cosmetic, and a copy decision + Hindi pairing. |
| B15 | No business-day reset for `item_pool.qty` / `menu_items.out_of_stock` | `docs/SPEC.md` documents a `POST /api/shop/day/close` zeroing the pool and resetting stock, and `MenuRepo.ResetStock`/`PoolRepo.ZeroAll` still exist for it — but nothing calls either (no route, no service, no scheduler). Leftover pool units carry into the next business day and get instantly FCFS-allocated to the first new order: food from a previous day served without anyone cooking or acknowledging it. **Real and reachable.** The fix needs a product decision (automatic at local midnight vs. tied to the shop-status transition vs. an explicit shopkeeper action), not a targeted code change. **Note the interaction with V6** — fixing V6 makes any status-based day-reset implementation correct rather than subtly wrong. |

**Caveats worth knowing (recorded, not tasks):**

- **R14 residual race** (documented in `shopstatus.go`): the accepted-order check
  and status save are atomic under the advisory lock, but `RejectAllSubmitted`
  runs as a *separate* transaction afterwards (nesting would deadlock). A
  concurrent Accept can land in the commit-to-sweep gap, leaving the shop paused
  with one accepted order. Narrow. **V2 covers the more common twin of this on
  the create-order path.**
- Student history is `LIMIT 20` (B5); shop history caps the *response list* at
  200 rows but computes insights/totals over the full day.
- A slow SSE consumer is dropped by closing its channel; the browser reconnects
  and `onOpen` resyncs it. Deliberate self-heal, not data loss.
- `MarkDone` caps qty at current unmet demand — a shopkeeper cannot cook ahead
  speculatively. Deliberate, enforced server-side so the API can't bypass it.

---

### Deployment (human-led — needs real infra, not more code)

**`deploy/RUNBOOK.md` is the expanded, step-by-step version of this table.**
Artifacts ready and committed: `deploy/Caddyfile` (validated with `caddy
validate`), `deploy/khaao-backend.service`, `deploy/RUNBOOK.md`.
**Agent/human split:** almost everything needs a human with domain/server access.
An agent's useful roles are (a) pair on D-4/D-5 config and debugging once access
exists, (b) verify D-6 findings and fix what they surface, (c) keep this table
and the runbook in sync as steps complete.

| # | What | Notes |
|---|---|---|
| D-1 | **Provision managed Postgres** | Runbook § 1. Daily backups from day one, test a restore *before* go-live. Confirm `citext`. `?sslmode=require`. |
| D-2 | **Firebase setup** | Runbook § 2. Enable Google sign-in → **add authorized domains** (the #1 launch gotcha — sign-in silently fails otherwise, and the redirect flow depends on it). |
| ~~D-3~~ | ~~Cloudinary account check~~ | **Done.** Live-verified. **Never regenerate the credentials** (§ 5). |
| D-4 | **Deploy backend** | Runbook § 4 + § 6. ONE instance (replicas=1). Raise `ulimit -n`. Caddy in front: `proxy_buffering off` on `/api/stream`, long SSE read timeout. `APP_ENV=production`. |
| D-5 | **Deploy frontend** | Runbook § 5. Static host, `VITE_FIREBASE_*` set at build time. |
| D-6 | **End-to-end production verification** | Runbook § 7. One real student + one real shopkeeper complete a full lifecycle on production. **Must include:** Google sign-in *inside* the installed PWA on iOS and Android (not just a browser tab); the "ready" moment on a locked phone (push arrives, SW notification shows, chime plays after first-touch unlock); a CSP console check per § 11.5. |
| D-7 | **Runbook for ongoing ops** | **Written** — § 8 covers rotating `JWT_SECRET`, adding/removing a shopkeeper, checking logs, restoring a backup. Remaining: validate against the real deployment during D-6. |

---

## 10. Operational lessons (worth 30 seconds before you repeat one)

- **Commit incrementally** once review is done — a prior multi-session stretch
  where nothing was committed led to a `git checkout --` wiping real work.
- **Never batch-`mv` files with duplicate basenames into one destination** —
  silent overwrite, no warning.
- **Never regenerate the VAPID key pair or Cloudinary credentials** —
  invalidates every push subscription / breaks uploads.
- **A `fixed`-positioned overlay must never be a literal DOM child of an element
  with `backdrop-filter`/`filter`/`transform`** — that ancestor becomes the
  containing block instead of the viewport. Portal it to `document.body`.
- **A hardcoded base class merged with a caller `className` can silently lose
  the Tailwind cascade tie** — utilities are emitted in source-file order, not
  JSX order. Bit `MenuSkeleton`'s `Bone` and `RatingPrompt`'s `Card`
  independently in one session. A `ring-*` box-shadow sidesteps the collision.
  Verify against the *compiled* CSS, not assumed source order.
- **Native `date`/`time` inputs are user-clearable to `""`** — guard the
  `onChange` handler, not just the arithmetic downstream. An empty value
  cascading into date math produces `NaN`, and if that becomes a new query key,
  an `isError` guard can replace the whole section including the input that
  would let the user recover. Found in both `History.tsx` and
  `ShopStatusControl.tsx` in one session — same root cause, same fix shape.
- **The menu mistouch-guard's ~3s auto-disarm can look like a missing feature**
  if you click-then-check across two tool round-trips — test click+check inside
  one script.
- **A long-lived browser tab in a scratch PWA setup can serve a stale
  service-worker precache** — if live behavior contradicts the code, check
  `navigator.serviceWorker.getRegistrations()` / `caches.keys()` first.
- **Playwright `fullPage: true` screenshots can visually misplace `position:
  fixed` elements** — capture artifact, not a rendering bug.
- **Don't touch the shared `frontend/vite.config.ts` proxy target for a scratch
  check if a real dev server might be running** — it hot-reloads the live
  session onto the scratch backend. Use an isolated config + distinct port, and
  remember it still needs the `VitePWA` plugin.
- **Orphaned scratch server processes can hold a Postgres connection open for a
  full day**, blocking `scripts/smoke.sh`'s `dropdb`. Cross-reference
  `pg_stat_activity` against `ps aux`/`lsof` before assuming the script is broken.
- **When a third-party integration fails, reproduce it directly against the
  provider's API with curl** — unambiguous status code in ~10 seconds.
- **The auto-mode permission classifier can deny `agy
  --dangerously-skip-permissions` case-by-case** based on what a specific prompt
  touches, with no settings change in between — doing the work directly is a
  legitimate fallback when denied.
- **A GitHub Actions step can be silently broken from the moment it's added** —
  `git push` succeeding is not CI passing. Check `gh run list` yourself.
- **Local tool verification and CI-green are two different claims** — a script
  that isn't part of routine verification (e.g. `scripts/loadtest.js`) drifts
  silently. The fix isn't "trust it more," it's "actually run it periodically."

---

## 11. Known security gaps (tracked)

1. ~~SSE token in the query string~~ — **fixed**: SSE authenticates via a
   short-lived one-use ticket (`services/sse_ticket.go`), never the raw JWT.
2. `localStorage` JWT — still XSS-exfiltratable. Left as-is deliberately; fixing
   it properly means full cookie-based sessions (§ 9.6-B9). **Partially
   mitigated** by the CSP (`script-src 'self'`, no `unsafe-inline`/`unsafe-eval`).
3. ~~No rate limiting~~ — **fixed**: per-user token bucket on mutations plus a
   per-user SSE connection cap (`middleware/ratelimit.go`), live-verified.
4. Photo URLs are restricted to `http(s)://` only at the API layer. **Tightened**
   via the CSP's `img-src` (`'self'`, `blob:`, `https://res.cloudinary.com`).
5. ~~No CSP~~ — **fixed**, in both `middleware/security.go` and
   `deploy/Caddyfile`. **NOT YET live-verified** against a real Firebase sign-in
   + Cloudinary upload — check the console for "Refused to …" errors at D-6.
6. **An already-open SSE stream survives shopkeeper de-provisioning.** REST auth
   re-reads role and allowlist on every request, so a removed shopkeeper is
   locked out of all *actions* immediately. Their existing `/api/shop/stream`
   connection was authorized at connect time and keeps delivering read-only shop
   events until it drops. Accepted: read-only metadata, hand-picked allowlist,
   any reconnect ends it.
7. ~~`POST /api/push/subscribe` accepted any client-supplied `endpoint`~~ —
   **fixed**: validated against a hostname allowlist of the real Web Push
   vendors. This was a genuine SSRF reachable by any authenticated student.
   **See § 9.3-V9** — the `p256dh`/`auth` fields on the same endpoint are still
   unvalidated (much lower severity, no outbound request depends on them).

Also: Gin runs in `ReleaseMode` when `APP_ENV=production`; `SetTrustedProxies(nil)`
is explicit — harmless since no code path reads client IP.

Already correct, do not change: Firebase token verification pinned to RS256;
CORS pinned to `FRONTEND_ORIGIN` (no wildcard); `ParseToken` uses
`jwt.WithValidMethods` (alg-pinned).

---

## 12. Working protocol for the next agent

**Read § 9.1 and § 9.2 before any frontend change. Read the task's own section
before starting it — the "Fix shape" and "Test first" lines are the spec.**

1. **One task at a time.** Every V/H/Q task lists the files it owns. Do not
   touch files another task owns; where two tasks share a file (V8/V10 share
   `repository/gorm.go`; V5/V9 share `push.go`), either sequence them or give
   both to one agent.
2. **Test first, and prove it fails.** Write the regression test, run it against
   the *unfixed* code, and confirm it fails for the right reason (`git stash` on
   just the implementation file is the established technique here). A test that
   was never seen red is not a regression test.
3. **Run the full gate before committing** — both stacks, § 6. Do not report
   partial gates as green. If something fails, say so with the output.
4. **Commit split by stack**, one commit per stack per round — the standing
   convention. Descriptive messages; `git log` is the history of record.
5. **Update this file as you land work.** Move the task from its backlog into a
   one-line record, and update the bundle number in § 9.1.8 whenever `npm run
   build` changes it. If a task turns out to be a non-defect (V8 may), record
   that verdict here rather than deleting the entry.
6. **Do not start anything in § 9.6.** It is a decision list, not a queue.
7. **If a task's premise turns out to be wrong,** say so and stop rather than
   inventing adjacent work. The audit that produced these was thorough but not
   infallible.

**Parallelization guidance:** V1–V7 are independent of the H-series and can run
concurrently with it. Within § 9.4, **H2 must land before H1**. **V3 must land
before H3.** Q1 and Q2 are independent of everything and are the best first
tasks for an agent with no prior context on this codebase.
