# Khaao — Canteen Pre-Order App — MVP Build Spec

Single source of truth for the backend (Go) and frontend (React) builds.
Derived from `docs/01-flows.html` and `docs/02-technical.html`.

## Product summary

Students sign up with a college email, browse a live menu, and place a single
active "order-now" order. The shopkeeper accepts / rejects / trims incoming
orders, cooks to **aggregate demand** (Prep List), and taps "Done" per finished
unit. Done units land in a **Done Pool** and are **FIFO-allocated** back to
orders. When an order is fully allocated it becomes **ready**, the student is
notified (SSE + sound) and has **15 minutes** to pick up and **pay at the
counter**. Expired orders return their units to the pool. Students may add
items to an open order; each addition must be re-accepted and re-opens the
order. No in-app payment. No scheduling. One active order per student.

## Repository layout

```
Khaao/
  backend/            # Go 1.23, Gin, GORM (sqlite + postgres), MVC
  frontend/           # Vite + React 18 + TypeScript + Tailwind 3.4 + TanStack Query
  docs/
```

---

## Money & time conventions

- **Prices are integers in paise** (₹1 = 100). API field names: `price`, `price_each`, `total_price`.
- Timestamps: RFC3339 strings in JSON.
- Availability windows: `avail_from` / `avail_to` are `"HH:MM"` 24h strings or `null` (= all day).

## Roles

`student` and `shopkeeper`. Shopkeeper account is seeded from env (no signup path).

---

# Backend spec (Go)

## Stack & layout (MVC)

Gin, GORM (drivers: `glebarez/sqlite` pure-Go + `gorm.io/driver/postgres`),
golang-jwt/v5, bcrypt. GORM AutoMigrate on boot. Module name: `khaao`.

```
backend/
  cmd/server/main.go        # wire config → db → services → routes, start ticker
  internal/
    config/config.go        # env loading with defaults
    models/                 # M: user.go, menu_item.go, order.go, order_item.go, done_pool.go
    controllers/            # C: auth.go, menu.go, orders.go, shop.go  (HTTP only: bind, call service, respond)
    services/               # business logic: auth.go, menu.go, orders.go, pool.go (pool engine)
    middleware/             # auth.go (JWT, role guard), cors.go
    routes/routes.go        # route registration
    database/database.go    # open db (driver switch), automigrate, seed
    realtime/hub.go         # SSE hub
  go.mod
```

Controllers contain no business logic. Services contain no HTTP types.
The pool engine (`services/pool.go`) guards all order/pool mutations with a
single `sync.Mutex` — correctness over throughput, this is a monolith for one
canteen.

## Env (with defaults)

```
PORT=8080
DB_DRIVER=sqlite               # sqlite | postgres
DB_DSN=khaao.db                # for postgres: standard DSN
JWT_SECRET=dev-secret-change-me
ALLOWED_EMAIL_DOMAINS=         # comma-separated; empty = allow any domain
HOLD_MINUTES=15
FRONTEND_ORIGIN=http://localhost:5173
SHOPKEEPER_EMAIL=shopkeeper@canteen.local
SHOPKEEPER_PASSWORD=admin123
SHOPKEEPER_NAME=Canteen
SEED_SAMPLE_MENU=true          # seed a few menu items if table empty
```

## Data model

```
users        id, name, email (unique), password_hash, role, created_at
menu_items   id, name, price, photo_url, is_available, avail_from, avail_to,
             out_of_stock, created_at, updated_at, deleted_at (gorm soft delete)
orders       id, user_id, status, total_price, created_at, ready_at, expires_at, closed_at
order_items  id, order_id, menu_item_id, qty, allocated_qty, price_each, status, created_at
done_pool    menu_item_id (pk), qty_available
```

### State machines

**Order status:** `submitted → preparing → partially_ready → ready → picked`,
branches `rejected`, `expired`. ("accepted" from the docs is folded into
`preparing`: accepting an order immediately puts its items on the Prep List.)

**Order item status:** `pending → queued → allocated → handed_over`, branch `rejected`.
- `pending` — awaiting shopkeeper acceptance (initial submit OR later addition).
- `queued` — accepted, counts toward Prep List; `allocated_qty` may be < `qty`.
- `allocated` — `allocated_qty == qty`.
- `rejected` — trimmed by shopkeeper.
- `handed_over` — order closed.

**Active order** (for the one-order rule) = status in
(`submitted`, `preparing`, `partially_ready`, `ready`).

### Menu item computed fields (in every API response)

- `status`: `"out_of_stock"` if out_of_stock; else `"unavailable"` if !is_available;
  else `"time_limited"` if a window is set; else `"available"`.
- `orderable` (bool): is_available && !out_of_stock && (no window || now within window, server local time).

## Pool engine rules (services/pool.go)

1. **Prep List** per menu item = Σ `(qty - allocated_qty)` over `queued` items
   in orders with status `preparing`/`partially_ready`.
