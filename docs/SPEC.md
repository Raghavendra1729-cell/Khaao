# Khaao — Canteen Pre-Order App — v3 Build Spec

Single source of truth for the backend (Go) and frontend (React) builds.
Supersedes v1/v2 entirely. Derived from `docs/01-flows.html`, `docs/02-technical.html`,
and the v3 product decisions below.

## Product summary (v3)

Students sign in with **Google (Firebase Auth) using their `@sst.scaler.com`
account** — no passwords, no guest mode, no signup form. Shopkeepers sign in
with the **same Google button**; their (any-domain) emails live in a DB
allowlist. Students browse a live menu, build a **cart**, see the **total**,
check out, and place a single active order. The order goes to the shopkeeper,
who **accepts / rejects / trims** it. The student may **cancel any time before
the shopkeeper responds**. Accepted orders enter the **pool**: the shopkeeper
cooks to aggregate demand (Prep tab) and taps **"−1 · Done"** per finished
unit; each done unit is **FCFS-allocated** to the earliest order waiting for
that item, visible to the student **in real time**. The student may pick up
ready items one by one (or wait); at the counter the shopkeeper marks each
handed-over item. When **every unit is handed over**, the order asks for
payment; the shopkeeper taps **"Paid"** and the order moves to **history**.
No in-app payment. One active order per student. Shopkeeper UI must stay
dead simple: big buttons, three obvious piles, no jargon.

## Repository layout

```
Khaao/
  backend/            # Go 1.23, Gin, GORM (Postgres ONLY), layered: controllers → services → repositories
  frontend/           # Vite + React 18 + TypeScript + Tailwind 3.4 + TanStack Query + Firebase JS SDK, mobile-only PWA
  docs/
```

## Conventions

- **Prices are integers in paise** (₹1 = 100). JSON field names: `price`, `price_each`, `total_price`.
- Timestamps: RFC3339 strings in JSON. Dates: `"YYYY-MM-DD"`.
- Availability windows: `avail_from`/`avail_to` are `"HH:MM"` 24h strings or `null`.
- Errors: `{"error": "human-readable message"}` + proper status
  (400 validation, 401 auth, 403 forbidden/role/domain, 404, 409 conflict, 422 unorderable).
- Roles: `student`, `shopkeeper`. (Guest role removed in v3.)

---

# Authentication (v3 — Firebase Google only)

## Flow

1. Frontend signs the user in with the Firebase JS SDK
   (`signInWithPopup` + `GoogleAuthProvider`), gets a **Firebase ID token**.
2. `POST /api/auth/firebase {"id_token": "..."}` — backend verifies the token
   **itself with `golang-jwt/v5`** (no Firebase Admin SDK — its init can demand
   Application Default Credentials, a deployment footgun). Verification rules
   (per Firebase docs): header `alg == RS256` and `kid` present; RSA public key
   looked up by `kid` from
   `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`
   (x509 PEM certs; cache the response per its `Cache-Control: max-age`);
   claims `iss == "https://securetoken.google.com/" + FIREBASE_PROJECT_ID`,
   `aud == FIREBASE_PROJECT_ID`, `exp` in the future, `iat` in the past,
   `sub` non-empty (= Firebase UID). Read `email`, `email_verified`, `name`,
   `picture` claims. The cert fetcher sits behind a tiny interface so tests
   can inject static keys.
3. Backend rules, in order:
   - Token must be valid, unexpired, `email` present, `email_verified == true`.
   - **If email exists in `shopkeeper_emails` table → role `shopkeeper`**
     (any domain — this is the allowlist exception).
   - **Else if email's domain equals `ALLOWED_EMAIL_DOMAIN`** (default
     `sst.scaler.com`, case-insensitive) → role `student`.
   - Else → `403 {"error":"Sign in with your @sst.scaler.com Google account"}`.
4. Upsert user: match by `firebase_uid`, else by `email` (then attach the
   uid). Update `name`/`photo_url` from the token on every login. A user whose
   email is in the allowlist gets role `shopkeeper` even if they previously
   logged in as a student (role is recomputed at each login).
