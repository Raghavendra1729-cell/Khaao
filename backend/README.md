# Khaao Backend

Go 1.23 + Gin + GORM (sqlite/postgres) backend for the Khaao canteen
pre-order MVP. See `/docs/SPEC.md` in the repo root for the full spec this
implements.

## Run

```bash
cd backend
go mod tidy
go run ./cmd/server
```

The server seeds a shopkeeper account and a sample menu on first boot (see
env vars below) and listens on `PORT` (default `8080`).

To use Postgres instead of the default pure-Go SQLite driver:

```bash
DB_DRIVER=postgres DB_DSN="host=localhost user=khaao password=khaao dbname=khaao port=5432 sslmode=disable" go run ./cmd/server
```

## Environment variables

See `.env.example` for the full list with defaults. Highlights:

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DB_DRIVER` | `sqlite` | `sqlite` or `postgres` |
| `DB_DSN` | `khaao.db` | sqlite file path, or postgres DSN |
| `JWT_SECRET` | `dev-secret-change-me` | HS256 signing secret |
| `ALLOWED_EMAIL_DOMAINS` | *(empty = any)* | comma-separated signup allowlist |
| `HOLD_MINUTES` | `15` | ready-order pickup window |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin |
| `SHOPKEEPER_EMAIL` / `SHOPKEEPER_PASSWORD` / `SHOPKEEPER_NAME` | `shopkeeper@canteen.local` / `admin123` / `Canteen` | seeded shop account |
| `SEED_SAMPLE_MENU` | `true` | seed ~6 sample items if menu is empty |

## API summary

Base path `/api`. All errors are `{"error": "message"}`. Auth is a JWT bearer
token (`Authorization: Bearer <t>`) or `?token=` query param (for SSE).

**Auth** — `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`

**Student** (authenticated) —
`GET /menu`,
`POST /orders`, `GET /orders/active`, `GET /orders`, `POST /orders/:id/items`,
`GET /stream` (SSE: `order_update`, `menu_update`)

**Shopkeeper** (`role=shopkeeper`, under `/shop`) —
`GET /menu`, `POST /menu`, `PUT /menu/:id`, `DELETE /menu/:id`, `POST /menu/:id/stock`,
`GET /orders` (`{incoming, active, ready}`), `POST /orders/:id/accept`, `POST /orders/:id/reject`,
`GET /prep`, `POST /prep/:menu_item_id/done`,
`POST /orders/:id/close`, `POST /day/close`,
`GET /stream` (SSE: `orders_update`, `prep_update`, `menu_update`)

## Architecture

Strict MVC: `internal/controllers` bind/respond only; all business logic —
including the pool engine (FIFO allocation of finished units to orders,
guarded by a single `sync.Mutex`) — lives in `internal/services`. A 15s
ticker in `cmd/server/main.go` expires stale `ready` orders and returns their
units to the pool. `internal/realtime/hub.go` is an in-memory SSE hub.
