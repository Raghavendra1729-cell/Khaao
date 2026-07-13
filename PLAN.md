# Khaao — Delivery Plan to 2000+ Students (Stable & Concurrent)

_Author: orchestration pass, 2026-07-13. Companion to `REVIEW.md` (findings) and `docs/SPEC.md` (contract)._
_Verified against the actual working tree: `go vet`, `go build`, `go test ./...` all pass. Only service-level unit tests exist today._

This document answers three things you asked for:

1. **What's done, what's left** — a feature + hardening audit of the real code.
2. **Which keys/secrets you need and exactly how to get them.**
3. **How we make it stable & concurrent for 2000+ students** — the target topology and the exact work packages, each with a ready-to-run `agy` (coder) prompt and `codex` (reviewer) step. I orchestrate, review every diff, and verify.

---

## 1. Verdict & headline numbers

| Layer | Feature-complete vs SPEC | Production-hardened | Notes |
|---|---|---|---|
| Backend (Go/Gin/GORM) | **~85%** | **~35%** | All core flows exist and compile; concurrency & prod-config hardening is the gap |
| Frontend (React/Vite/PWA) | **~90%** | **~50%** | v3 pages present; needs a verification pass + token-handling security |
| Infra / Ops / Deploy | **~10%** | **~10%** | Deployment deliberately deferred; this is the bulk of "get to 2000 students" |

**Bottom line:** the app is a working v3 build. It is **not yet safe for 2000 concurrent students** because of five P0 gaps (below). None are large; the critical path is ~2–3 focused work packages plus a deployment + load test. **The single most important architectural decision is topology (Section 4): run ONE backend instance.** That decision removes the hardest problem in `REVIEW.md` (distributed locking + distributed SSE) entirely.

---

## 2. What's DONE (verified in code)

### Backend
- ✅ Clean layered SOLID architecture exactly as SPEC demands: `controllers → services → repository`, `authn` interface, `repository` interfaces + GORM impls, composition root in `cmd/server/main.go`.
- ✅ **Firebase Google auth, self-verified** (`internal/authn/firebase.go`, 151 lines) — no Admin SDK, cert fetch behind an interface, `FakeVerifier` for e2e (`fake.go`).
- ✅ Auth rules: shopkeeper allowlist → `shopkeeper`, else domain match → `student`, else 403. Khaao HS256 JWT (+7d). **Role resolved from DB on every request** (`middleware/auth.go`) — allowlist removal locks out next request. This is a strong, correct design.
- ✅ Full order/pool engine (`services/pool.go`, 717 lines): `CreateOrder`, `Accept` (with trim-at-accept), `Reject`, `Cancel`, `Handover`, `Paid`, `MarkDone`, FCFS `Allocate` (`services/allocation.go`), `ExpiryTick` (15s ticker), `CloseDay`, `PrepList`. Pure-ish `recomputeStatus`.
- ✅ Models carry real GORM tags incl. `CHECK` constraints and the daily-token unique index; boot runs `CREATE EXTENSION citext` + AutoMigrate + the **partial unique index** `uniq_active_order_per_user`.
- ✅ Menu CRUD + one-tap stock toggle; order history; idempotent shopkeeper-email + sample-menu seeding.
- ✅ **Role guard on all `/api/shop/*` routes**; in-memory SSE hub with heartbeat, slow-consumer drop; graceful shutdown.
- ✅ Unit tests: auth domain/allowlist rules, FCFS/status recompute (`services/*_test.go`).

### Frontend
- ✅ Google-only login, `AuthContext`, `lib/firebase.ts`, protected routes.
- ✅ Student Menu (cart) + live `OrderStatus`; Shop `Orders`, `Prep`, `History`, `MenuManage`.
- ✅ SSE hook + `StudentRealtime`/`ShopRealtime`; design system components; PWA scaffolding per SPEC.

---

## 3. What's LEFT (the real work), by priority