5. Respond `{token, user}` where `token` is **Khaao's own JWT** (HS256,
   `JWT_SECRET`, claims `sub` = user id string, `role`, `exp` = +7d). All other
   endpoints use this JWT via `Authorization: Bearer` **or** `?token=` (SSE).
6. **The auth middleware resolves the user from the DB on every request**
   (PK lookup) and role guards use the **DB role**, not the JWT claim — so
   removing someone from the allowlist locks them out on their next request,
   not in 7 days. Unknown user id → 401.

## TokenVerifier abstraction (SOLID / DIP — required)

```go
// internal/authn
type Identity struct { UID, Email, Name, PhotoURL string; EmailVerified bool }
type TokenVerifier interface { Verify(ctx context.Context, idToken string) (*Identity, error) }
```

- `FirebaseVerifier` — production impl (Admin SDK).
- `FakeVerifier` — enabled ONLY when `AUTH_FAKE=true` (default false; log a
  loud boot warning). Accepts tokens shaped `fake:<email>[:<name>]` and
  returns a verified identity (uid = `fake-<email>`). Exists so e2e tests run
  without Google credentials. **The server must refuse to start when
  `AUTH_FAKE=true` and `APP_ENV=production`** (new env `APP_ENV`, default
  `dev`).

`AuthService` depends on the interface, never on Firebase types.

## Endpoints

| Endpoint | Body → Response |
|---|---|
| `GET /api/auth/config` | → `{allowed_email_domain: "sst.scaler.com"}` (UI copy only) |
| `POST /api/auth/firebase` | `{id_token}` → `{token, user}` (200; 403 domain; 401 bad token) |
| `GET /api/auth/me` | → `{user}` |

`user = {id, name, email, role, photo_url}`.

Removed from v2: `/auth/signup`, `/auth/login`, `/auth/google`, `/auth/guest`.

---

# Database (Postgres ONLY — no sqlite)

GORM with `gorm.io/driver/postgres`, DSN from `DATABASE_URL`. AutoMigrate on
boot; models must carry gorm tags that reproduce the DDL below (uniques,
checks, defaults). The `citext` extension is already enabled; create it
defensively (`CREATE EXTENSION IF NOT EXISTS citext`) before migrating.

```sql
users             id BIGSERIAL PK
                  firebase_uid TEXT UNIQUE NOT NULL
                  email CITEXT UNIQUE NOT NULL
                  name TEXT NOT NULL DEFAULT ''
                  photo_url TEXT NOT NULL DEFAULT ''
                  role TEXT NOT NULL CHECK (role IN ('student','shopkeeper'))
                  created_at, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

shopkeeper_emails email CITEXT PK          -- the allowlist exception
                  note TEXT NOT NULL DEFAULT ''
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

menu_items        id BIGSERIAL PK
                  name TEXT NOT NULL
                  price INTEGER NOT NULL CHECK (price >= 0)          -- paise
                  photo_url TEXT
                  is_available BOOLEAN NOT NULL DEFAULT true
                  avail_from TEXT NULL, avail_to TEXT NULL           -- "HH:MM"
                  out_of_stock BOOLEAN NOT NULL DEFAULT false
                  created_at, updated_at, deleted_at (gorm soft delete, indexed)

orders            id BIGSERIAL PK
                  order_no INTEGER NOT NULL                          -- daily token
                  order_date DATE NOT NULL
                  UNIQUE (order_date, order_no)
                  user_id BIGINT NOT NULL REFERENCES users(id)
                  status TEXT NOT NULL CHECK (status IN ('submitted','preparing',
                    'partially_ready','ready','awaiting_payment','completed',
                    'rejected','cancelled','expired'))
                  total_price INTEGER NOT NULL DEFAULT 0 CHECK (total_price >= 0)
                  -- one active order per student, enforced by the DB too:
                  -- CREATE UNIQUE INDEX uniq_active_order_per_user ON orders(user_id)
                  --   WHERE status IN ('submitted','preparing','partially_ready',
                  --                    'ready','awaiting_payment');
                  -- (partial index — create with raw SQL after AutoMigrate)
                  paid BOOLEAN NOT NULL DEFAULT false
                  paid_at, accepted_at, ready_at, expires_at TIMESTAMPTZ NULL
                  created_at, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                  INDEX (user_id, created_at DESC); INDEX (status); INDEX (order_date)

order_items       id BIGSERIAL PK
                  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE
                  menu_item_id BIGINT NOT NULL REFERENCES menu_items(id)
                  name TEXT NOT NULL                                 -- snapshot at order time
                  price_each INTEGER NOT NULL CHECK (price_each >= 0)-- snapshot, paise
                  qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 20)
                  allocated_qty INTEGER NOT NULL DEFAULT 0
                    CHECK (allocated_qty >= 0 AND allocated_qty <= qty)
                  handed_qty INTEGER NOT NULL DEFAULT 0
                    CHECK (handed_qty >= 0 AND handed_qty <= allocated_qty)
                  status TEXT NOT NULL CHECK (status IN ('pending','queued',
                    'allocated','handed_over','rejected'))
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

item_pool         menu_item_id BIGINT PK REFERENCES menu_items(id)
                  qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0)    -- cooked, unallocated

order_events      id BIGSERIAL PK                                    -- audit/history trail
                  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE
                  type TEXT NOT NULL   -- placed|accepted|rejected|cancelled|item_trimmed|
                                       -- item_ready|item_handed|paid|expired|day_closed
                  payload JSONB NOT NULL DEFAULT '{}'
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                  INDEX (order_id)
```