2. **Accept** (`rejected_item_ids` = trim): those pending items → `rejected`;
   remaining pending → `queued`. If ALL items rejected → order `rejected`.
   Else order → `preparing`, then immediately **run allocation** (pool may
   already hold units). Recompute total_price over non-rejected items.
3. **Reject order**: order → `rejected`, pending items → `rejected`.
4. **Mark done** (`qty` units, default 1): `done_pool[item] += qty`, then allocate.
5. **Allocate(menu_item_id)**: while pool has units, walk orders
   (`preparing`/`partially_ready`, oldest `created_at` first), their `queued`
   items of that menu item (oldest first), incrementing `allocated_qty`.
   Item full → `allocated`. After each affected order: if it has NO `pending`
   items and every item is `allocated`/`rejected` (≥1 allocated) → status
   `ready`, `ready_at=now`, `expires_at=now+HOLD_MINUTES`, notify student;
   else if any `allocated_qty > 0` → `partially_ready`.
6. **Add item** (student): allowed only while order is `submitted`/`preparing`/
   `partially_ready`. Creates a `pending` item (needs re-accept via the same
   accept endpoint — shopkeeper sees the order back in "incoming" with only
   pending items awaiting decision; already-queued/allocated items are shown
   locked). Order stays out of `ready` until the pending item is resolved.
7. **Expiry ticker** (every 15s): orders `ready` with `expires_at < now` →
   `expired`; each item's `allocated_qty` returns to `done_pool`; then run
   allocation for those menu items (returned units may complete other orders).
8. **Close order**: `ready → picked`, items → `handed_over`, `closed_at=now`.
   (Payment happens at the counter; nothing to record in v1.)
9. **Close day**: all open orders (`submitted`/`preparing`/`partially_ready`/`ready`)
   → `expired`; zero the done pool; set `out_of_stock=false` on all items.
10. Every mutation broadcasts SSE events (see below).

## API contract

Base path `/api`. JSON everywhere. Errors: `{"error": "message"}` with proper
status (400 validation, 401 auth, 403 role, 404, 409 conflict, 422 unorderable).

### Auth

| Endpoint | Body → Response |
|---|---|
| `POST /api/auth/signup` | `{name, email, password}` → 201 `{token, user}` — role student; email domain-checked against ALLOWED_EMAIL_DOMAINS if set; password ≥ 6 chars; bcrypt |
| `POST /api/auth/login` | `{email, password}` → `{token, user}` |
| `GET /api/auth/me` | → `{user}` |

`user = {id, name, email, role}`. JWT HS256, claims `sub` (user id as string),
`role`, `exp` (+7d). Auth middleware reads `Authorization: Bearer <t>` **or**
`?token=<t>` (needed for EventSource).

### Student

| Endpoint | Purpose |
|---|---|
| `GET /api/menu` | `{items: [MenuItem]}` — only `is_available` items (incl. out-of-stock ones, marked) |
| `POST /api/orders` | `{items:[{menu_item_id, qty}]}` → 201 `{order}`. 409 if an active order exists; 422 if any item unorderable; qty 1–20 |
| `GET /api/orders/active` | `{order}` or 404 |
| `GET /api/orders` | `{orders}` — user's history, newest first |
| `POST /api/orders/:id/items` | `{menu_item_id, qty}` → `{order}` — add pending item; 409 if order is ready/picked/closed |
| `GET /api/stream?token=` | SSE, student's own events |

```
MenuItem = {id, name, price, photo_url, is_available, avail_from, avail_to,
            out_of_stock, status, orderable}
Order    = {id, status, total_price, created_at, ready_at, expires_at,
            student_name, student_email,          // shop views only, "" for students
            items: [{id, menu_item_id, name, qty, allocated_qty, status, price_each}]}
```

### Shopkeeper (`/api/shop/*`, role-gated)

| Endpoint | Purpose |
|---|---|
| `GET /api/shop/menu` | all items incl. unavailable |
| `POST /api/shop/menu` | `{name, price, photo_url, avail_from, avail_to, is_available}` → 201 |
| `PUT /api/shop/menu/:id` | same fields → `{item}` |
| `DELETE /api/shop/menu/:id` | 204 (soft delete) |
| `POST /api/shop/menu/:id/stock` | `{out_of_stock: bool}` → `{item}` — one-tap toggle |
| `GET /api/shop/orders` | `{incoming, active, ready}` — incoming = orders with ≥1 `pending` item (new orders AND re-opened additions); active = preparing/partially_ready with no pending; ready = ready |
| `POST /api/shop/orders/:id/accept` | `{rejected_item_ids: [id]}` → `{order}` — accept with trim |
| `POST /api/shop/orders/:id/reject` | → `{order}` |
| `GET /api/shop/prep` | `{items: [{menu_item_id, name, remaining_qty, pool_qty}]}` — remaining_qty = to cook; pool_qty = unallocated done units |
| `POST /api/shop/prep/:menu_item_id/done` | `{qty}` (default 1) → `{ok: true}` |
| `POST /api/shop/orders/:id/close` | ready → picked (handover + paid) |
| `POST /api/shop/day/close` | end-of-day reset → `{ok: true}` |
| `GET /api/shop/stream?token=` | SSE, dashboard events |

