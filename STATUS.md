# Khaao — Project Status

> **For the next agent:** read this top-to-bottom before touching code. It is
> the single source of truth for current state, architecture, and what's left.
> The full history of *how* we got here lives in `git log` — every committed
> change has a descriptive message. This file tracks the *current picture and
> the open work*, not a session-by-session diary.
>
> **§ 12 is the working protocol.** Read it before you pick up a task.

## Current state (2026-07-28 — fifth pass)

Everything landed through 2026-08-03 is committed and green. R1–R31, F1–F24,
the G-series, the T-series (2026-07-22 audit), the U-series (2026-07-25 audit),
V1–V10, H2, Q1/Q2, W1/W2/W4/W6/W9, P1/P2/P3/P6/P7, S1/S2 and X1–X7 are all in
`main`. **The long task write-ups for finished work were removed from this file
on 2026-07-28** — each one now survives as a single row in its section's status
table, which is where § 12.5 says a landed task belongs. The reasoning behind
each fix is in `git log`.

**§ 9.12, the Y-series** is a 16-item frontend backlog from a fresh audit
against the built output, aimed at the owner's brief (*"find issues, any
optimization needed; frontend improvements, visualizations for better UX/UI —
I want it to look the best, best experience, smooth"*). **This pass landed
twelve of the sixteen**: Y1 (font reclaim), the `Modal.tsx` bundle
(Y3/Y7/Y10), `StatusStamps.tsx` (Y2), `QtyStepper.tsx` + `MenuItemCard.tsx`
(Y9→Y4), `History.tsx`'s day-shape + revenue-per-item visualization
(Y5/Y13), and the cross-file sweeps (Y8 keyboard-reachable rails, Y14
skeleton status announcements, Y16 drops the trailing `.00`). Each landed
with a regression test confirmed red against the unfixed code first, in four
worktree-isolated agents (bundles M+N, O, P run in parallel; Q run after,
since it sweeps files the first three had just edited) merged back to `main`
one at a time with the full gate re-run after each merge. **Two of the four
merges needed hand resolution** — the M+N/P agents' worktrees branched before
Y1 landed, and the Q agent's worktree branched before M/N/O/P landed, so its
`History.test.tsx` collided with Y5's and its `Menu.test.tsx` diff collided
with Y4's; both were reconciled by hand, and one real fallout bug (Y5's test
asserting the pre-Y16 `.00`-suffixed price strings) was caught and fixed in
the process. **Y6, Y11, Y12, Y15 are now complete.**

Gate on the current tree, all landed Y-series work included:

| Gate | Result |
|---|---|
| `tsc -b --noEmit` | clean |
| `npm run lint` | 0 errors, 26 pre-existing-style warnings (was 24; +2 non-null-assertion warnings in the new rail test, same pattern as elsewhere in the codebase) |
| `vitest run` | **148/148 passing**, 24 test files (was 111/19 before this pass) |
| `npm run format:check` | clean |
| `vite build` initial student JS | **244.40 KB raw** — under the 250 KB hard stop |
| `vite build` service-worker precache | **706.68 KiB, 41 entries — under the ~800 KB soft ceiling** |
| Backend (`go build` / `vet` / `gofmt` / `test`) | unchanged this pass — not re-run, not claimed |

**Precache arc this pass:** 801.93 KiB/49 entries (start) → 696.51 KiB/42
(after Y1's font reclaim alone) → 702.92 KiB/42 (final, after Y2/Y5/Y14 added
back ~6.4 KB of CSS/markup). Still comfortably under the ceiling; the
remaining ~97 KB is what Y11 and Y15 (both still open) should be measured
against.

### The backlogs

| Backlog | What | Size | Status |
|---|---|---|---|
| § 9.3 — V-series (V1–V10) | Backend defects, 2026-07-26 audit | 10 | **All done** — records only |
| **§ 9.4 — H-series (H1–H8)** | Frontend design + UX | 8 | H2 done; **H1, H3–H8 open** |
| **§ 9.5 — Q-series (Q1–Q9)** | Testing, as real student / shopkeeper scenarios | 9 | Q1/Q2 done; **Q3–Q9 open** |
| § 9.6 — B-series (B1–B16) | Deferred product decisions | 16 | **NOT authorized** — owner picks deliberately |
| **§ 9.7 — P-series (P1–P7)** | Install & distribution, the Settings screen | 7 | P1/P2/P3/P5/P6/P7 done; **P4 open** |
| **§ 9.8 — W-series (W1–W9)** | PWA / mobile defects, 2026-07-27 audit | 9 | W1/W2/W3/W4/W5/W6/W8/W9 done, W7 investigated |
| **§ 9.9 — M-series (M1–M6)** | Mobile experience — the app *as a phone app* | 6 | **All open** |
| **§ 9.10 — S-series (S1–S5)** | Trust & provenance | 5 | S1/S2 done; **S3/S4/S5 open** |
| § 9.11 — X-series (X1–X7) | Frontend defects + design, 2026-07-27 fourth pass | 7 | **All done** — records only |
| **§ 9.12 — Y-series (Y1–Y16)** | **Frontend defects + design elevation + visualizations, 2026-07-28 fifth pass** | **16** | **All done** |
| Deployment D-1..D-7 | Human-led, needs real infra | 7 | Open |

> **Note the section order.** § 9.6 (deferred, *not* authorized) sits between
> the authorized backlogs for historical reasons — later sections were appended
> after it rather than renumbering and breaking every cross-reference. This
> table is the navigation aid, not the file order.

> **Numbering note:** older commits reference "§ 9.5 (T-series)" and "§ 9.6
> (U-series)". Those are complete and were removed in the 2026-07-26 rewrite;
> § 9.3/9.4/9.5 now hold the V/H/Q backlogs. Map T → 2026-07-22 audit,
> U → 2026-07-25 audit, and read `git log`.
>
> **Section numbers are load-bearing.** Source comments cite them directly
> (`STATUS.md § 9.11-X2` in `Menu.tsx`, `§ 9.11-X5` in `Modal.tsx`, and
> others). Completed series keep their numbers when they collapse to records —
> new work gets the next number. Do not renumber.

### Start here

**§ 9.12 (Y-series) is 12/16 done — bundles Y0, M, N, O, P, Q have all
landed.** Suggested order for what's left:

1. **Y6** — `Orders.tsx`, the accept-with-nothing-checked guard. Small, and
   the file will get busier once Y15/H1 land, so a good first pick.
