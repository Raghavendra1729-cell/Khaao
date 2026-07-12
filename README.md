# Khaao — Canteen Pre-Order App (MVP v1)

Students browse a live menu and place a single active **order-now** order.
The shopkeeper accepts / rejects / trims incoming orders, cooks to **aggregate
demand** (Prep List), and taps **Done** per finished unit. Done units land in a
**Done Pool** and are **FIFO-allocated** back to orders. Fully allocated orders
turn **Ready** — the student is notified live (SSE + sound) and has **15
minutes** to pick up and **pay at the counter**.

- Product flows: `docs/01-flows.html` · Technical brief: `docs/02-technical.html`
- Build spec (API contract, state machines, pool engine): `docs/SPEC.md`

## Stack

| Layer | Choice |
|---|---|
| Backend | Go 1.23 · Gin · GORM (SQLite for dev, PostgreSQL for prod) · MVC |
| Real-time | Server-Sent Events (both student + shopkeeper dashboards) |
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS · TanStack Query |
| Auth | Email + password (bcrypt) · JWT · role-based (student / shopkeeper) |

## Run locally

Backend (port 8080):

```sh
cd backend
go run ./cmd/server
```

Frontend (port 5173, proxies `/api` to the backend):

```sh
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

**Seeded shopkeeper login:** `shopkeeper@canteen.local` / `admin123`
(override with `SHOPKEEPER_EMAIL` / `SHOPKEEPER_PASSWORD`).
Students sign up in the app; restrict signups to your college domain with
`ALLOWED_EMAIL_DOMAINS=yourcollege.edu`.

All backend env vars are documented in `backend/.env.example`. For production,
set `DB_DRIVER=postgres` and `DB_DSN` to your PostgreSQL DSN.

## Project layout

```
backend/   Go API — cmd/server + internal/{config,models,controllers,services,
           middleware,routes,database,realtime}  (MVC; pool engine in services)
frontend/  React app — src/{api,lib,context,hooks,components,pages}
docs/      Product flows, technical brief, build spec
```

## Out of scope for v1

In-app payments · OTP · guest scan-to-order · time-slot scheduling ·
strike/ban system · bilingual toggle · analytics. Deployment (Docker/VM/HTTPS)
is planned but intentionally deferred — see `docs/02-technical.html` §8.
