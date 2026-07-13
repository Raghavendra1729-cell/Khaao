# Khaao — Canteen Pre-Order App (v3)

A mobile-only PWA for one college canteen. Students sign in with their
**@sst.scaler.com Google account**, build a cart, check out, and follow their
order live. The shopkeeper accepts / rejects / trims incoming orders, cooks to
**aggregate demand** (Prep tab), and taps **−1 · Done** per finished unit; each
unit is **FCFS-allocated** to the earliest waiting order. Students can pick up
ready items one by one — the shopkeeper taps **Give 1** per handed item. When
everything is handed over the order asks for payment; the shopkeeper taps
**Paid** and the order lands in the **History** tab. Order numbers are daily
tokens that reset every morning. No in-app payments.

- Build spec (schema, API contract, state machines, pool rules): `docs/SPEC.md`
- Original product flows: `docs/01-flows.html` · Technical brief: `docs/02-technical.html`

## Stack

| Layer | Choice |
|---|---|
| Backend | Go 1.23 · Gin · GORM · **PostgreSQL** · controllers → services → repositories (SOLID, interface-driven) |
| Auth | **Firebase Google sign-in only** — students domain-locked, shopkeepers via a DB email allowlist; backend verifies ID tokens against Google's public certs, then issues its own JWT (role re-read from DB per request) |
| Real-time | Server-Sent Events (student order updates + shop dashboard) |
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS · TanStack Query · installable PWA |

## Setup

### 1. Postgres

```sh
createdb khaao   # any Postgres 14+; citext is enabled automatically
```

### 2. Firebase (one project, two screens)

1. [console.firebase.google.com](https://console.firebase.google.com) → create/select a project.
2. **Authentication → Sign-in method → enable Google.**
3. Project settings (gear) → General:
   - **Project ID** → `FIREBASE_PROJECT_ID` in `backend/.env`
   - "Your apps" → add a **Web app** (`</>`) → SDK config → copy
     `apiKey`, `authDomain`, `projectId`, `appId` → the four
     `VITE_FIREBASE_*` values in `frontend/.env`
4. Authentication → Settings → **Authorized domains**: make sure `localhost`
   is listed (it is by default).

### 3. Env files

Copy `backend/.env.example` → `backend/.env` and
`frontend/.env.example` → `frontend/.env`, then fill in the Firebase values.
Put the shopkeeper Google emails (any domain) in `SHOPKEEPER_EMAILS` —
everyone else must sign in with an `@sst.scaler.com` account.

## Run locally

Backend (port 8080, auto-loads `backend/.env`):

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

Open http://localhost:5173 on a phone-sized viewport. The app is installable
("Add to Home Screen").

## Testing without Firebase

Set `AUTH_FAKE=true` (dev only — the server refuses it when
`APP_ENV=production`). `POST /api/auth/firebase` then accepts
`{"id_token": "fake:someone@sst.scaler.com:Name"}` — this is what the e2e
suite uses. The UI itself always uses the real Google popup.

## Project layout

```
backend/   Go API — cmd/server + internal/{config,models,repository,authn,
           services,controllers,middleware,routes,database,realtime}
frontend/  React PWA — src/{api,lib,context,hooks,components,pages}
docs/      SPEC.md (the contract) + original product docs
```

## Out of scope (unchanged)

In-app payments · OTP · time-slot scheduling · strike/ban system · bilingual
toggle · analytics. Deployment (Docker/VM/HTTPS) is planned but deferred —
see `docs/02-technical.html` §8.
