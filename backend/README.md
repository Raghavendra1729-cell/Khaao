# Khaao Backend

Go 1.23 + Gin + GORM + Postgres backend for the Khaao canteen pre-order app.
See `docs/SPEC.md` in the repo root for the full spec.

## Run locally

```bash
# 1. Create a local Postgres database
createdb khaao

# 2. Copy and edit the env file
cp .env.example .env
# At minimum set FIREBASE_PROJECT_ID (or enable AUTH_FAKE=true for dev)

# 3. Start the server
cd backend
go run ./cmd/server
```

The server auto-migrates the schema, seeds shopkeeper emails (from
`SHOPKEEPER_EMAILS`), and optionally seeds sample menu items on first boot.
Listens on `PORT` (default `8080`).

## Environment variables

See `.env.example` for the full list with defaults. Highlights:

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `APP_ENV` | `dev` | `dev` / `test` / `production` |
| `DATABASE_URL` | `postgres://...` | Postgres DSN — Postgres is the **only** supported DB |
| `JWT_SECRET` | `dev-secret-change-me` | HS256 signing secret (≥ 32 chars in production) |
| `FIREBASE_PROJECT_ID` | *(empty)* | Required in production; skip with `AUTH_FAKE=true` in dev |
| `ALLOWED_EMAIL_DOMAIN` | `sst.scaler.com` | Students must sign in with this Google domain |
| `SHOPKEEPER_EMAILS` | *(empty)* | Comma-separated shopkeeper email allowlist, seeded on boot |
| `AUTH_FAKE` | `false` | Dev/test only — accept `fake:<email>` tokens |
| `HOLD_MINUTES` | `15` | Ready-order pickup window before it expires |
| `BUSINESS_TIMEZONE` | `Asia/Kolkata` | IANA timezone for daily token reset and history dates |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin (must be `https://` in production) |
| `SEED_SAMPLE_MENU` | `true` | Seed ~6 sample items if the menu table is empty |

## API summary

Base path `/api`. All errors return `{"error": "message"}`.
Auth is a JWT bearer token (`Authorization: Bearer <t>`) or `?token=` query param (SSE only).

**Public**
- `GET /api/menu`
- `GET /api/auth/config`
- `POST /api/auth/firebase`

**Authenticated** (`GET /api/auth/me`)
- `GET /api/auth/me`

**Student** (authenticated + student role)
- `POST /api/orders` — place order
- `GET /api/orders/active` — current active order
- `GET /api/orders` — order history
- `POST /api/orders/:id/cancel`
- `GET /api/stream` (SSE: `order_update`, `menu_update`)

**Shopkeeper** (`/api/shop/*`, authenticated + shopkeeper role)
- `GET /api/shop/menu`, `POST /api/shop/menu`, `PUT /api/shop/menu/:id`, `DELETE /api/shop/menu/:id`
- `POST /api/shop/menu/:id/stock`
- `GET /api/shop/orders` — `{incoming, in_progress, awaiting_payment}`
- `GET /api/shop/history[?date=YYYY-MM-DD]`
- `POST /api/shop/orders/:id/accept`, `POST /api/shop/orders/:id/reject`
- `GET /api/shop/prep`, `POST /api/shop/prep/:menu_item_id/done`
- `POST /api/shop/orders/:id/items/:itemID/handover`
- `DELETE /api/shop/orders/:id/items/:itemID` — remove item + re-pool units
- `POST /api/shop/orders/:id/paid`
- `POST /api/shop/day/close`
- `GET /api/shop/stream` (SSE: `orders_update`, `prep_update`, `menu_update`)

## Architecture

Layered SOLID: `controllers` → `services` → `repositories`.

- **Pool engine** (`services/pool.go`): FCFS allocation of cooked units to orders,
  guarded by an in-process `sync.Mutex` + a Postgres advisory lock for
  deploy-time overlap safety.
- **Expiry ticker** (`cmd/server/main.go`): fires every 15 s, expires stale `ready`
  orders that were never picked up, returns their units to the pool.
- **Realtime hub** (`realtime/hub.go`): in-memory SSE fan-out keyed by user ID / role.
- **Fail-closed config** (`config/config.go`): refuses to boot in production with
  dev defaults, missing `FIREBASE_PROJECT_ID`, localhost `DATABASE_URL`, or
  non-HTTPS `FRONTEND_ORIGIN`.

## Tests

```bash
go test ./... -race
```