Legend: **P0** = blocks 2000-student launch · **P1** = correctness/security before real use · **P2** = reliability/ops polish.
"Status vs REVIEW.md" notes what has already moved since the review was written.

### P0 — must fix before launch
| # | Gap | Where | Status vs REVIEW.md |
|---|---|---|---|
| P0-1 | **Concurrency only safe in one process.** `PoolEngine.mu` is a local `sync.Mutex`; allocation/accept/handover/expiry read with no row locks. | `services/pool.go:25`, `services/allocation.go` | Still open. **We resolve it by choosing single-instance topology + adding `SELECT … FOR UPDATE` as defense-in-depth** (Section 4/WP5). |
| P0-2 | **Post-accept item trim / re-pool is missing.** Only trim-at-accept exists; no route to remove an item from an already-accepted order and return prepared units to the pool (SPEC pool-rule 6/edge case, canttenapp.txt L24/L30). | no route | Still open (WP6). |
| P0-3 | **Config can boot with dev secrets.** Defaults `JWT_SECRET=dev-secret-change-me`, a local `DATABASE_URL`, blank `FIREBASE_PROJECT_ID`; only `AUTH_FAKE && APP_ENV=="production"` is rejected, and `APP_ENV` isn't normalized. | `config/config.go:32-40`, `main.go:43-51` | Partially better (AUTH_FAKE guard exists). Fail-closed validation still needed (WP1). |
| P0-4 | **Student routes have no `RequireRole(student)`.** A shopkeeper token can place/act on student orders. | `routes/routes.go:48-56` | Half-done: shop routes now guarded; student side still open (WP3). |
| P0-5 | **No DoS controls.** `http.Server` has no `ReadTimeout/WriteTimeout/MaxHeaderBytes`; no body cap, no rate limit, no SSE connection cap. At 2000 users this is a real availability risk. | `main.go:65-68`, `routes/routes.go:23-25` | Still open (WP2). |

### P1 — correctness & security
| # | Gap | Where |
|---|---|---|
| P1-1 | Daily `order_no` computed but **no retry-once** on the unique-violation race; active-order check sits **before** the tx (single-instance mutex covers it today, but map the unique violation → 409). | `pool.go:136-186` |
| P1-2 | `MarkDone` coerces `qty<=0→1`, **no menu existence / upper-bound check** — can pool a nonexistent item or unbounded food. | `pool.go:485-492` |
| P1-3 | `Reject` has **no out-of-stock item selection** and never calls `UpdateStock` (canttenapp.txt L23). Decide: keep v3 "trim-at-accept" or restore stock-out marking. | `pool.go:303`, `menu` repo |
| P1-4 | **Events/writes swallow errors.** `logEvent` drops JSON+DB errors; `MarkDone`/expiry ignore `Save` returns; `item_trimmed`/`item_ready` events not emitted. Audit log can't be trusted. | `pool.go:110-117, 507` |
| P1-5 | **FCFS lacks a stable tiebreaker.** Orders sort `created_at asc` only; items rely on preload order. Add `created_at ASC, id ASC` both levels. | `repository/gorm.go:239-245` |
| P1-6 | **Timezone = host local.** `time.Now()`/`DayOf` use server zone; a UTC host rolls the "day"/expiry wrong. Add `BUSINESS_TIMEZONE=Asia/Kolkata` + injectable clock. | pool.go, order.go |
| P1-7 | **Input validation thin.** Duplicate `menu_item_id` lines bypass the qty≤20 ceiling; no line/value caps; photo URLs unrestricted. | `pool.go:160-183`, menu |
| P1-8 | **Menu soft-delete can orphan** active-order references. Block delete while referenced; deactivate instead. | menu service |
| P1-9 | **Security headers absent**; **token pinning** (RS256 for Firebase, HS256 for app JWT) not explicit; **JWT in SSE `?token=`** and **localStorage** (XSS-exfiltratable). | routes, middleware, `frontend/src/api/client.ts`, `useSSE.ts` |
| P1-10 | **No versioned SQL migrations.** AutoMigrate + one raw index only; FKs lack explicit `ON DELETE`, no CI schema check. | `database/database.go` |