### SSE protocol

Standard SSE; each message `data: <json>\n\n` where json is
`{"type": "...", "order": Order?}`. Heartbeat comment (`: ping`) every 25s.

- **Student stream** types: `order_update` (includes full `order`), `menu_update`.
- **Shop stream** types: `orders_update`, `prep_update`, `menu_update`
  (no payload — frontend refetches).

Hub: in-memory; register per-user channels + role broadcast. New order /
addition / accept / done / ready / expiry / close all emit the relevant events
to both sides (student gets `order_update` with the updated order).

## Seeding (on boot)

- Shopkeeper user from env if it doesn't exist.
- If `SEED_SAMPLE_MENU=true` and menu empty: seed ~6 Indian canteen items
  (e.g. Samosa ₹15, Veg Puff ₹20, Masala Dosa ₹40, Chai ₹10, Cold Coffee ₹30,
  Veg Fried Rice ₹50 — prices in paise).

---

# Frontend spec (React)

Vite + React 18 + **TypeScript** + **Tailwind CSS 3.4** (pin v3; do NOT use v4)
+ `@tanstack/react-query` v5 + `react-router-dom` v6. No component library —
small hand-rolled components. Native `fetch` wrapper, native `EventSource`.

Vite dev server proxies `/api` → `http://localhost:8080` (so all API calls use
relative `/api/...` paths).

## Layout

```
frontend/src/
  api/client.ts          # fetch wrapper: base /api, JSON, token from localStorage, throws {status, message}
  api/{auth,menu,orders,shop}.ts
  lib/format.ts          # formatPrice (paise → ₹x.xx), time helpers
  lib/sound.ts           # WebAudio beep (no audio assets) — loud triple beep
  context/AuthContext.tsx# token+user in localStorage, login/logout/signup
  hooks/useSSE.ts        # EventSource w/ ?token=, auto-reconnect, onMessage(type, data)
  components/            # Button, Card, Badge/StatusBadge, QtyStepper, Spinner, Layout(nav+logout), ProtectedRoute(role)
  pages/Login.tsx  pages/Signup.tsx
  pages/student/Menu.tsx         # browse + cart drawer + place order (or add-to-order if active order open)
  pages/student/OrderStatus.tsx  # live active order: status timeline, per-item progress (allocated/qty), big order number, READY banner + sound + 15-min countdown; history below
  pages/shop/Orders.tsx          # incoming (accept / reject / per-item trim checkboxes) + active + ready(+close/handover); loud beep on new incoming
  pages/shop/Prep.tsx            # aggregate prep list: item, remaining count, big "+1 Done" button, pool count
  pages/shop/MenuManage.tsx      # CRUD form + list, out-of-stock one-tap toggle, availability window, Close Day button (confirm)
  App.tsx (routes)  main.tsx  index.css
```

## Behavior

- **Routing:** `/login`, `/signup`, student: `/` (menu), `/order`; shop:
  `/shop` (orders), `/shop/prep`, `/shop/menu`. Role-based redirect after login.
- **TanStack Query** for all server state. SSE events invalidate queries:
  student `order_update` → also directly set query data + if status became
  `ready`, play sound + show fixed banner; `menu_update` → invalidate menu.
  Shop `orders_update` → invalidate orders (beep when incoming count grows),
  `prep_update` → invalidate prep, `menu_update` → invalidate menu.
- **Student flow:** menu grid (photo placeholder, name, ₹, status chip), qty
  stepper → cart → "Place order". If an active order exists, menu switches to
  "add to your open order" mode (only when order not ready). `/order` shows
  live progress: Submitted → Preparing → Ready with per-item x/y allocated,
  countdown to `expires_at` when ready, "Pay at counter" note, big order #.
- **Shop flow:** tablet-friendly, large tap targets. Incoming order card:
  student name, items with checkboxes (unchecked = trim), Accept / Reject.
  Re-opened orders show locked (already accepted) items greyed + the new
  pending ones actionable. Ready column: order # + Close (handed over + paid).
- **Design:** mobile-first; green brand `#0f5132` (matches docs), Tailwind
  theme color `brand`. Clean, high-contrast, big buttons ≥44px. Empty states
  for every list. Loading spinners. Error toasts (simple inline, no library).

## Auth UX

Login/signup pages with the Khaao brand. Signup = students only. A small note
on login: "Shopkeeper? Use your provided credentials." Store `{token, user}`
in localStorage; 401 from API → clear + redirect to /login.
