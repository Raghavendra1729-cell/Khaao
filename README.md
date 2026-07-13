# Khaao — Canteen Pre-Order App

A **mobile-first installable PWA** for a single college canteen. Students sign in with their `@sst.scaler.com` Google account, browse the menu, place one order at a time, and track it live via SSE. The shopkeeper accepts/rejects/trims orders, cooks to **aggregate demand** (Prep tab), taps **+1 Done** per finished unit (FCFS-allocated to the earliest waiting order), hands items over one-by-one (**Give 1**), and collects payment (**Paid**).

> **For agents / contributors:** Full context, architecture decisions, codebase map, what's done, and what's next is in **[STATUS.md](./STATUS.md)**. Read that first.

---

## Stack

| Layer | Details |
|---|---|
| **Backend** | Go 1.23 · Gin · GORM · **PostgreSQL only** |
| **Auth** | Firebase Google sign-in only. Backend verifies Firebase ID tokens against Google's public certs, issues its own HS256 JWT. Role re-read from DB on every request. |
| **Real-time** | Server-Sent Events — in-memory fan-out hub |
| **Frontend** | React 18 · TypeScript · Vite · Tailwind CSS 3.4 · TanStack Query · installable PWA |
| **Topology** | **One backend instance** (vertically scaled) behind a TLS reverse proxy. Explicit constraint — see STATUS.md §3 |

---

## Quick Start

### Prerequisites

- Go 1.23+
- Node 18+
- PostgreSQL 14+ (run `createdb khaao`)
- A Firebase project with Google sign-in enabled

### 1. Clone and configure

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` — minimum required:
```env
DATABASE_URL=postgres://localhost:5432/khaao?sslmode=disable
JWT_SECRET=<at-least-32-random-chars>
FIREBASE_PROJECT_ID=<your-firebase-project-id>
SHOPKEEPER_EMAILS=<your-email@gmail.com>
```

Edit `frontend/.env` — copy from Firebase console → Project settings → Web app:
```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=....firebaseapp.com
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

### 2. Run backend (port 8080)

```bash
cd backend
go run ./cmd/server
```

Auto-migrates the schema, seeds shopkeeper emails, and seeds sample menu items on first boot.

### 3. Run frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Install as PWA from the browser.

---

## Testing without Firebase

Set `AUTH_FAKE=true` in `backend/.env` (dev only — refused in production). Then:

```bash
curl -X POST http://localhost:8080/api/auth/firebase \
  -H 'Content-Type: application/json' \
  -d '{"id_token": "fake:student@sst.scaler.com:Test Student"}'
```

---

## Verification

```bash
# Backend
cd backend
go build ./... && go vet ./... && go test ./... -race

# Frontend
cd frontend
npx tsc --noEmit
```

---

## Project layout

```
backend/                      Go API
  cmd/server/main.go          → entry point, dependency wiring, expiry ticker
  internal/
    config/                   → fail-closed config (refuses bad production secrets)
    authn/                    → Firebase token verification + fake verifier
    middleware/               → auth, CORS, security headers, role guards
    models/                   → GORM models with CHECK constraints
    database/                 → connection, AutoMigrate, seed, pool tuning
    repository/               → interfaces + GORM implementations
    realtime/                 → in-memory SSE hub
    services/                 → business logic (auth, menu, orders, pool engine, FCFS)
    controllers/              → HTTP handlers
    routes/                   → Gin router + middleware registration

frontend/                     React PWA
  src/
    api/                      → typed fetch wrappers (client, auth, menu, orders, shop)
    lib/                      → firebase, format helpers, WebAudio beeps
    context/                  → AuthContext
    hooks/                    → useSSE (exponential backoff + retry cap)
    components/               → Layout, realtime handlers, UI primitives
    pages/                    → Login, student/Menu, student/OrderStatus,
                                 shop/Orders, shop/Prep, shop/History, shop/MenuManage

docs/
  SPEC.md                     → authoritative API contract + state machines (read this)
  01-flows.html               → product flow diagrams
  02-technical.html           → original technical brief

STATUS.md                     → full project context, what's done, what's next
scripts/smoke.sh              → e2e smoke test (full lifecycle against a live server)
```

---

## What's been built

See [STATUS.md §8](./STATUS.md) for the complete list. Highlights:

- ✅ Full order lifecycle (cart → FCFS allocation → per-item handover → payment)
- ✅ Post-accept item trim + re-pool (shopkeeper removes an item; prepared units return to pool and are re-allocated FCFS)
- ✅ Fail-closed production config (refuses to boot with dev secrets)
- ✅ DB-backed concurrency (`SELECT … FOR UPDATE` + Postgres advisory locks inside every mutation transaction)
- ✅ Server hardening (timeouts, body cap, security headers)
- ✅ Role separation (`RequireRole(student)` / `RequireRole(shopkeeper)`)
- ✅ SSE retry bounding (8 failures → force re-login)
- ✅ Health endpoint (`GET /api/health`)
- ✅ DB connection pool tuned (`MaxOpenConns(25)`)
- ✅ Menu delete safety (409 if item is in an active order)
- ✅ Server-side menu validation (name length, price > 0, URL scheme, paired availability window)

## What's next

See [STATUS.md §9](./STATUS.md) for the full prioritized list. Top items:

1. Dedupe `menu_item_id` lines in `CreateOrder` (P1 correctness)
2. Rate limiting middleware, per-user (P1 security)
3. Structured logging with `slog` (P2 reliability)
4. Versioned SQL migrations with golang-migrate (WP4)
5. Postgres integration tests + `go test -race` in CI (P2)

---

## Out of scope (unchanged)

In-app payments · OTP · time-slot scheduling · strike/ban system · bilingual toggle · analytics.