### P2 — reliability & ops (needed for a smooth 2000-student run, not a hard blocker)
- Health/readiness endpoints; DB connection-pool tuning (`SetMaxOpenConns` etc.); structured logs; metrics/alerts on auth failures, tx conflicts, pool anomalies.
- `CloseDay` needs confirmation token + idempotency + audit actor (it's destructive).
- SSE: in-memory only reaches this instance (fine — we run one) but add reconnect + refetch-on-connect guarantees; consider an outbox only if we ever scale out.
- Postgres integration test suite + `go test -race`; **load test at 2000 users** (Section 6).
- Frontend: verify v3 migration completeness; test offline PWA UX; align token storage with the P1-9 decision.
- Update `backend/README.md` (still references old v2 env/paths).

---

## 4. Target architecture for 2000+ students — **ONE instance, done right**

A single college canteen with ~2000 students has a very specific load shape: a **lunch/break rush** where maybe 500–1000 students place an order inside a 30–60 min window, then hold a live SSE connection while their order is active. Peak concurrency is on the order of **~1–2k long-lived SSE connections** and **bursts of ~10–20 order-creates/sec**, not sustained thousands/sec.

For that shape, **a single vertically-scaled Go instance is the correct answer**, and it is dramatically simpler and safer than scaling out:

```
                       Students' phones (PWA)          Shopkeeper/Chef tablet
                              │  HTTPS + SSE                    │
                              ▼                                 ▼
              ┌───────────────────────────────────────────────────────┐
              │  Reverse proxy / TLS  (Caddy or nginx)                 │
              │  • proxy_buffering off for /api/stream (SSE)           │
              │  • long read timeout on SSE, short elsewhere           │
              │  • gzip, security headers, HTTP/2                      │
              └───────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────────────────────┐
              │  ONE Go backend instance  (2–4 vCPU, 1–2 GB RAM)       │
              │  • in-process sync.Mutex  → correct, no distributed    │
              │    lock needed                                         │
              │  • in-memory SSE hub      → correct, single process    │
              │  • ulimit nofile raised (each SSE = 1 fd)              │
              │  • http.Server timeouts + body caps + rate limits      │
              └───────────────────────────────────────────────────────┘
                              │  pooled conns (SetMaxOpenConns ~ 20–40)
                              ▼
              ┌───────────────────────────────────────────────────────┐
              │  Managed Postgres 15+  (citext ext, daily backups)     │
              │  • SELECT … FOR UPDATE inside each mutation tx         │
              │  • partial unique index + CHECK constraints (exist)    │
              └───────────────────────────────────────────────────────┘
```

**Why one instance (and why that's not a cop-out):**
- Go handles thousands of idle SSE goroutines on a couple of cores trivially — the constraint is file descriptors (raise `ulimit`), not CPU.
- The pool engine's global mutex is *correct and fast* in one process: each mutation is a single short DB transaction (single-digit ms). Even a burst of 20 mutations/sec serialized ≈ tens of ms of queueing — imperceptible.
- Scaling out would force distributed locking (Postgres advisory locks / `FOR UPDATE`) **and** a distributed SSE transport (Redis / `LISTEN/NOTIFY`) — weeks of work and new failure modes, for a single canteen that doesn't need it.

**But we still harden the single instance so a bug or restart can't corrupt state:**
1. Add `SELECT … FOR UPDATE` on the order, its items, and the pool row inside every mutation, with a deterministic lock order (order → items → pool). This makes the DB the ultimate arbiter even against the background expiry ticker, and means a future second instance wouldn't corrupt data (it'd just serialize).
2. Keep the in-process mutex as a fast-path (belt & suspenders).
3. Make **single-instance an enforced, documented operational constraint** (deploy config sets replicas=1; a boot log states it).
4. Rely on the existing partial unique index + CHECK constraints as the last line of defense (already in the models).

If the college ever grows past one canteen / needs HA, Section "Future scale" in the appendix notes the exact upgrade path — but **do not build it now.**

---

## 5. Keys & secrets you need — and exactly how to get each

Nothing here requires a Firebase **service-account private key** (the design verifies tokens with Google's public certs). You need **6 secrets**. Never commit them; keep them in the host's secret manager / an untracked `.env`.

| Key | Used by | Where it lives | How to get it |
|---|---|---|---|
| **`FIREBASE_PROJECT_ID`** | backend token verify | `backend/.env` | Firebase console → create/select project → ⚙ Project settings → **Project ID** (e.g. `khaao-canteen`). |
| **`VITE_FIREBASE_API_KEY`**, **`_AUTH_DOMAIN`**, **`_PROJECT_ID`**, **`_APP_ID`** | frontend Firebase SDK | `frontend/.env` | Firebase console → Project settings → **Your apps** → register a **Web app** → copy the `firebaseConfig` values. `authDomain` = `<project>.firebaseapp.com`. (These are *public* by design — safe in the client bundle.) |
| **`JWT_SECRET`** | backend, signs Khaao JWT | `backend/.env` | Generate high-entropy: `openssl rand -base64 48`. Rotate = invalidate all sessions. **Must not be the default in production.** |
| **`DATABASE_URL`** | backend | `backend/.env` | Provision managed Postgres 15+ (see options below). Format: `postgres://user:pass@host:5432/khaao?sslmode=require`. Ensure the `citext` extension is allowed (the app creates it). |
| **`SHOPKEEPER_EMAILS`** | backend seed/allowlist | `backend/.env` | The actual Google account emails of the shopkeeper(s)/chef(s), comma-separated. Any domain allowed (this is the allowlist exception). |
| **`ALLOWED_EMAIL_DOMAIN`** | backend | `backend/.env` | Already known: `sst.scaler.com`. Students must sign in with a Google account on this domain. |

### Step-by-step: Firebase Google sign-in setup (one-time, ~15 min)
1. **console.firebase.google.com → Add project** → name it (e.g. `khaao`). Disable Analytics unless wanted.
2. **Build → Authentication → Get started → Sign-in method → enable Google.** Set a support email.
3. **Authentication → Settings → Authorized domains:** add your production frontend domain (e.g. `khaao.sst.scaler.com`) and `localhost` for dev. **Sign-in popups fail on unauthorized domains** — this is the #1 launch gotcha.
4. **Project settings → Your apps → Web (`</>`)** → register app → copy the 4 `VITE_FIREBASE_*` values into `frontend/.env`.
5. Copy **Project ID** into `backend/.env` as `FIREBASE_PROJECT_ID`.
6. (Optional but recommended for @sst.scaler.com) The frontend already passes `hd: <domain>` + `prompt: 'select_account'` as a hint; the **server enforces** the domain, so students on other Google accounts get a clean 403.

### Postgres options (pick one)
- **Managed (recommended for launch):** Supabase, Neon, Railway, or a cloud provider's managed Postgres. Turn on **daily automated backups**. Confirm `citext` is available (all of the above support it).
- **Self-hosted:** Postgres 15+ on the same VM as the backend is acceptable for one canteen; you then own backups (`pg_dump` cron) and tuning.

### Hosting the app
- **Backend:** any container/VM host that lets you set env vars, run **one** replica, raise `ulimit -n`, and put a reverse proxy in front (Fly.io, Railway, Render, a small cloud VM, or campus infra). Needs outbound HTTPS to Google's cert endpoint.
- **Frontend:** any static host (Netlify, Vercel, Cloudflare Pages, or served by the same proxy). Set the 4 `VITE_FIREBASE_*` at build time and point the app at the backend origin.
- **Domain + TLS:** one HTTPS domain for the frontend, one for the API (or same domain, `/api` proxied). Caddy gives you automatic TLS with ~5 lines of config.

---

## 6. How I'll build it — orchestration with `agy` (code) + `codex` (review)

**Roles (per your instruction):** I (Claude) am the **orchestrator** — I plan, write precise prompts, review every diff, run build/vet/test, and gate merges. **`agy` writes the code** (non-interactive `agy -p …`, in an isolated git worktree/branch per package). **`codex` reviews** the design and the resulting diff (`codex exec` / `codex review`). I never hand a package to `agy` without acceptance criteria, and I never merge a package `codex` + I haven't both reviewed.

**Ground rules baked into every `agy` prompt:**
- `docs/SPEC.md` is the contract; do not change the API shape without calling it out.
- `go vet ./... && go build ./... && go test ./... -race` must pass.
- Touch only the files in scope; no drive-by refactors.
- Single-instance topology is a given (Section 4) — do **not** add Redis/distributed transport.

### Work packages (dependency order)

| WP | Scope | Depends on | Reviewer gate |
|---|---|---|---|
| **WP0** | Disposable-Postgres integration harness + `go test -race` in CI; smoke test that boots the server. | — | codex on test plan |
| **WP1** | Fail-closed config (P0-3): normalize `APP_ENV`; in production require non-default `JWT_SECRET`, real `DATABASE_URL`, `FIREBASE_PROJECT_ID`, explicit HTTPS `FRONTEND_ORIGIN`; reject `AUTH_FAKE` outside dev/test. Add `BUSINESS_TIMEZONE` + injectable clock (P1-6). | — | codex + Claude |
| **WP2** | Server hardening (P0-5): `http.Server` timeouts + `MaxHeaderBytes`; `MaxBytesReader` body cap; rate-limit login + mutations (per IP/user); SSE connections capped per user; security-headers middleware (P1-9 headers). | — | codex + Claude |
| **WP3** | AuthZ (P0-4, P1-9): `RequireRole(student)` on student routes; pin Firebase→RS256, app JWT→HS256; validate one exact HTTPS CORS origin at boot. | WP1 | codex + Claude |
| **WP4** | Versioned SQL migrations (P1-10): explicit FKs + `ON DELETE`, CHECKs, partial index, indexes; CI schema verification; keep AutoMigrate only for dev. | WP0 | codex + Claude |
| **WP5** | DB-backed concurrency (P0-1, P1-1, P1-5): `SELECT … FOR UPDATE` on order/items/pool inside each mutation, deterministic lock order; keep the mutex; daily `order_no` retry-once + active-order check inside tx mapping unique violation→409; FCFS `created_at ASC, id ASC`. Multi-goroutine race tests. | WP0, WP4 | codex + Claude |
| **WP6** | Post-accept trim / re-pool feature (P0-2): shopkeeper `POST /api/shop/orders/:id/items/:itemID/remove`; return unhanded allocated qty to pool; re-run allocation; recompute status/total; emit `item_trimmed`; broadcast. Frontend "remove item" control. | WP5 | codex + Claude |
| **WP7** | Reliable events + validation (P1-2, P1-3, P1-4, P1-7): make `logEvent` + all writes return errors inside tx; emit `item_ready`/`item_trimmed`; `MarkDone` menu-exists + upper-bound; decide+implement reject stock-out policy; dedupe menu ids + line/value caps + URL validation. | WP5 | codex + Claude |
| **WP8** | Menu-delete policy (P1-8) + ops (P2): block delete while referenced; health/readiness endpoints; DB pool tuning; structured logs; `CloseDay` confirmation + idempotency + actor. | WP5 | codex + Claude |
| **WP9** | Frontend v3 verification + token-handling decision (P1-9): confirm all v3 pages/flows; align token storage (short-lived SSE ticket vs cookie); offline PWA UX test; update `backend/README.md`. | WP2, WP3 | codex + Claude |
| **WP10** | Load test at 2000 students (k6): ramp 2000 SSE + burst order-creates; measure p95 latency, mutex queue depth, fd usage, Postgres conns; tune instance size + pool. | WP2, WP5 | Claude analyzes |

**Suggested first sprint to a safe soft-launch:** WP0 → WP1 → WP2 → WP3 → WP4 → WP5 → WP6. That closes all five P0s. WP7–WP10 harden for the full 2000-student rollout.

### Example ready-to-run prompts (appendix)

I'll issue these verbatim (in isolated worktrees) once you approve. Two samples so you can see the precision level:

**`agy` — WP1 (fail-closed config):**
> Repo: Khaao Go backend. Contract: `docs/SPEC.md`; issue detail: `PLAN.md` WP1 and `REVIEW.md` P0-3/P1-6. Task: In `internal/config/config.go` add `Validate()` that runs after `Load()`. Normalize `APP_ENV` to lowercase. When `AppEnv=="production"`: fail (return error, don't `log.Fatal` inside config) unless `JWT_SECRET` is set AND ≠ `dev-secret-change-me` AND ≥32 bytes; `DATABASE_URL` set and not the localhost default; `FIREBASE_PROJECT_ID` non-empty; `FRONTEND_ORIGIN` a valid `https://` URL. Reject `AUTH_FAKE=true` unless `AppEnv` ∈ {dev,test}. Add `BusinessTimezone` (env `BUSINESS_TIMEZONE`, default `Asia/Kolkata`), load via `time.LoadLocation`, fail if invalid; expose a `Clock` interface (`Now() time.Time`) defaulting to real time, wired through `PoolEngine` so tests inject it — but keep this change minimal and do not alter allocation logic. Call `cfg.Validate()` in `cmd/server/main.go`, `log.Fatal` on error with a specific message per missing/invalid var. Add table tests in `config/config_test.go` for each production failure and each dev pass. Constraints: `go vet ./... && go build ./... && go test ./... -race` must pass; touch only `config/`, `cmd/server/main.go`, and the minimal `PoolEngine` clock wiring; do not change API shapes.

**`codex` — review gate (per WP):**
> Review this diff against `docs/SPEC.md` and the WP acceptance criteria in `PLAN.md`. Focus: correctness of the state machine and concurrency, whether it fails closed, missing error handling, and any deviation from the single-instance topology decision (flag any added distributed/Redis dependency). Do not rewrite; list concrete issues ranked by severity with file:line.

---

## 7. Definition of "ready for 2000 students"

- [ ] All five P0s closed (WP1–WP6) and covered by `-race` + Postgres integration tests.
- [ ] Fail-closed config verified: server refuses to boot in production without real secrets.
- [ ] Rate limits + timeouts + body caps live; SSE capped per user.
- [ ] Deployed as **one** instance behind a proxy tuned for SSE; `ulimit -n` raised.
- [ ] Managed Postgres with daily backups + a tested restore; connection pool sized.
- [ ] Firebase authorized-domains includes the prod domain; a real @sst.scaler.com student and a real shopkeeper have each logged in end-to-end.
- [ ] k6 load test (WP10) sustains 2000 SSE + rush order-creates within p95 target; no mutex starvation, no fd exhaustion.
- [ ] Runbook: how to close the day, rotate `JWT_SECRET`, add a shopkeeper, restore a backup.

---

## 8. What I need from you to start executing
1. **Go / no-go on single-instance topology** (Section 4). I recommend go.
2. **Approve the WP order** (or reprioritize).
3. When ready, the 6 secrets (Section 5) in an **untracked** `backend/.env` + `frontend/.env` — needed for WP0's integration harness and WP9/WP10, not for me to start WP1–WP7 (those I can build and test with `AUTH_FAKE` + a throwaway Postgres).

Say the word and I'll kick off **WP0 + WP1** with `agy` in isolated worktrees and run `codex` + my own review on the diffs.
