# Khaao — Canteen Pre-Order App

A **mobile-first installable PWA** for a single college canteen. Students sign in with their `@sst.scaler.com` Google account, browse the menu, place one order at a time, and track it live via SSE. The shopkeeper accepts/rejects/trims orders, cooks to **aggregate demand** (Prep tab), taps **Done** per finished unit (FCFS-allocated to the earliest waiting order), hands items over one-by-one, and collects payment.

> **For agents / contributors:** Full context — architecture decisions, codebase map, environment variables, API surface, what's done, and what's next — lives in **[STATUS.md](./STATUS.md)**. Read that first; this file is just a quickstart. `docs/SPEC.md` has the frozen core API/state-machine contract.

## Stack

| Layer | Details |
|---|---|
| **Backend** | Go 1.23 · Gin · GORM · **PostgreSQL only** · versioned SQL migrations |
| **Auth** | Firebase Google sign-in only. Backend verifies Firebase ID tokens, issues its own HS256 JWT. Role re-read from DB on every request. |
| **Real-time** | Server-Sent Events (in-memory fan-out hub), ticket-authenticated (never a raw JWT in the URL) |
| **Frontend** | React 18 · TypeScript · Vite · Tailwind CSS · TanStack Query · installable PWA |
| **Topology** | **One backend instance** (vertically scaled) behind a TLS reverse proxy — a deliberate constraint, see STATUS.md § Topology decision |

## Quick start

```bash
createdb khaao
cp backend/.env.example backend/.env      # fill in Firebase/Cloudinary/VAPID values
cp frontend/.env.example frontend/.env
cd backend && go run ./cmd/server          # :8080
cd frontend && npm install && npm run dev  # :5173, proxies /api to backend
```

Testing without Firebase (dev only): set `AUTH_FAKE=true` in `backend/.env`, then
`POST /api/auth/firebase {"id_token": "fake:someone@sst.scaler.com:Name"}`. The
UI always uses the real Google popup — fake tokens are for curl/Playwright.

## Verification

```bash
cd backend && go build ./... && go vet ./... && go test ./... -race
cd frontend && npx tsc -b --noEmit && npm run build
scripts/smoke.sh   # e2e lifecycle test against a live server
```

## Project layout

```
backend/    Go API — see STATUS.md § 4 for the full package map
frontend/   React PWA — see STATUS.md § 4 for the full package map
docs/       SPEC.md — frozen core API/state-machine contract
deploy/     Caddyfile, systemd unit, production runbook
scripts/    smoke.sh (e2e test), loadtest.js/.md (k6 load test)
STATUS.md   Full project context — read this for anything not covered above
```

## Out of scope

In-app payments · OTP · time-slot scheduling · strike/ban system · analytics · multi-canteen support.