2. **Y15** — the queue-depth strip, same file as Y6 (sequence after it), and
   read § 9.4-H5 first so the two urgency treatments share one visual idiom.
   H1 (the cash drawer) also owns this file and is the largest of the three —
   land it last (see the bundle table's "K — shop orders page" row).
3. **Y12 → H3 → Y11**, in that order, all on `pages/student/OrderStatus.tsx`
   (the bundle table's "I — order-status page" row): Y12 is a two-line
   `localStorage` guard; H3 is the price-drift notice (V3 already landed, so
   it's unblocked); Y11 adds the elapsed-time line and is the largest — both
   Y11 and Y15 should be measured against the ~97 KB of precache headroom
   still left from Y1.
4. Then the still-open **H1, H3–H8** (H3 is part of step 3's bundle above,
   the rest aren't), **P4/P5**, **W3/W5/W8**, **M1–M6**, **S3/S4/S5**,
   **Q3–Q9** — none of these were touched this pass.

**Two things carry over and are still true:**

- **Do not promote the § 9.7 install push to real students until W3 is fixed.**
  Both prompt cards still collide with the bottom nav on notched iPhones —
  a bad first impression on the exact feature being promoted.
- **W5 (§ 9.8) needs a decision, not just code.** P3 built the *manual*
  Reconnect button; W5 also wanted the *silent* automatic re-post of a pruned
  subscription. Settle whether the button alone closes it before writing more.
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
| `ALLOWED_EMAIL_DOMAIN` | — | Required student email domain in production; no college is hard-coded |
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
`POST /api/auth/firebase {"id_token": "fake:someone@college.edu:Name"}`
(with `ALLOWED_EMAIL_DOMAIN=college.edu`).
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
8. **Performance budget — two numbers, both binding:**
   - **Initial student JS ≤ ~250 KB raw.** Measured **241.78 KB** on
     2026-07-28 (`dist/assets/index-*.js`) after H2, the § 9.7 Settings work,
     § 9.11's X-series and this pass's Y-series work — under, with ~8.2 KB of
     headroom. This is parse-and-execute on first paint.
   - **Service-worker precache ≤ ~800 KB.** Measured **702.92 KiB / 42
     entries — under the soft ceiling**, ~97 KB of headroom, after **Y1**
     (font reclaim, -105 KB) plus **Y2/Y4/Y5/Y14** adding back ~6.4 KB (stamp
     fill CSS, the History day-shape chunk, skeleton status markup). Was
     801.93 KiB / 49 entries, over the ceiling, before this pass.

     **Remaining headroom pays for Y11/Y15**, still open — treat it as spent
     as those land, not as free margin.

     **No charting library, at any budget.** The smallest mainstream one is
     ~90 KB gzipped — several times the entire student headroom — and none of
     them can be made to look like a canteen (§ 9.2). Visualizations are
     hand-drawn inline SVG or token-styled divs. This is a hard rule.

   New heavy dependencies must be lazy chunks (follow `App.tsx`'s route-group
   `lazy()` pattern). Menu photos always render through `cloudinaryThumb(url,
   2×display-px)` — never a raw `secure_url`. **Update both numbers here
   whenever `npm run build` changes them** (§ 12.5).
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
to be a real defect, not a false alarm. **The full task write-ups were removed
on 2026-07-28** — the table below is the record; `git log` has the reasoning.

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

**The finding, now measured.** The 2026-07-28 audit (§ 9.12) computed the WCAG
2.x ratios this task asked for and counted the usages. It is worse and more
widespread than the original estimate:

| Class | vs `paper` #EEDFBB | vs `steel` #DCE4DE | Usages | AA (4.5:1) |
|---|---|---|---|---|
| `text-ink/35` | 2.1:1 | 2.1:1 | 2 | **fail** |
| `text-ink/40` | **2.33:1** | 2.3:1 | 14 | **fail** |
| `text-ink/45` | ~2.6:1 | ~2.6:1 | 7 | **fail** |
| `text-ink/50` | **3.02:1** | **3.02:1** | 28 | **fail** |
| `text-ink/60` | **3.96:1** | ~3.9:1 | 26 | **fail** |
| `text-ink/70` | **5.31:1** | ~5.2:1 | 36 | pass |

**77 usages below AA**, and the failures are not decoration: they carry
timestamps, availability windows, "left to cook", every `hint` on every
`EmptyState`, and the shopkeeper's ready/handed-over counts. `text-ink/70` is
the floor that passes — it is already the most-used value in the codebase, so
the fix is mostly convergence on a value the design already reaches for.

The original estimate here (2.1:1 for `ink/40`) was close; treat the table
above as the number of record and re-derive it if the tokens change.

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
| B6 | Weekly/range shop insights | Backend aggregation across days. **§ 9.12-Y5 builds the single-day version** from data the endpoint already returns; anything comparing days ("busier than yesterday") needs a second fetch and lands here, not there. |
| B7 | Queue position / ETA for students | Backend derivation from pool state; needs careful honesty about accuracy. |
| B8 | Shopkeeper allowlist admin UI | Backend endpoints; today it's env-seeded, fine at this scale. |
| B9 | httpOnly cookie sessions | § 11.2 — an architecture project, not a task. |
| B10 | iOS splash screens | Pure asset generation; wait for D-6 to prove it's worth the asset set. |
| ~~B11~~ | ~~SW update-prompt UX~~ | **Superseded by § 9.8-W1.** This entry assumed `autoUpdate` *worked* and that a prompt was the alternative preference. It does not work — `injectManifest` mode never injects `skipWaiting`, so no update can ever activate. Fixing that is now a defect, not a preference. A prompt-based flow is still a legitimate choice, but it is one of W1's two possible fixes rather than a deferred nicety. |
| B12 | Abandoned-order recovery | An order with *some* but not all items handed over, then abandoned, has no terminal path — `Reject` refuses once `handed_qty > 0`, and `ExpiryTick` skips any order with handover activity (matches § 3's documented state machine, not a bug). The order — and the student's one-active-order slot — stays stuck. A real fix needs an explicit shopkeeper "write off / abandon" action: endpoint + service + UI + copy + Hindi pairing, and a product decision on what it means (unpaid-completed? a new terminal status?). |
| ~~B13~~ | ~~Lazy-split the shop shell~~ | **Promoted to § 9.4-H2** — the bundle is now over budget, so this is blocking rather than optional. |
| B14 | "Accept" with every item unchecked silently rejects the order | Unchecking *all* pending items and pressing green **Accept** sends `rejectedItemIds = all`, which the backend turns into a full rejection. Defensible, but a green "Accept" producing a rejection is a UX trap. A fix would disable/relabel Accept when nothing is checked — cosmetic, and a copy decision + Hindi pairing. |
| B15 | No business-day reset for `item_pool.qty` / `menu_items.out_of_stock` | `docs/SPEC.md` documents a `POST /api/shop/day/close` zeroing the pool and resetting stock, and `MenuRepo.ResetStock`/`PoolRepo.ZeroAll` still exist for it — but nothing calls either (no route, no service, no scheduler). Leftover pool units carry into the next business day and get instantly FCFS-allocated to the first new order: food from a previous day served without anyone cooking or acknowledging it. **Real and reachable.** The fix needs a product decision (automatic at local midnight vs. tied to the shop-status transition vs. an explicit shopkeeper action), not a targeted code change. **Note the interaction with V6** — fixing V6 makes any status-based day-reset implementation correct rather than subtly wrong. |
| B16 | A real Android app (Play Store TWA) | § 9.7 recommends the PWA install path and **explicitly rejects a hosted `.apk` download** — it excludes every iPhone on campus and triggers Android's "this file may be harmful" + "install unknown apps" warnings, which is the opposite of the owner's trust goal. If a store presence is genuinely wanted later, the path is a Trusted Web Activity via Bubblewrap: Play Console account, signing keys, a hosted `.well-known/assetlinks.json`, and a per-release build. That is an ownership commitment, not a task. **iOS has no equivalent** — Safari's Add to Home Screen stays the only route there, so the PWA work in § 9.7 is required either way and is never wasted. |

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

### 9.7 Install & distribution backlog (P-series) — P1/P2/P3/P6/P7 DONE, P4/P5 OPEN

**Owner's ask (2026-07-27):** *"make sure our app is downloadable in their phone
from the website directly — add a download button in Settings where people can
download our app from."*

#### The decision this rests on, stated plainly

There are two ways to read "downloadable," and they are not equally good ideas:

| | **PWA install** (recommended, and what this series builds) | **A real `.apk` download** |
|---|---|---|
| How | Browser's own "Add to home screen" / `beforeinstallprompt` | Wrap the site in a TWA (Bubblewrap), sign it, host the file |
| Cost | UI work only — the app is already an installable PWA | Play Console account, signing keys, `assetlinks.json`, an update channel we own, per-release builds |
| iPhone | Works (Safari "Add to Home Screen") | **Impossible.** No sideloading on iOS. Half the campus gets nothing. |
| Trust | Installs from `khaao.<domain>` over HTTPS, no OS warnings | Android shows *"this file may be harmful"* + "install unknown apps" — the exact thing the owner asked us to avoid |
| Updates | Ships with the next deploy | Every student must re-download, forever |

**Recommendation: build the PWA install path (P1–P7). Do not ship an APK.**
An APK download link is the single fastest way to make a legitimate app *look*
malicious to a student, and it excludes every iPhone on campus. If the owner
still wants a real store presence later, the path is a TWA in the Play Store,
not a file on a webpage — recorded as **B16** in § 9.6, not authorized here.

Everywhere below, **"Download the app" is the label students see; a PWA install
is the mechanism.** Do not write "install PWA" in the UI — nobody knows what
that means (§ 9.2 writing rules: name things by what the person controls).

| # | Priority | One-line | Files owned | Status |
|---|---|---|---|---|
| P1 | **HIGH — do first** | There is no Settings screen at all — build it, it's the container for everything else here | new `pages/Settings.tsx`, `App.tsx`, `components/layout/Layout.tsx` | **DONE** |
| P2 | **HIGH** | The "Get the app" section: a real, always-available download button per platform | new `components/settings/GetTheApp.tsx`, new `lib/install.ts` | **DONE** |
| P3 | **HIGH** | Notification controls in Settings — today there is no way back from a dismissed or denied prompt | `pages/Settings.tsx`, `components/layout/PushNotificationSetup.tsx` | **DONE** |
| P4 | **HIGH** | The manifest is too thin for a real install dialog — no `id`, no `screenshots` | `vite.config.ts`, new `public/screenshot-*.png` | Open |
| P5 | MEDIUM | Login is the first screen every student sees and it never mentions the app is installable | `pages/Login.tsx` | Open |
| P6 | MEDIUM | Nothing listens for `appinstalled` — the app can't tell installed from not-installed | `lib/install.ts`, `components/layout/InstallPrompt.tsx` | **DONE** |
| P7 | MEDIUM | Deploy-side: the install can't work correctly without cache headers and MIME types | `deploy/Caddyfile`, `deploy/RUNBOOK.md` | **DONE** |

**Sequencing:** P1 → P2 → (P3, P5, P6 in any order). P4 and P7 are independent
of all of them and can run concurrently from the start.

---

#### P4 — [HIGH] The manifest is too thin for a real install dialog

**Verified** against the built `dist/manifest.webmanifest`:

```json
{"name":"Khaao — canteen pre-order","short_name":"Khaao","description":"…",
 "start_url":"/","display":"standalone","background_color":"#dce4de",
 "theme_color":"#DCE4DE","lang":"en","scope":"/","icons":[…3 icons…]}
```

Missing, and each one costs something concrete:

| Field | What its absence costs |
|---|---|
| `screenshots` (with `form_factor`) | **The big one.** Without narrow-form-factor screenshots, Chrome on Android shows the cramped mini-infobar instead of the rich install dialog with app art. This is the difference between "some website wants to add an icon" and "this is an app." Directly undercuts the owner's ask. |
| `id` | App identity defaults to `start_url`. If `start_url` ever changes, every existing install is orphaned and re-installs as a second app. Set `"id": "/"` now — it is free today and unfixable later. |
| `display_override` | No `["standalone", "minimal-ui"]` fallback chain. |
| `categories` | `["food", "productivity"]` — used by install surfaces and listings. |
| `shortcuts` | A long-press on the home-screen icon offers nothing. Two entries — "My order" → `/order`, "Menu" → `/` — are a genuine daily-use win. Shop shortcuts are pointless (one device, always on `/shop`). |

**Screenshots must be real.** Capture them from the running app at 1080×1920
(`form_factor: "narrow"`): the student menu, and the ready-stamp moment — that
second one is the product's emotional peak (§ 9.2) and is what should sell the
install. Do not fabricate mockups. Save to `public/`, and note they are **not**
covered by the current `injectManifest.globPatterns` PNG glob concern in **W6
(§ 9.8)** — coordinate if W6 lands first, since screenshots must *not* be
precached (they are install-dialog art, never rendered in-app).

**Verify:** build, then load `dist/manifest.webmanifest` in Chrome DevTools →
Application → Manifest and confirm zero warnings and that the install dialog
preview shows the screenshots. Record the result here.

---

#### P5 — [MEDIUM] Login never mentions the app is installable

`pages/Login.tsx` is the first screen every student ever sees, and the only one
they see before signing in. It renders the K mark, "Order ahead · Skip the
line," a Google button and the allowed-domain line. Nothing about the app being
installable.

Settings (P1/P2) is behind the login wall — so on the very screen where a
student is deciding whether this thing is worth their Google account, the
install path is invisible.

**Fix shape:** one quiet line beneath the ticket card — "Add Khaao to your home
screen" — that opens the same install flow as P2 via `lib/install.ts`. It is a
footnote, not a second call to action: **Continue with Google stays the only
primary button on this screen.** Hide it entirely when `install.ts` reports
`installed` (a student opening the installed app is already there).

Pairs naturally with **S3 (§ 9.10)**, which adds the provenance line to this
same screen. Same file — **sequence them or give both to one agent** (§ 12.1).

**Test:** `Login.test.tsx` (new) — the line renders when promptable, is absent
when `installed`, and the Google button is unaffected in both.

---

### 9.8 PWA / mobile find-fix backlog (W-series) — W1/W2/W4/W6/W9 DONE, W3/W5/W8 OPEN, W7 INVESTIGATED (no change)

Found in the **2026-07-27 install-and-mobile audit**. Every item below was
verified against the code or the built output — the numbers quoted are measured,
not estimated.

| # | Severity | One-line | Files owned | Status |
|---|---|---|---|---|
| W1 | **CRITICAL** | The service worker can never activate an update — every installed phone is pinned to the build it first installed | `src/sw.ts` | **FIXED** — `skipWaiting()`/`clientsClaim()`/`cleanupOutdatedCaches()` added, live-verified present in `dist/sw.js`. Not verified on a real device/deploy (needs D-6). |
| W2 | **HIGH** | No cache-control policy at the edge — a stale `index.html` serves asset URLs that no longer exist | `deploy/Caddyfile`, `deploy/RUNBOOK.md` | **FIXED** — verified with `caddy validate` + local `curl -I`. Not verified against the real production domain (needs D-6). |
| W3 | **HIGH** | Both prompt cards collide with the bottom nav on notched iPhones | `components/layout/InstallPrompt.tsx`, `components/layout/PushNotificationSetup.tsx` | **Open, unstarted** — not touched by the 2026-07-27 third pass. Blocks promoting the install push to students (a bad first impression on the exact card being promoted). |
| W4 | **HIGH** | Covered by **P2/P6** — the install prompt is one-shot and unrecoverable | — (see § 9.7) | **FIXED** — P2/P6 landed (see § 9.7 table). |
| W5 | **HIGH** | A push subscription pruned by the backend is never re-created — notifications die silently and permanently | `components/layout/PushNotificationSetup.tsx` | **Open** — P3 (§ 9.7) built the *manual* Reconnect button in Settings, but the *silent automatic* re-post on mount is still not wired in. Decide whether the manual button alone closes this, or finish the silent path. |
| W6 | MEDIUM | The service worker precaches 1058 KB, of which 244 KB is fonts the app can never render | `vite.config.ts`, `src/main.tsx` | **FIXED** — precache now 799.06 KiB / 49 entries. Font imports narrowed to latin/latin-ext subsets, same weight set kept (mono 500/600/700, sans 400/500/600/700). |
| W7 | LOW | 39 legacy `.woff` files (~430 KB) ship to the server and are never fetched | `src/main.tsx` | **Investigated, not changed.** `@fontsource` bundles woff+woff2 in one `@font-face`; dropping `.woff` cleanly needs hand-authored `@font-face` rules (manual-sync risk against future `@fontsource` bumps). Shrank 39→14 files per format as a side effect of W6. |
| W8 | LOW | Both prompt cards are hand-rolled `fixed` divs, against § 9.1.3 | same files as W3 — fold into W3 | **Open** — folds into W3, not started. |
| W9 | LOW | `notificationclick` navigates to an unvalidated payload URL | `src/sw.ts` | **FIXED** — rejects `//`-prefixed/cross-origin URLs, falls back to `/`. Test-covered in `sw.test.ts`. |

---

#### W3 — [HIGH] Both prompt cards collide with the bottom nav on notched iPhones

**Verified by arithmetic against the source:**

| Element | Position | Height |
|---|---|---|
| `<nav>` (`Layout.tsx:374`) | `fixed bottom-0`, `z-30` | `h-14` (56 px) **+ `pb-safe`** = `env(safe-area-inset-bottom)`, **34 px** on a notched iPhone → **90 px** |
| `InstallPrompt` (`:97`) | `fixed bottom-20`, `z-40` | bottom edge sits at **80 px** |
| `PushNotificationSetup` (`:133`) | `fixed bottom-20`, `z-40` | identical |

80 px < 90 px, so on every iPhone with a home indicator the card's lower edge
sits **inside** the nav bar. At `z-40` over the nav's `z-30`, the card wins: it
covers the Menu/Order tab labels, and taps in that strip hit the card instead of
the tab. This is a direct § 9.1.4 violation on the app's two most important
one-time prompts — including the one asking students to install the app.

**It gets worse on the Menu screen.** The cart bar (`pages/student/Menu.tsx:588`)
is `z-50` and pinned at
`bottom-[calc(env(safe-area-inset-bottom)+56px)]` — which is **the correct
idiom, already in this codebase**, and it outranks the prompt cards. So during
the one moment that matters (a student with items in their cart), the cart bar
and an install card fight for the same strip.

**Fix shape:** replace `bottom-20` on both cards with the Menu's proven
expression, and add whatever additional offset keeps them clear of the cart bar
when it is present. Do not invent a third number — take the one that already
works.

**Fold W8 in here.** Both cards are hand-rolled `fixed` divs, which § 9.1.3
forbids ("every overlay goes through `Modal`/`ConfirmDialog`"). They are not
modal — they must not trap focus or lock scroll — so the right outcome is a
small shared `BottomSheetCard` in `components/ui/`, portalled to
`document.body` like `Modal`, owning the safe-area math once. Two files stop
duplicating it and § 10's `backdrop-filter` containing-block trap stops being
reachable (the nav directly above them has `backdrop-blur`).

**Test:** extend `PushNotificationSetup.test.tsx` and add an `InstallPrompt`
test asserting both render through the portal and carry the safe-area class.
Then screenshot at 375×667 **with a simulated safe-area inset** — the default
test viewport has none, which is exactly why this survived to now.

---

#### W5 — [HIGH] A pruned push subscription is never re-created

**Where:** `PushNotificationSetup.tsx:75–80`.

```ts
navigator.serviceWorker.ready.then((registration) => {
  registration.pushManager.getSubscription().then((subscription) => {
    if (subscription || installPromptShowingRef.current) return;   // ← here
    setShowPrompt(true);
  });
});
```

The presence of a **browser-side** subscription is taken as proof that the
**server** knows about it. Those are two different facts, and § 8 records that
the backend deliberately self-cleans dead subscriptions ("best-effort,
self-cleaning dead subscriptions").

**Failure scenario:** a student's phone is off for the weekend. The push service
returns `410 Gone` for their endpoint and the backend prunes the row — correct
behavior. The browser, meanwhile, still holds a `PushSubscription` object.
Monday, the student opens Khaao: `getSubscription()` returns non-null, the
component returns early, and **nothing is ever sent to the server again**. They
place orders all semester and never receive another ready notification. No
error, no prompt, no way to notice — the one screen-off signal the product has
(§ 9.1.9) is gone. Any backend restore-from-backup or a `push_subscriptions`
migration reproduces this across the entire student body at once.

**Fix shape:** when a local subscription exists, **re-post it** — call
`subscribeToPush(endpoint, p256dh, auth)` idempotently rather than returning
early. The endpoint already exists and re-subscribing an existing row must be a
no-op server-side (**verify that** before relying on it; if it is not, that is a
V-series item and must be recorded here). Do it once per session, not per
render, and never show the prompt card for it — this is silent repair, not a
user decision. Rate-limit awareness: it is one call per app open per student, on
an endpoint already covered by `middleware/ratelimit.go`.

Pairs with **P3 (§ 9.7)**, which gives the same repair a manual button for when
the silent path fails. Ship them together.

**Test:** extend `PushNotificationSetup.test.tsx` — an existing local
subscription re-posts to the server exactly once and shows no prompt; a fresh
`serviceWorker.ready` with no subscription still shows the prompt.

---

### 9.9 Mobile experience backlog (M-series) — OPEN, AUTHORIZED, UNSTARTED

**Owner's ask (2026-07-27):** *"frontend improvements we can make better for
user experience — focus more on mobile things only, many people won't use it
from laptop."*

Read § 9.1 and § 9.2 first — these sharpen the existing direction and none of
them is licence to restyle. Distinct from the § 9.4 H-series, which is about
screens that exist; these are about how the app behaves **as a phone app**.

| # | Priority | One-line | Files owned |
|---|---|---|---|
| M1 | **HIGH** | Launching the installed app with no network shows an error screen, not the app | `main.tsx`, `pages/student/Menu.tsx`, `pages/student/OrderStatus.tsx` |
| M2 | **HIGH** | There is no way to retry — a student on bad campus Wi-Fi has no gesture that means "try again" | `pages/student/Menu.tsx`, `components/layout/Layout.tsx` |
| M3 | MEDIUM | The offline banner reports the browser's opinion, not ours | `hooks/useOnlineStatus.ts`, `components/layout/Layout.tsx` |
| M4 | MEDIUM | `theme-color` is a single light value — the status bar is wrong in dark mode and on the ink surfaces | `index.html`, `vite.config.ts` |
| M5 | MEDIUM | Nothing is reachable one-handed on the tallest phones | `pages/student/Menu.tsx` |
| M6 | LOW | No `apple-mobile-web-app-status-bar-style` tuning or splash for standalone iOS | `index.html` (see § 9.6-B10) |

---

#### M1 — [HIGH] The installed app is unusable on a cold offline launch

**Verified.** `pages/student/Menu.tsx:330–335`:

```ts
if (menuQuery.isLoading || shopStatusQuery.isLoading) return <MenuSkeleton />;
if (menuQuery.isError && menuQuery.data === undefined) { …error screen… }
```

`OrderStatus.tsx:488–493` is the same shape. The `data === undefined` guard is
**correct and careful** — it is exactly what § 9.1.7 asks for, and it means a
*background* refetch failure never replaces rendered data. But TanStack Query's
cache is in-memory only. There is no persister configured in `main.tsx`. So
`data` is `undefined` on every cold start, and § 9.1.7's promise — "every screen
must stay usable on cached data" — holds **within a session and not across
one.**

**Failure scenario:** a student installs Khaao (which § 9.7 is about to make far
more common). They open it from the home screen in the basement lab, or in the
lift, or in the 12:45 crush when the campus AP is saturated. The service worker
serves the shell instantly — that part works. Then every query fails, `data` is
`undefined`, and they get an error screen. **The app they installed is more
broken offline than the website was**, because at least a browser tab kept the
last page. That is the opposite of what installing is supposed to buy.

**Fix shape:** persist the query cache. `@tanstack/react-query-persist-client`
with a `localStorage` persister is the intended mechanism.

- **Budget first (§ 9.1.8).** The persist packages are small but not free —
  measure the initial-chunk delta and record it. H2 left headroom (239.57 KB
  against 250 KB); do not spend all of it here. If it does not fit, a
  hand-rolled `localStorage` read/write on just the menu and active-order keys is
  an acceptable smaller answer — say which you chose and why.
- **Persist selectively.** The menu and the active order, yes. Anything derived
  or shop-side, no.
- **Say the data is stale.** A student must never mistake a cached menu for a
  live one — prices and stock change. One line in the § 9.2 voice, near the
  offline banner: *"Showing the menu from 11:42. Prices may have changed."*
- **Never let stale data reach a mutation.** Placing an order from a cached menu
  must still hit the network and still surface the 422 path (§ 9.4-H4). Cached
  reads, live writes — no exceptions.

**Test:** `Menu.test.tsx` — with a primed persisted cache and a failing query,
the menu renders with the staleness line rather than the error screen; with no
persisted cache the error screen still renders.

---

#### M2 — [HIGH] There is no retry gesture

Once a student lands on the error screen from M1, or on stale data, the only
recovery is closing and reopening the app. There is no pull-to-refresh, no retry
button on the error state (**verify** what `Menu.tsx`'s error branch actually
offers before writing the fix), and inside an installed PWA there is no browser
reload button either — that chrome is gone by definition.

**Fix shape:** the smallest thing that works, in this order:

1. A **Try again** button on every error state, wired to the query's `refetch`.
   This is the required minimum and is cheap.
2. Refetch on regained connectivity — `useOnlineStatus` already knows; have the
   transition to online invalidate the active queries.
3. Pull-to-refresh only if 1 and 2 leave a real gap. Hand-rolled
   pull-to-refresh on iOS fights the native overscroll and is a reliable source
   of scroll bugs; **do not add a library for it** (§ 9.1.10).

Not a spinner-and-hope: the button says what it does and shows a pending state
(§ 9.1.7).

**Test:** `Menu.test.tsx` — the error state renders a retry control that calls
`refetch`; an offline→online transition triggers a refetch.

---

#### M3 — [MEDIUM] The offline banner reports the browser's opinion

`Layout.tsx:359` renders "You're offline — reconnecting…" from
`useOnlineStatus()`. `navigator.onLine` is famously weak: it reports whether an
interface is *up*, not whether anything is reachable. Campus captive portals and
a saturated AP both present as online.

The app already knows better in two places: `apiFetch` throws `ApiError(0, …)`
on network failure (`api/client.ts:95`), and `useSSE` tracks its own connection
with jittered backoff. Either is far stronger evidence than `navigator.onLine`.

**Fix shape:** keep `navigator.onLine` as the fast negative signal (when it says
offline, we are), and add a positive one — treat a live SSE connection as
"connected," and a run of `ApiError(0)` as "not." Show the banner on the union.
Keep the copy honest about which state we are in; do not claim "reconnecting" if
nothing is reconnecting.

Small and self-contained. **Sequence with M2** — both touch the same connectivity
signal.

**Test:** extend `useSSE.test.ts` / add `useOnlineStatus` coverage — the banner
appears on repeated network-class API errors while `navigator.onLine` is true.

---

#### M4 — [MEDIUM] `theme-color` is a single light value

`index.html:8` sets `theme-color: #DCE4DE` (steel), and the manifest repeats it.
One value, unconditional. In an installed PWA that color paints the status bar
and the Android navigation bar. On the ink-background surfaces (the prep
chalkboard, § 9.2) the status bar stays pale steel above a near-black screen,
which reads as a rendering fault rather than a choice.

**Fix shape:** add a `prefers-color-scheme: dark` variant `<meta>` and, if it
proves worthwhile on a real device, drive it per-route for the ink surfaces.
Stay inside the § 9.1.10 token set — this is picking the right existing token,
not inventing a color. iOS behavior is only ever proven on a real device (§ 9.1.1,
D-6) — record what actually happened, and do not claim the iOS half without one.

Pairs with **M6** and § 9.6-B10 (splash screens); same file, same device session.

---

#### M5 — [MEDIUM] Nothing is reachable one-handed on tall phones

The header (`Layout.tsx:324`) is `sticky top-0` and holds the account menu, and
after P1 it holds the route into Settings. On a 6.7" phone the top of the screen
is not reachable with a thumb while holding the phone one-handed — and a student
in a lunch queue is holding a phone in one hand and, frequently, a bag in the
other.

The app already does the important half right: the cart bar and the nav are
bottom-docked, and `Modal` is a bottom sheet on phones. The gap is the header
cluster.

**Fix shape:** audit what genuinely must live in the header versus what could be
reached from the bottom. Resist adding a second bottom bar — the answer is
probably that the header keeps identity and status (the K mark, the shop status
pill) while *actions* migrate into the account sheet, which itself should open as
a bottom sheet on phones rather than a top-anchored dropdown. `AvatarMenu` is
currently `absolute right-0 top-full` — a dropdown hanging from the top-right
corner, the least reachable point on the screen.

**Do this after P1**, so the audit sees the final set of header entry points.
Measure on a 430×932 viewport and record what moved and why.

---

#### M6 — [LOW] iOS standalone chrome is untuned

`apple-mobile-web-app-status-bar-style` is `default` (`index.html:11`), and there
are no iOS splash screens (§ 9.6-B10, deferred as pure asset generation). Both
only matter in standalone mode and both can only be judged on a real device.
**Bundle this with D-6** rather than guessing; an agent cannot verify it and must
not claim to have.

---

### 9.10 Trust & provenance backlog (S-series) — S1/S2 DONE, S3/S4/S5 OPEN

**Owner's ask (2026-07-27):** *"make sure the app is not malicious."*

Two separate questions live inside that sentence, and both deserve a straight
answer.

**1. Is Khaao malicious? No.** That is a factual claim about this repository and
it holds up:

- No obfuscated or minified-by-hand source, no `eval`, no dynamic script
  injection. CSP is `script-src 'self'` with no `unsafe-inline`/`unsafe-eval`
  (§ 11.5), which structurally forbids the main injection vectors.
- No analytics, no third-party trackers, no ad SDKs. Third-party network egress
  is exactly three destinations, each doing one declared job: Firebase (Google
  sign-in), Cloudinary (menu photos), and the browser's own push service. The
  CSP `connect-src` pins that list.
- Data collected is what the product needs and nothing more: name, college
  email, role, orders. No location — `Permissions-Policy` explicitly disables
  `geolocation`, `microphone`, `camera` (`middleware/security.go`).
- No secrets in the repo. Verified: `git ls-files | grep .env` returns only
  `.env.example` files; `.gitignore` covers `.env` and `keys.txt`.
- The known gaps are *written down* in § 11 rather than hidden, which is the
  actual difference between an app with weaknesses and a dishonest one.

**2. Will it *look* trustworthy to a student on install day?** Less so, and
that is what this series fixes. A page that asks for a Google account while
telling you nothing about who runs it is indistinguishable from a phishing page
to a careful person — and the § 9.7 install flow is about to ask students for
more trust, not less.

| # | Priority | One-line | Files owned |
|---|---|---|---|
| S1 | **HIGH** | The app HTML can be framed by any site — the anti-clickjacking header only covers the API | `deploy/Caddyfile`, `backend/internal/middleware/security.go` | **FIXED** — `frame-ancestors 'none'` + `X-Frame-Options: DENY` added to the Caddy `header` block. The Caddyfile's old "identical headers" comment was false; corrected. |
| S2 | **HIGH** | Nobody sets HSTS — both layers document it as the other one's job | `deploy/Caddyfile` | **FIXED** — `Strict-Transport-Security: max-age=31536000; includeSubDomains`, deliberately no `preload` (documented why in RUNBOOK.md). |
| S3 | MEDIUM | Login and Settings never say who runs Khaao or what it stores | `pages/Login.tsx`, `pages/Settings.tsx` | **Open** — P1 left an explicit "Coming soon." TODO placeholder in Settings' "About Khaao" section rather than fabricating operator/contact/data-handling facts. Needs real facts from the owner before writing. |
| S4 | MEDIUM | No build identity — a student and a maintainer cannot agree on what version is running | `vite.config.ts`, `pages/Settings.tsx` | **Open** — P1 left the version/build footer out entirely with a TODO comment, no fabricated string. |
| S5 | MEDIUM | Dependency and license provenance is unverified | `frontend/package.json`, `.github/workflows/` | Open, unstarted. |

---

#### S3 — [MEDIUM] Nothing says who runs Khaao

`pages/Login.tsx` renders the K mark, a tagline, a Google button and "Use your
@sst.scaler.com account." A student's entirely reasonable question — *who is
this, and what happens to my data?* — has no answer anywhere in the product.

This is not a legal checkbox. It is the difference between an app that reads as
official and one that reads as a scrape.

**Fix shape:**

- **Login:** one line under the card. Who operates it (the canteen / the college
  club that built it), and that it uses Google sign-in only to confirm you are a
  student. Quiet, small, in the § 9.2 voice — the sign-in button stays the only
  primary element on the screen.
- **Settings → About Khaao** (P1's fourth section) says it properly: what Khaao
  stores (name, college email, your orders), what it does not (no location, no
  payment details, no third-party trackers — **all three are true today; verify
  each is still true before writing it**), who to contact, and that there are no
  in-app payments and never will be (§ 1). That last one is worth stating
  outright — "we will never ask you to pay in the app" is the single most useful
  anti-phishing sentence this product can contain, because it makes any future
  fake payment screen self-evidently fake.
- Shopkeeper strings need Hindi pairs (§ 9.1.11).

**Do not invent facts.** If the operator name or a contact address is not known,
leave a clearly-marked placeholder and flag it here rather than writing something
plausible. **This is the one task in this file where a fabricated detail causes
real harm** — it would put a false claim about data handling in front of 2000
students.

**Sequence with P5** — same file, same screen.

---

#### S4 — [MEDIUM] No build identity

Nothing in the UI, and nothing in the built output, identifies which build is
running. Combined with **W1** (installed phones pinned to whatever they first
installed), this means a student reporting a bug and a maintainer looking at
`main` have no way to establish they are discussing the same code — and no way
to discover that the student's app is three deploys behind, which after W1 is
the *likely* case.

**Fix shape:** inject the short git SHA and build timestamp at build time via
Vite `define`, render them in Settings' footer as small mono text (§ 9.2:
numbers are the mono voice), and have the backend `/api/health` return its own
build identity so the two can be compared. Keep it factual and unlabelled-as-
important: a version string is a debugging tool, not a feature.

**Test:** `Settings.test.tsx` asserts the version string renders; it does not
assert the value.

---

#### S5 — [MEDIUM] Dependency provenance is unverified

`frontend/package.json` has 7 runtime dependencies and 24 dev dependencies —
lean, and every runtime one is a recognizable, widely-audited package (React,
react-router, TanStack Query, Firebase, fontsource). That is a good position to
be in, but it is currently an *impression*, not a verified fact, and the
`.github/workflows/` gate does not check it.

**Fix shape:**

- Run `npm audit --omit=dev` and `go list -m all | nancy` (or `govulncheck`, which
  is the better fit for Go) once by hand and **record the output here**. That is
  the deliverable — a snapshot with a date, not a vague assurance.
- Add `govulncheck` to the backend CI job. It is fast, low-noise, and
  reachability-aware, so it will not drown the gate in irrelevant advisories.
- Decide on `npm audit` in CI deliberately: it is noisy on dev dependencies and a
  failing gate that everyone learns to ignore is worse than no gate (§ 10 has
  the matching lesson about `scripts/loadtest.js`). Scoping it to
  `--omit=dev --audit-level=high` is the version worth having.
- Confirm `package-lock.json` is committed and CI uses `npm ci`, not
  `npm install`, so builds are reproducible. **Verify this rather than assuming
  it** — check the workflow file.

**Not in scope:** adding SBOM generation, signing, or a supply-chain scanner
service. This is a college canteen app; the goal is knowing what we ship, not a
compliance program.

---

### 9.11 Frontend find-fix + design-elevation backlog (X-series) — DONE (2026-07-27, fourth pass)

Found in the **2026-07-27 fourth-pass frontend audit** (owner's brief: find
remaining bugs and make the frontend the best version of itself). Every defect
below was verified against the current source — file and line references are
from the tree at the time of writing. X1–X4 are defects; X5–X7 sharpen the
§ 9.2 identity on the surfaces it hasn't reached yet. **All seven landed the
same day**, one agent, test-first per § 12.2 (X6/X7 used before/after
verification against the live dev server in place of a red test, as the
section originally allowed), full frontend gate green at the time
(242.10 KB initial JS / 801.93 KiB precache — see § 9.1.8 for the current
numbers). Landed as **one commit** rather than split by task — the
tasks touch a small, overlapping set of files (see the bundle table in § 12)
and none of the individual diffs was large enough to justify seven review
points.

| # | Priority | Kind | One-line | Files owned | Status |
|---|---|---|---|---|---|
| X1 | **HIGH** | Defect | A failed history fetch renders as a confident "No past orders yet" — a false claim with no retry | `pages/student/OrderStatus.tsx` | **Fixed** — added the `historyQuery.isError && data===undefined` guard (mirroring the existing `activeOrderQuery` idiom on the same page), an error+retry state in the History section, and gated the first-time-user welcome on `!historyFailed`. |
| X2 | **HIGH** | Defect | Granting notification permission after placing an order never creates a push subscription — permission granted, notifications still dead | `pages/student/Menu.tsx` | **Fixed** — swapped the bare `Notification.requestPermission()` for the shared `requestNotificationPermissionAndSubscribe()` (`lib/push.ts`, the same flow P3 built for Settings), still fire-and-forget, still errors swallowed. |
| X3 | MEDIUM | Defect | The shop's order modal shows a stale order forever once the order leaves the list — live-looking buttons that can only 409 | `pages/shop/Orders.tsx` | **Fixed** — chose the terminal-notice path over auto-close+toast: once the order id is no longer in `allInProgress` *and* the query isn't mid-refetch, the modal swaps to a one-line notice + Close button instead of falling back to the stale copy. |
| X4 | MEDIUM | Defect | Toast: dismiss target is ~20 px (§ 9.1.2 says 44), and critical error toasts vanish in 5 s flat | `components/ui/Toast.tsx` | **Fixed** — 44px dismiss target with an inline stroke-SVG X (see X5), variant-aware duration (error 10s, success/info 5s, never persistent), dropped the redundant `aria-live="polite"` wrapper now that `role="alert"` already carries it, capped the visible stack at 3 (oldest dropped). New `Toast.test.tsx`. |
| X5 | MEDIUM | Design-defect | Text glyphs (✕ ✓ → ★) stand in for icons across the app, against § 9.2's own rule and the established stroke-SVG language | sweep: `Toast.tsx`, `OrderModal.tsx`, `Orders.tsx`, `Menu.tsx`, `OrderStatus.tsx` | **Fixed** — swept all six listed occurrences to inline stroke SVGs. **Scope note:** also swept `components/ui/Modal.tsx`'s own close-button ✕, which the original audit missed — it's the identical glyph on the one dialog chrome every overlay in the app shares, so fixing Toast's copy and leaving Modal's felt like an obvious gap once seen. Kept the deliberate exception exactly as scoped: the *read-only* rating-display `★` in `MenuItemCard.tsx`/`TrendingRail.tsx`/`MenuManage.tsx` stays text (running-prose convention); the *interactive* rating-control `★` in `OrderStatus.tsx`'s `RatingPrompt` (a real 44px input) was drawn as an SVG, per the task's own recommendation for that case. |
| X6 | MEDIUM | Design | Checkout — the moment the chit is printed — is a generic list-total-button modal | `pages/student/Menu.tsx` (checkout modal only) | **Fixed** — total set at `text-3xl` mono display size, item list wrapped in a dashed-border/`steel`-tint "chit" frame (Login's `ticket-notch` card language, minus the punch-hole pseudo-elements — those are negative-offset and would be clipped by `Modal`'s own `overflow-hidden` sheet, a real constraint, not a shortcut), and a quiet line under Place order: "You'll get a token number — pay at the counter when you pick up." Bundle cost: +0.61 KB shared with X2/X5/X7 (see "Current state"). |
| X7 | LOW | Design | The student's "pay at the counter" banner is a plain colored box on the app's second-most-loaded money moment | `pages/student/OrderStatus.tsx` (banner only) | **Fixed** — amount promoted to `text-4xl` mono display, tabular figures, matching `ReadyBanner`'s countdown scale discipline; "Pay at the counter" demoted to a small uppercase label above it. |

**Sequencing / shared files (§ 12.1):** X1 and X7 share `OrderStatus.tsx` with
each other **and with H3** — one agent takes all three, or they run strictly in
sequence. X2 and X6 share `Menu.tsx` with **H4** — same rule. X3 shares
`Orders.tsx` with **H1** — same rule. X4 and X5 both touch `Toast.tsx` — do X4
first, X5's sweep then replaces the glyph it owns. X5 is otherwise last in any
sequence, since it sweeps files the others edit.

---

### 9.12 Frontend defect + design-elevation backlog (Y-series) — 12/16 DONE (Y1–Y5, Y7–Y10, Y13, Y14, Y16), Y6/Y11/Y12/Y15 OPEN, AUTHORIZED

Found in the **2026-07-28 fifth-pass frontend audit**. Owner's brief: *"find
issues, any optimization needed; frontend improvements, visualizations for
better UX/UI — I want it to look the best, best experience, smooth."*

Every finding below was verified against the current tree — source lines, the
**compiled** CSS in `dist/`, the built bundle, and measured contrast ratios.
Numbers quoted are measured, not estimated. Where a check was not run, the
entry says so.

**This series does not duplicate open H-work.** Two findings this audit
surfaced are already owned by existing tasks and were folded into them rather
than renumbered:

- **Text contrast** → **§ 9.4-H7**, still open. This audit measured the actual
  ratios H7 asked for and wrote them into H7's entry. Do not open a Y-task for
  contrast; do H7.
- **Prep board wait times** → **§ 9.4-H5**, still open. Y15 below is the
  *shopkeeper's queue-depth* surface on `Orders.tsx`, which is a different
  screen; read H5 first so the two stay one visual language.

| # | Priority | Kind | One-line | Files owned |
|---|---|---|---|---|
| Y1 | **DONE** | Optimization | 120 KB of precached `latin-ext` font subsets the app can never render — the whole reason there is no byte headroom | `src/main.tsx` — precache 801.93 KiB/49 → **696.51 KiB/42 entries** |
| Y2 | **DONE** | Defect | `bg-current/10` compiles to nothing — every status stamp, the app's signature element, ships with its ink wash missing | `components/student/StatusStamps.tsx` |
| Y3 | **DONE** | Defect | Every dialog in the app announces as an unnamed "dialog" — `aria-modal` with no `aria-labelledby` | `components/ui/Modal.tsx` |
| Y4 | **DONE** | Design | The student's menu row — the most-looked-at surface in the product — is a generic delivery-app list item | `components/student/MenuItemCard.tsx`, `components/ui/QtyStepper.tsx` |
| Y5 | **DONE** | Design/viz | The shop's History page is the business, rendered as three stat cards. No sense of the day's shape | `pages/shop/History.tsx` |
| Y6 | MEDIUM | Defect | Accept with every item unchecked submits an "accept" that rejects the whole order | `pages/shop/Orders.tsx` |
| Y7 | **DONE** | Defect | `Modal` sizes to `vh` on a codebase that already knows `vh` is wrong on iOS | `components/ui/Modal.tsx` |
| Y8 | **DONE** | Defect | Four horizontal rails are unreachable by keyboard | `TrendingRail.tsx`, `FavoritesRail.tsx`, `MenuSkeleton.tsx`, `pages/student/Menu.tsx` |
| Y9 | **DONE** | Defect | `QtyStepper` — the app's most-tapped control — still uses text glyphs and announces nothing when the quantity changes | `components/ui/QtyStepper.tsx` |
| Y10 | **DONE** | Defect | A drag that starts inside a modal and ends on the backdrop closes the modal | `components/ui/Modal.tsx` |
| Y11 | MEDIUM | Design/viz | The student watches an order with no sense of elapsed time | `pages/student/OrderStatus.tsx` |
| Y12 | LOW | Defect | `markAsRated` writes to `localStorage` unguarded while its paired read is guarded | `pages/student/OrderStatus.tsx` |
| Y13 | **DONE** | Defect | Top-items bar computes `NaN%` width on an all-zero day | `pages/shop/History.tsx` |
| Y14 | **DONE** | Defect | Every loading skeleton is `aria-hidden` with nothing announced in its place | `History.tsx`, `MenuManage.tsx`, `Prep.tsx`, `Orders.tsx`, `OrderStatus.tsx`, `MenuSkeleton.tsx` |
| Y15 | LOW | Design/viz | The shopkeeper cannot see how deep the queue is without counting cards | `pages/shop/Orders.tsx` |
| Y16 | **DONE** | Design | Every price in the app carries `.00` on a menu with no paise | `lib/format.ts` |

**The budget was the constraint on this whole series — Y1 has landed.**
Precache is now **696.51 KiB / 42 entries, under the ~800 KB soft ceiling**
(was 801.93 KiB, over — § 9.1.8). Y1 reclaimed ~103 KB of real headroom; that
is what pays for Y4, Y5, Y11 and Y15. Treat it as spent as those land, not as
free margin.

**No charting library. Not one.** Y5, Y11 and Y15 are all "visualization"
tasks and the reflex is to reach for Recharts/Chart.js/D3 — the smallest of
them is ~90 KB gzipped, which is the entire student bundle headroom several
times over, and none of them can be made to look like a canteen (§ 9.2). Every
chart in this series is hand-drawn: inline SVG or flex/grid divs with the
existing tokens. This is a hard constraint, not a preference.

**Sequencing / shared files (§ 12.1):**

- Y3, Y7 and Y10 all own `components/ui/Modal.tsx` — **one agent takes all
  three**, they are three small diffs in one file.
- Y4 and Y9 share `QtyStepper.tsx` — Y9 first (it fixes the control), Y4 then
  restyles the row around it.
- Y5 and Y13 own `pages/shop/History.tsx` — Y13 is a one-line guard, fold it
  into Y5's agent.
- Y6 and Y15 own `pages/shop/Orders.tsx`, **and so does the still-open
  § 9.4-H1**. Three tasks, one file — sequence them or give all three to one
  agent. H1 is the largest; it should go last.
- Y11 and Y12 own `pages/student/OrderStatus.tsx`, **and so does the
  still-open § 9.4-H3**. Same rule.
- Y1 must land before Y4/Y5/Y11/Y15 are measured, or their bundle numbers are
  meaningless.

**Expected output for every task below** (the standard four, per § 12):
1. The fix, matching the "Fix shape" line.
2. The regression test named in "Test first," confirmed red against the
   unfixed code before the fix (§ 12.2).
3. The full frontend gate green (§ 6), with the bundle and precache numbers
   updated in § 9.1.8 if `npm run build` moved them.
4. This file updated — move the task into the § 9.12 record table with what
   actually landed, including anything you found that the entry got wrong.

---

#### Y1 — DONE (2026-07-28)

Deleted the seven `latin-ext` `@fontsource` imports from `src/main.tsx`
(mono 500/600/700, sans 400/500/600/700 — the basic-Latin weights, kept).
Khaao renders only basic Latin and Devanagari; Devanagari already falls back
to a system font since Plex ships no Devanagari glyphs, so latin-ext was
rendering nothing. Same class of fix as § 9.8-W6, one subset further.

**Measured:** precache **801.93 KiB / 49 entries → 696.51 KiB / 42 entries**
— better than the ~682 KiB estimate. Full frontend gate green (tsc/lint/
111 vitest tests/format/build). The `user.name` latin-ext edge case (a student
named e.g. Łukasz) was checked against source only: `tailwind.config.js`
already declares the `-apple-system, BlinkMacSystemFont, sans-serif` fallback
chain, so the glyph still renders, in a different face — this was **not**
visually verified in a running browser this pass (§ 12.8: mechanism confirmed
in source, not observed live).

---

#### Y2 — DONE (2026-07-28)

`STAMP_BASE`'s `bg-current/10` compiled to nothing (Tailwind 3 can't apply an
opacity modifier to `currentColor`) — confirmed via `grep -c "bg-current"
dist/assets/*.css` → 0 before the fix. Added a real per-stamp fill token
(`bg-ink/10`, `bg-turmeric-pale/60`, `bg-stamp-light/50`, `bg-brand-light/60`)
to the `STAMPS` table, plus one for the void stamp. Test is a build-output
assertion (`StatusStamps.test.tsx`, greps the compiled CSS for each class) —
confirmed red on the old code, green after. Visually checked the compiled CSS
against a static 375px harness (Playwright) for all four landed states plus
the void state — each shows a visible tinted wash under its border/text color.

---

#### Y3 — DONE (2026-07-28)

`Modal.tsx` dialogs had `role="dialog"`/`aria-modal` but no accessible name.
Added `useId()`-generated title/subtitle ids, wired `aria-labelledby` to the
title div and `aria-describedby` to the subtitle when present; falls back to
`aria-label="Dialog"` when no title is given (never a dangling
`aria-labelledby`). `Modal.test.tsx` (new, shared with Y7/Y10) confirmed red
then green.

---

#### Y4 — DONE (2026-07-28)

Rebuilt `MenuItemCard.tsx`'s name/price line as a **menu board** leader:
`[VegMark] Name ⋯⋯⋯⋯ Price`, price anchored at a fixed right edge via a
`flex-1` dotted-border spacer, name truncating into the leader instead of
wrapping. Collapsed the stepper: at `qty 0` (and orderable) a single 44px
**Add** button renders instead of the always-present stepper; tapping it sets
qty 1 and swaps in the full `QtyStepper` (Y9's fixed control), which reverts to
Add at zero. Out-of-stock items never show Add. No new tokens. Extended
`Menu.test.tsx` (+4 tests), confirmed the Add/stepper-swap assertions red then
green. Initial JS bundle unchanged at **241.74 KB** — `MenuItemCard`/`Menu`
already lived in the lazy student-route chunk, not the eager initial bundle.

---

#### Y5 — DONE (2026-07-28)

Added two client-derived, hand-drawn (no charting library) visualizations to
`History.tsx`: a **day-shape** chalkboard block (`ink` background, same idiom
as `Prep.tsx`'s tally strip) bucketing orders into 48 half-hour slots —
stacked kraft-chit rectangles up to a threshold, then a degrade to a solid
proportional bar, hour labels a canteen thinks in, plus a one-line busiest-slot
summary computed from that day only; and a **Top earners** card ranking items
by `qty × price_each` (a different, and sometimes differently-ordered, metric
than the existing qty-based "Top items"). No cross-day comparison invented —
out of scope per the task's own instruction. `History.test.tsx` (new)
confirms the derivation is real (a fixture where the top-earning item isn't
the top-qty item) — red then green. Shop-only chunk confirmed still
lazy-loaded, unaffected by the student initial bundle.

---

#### Y6 — [MEDIUM] Accept with nothing checked submits an "accept" that rejects everything

**Where:** `pages/shop/Orders.tsx` — `IncomingOrderCard`, `acceptMutation`
(line ~159): `const rejectedItems = pendingItems.filter((i) => !checked[i.id])`.

Every pending item starts checked. Unchecking one marks it out of stock and
drops it from the order — that is the intended flow and the card's own copy
explains it. But there is no floor: uncheck **all** of them and **Accept**
stays enabled, sending an accept whose `rejected_item_ids` is the entire order.

**Failure scenario:** 12:47, the rush. The shopkeeper is out of everything on a
two-item order and unchecks both, reading the tick as "do I have this?" rather
than "keep this." They tap **Accept**. Depending on how the backend handles a
fully-rejected accept, the student either gets an order containing nothing or a
rejection that arrived through the accept path — and the shopkeeper believes
they accepted an order. Either way the two ends of the counter now disagree, and
the shopkeeper's mental model of the control is wrong in a way nothing on screen
corrects.

**Check the backend before choosing the fix.** `V4` (§ 9.3, landed) tightened
`Accept`'s handling of `rejected_item_ids`; read what it actually does with a
full set now. If it already 400s, this is purely a client-side affordance
problem. If it does not, say so in your write-up — a backend guard would be
V-series scope, not this task's.

**Fix shape:** when nothing is checked, the action is a rejection and the UI
should say so. Either disable **Accept** with a one-line reason under it
("Nothing left to accept — use Reject"), or relabel the button to **Reject**
and route it through `rejectMutation` so the student gets the rejection path
they should get. Prefer the first: silently changing what a button does under
the shopkeeper's finger during a rush is worse than disabling it. Keep the
Hindi pair.

**Test first:** extend `Orders.test.tsx` — unchecking every item on a two-item
incoming card disables **Accept** and shows the reason; `acceptOrder` is never
called; one item checked leaves it enabled. Confirm it fails red today.

---

#### Y7 — DONE (2026-07-28)

`max-h-[92vh]`/`sm:max-h-[88vh]` → `max-h-[92dvh]`/`sm:max-h-[88dvh]` in
`Modal.tsx`. Test is intentionally weak (jsdom can't evaluate viewport units;
asserts the class list only) — real verification is desktop-Safari sizing
sanity, not an iOS device (§ 12.8 — not claimed as iOS-verified, that's D-6).

---

#### Y8 — DONE (2026-07-28)

Added `tabIndex={0}` plus `role="group"` and an `aria-label`/`aria-labelledby`
(reusing each rail's existing section heading id where one exists) to
`TrendingRail.tsx`, `FavoritesRail.tsx`, and `Menu.tsx`'s sticky category chip
strip. The `MenuSkeleton` rail is decorative — made `aria-hidden` instead of
focusable, the more honest fix. Focus ring comes free from the existing global
`:focus-visible` style. Covered in `Menu.test.tsx`, confirmed red then green.

---

#### Y9 — DONE (2026-07-28)

Swapped `QtyStepper.tsx`'s `−`/`+` text glyphs for inline stroke SVGs matching
the X5 sweep's language. Value span now carries `aria-live="polite"` plus an
accessible label naming what it counts (new optional `label` prop, so callers
can name the item) — kept local per stepper instance rather than routing
through the global `liveAnnouncer`, since the control can appear many times per
page. The `max`-reached case gets a quiet accessible-only cue (`"...maximum N
reached"` in the label) rather than a silent disable. `QtyStepper.test.tsx`
(new, 10 tests) confirmed red then green; full min/max/disabled/
disableIncrease regression cover included.

---

#### Y10 — DONE (2026-07-28)

Backdrop `onClick={onClose}` now only fires when the interaction both starts
and ends on the backdrop itself — a `mousedown`-target ref recorded in
`onMouseDown`, checked in `onClick` alongside the click's own target. A drag
starting on the sheet and releasing past its edge no longer closes the modal;
a full backdrop click still does. Covered in the shared `Modal.test.tsx`.

---

#### Y11 — [MEDIUM] The student watches an order with no sense of elapsed time

**Where:** `pages/student/OrderStatus.tsx` — `ActiveOrderView`.

**The gap.** The page shows the token, the stamps, the items, the total. Once
the order is `ready`, `ReadyBanner` runs a real countdown — the one moment on
the page with a live figure. Everything before that is static: a student who
ordered at 12:47 and is waiting has no idea whether it has been two minutes or
eleven, and refreshing tells them nothing new. `Orders.tsx` already computes
and displays order age for the *shopkeeper*; the student, who is the one
actually waiting, does not get it.

**What to build.** The chit is a physical object that gets *punched* with a
time at the counter. Put that on the ticket: the time the order was placed, and
the time elapsed since, in the mono chit voice — one line, at label scale, under
the token. It ticks live off the same one-interval-per-page pattern
`ReadyBanner` already uses (do not add a timer per item). As the order moves
through the stamps, the elapsed figure is the only thing that changes, and that
is the point: it makes the page feel alive while nothing is happening, which is
exactly the interval students currently spend re-opening the app.

**Do not invent an ETA.** There is no prep-time data anywhere in this system —
not in the menu, not on the order, not in the backend. A "ready in ~8 min"
figure would be fabricated, and a wrong ETA at a canteen counter is worse than
no ETA (§ 9.2: errors never mislead; the same holds for predictions). Elapsed
time is a fact. Show the fact.

**Rules.** Reduced motion: the figure updates, it does not animate. Do not
compete with `ReadyBanner` — once the order is `ready`, the countdown is the
hero and the elapsed line should recede or go away. Keep the interval cleaned
up on unmount. Student-facing copy is English-only (§ 9.1.11).

**Watch the budget:** student-path code, initial chunk. Small, but measure it.

**Test first:** extend `OrderStatus.test.tsx` — an order created 6 minutes ago
renders an elapsed figure of 6 minutes; the figure advances on a faked timer
tick; a `ready` order does not render two competing timers; the interval is
cleared on unmount. Confirm red today.

---

#### Y12 — [LOW] `markAsRated` writes to `localStorage` unguarded

**Where:** `pages/student/OrderStatus.tsx:505-512`.

The paired *read* three lines above is wrapped in `try/catch` (line 497-503);
the write is not. Every other `localStorage` write in this codebase is guarded
— `Menu.tsx`'s diet filter (line 79-85) and favorites (line 102-108) both
catch, with a comment naming the private-browsing/quota case.

**Failure scenario:** Safari private browsing, or a phone at its origin quota.
The student submits a rating; `submitRatings` succeeds; `onDismiss` fires;
`markAsRated` throws inside a React event handler. The throw escapes into
`ErrorBoundary` and the student loses the page after a *successful* rating —
the one interaction in the product that is pure goodwill.

**Fix shape:** wrap the write, matching the existing idiom and comment style in
`Menu.tsx`. Keep the `setRatedOrders` state update outside the `try` so the
prompt still dismisses for this session even when persistence fails.

**Test first:** extend `OrderStatus.test.tsx` — with `localStorage.setItem`
stubbed to throw, dismissing the rating prompt does not throw and the prompt
still disappears. Confirm red today.

---

#### Y13 — DONE (2026-07-28)

`maxQty` in `History.tsx` now floors at `Math.max(1, ...)` before the
division, so an all-zero day produces a valid width instead of `NaN%`. Folded
into Y5's commit, same file. Covered in `History.test.tsx`.

---

#### Y14 — DONE (2026-07-28)

Every affected skeleton (`History.tsx`, `MenuManage.tsx`, `Prep.tsx`,
`Orders.tsx`, `OrderStatus.tsx`, `MenuSkeleton.tsx`) now carries a local
`sr-only` `role="status"` element ("Loading history…" etc.) alongside its
existing/added `aria-hidden` visual bones — local to the skeleton, no cleanup
needed, consistent across both roles. New `History.test.tsx`/`Prep.test.tsx`
(neither page had a test file before) plus extensions to `Orders.test.tsx`,
`OrderStatus.test.tsx`, `MenuManage.test.tsx` — each asserts the status is
present while loading and gone once data lands. Confirmed red then green.

---

#### Y15 — [LOW] The shopkeeper cannot see how deep the queue is

**Where:** `pages/shop/Orders.tsx`.

**Read § 9.4-H5 first.** H5 adds oldest-waiting-time to the *prep board*. This
is the same question on the *orders* screen, and the two must end up in one
visual language rather than two independent inventions of "how urgent is this."
If H5 has not landed yet, whoever does it second inherits the first one's idiom.

**The gap.** Order age exists on the incoming card (`formatOrderAge`, F18) and
escalates by text color at 5 and 10 minutes — turmeric, then stamp. That tells
the shopkeeper about *one* order at a time. It does not answer the question
they actually have at 12:47: how deep am I, and who has been waiting longest?
Both answers require counting cards.

**What to build.** The chalkboard strip, in the idiom `PrepSummaryStrip`
already established (`ink` background, `paper` mono digits) — the count waiting
and the oldest wait, at tally scale, above the incoming column. If you add a
per-order age visual, keep it to the existing 5/10-minute escalation and do not
introduce a third urgency level: H5's entry makes the point that a red "late"
badge in a kitchen becomes wallpaper within a day, and it applies here just as
well.

**Rules.** Hindi pairs on every new string. `useTicker(30_000)` already runs on
this page — reuse it, do not add a second interval. Shop-only code. No new
tokens.

**Test first:** extend `Orders.test.tsx` — the strip reports the incoming count
and the oldest age from a fixture; an empty incoming list renders no strip (not
a zero); the existing empty state still renders. Confirm red today.

---

#### Y16 — DONE (2026-07-28)

`formatPrice` in `lib/format.ts` now drops the fraction for whole rupees
(`₹40.00` → `₹40`) and keeps two decimals for a genuinely fractional amount
(a real ₹12.50 item is never truncated). `paiseToRupeesInput` left untouched —
it feeds a form input and wants its fixed two decimals. Extended
`format.test.ts`, confirmed red then green. Fallout: `History.tsx`'s Y5 test
asserted `₹120.00`/`₹50.00`/`₹150.00` on whole-rupee fixture amounts — updated
to the new no-fraction form during this merge (the sweep agent's own grep
missed it since its worktree predated Y5).

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
- **`vite-plugin-pwa`'s `registerType: 'autoUpdate'` does nothing on its own in
  `injectManifest` mode.** The plugin injects `skipWaiting`/`clientsClaim` only
  into a *generated* worker; a hand-written `src/sw.ts` must call them itself,
  and its registration client deliberately skips the SKIP_WAITING message when
  `autoUpdate` is set. Two config options that each look correct combine into a
  worker that can never activate an update (§ 9.8-W1). **`grep skipWaiting
  dist/sw.js` is the ten-second check** — do it after any PWA config change.
  Generalizes: a plugin option named after a behavior is not evidence the
  behavior is present in the built artifact. Check the artifact.
- **Safe-area math has one correct expression in this codebase and two wrong
  ones.** `Menu.tsx`'s cart bar uses
  `bottom-[calc(env(safe-area-inset-bottom)+56px)]` — correct, because the nav is
  `h-14` *plus* `pb-safe`. Both prompt cards use a flat `bottom-20` (80 px),
  which is smaller than the nav's real 90 px height on a notched iPhone, so they
  sit on top of it (§ 9.8-W3). A hardcoded offset next to a `pb-safe` element is
  always a bug in waiting. **The default test viewport has no safe-area inset**,
  which is why this survived a green suite.
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

8. **The app HTML is framable by any origin.** `X-Frame-Options: DENY` is set by
   `middleware.SecurityHeaders()`, which only runs on the Go backend — i.e. on
   `/api/*`, which cannot be usefully framed. The browser-rendered app is served
   by Caddy's `file_server`, whose `header` block sets neither `X-Frame-Options`
   nor a CSP `frame-ancestors`. The Caddyfile's comment claiming the two header
   sets are identical is wrong on exactly this point. **See § 9.10-S1.**
9. **No HSTS anywhere.** `middleware/security.go` documents it as the proxy's
   job; `deploy/Caddyfile` does not set it, and Caddy v2 does not add it
   automatically. Each layer names the other as owner. First-request downgrade is
   live on a hostile network — which § 9.1.7 already assumes campus Wi-Fi is.
   **See § 9.10-S2.**
10. **A dead push subscription is never re-created** — not a vulnerability, but a
    silent, permanent loss of the product's only screen-off signal. **See
    § 9.8-W5.**

**Not gaps — verified clean on 2026-07-27** (recorded so the next audit doesn't
re-derive it): no `eval`/dynamic script injection; no analytics, trackers or ad
SDKs; third-party egress is exactly Firebase + Cloudinary + the browser's push
service, each pinned by CSP `connect-src`; `geolocation`/`microphone`/`camera`
disabled via `Permissions-Policy`; no secrets tracked in git (`git ls-files |
grep .env` returns only `.env.example` files). See § 9.10's preamble for the
full statement.

Also: Gin runs in `ReleaseMode` when `APP_ENV=production`; `SetTrustedProxies(nil)`
is explicit — harmless since no code path reads client IP.

Already correct, do not change: Firebase token verification pinned to RS256;
CORS pinned to `FRONTEND_ORIGIN` (no wildcard); `ParseToken` uses
`jwt.WithValidMethods` (alg-pinned).

---

## 12. Working protocol for the next agent

**Read § 9.1 and § 9.2 before any frontend change. Read the task's own section
before starting it — the "Fix shape" and "Test first" lines are the spec.**

1. **One task at a time.** Every task lists the files it owns. Do not touch
   files another task owns; where two tasks share a file, either sequence them
   or give both to one agent. The § 9.12 Y-series has several of these — see
   its own sequencing note and the bundle table below.
2. **Test first, and prove it fails.** Write the regression test, run it against
   the *unfixed* code, and confirm it fails for the right reason (`git stash` on
   just the implementation file is the established technique here). A test that
   was never seen red is not a regression test.
3. **Run the full gate before committing** — both stacks, § 6. Do not report
   partial gates as green. If something fails, say so with the output.
4. **Commit split by stack**, one commit per stack per round — the standing
   convention. Descriptive messages; `git log` is the history of record.
5. **Update this file as you land work.** Move the task from its backlog into a
   one-line record in its section's status table, delete the long write-up, and
   update **both** numbers in § 9.1.8 whenever `npm run build` changes them.
   If a task turns out to be a non-defect, record that verdict as its row
   rather than deleting the entry — a finding that was investigated and
   dismissed is worth as much as one that was fixed, and stops the next audit
   re-finding it. § 9.3 and § 9.11 are what a fully-collapsed section looks
   like.

   **Do not renumber sections.** Source comments cite them (`STATUS.md
   § 9.11-X2` in `Menu.tsx`, `§ 9.11-X5` in `Modal.tsx`). A completed series
   keeps its number; new work takes the next one.
6. **Do not start anything in § 9.6.** It is a decision list, not a queue.
7. **If a task's premise turns out to be wrong,** say so and stop rather than
   inventing adjacent work. The audit that produced these was thorough but not
   infallible.

8. **Do not claim a device-dependent result you did not observe.** Several tasks
   below (M4, M6, P4's install dialog, W1's live update check) can only be
   settled on a real phone or a real deploy. Write down what you actually ran. "I
   expect this fixes it on iOS" is a fine sentence; "verified on iOS" is not,
   unless you held the phone.

**Parallelization guidance:**

Bundles A, B, C and L are complete and were removed on 2026-07-28 — see § 9.7,
§ 9.8, § 9.10 and § 9.11 for what landed. What remains, plus the new § 9.12
work, groups as follows. **Give each bundle to one agent**; shared files are
what the grouping is for.

**Y1 goes first, alone, before anything in bundles M–Q.** It is the precache
reclaim (§ 9.12), it touches one file nothing else touches, and every design
task's bundle measurement is meaningless until it lands.

| Bundle | Tasks | Why they group | Status |
|---|---|---|---|
| **Y0 — bytes** | **Y1** | Seven deleted imports in `src/main.tsx`. Owns nothing else, blocks everything that adds weight. | **DONE (2026-07-28)** — precache 801.93 KiB/49 → 696.51 KiB/42. |
| **M — modal** | **Y3** + **Y7** + **Y10** | Three small defects in one file, `components/ui/Modal.tsx`: no accessible name, `vh` should be `dvh`, drag-off-sheet closes it. One agent, one `Modal.test.tsx`. | **DONE (2026-07-28)**. |
| **N — stamps** | **Y2** | `components/student/StatusStamps.tsx` alone. The `bg-current/10` dead class. Verify the fix against the **compiled** CSS, not the source. | **DONE (2026-07-28)**. |
| **O — menu row** | **Y9** → **Y4** | Y9 fixes `QtyStepper` (glyphs + live announcement); Y4 then restyles `MenuItemCard` around the fixed control. Strict order — Y4 changes when the stepper renders at all. | **DONE (2026-07-28)**. |
| **P — shop history** | **Y5** + **Y13** | Both own `pages/shop/History.tsx`. Y13 is a one-line `NaN` guard inside the panel Y5 is rebuilding. | **DONE (2026-07-28)**. |
| **Q — sweeps** | **Y8**, **Y14**, **Y16** | Three cross-file sweeps (rail keyboard access, skeleton status announcements, `formatPrice`). Run them **after** bundles M–P so they aren't sweeping files mid-edit — the same rule X5 followed. | **DONE (2026-07-28)** — merged with two hand-resolved conflicts (`History.test.tsx`, `Menu.test.tsx`) since its worktree branched before M–P landed; see § 12.1 note. |
| **I — order-status page** | **Y12** → **H3** → **Y11** | All own `pages/student/OrderStatus.tsx`. Y12 is a two-line guard, first; H3 is the price-drift notice (V3 landed, so it's unblocked); Y11 adds the elapsed-time line, last — it's the largest. | Open. **X1/X7 already landed here** (§ 9.11) — read what they changed before editing. |
| **J — menu page** | **H4** | Owns `pages/student/Menu.tsx` (the 422 recovery). Coordinate with bundle O: Y4 owns `MenuItemCard.tsx`, H4 owns the page — adjacent, not the same file, but land one before starting the other. | Open, unstarted. **X2/X6 already landed here** (§ 9.11). |
| **K — shop orders page** | **Y6** → **Y15** → **H1** | All own `pages/shop/Orders.tsx`. Y6 is a small guard, first. Y15 adds the queue-depth strip. H1 is the cash drawer and is much the largest — last, and it also adds `components/shop/CashDrawer.tsx`. **Read § 9.4-H5 before Y15** so the two urgency treatments end up one language. | Open. **X3 already landed here** (§ 9.11). |
| **D — login screen** | P5 + **S3** | Both edit `pages/Login.tsx`. § 12.1 — sequence or single-agent, no exceptions. | Open, unstarted. S3 needs real operator/contact facts from the owner — do not fabricate. |
| **E — manifest** | **P4** | Independent of everything; only conflict is `globPatterns`. **W6 and Y1 both touch fonts** — check `globPatterns` before adding screenshot patterns. | Open, unstarted. |
| **F — connectivity** | **M1** → M2 → M3 | M1 establishes the persisted cache the others build recovery UI around. | Open, unstarted. **Mind the precache budget**: now 702.03 KiB against an ~800 KB ceiling (Y1 landed, ~98 KB headroom) — still measure M1's persist-client package before committing to it, since Y11/Y15 also want a share of that headroom. |
| **G — standalone chrome** | M4 + M6 + § 9.6-B10 | All `index.html`, all only verifiable on a real device — bundle with **D-6**. | Open, unstarted. |
| **H — provenance** | S4 + S5 | CI and build-time config; touches nothing the others touch. | Open, unstarted. S4 has a natural home — the version-footer placeholder P1 left in `Settings.tsx`. |
| **R — prep board** | **H5** | `pages/shop/Prep.tsx` alone. Pairs conceptually with Y15 (bundle K) — whichever lands second inherits the first one's visual idiom. | Open, unstarted. |
| **S — contrast** | **H7** | A token change plus a sweep across nearly every page. The measurements it asked for are now in its entry. Run it **last**, or it collides with every other frontend bundle. | Open, unstarted. |
| **T — copy** | **H8** | Copy-only sweep, all pages. Same reasoning as bundle S — run it last. | Open, unstarted. |
| **U — backend tests** | Q3 → Q4, then Q5/Q6/Q8/Q9, then Q7 | Independent of every frontend bundle above and the best first work for an agent with no context on this codebase. | Open, unstarted. |

**Standing constraints that outlive any single bundle:**

- **Do not promote the § 9.7 install push to real students until W3 is fixed**
  (§ 9.8) — both prompt cards still collide with the bottom nav on notched
  iPhones, which is a bad first impression on the exact feature being promoted.
- **W5 needs a decision before more code.** P3 built the manual Reconnect
  button; W5 also wanted the silent automatic re-post. Settle which is wanted.
- Bundles D–H, R and U run concurrently with each other and with the § 9.12
  work. **M5 depends on P1**, which is done — M5 is unblocked.
- A, B and D–H were verified locally but **not** against a real deploy or a
  real phone. That is D-6, and § 12.8 applies to everything downstream of it.