Seeding on boot (idempotent): upsert every email from `SHOPKEEPER_EMAILS`
(comma-separated env) into `shopkeeper_emails` (never delete rows not in the
env — the DB is the source of truth, env is convenience). If
`SEED_SAMPLE_MENU=true` and menu empty, seed ~6 Indian canteen items
(Samosa ₹15, Veg Puff ₹20, Masala Dosa ₹40, Chai ₹10, Cold Coffee ₹30,
Veg Fried Rice ₹50 — paise).

---

# State machines (v3)

**Order:** `submitted → preparing → partially_ready → ready → awaiting_payment → completed`
branches: `submitted → cancelled` (student), `submitted → rejected` (shopkeeper),
`ready → expired` (hold timeout, only if nothing handed yet).

- `submitted` — waiting for shopkeeper. Student **can cancel**; shopkeeper can accept/reject.
- `preparing` — accepted; items queued on the Prep list. No cancel, no reject.
- `partially_ready` — ≥1 unit allocated (or handed) but not all allocated.
- `ready` — every unit allocated. `ready_at=now`, `expires_at=now+HOLD_MINUTES` (first transition only).
- `awaiting_payment` — every unit handed over; waiting for the "Paid" tap.
- `completed` — paid=true, paid_at=now. Terminal; shows in history.
- `rejected` / `cancelled` / `expired` — terminal; show in history.

**Order item:** `pending → queued → allocated → handed_over`, branch `rejected`.
- `pending` — awaiting accept decision.
- `queued` — accepted; `allocated_qty` grows 0→qty as units are cooked (FCFS).
- `allocated` — `allocated_qty == qty` (all units ready to collect).
- `handed_over` — `handed_qty == qty` (student has all units of this line).
- `rejected` — trimmed at accept, or whole order rejected.
- `handed_qty` may grow while status is `queued`/`allocated` (partial pickup of a multi-qty line is allowed; `handed_qty ≤ allocated_qty` always).

**Status recompute** — one pure function, the only place order status is
derived (call it after every mutation; never set these statuses ad hoc).
Over non-rejected items of a non-terminal, accepted order:
1. all lines `handed_qty == qty` → `awaiting_payment`
2. else all lines `allocated_qty == qty` → `ready`
3. else any `allocated_qty > 0 || handed_qty > 0` → `partially_ready`
4. else → `preparing`

**Active order** (one-order rule) = status in
(`submitted`,`preparing`,`partially_ready`,`ready`,`awaiting_payment`).

**Daily order number:** `order_no` starts at 1 each day (`order_date` =
server-local date). Computed inside the engine lock as `MAX(order_no)+1` for
today; `UNIQUE(order_date, order_no)` is the safety net — on a unique
violation (another instance raced us), retry the insert once with a fresh
`MAX+1` before failing. Shown big in both UIs as the token number (`#12`).

---

# Pool engine rules (single `sync.Mutex` + one DB transaction per mutation)

1. **Prep list** per menu item = Σ `(qty − allocated_qty)` over `queued`
   items in orders `preparing`/`partially_ready`. Pool = `item_pool.qty`.
2. **Accept** (`{rejected_item_ids}` = trim): trimmed pending items →
   `rejected`; remaining pending → `queued`. All trimmed → order `rejected`.
   Else order `preparing`, `accepted_at=now`, recompute `total_price` over
   non-rejected items, then **run allocation** (pool may already hold units).
3. **Reject order** — only while `submitted`: order + pending items → `rejected`.
4. **Cancel (student)** — only while `submitted` (409 otherwise: "order was
   already accepted"): order → `cancelled`, items → `rejected`.
5. **Mark done** (`POST /shop/prep/:menuItemID/done {qty}`, default 1):
   `item_pool[m] += qty`, then **Allocate(m)**.
6. **Allocate(m)**: while pool[m] > 0, walk orders `preparing`/`partially_ready`
   **oldest `created_at` first** (FCFS), their `queued` items of m (oldest
   first), `allocated_qty++`, pool−−. Line full → status `allocated`. After
   each affected order: recompute status; on the transition into `ready`, set
   `ready_at`/`expires_at` and notify the student. Leftover units stay in pool.
7. **Hand over** (`POST /shop/orders/:id/items/:itemID/handover {qty}`, default
   1): requires order in `partially_ready`/`ready`/`awaiting_payment`-adjacent
   active states and `handed_qty + qty ≤ allocated_qty` (409 otherwise).
   `handed_qty += qty`; line full → `handed_over`. Recompute order status;
   entering `awaiting_payment` notifies the student ("pay at the counter").
8. **Paid** (`POST /shop/orders/:id/paid`): requires `awaiting_payment`
   (409 otherwise — "hand over every item first"). `paid=true`, `paid_at=now`,
   status `completed`. Emits `paid` event; order now lives in history.
9. **Expiry ticker** (15s): orders `ready` with `expires_at < now` **and
   Σ`handed_qty` == 0** → `expired`; allocated units return to the pool, then
   Allocate for those menu items. (Orders with anything already handed never
   expire — the shopkeeper settles them with handover + paid.)
10. **Close day** (`POST /shop/day/close`): all non-terminal orders → `expired`
    (regardless of handed units — end of day), pool zeroed, `out_of_stock`
    reset to false on all items.
11. Every mutation writes an `order_events` row and broadcasts SSE.

Removed from v2: **add-item-to-open-order** (`POST /orders/:id/items`) and
**close order** (`POST /shop/orders/:id/close`) — checkout is one-shot now;
close is replaced by per-item handover + paid.

---

# API contract (v3)

Base path `/api`. Auth middleware: Khaao JWT via `Authorization: Bearer` or `?token=`.

### Public
| Endpoint | Purpose |
|---|---|
| `GET /api/menu` | `{items:[MenuItem]}` — `is_available` items only (out-of-stock included, flagged) |
| `GET /api/auth/config` | `{allowed_email_domain}` |
| `POST /api/auth/firebase` | see Auth |

### Student (role `student`; shopkeeper tokens also accepted on GETs is NOT needed — keep strict)
| Endpoint | Purpose |
|---|---|
| `POST /api/orders` | `{items:[{menu_item_id, qty}]}` → 201 `{order}`. 409 active order exists; 422 unorderable; qty 1–20 |
| `GET /api/orders/active` | `{order}` or 404 |
| `GET /api/orders` | `{orders}` — own history, newest first |
| `POST /api/orders/:id/cancel` | own + `submitted` only → `{order}` (409 otherwise) |
| `GET /api/stream?token=` | SSE |

### Shopkeeper (`/api/shop/*`, role `shopkeeper`)
| Endpoint | Purpose |
|---|---|
| `GET /api/shop/menu` · `POST /api/shop/menu` · `PUT /api/shop/menu/:id` · `DELETE /api/shop/menu/:id` · `POST /api/shop/menu/:id/stock` | menu CRUD + one-tap stock toggle (unchanged from v2) |
| `GET /api/shop/orders` | `{incoming, in_progress, awaiting_payment}` — incoming=`submitted`; in_progress=`preparing`/`partially_ready`/`ready`; awaiting_payment=`awaiting_payment`; each oldest-first |
| `POST /api/shop/orders/:id/accept` | `{rejected_item_ids:[]}` → `{order}` |
| `POST /api/shop/orders/:id/reject` | → `{order}` (submitted only) |
| `POST /api/shop/orders/:id/items/:itemID/handover` | `{qty}` default 1 → `{order}` |
| `POST /api/shop/orders/:id/paid` | → `{order}` |
| `GET /api/shop/prep` | `{items:[{menu_item_id, name, remaining_qty, pool_qty}]}` |
| `POST /api/shop/prep/:menu_item_id/done` | `{qty}` default 1 → `{ok:true}` |
| `GET /api/shop/history?date=YYYY-MM-DD` | default today → `{orders, total_paid}` — terminal orders for that date, newest first; `total_paid` = Σ total_price where paid |
| `POST /api/shop/day/close` | → `{ok:true}` |
| `GET /api/shop/stream?token=` | SSE |

### JSON shapes

```
MenuItem = {id, name, price, photo_url, is_available, avail_from, avail_to,
            out_of_stock, status, orderable}          // computed fields as v2
Order    = {id, order_no, order_date, status, total_price, paid, paid_at,
            created_at, ready_at, expires_at,
            student_name, student_email,              // "" in the student's own view
            items: [{id, menu_item_id, name, qty, allocated_qty, handed_qty,
                     status, price_each}]}
```

### SSE protocol (unchanged mechanics from v2)

`data: {"type": "...", "order": Order?}` + `: ping` heartbeat every 25s.
- Student stream: `order_update` (full order embedded — fires on accept/reject/
  allocation/handover/awaiting_payment/paid/expired/cancelled), `menu_update`.
- Shop stream: `orders_update`, `prep_update`, `menu_update` (no payload; refetch).

---

# Backend architecture (SOLID — this is a build requirement, not a suggestion)

```
backend/
  cmd/server/main.go        # composition root: config → db → repos → services → controllers → routes
  internal/
    config/                 # env parsing, typed Config
    models/                 # GORM models + status constants ONLY (no logic beyond tiny helpers)
    repository/             # interfaces + gorm impls: UserRepo, ShopkeeperEmailRepo,
                            #   MenuRepo, OrderRepo, PoolRepo, EventRepo. ALL SQL lives here.
    authn/                  # TokenVerifier interface + firebase.go + fake.go
    services/               # AuthService, MenuService, OrderService, PoolEngine —
                            #   constructor-injected repo interfaces; no gorm/gin imports
    controllers/            # bind/validate → service call → JSON. No business logic.
    middleware/             # JWT auth, role guard, CORS
    routes/                 # wiring
    database/               # open postgres, citext, automigrate, seed
    realtime/               # SSE hub (in-memory)
```

- Services depend on **interfaces** (DIP); each service has one reason to
  change (SRP); adding an allocation strategy later must not modify callers —
  keep `Allocate` behind a small `AllocationStrategy` interface with the FCFS
  impl as the only one for now (OCP).
- Engine mutations: `engine.mu.Lock()` → single `db.Transaction(...)` → SSE
  broadcasts after commit.
- `go vet ./... && go build ./...` must pass. Add unit tests for: status
  recompute, FCFS allocation order, handover guards, paid guard, domain/
  allowlist auth rules (use FakeVerifier + sqlite-free mocks or a test PG if
  available; pure-function tests preferred).

## Backend env (`backend/.env.example`)

```
PORT=8080
APP_ENV=dev                     # dev | production (production refuses AUTH_FAKE)
DATABASE_URL=postgres://lingaraghavendra@localhost:5432/khaao?sslmode=disable
JWT_SECRET=dev-secret-change-me
FIREBASE_PROJECT_ID=            # Firebase console → project settings
ALLOWED_EMAIL_DOMAIN=sst.scaler.com
SHOPKEEPER_EMAILS=              # comma-separated Google emails allowed as shopkeeper
HOLD_MINUTES=15
FRONTEND_ORIGIN=http://localhost:5173
SEED_SAMPLE_MENU=true
AUTH_FAKE=false                 # true ONLY for local e2e tests
```

---

# Frontend spec (v3)

Stack unchanged: Vite + React 18 + TS + Tailwind 3.4 + TanStack Query v5 +
react-router-dom v6 + vite-plugin-pwa. **Add `firebase`** (modular SDK,
`firebase/app` + `firebase/auth` only). Mobile-only design system already in
place (leaf green `#0f5132`, turmeric accent, Bricolage Grotesque display
font, bottom tab bar, OrderTicket, safe-area insets) — keep and extend it,
do not restyle from scratch.

## Auth UX

- `/login`: Khaao brand + ONE primary button **“Continue with Google”** +
  caption “Use your @sst.scaler.com account” (domain from `/api/auth/config`).
  No password form, no guest, no signup. Shopkeepers use the same button.
- `src/lib/firebase.ts`: init from `import.meta.env.VITE_FIREBASE_*`;
  `signInWithGoogle()` → `signInWithPopup(auth, provider)` where provider sets
  `{hd: allowedDomain, prompt: 'select_account'}` (hint only — server enforces);
  returns `user.getIdToken()`.
- AuthContext: `loginWithGoogle()` = firebase popup → `POST /api/auth/firebase`
  → store `{token, user}` (existing localStorage plumbing). 403 → friendly
  inline error (“That Google account isn’t allowed…”). Role-redirect after
  login (student `/`, shopkeeper `/shop`). Remove signup/guest/password code
  paths and pages.

## Student flow

- `/` Menu: grid + qty steppers + **cart bar** (count + total) →
  **checkout sheet**: line items, qty, per-line price, **big total**, “Place
  order” button. (Add-to-open-order mode is REMOVED — if an active order
  exists, menu links to `/order` instead.)
- `/order` live view: big token `#order_no`, status timeline
  (Waiting → Cooking → Ready → Pay → Done), per-item progress
  `allocated_qty/qty ready · handed_qty picked up`, tick-pop animation when a
  unit becomes ready, **Cancel button while `submitted`**,
  `awaiting_payment` state = “Pay ₹total at the counter” banner,
  `completed` = ticket stamped Paid. History list below (paid badge, date).
- SSE `order_update` keeps it all live (existing hook).

## Shopkeeper flow (simplicity is the acceptance criterion)

- `/shop` Orders — three piles top-to-bottom, labelled in plain words:
  **“New”** (Accept / Reject / per-item trim — unchanged), **“Cooking”**
  (per item line: `ready x/y · picked z` + **“Give 1”** button enabled while
  `handed < allocated`), **“Collect payment”** (big card: token, name, items,
  **“Paid ₹X”** button). Beep on new incoming (existing sound lib).
- `/shop/prep` — unchanged: aggregate list, big **“−1 · Done”** button per item, pool count.
- `/shop/history` — NEW tab: date (today), list of finished orders
  (token, name, items, total, Paid/Rejected/Expired/Cancelled badge) +
  **“Collected today: ₹X”** header. Simple list, no filters beyond a date picker.
- `/shop/menu` — unchanged CRUD + Close day button.
- Bottom tab bar: Orders · Prep · History · Menu (4 tabs, icons + labels).

## Frontend env (`frontend/.env.example`)

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=      # <project>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

PWA (manifest, icons, NetworkOnly for `/api`, install prompt) is already in
place — keep it working; `/login` must render fine offline-first shell-wise.

## Types delta (src/api/types.ts)

- `Role = 'student' | 'shopkeeper'` (guest removed)
- `OrderStatus` += `awaiting_payment`, `completed`; `picked` removed
- `OrderItem` += `handed_qty`
- `Order` += `paid_at`
- `User` += `photo_url`
- `AuthConfig = {allowed_email_domain: string}`
- `ACTIVE_ORDER_STATUSES` = submitted, preparing, partially_ready, ready, awaiting_payment
