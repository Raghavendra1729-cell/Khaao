# Khaao architecture, schema, concurrency, and security review

Reviewed: 2026-07-13. Scope: `canttenapp.txt`, `docs/SPEC.md`, backend and frontend implementation. No application code was changed.

## Verdict

The project has a good foundation: Go/Gin + Postgres, server-side Firebase-token verification, an explicit order/item state model, paise pricing, a partial unique index for one active order, transactions around mutations, and an API cache bypass in the PWA.

It is **not production-ready yet**. The most serious problems are multi-instance correctness of the pool engine, a missing required post-accept modification/re-pooling flow, and production configuration that can silently use insecure defaults. Fix P0 items before any deployment or real-money/canteen use.

## P0 — fix before deployment

| Finding | Evidence | Impact | Required change |
|---|---|---|---|
| The pool/order engine is only safe in one Go process. | `PoolEngine.mu` is a local `sync.Mutex`; reads and allocation writes use ordinary queries with no row locks or serializable isolation. | With two replicas, Accept/Done/Handover/Expiry can concurrently read stale pool/order values. Allocation can be lost, duplicated, fail on the non-negative check, or break FCFS. The in-memory SSE hub also becomes incomplete. | Either run exactly **one** backend replica as an explicit operational constraint, or make the DB the concurrency coordinator: transactions with `SELECT ... FOR UPDATE` on the order items and pool row, deterministic lock order, atomic conditional updates, plus a distributed event transport (Redis/Postgres `LISTEN/NOTIFY`) for SSE. Add multi-process integration tests. |
| The required active-order item deletion/re-pooling feature is absent. | No route/service modifies an already accepted order; `canttenapp.txt` lines 24 and 30 require it. | A shopkeeper cannot honor the stated workflow. Prepared units cannot be returned to the pool and reassigned FCFS. | Add a shopkeeper-only `trim/remove order item` mutation. In one transaction: lock order/item/pool, forbid handed units or define an explicit partial-removal policy, add unhanded allocated quantity back to `item_pool`, mark/reduce the line, recompute total/status, re-run allocation, write `item_trimmed`, and broadcast after commit. |
| Production can boot with known development credentials and no Firebase project ID. | `config.Load()` defaults `JWT_SECRET=dev-secret-change-me`, local insecure `DATABASE_URL`, blank `FIREBASE_PROJECT_ID`; only `AUTH_FAKE && APP_ENV == "production"` is rejected. | A deployment misconfiguration can let anyone forge application JWTs or make auth invalid/unpredictable. Case variation such as `APP_ENV=Production` bypasses the fake-auth guard. | In production, fail closed unless `DATABASE_URL`, a high-entropy `JWT_SECRET`, `FIREBASE_PROJECT_ID`, and a valid explicit `FRONTEND_ORIGIN` are present. Normalize `APP_ENV`; reject `AUTH_FAKE` outside development/test. Never give real deployments a default JWT secret. |
| Student/shopkeeper authorization is not enforced for student endpoints. | `/api/orders*` and `/api/stream` use `RequireAuth` but no `RequireRole(student)` in `routes.go`. | A shopkeeper account can create a student order and use student interfaces; the declared role separation is not reliably enforced. | Add `RequireRole(student)` to student routes (or deliberately document and test a dual-role policy, which the data model currently cannot represent). |
| No request-size/rate/abuse controls exist on public/auth/mutation endpoints and SSE. | Gin has recovery and CORS only; no body cap, rate limiter, auth throttling, connection limits, or server read/write/header timeouts. | Credential-token verification/cert fetching, order creation, and long-lived SSE can be used for denial of service. | Set `http.Server` timeouts and `MaxHeaderBytes`; wrap JSON bodies with `http.MaxBytesReader`; rate-limit login and mutations (per IP/user); cap SSE streams per user/IP and enforce proxy timeouts. |

## P1 — correctness, state machine, and schema issues

| Finding | Evidence | Impact / recommendation |
|---|---|---|
| Daily order number retry required by the spec is missing. | `CreateOrder` calculates `MAX(order_no)+1` before its transaction and inserts once. | The `(order_date, order_no)` unique index will reject a cross-instance race as a generic 500. Calculate/insert inside the concurrency boundary and retry a detected unique violation once, returning a controlled error if it still fails. |
| The one-active-order check is outside the transaction. | `FindActiveByUserID` occurs before `WithTx`. | The partial unique index is a good last line of defense, but a race becomes a raw DB error/500. Map the unique-index violation to 409 and use a transaction/advisory lock per user. |
| `MarkDone` accepts arbitrary quantity and menu ID. | `MarkDone` converts any `qty <= 0` to 1; it never verifies menu existence, availability, deletion, or an upper bound. | A malformed request can create a pool row for a nonexistent item (or an uncontrolled amount of food); it may also violate an intended FK. Require `qty >= 1` and a sensible maximum; verify the menu item is active/orderable for production policy. |
| Accepted-order trimming and full rejection do not update stock as required by the supplied context. | `Accept` changes line status only; `Reject` has no item selection; neither calls `UpdateStock`. | `canttenapp.txt` says rejected unavailable items must be marked unavailable on the main menu. Clarify whether v3 intentionally replaced this with partial accept. If not, include `out_of_stock_item_ids`, validate them against the order, update them transactionally, and emit a menu refresh. |
| Event/audit trail is incomplete and failures are swallowed. | `logEvent` discards JSON and DB errors. Accept does not log `item_trimmed`; allocation does not log `item_ready`. Several `Save` calls in `MarkDone`/expiry ignore errors. | The spec requires every mutation to create an event; the current audit log cannot be trusted and a DB write failure can still commit related state. Make logging and all writes return errors within the transaction; emit the specified event types with actor and quantity metadata. |
| Database foreign-key/delete semantics are not explicitly guaranteed by model tags/migrations. | Schema requires FKs and `ON DELETE CASCADE`; models mostly use scalar IDs and do not declare `constraint:OnDelete:CASCADE`. `ItemPool` has no relation field at all. | AutoMigrate is not a substitute for reviewed, versioned DDL. Add versioned migrations that explicitly create every FK, `ON DELETE` behavior, checks, partial index, and indexes; verify the resulting database schema in CI. |
| Global lock unnecessarily serializes all mutations even for unrelated menu items/users. | Every engine mutation takes one mutex. | Single-process behavior is safer but can become slow under load. Once DB locking is correct, replace it with narrow DB locks/advisory locks and preserve a deterministic lock order. |
| FCFS ordering lacks a stable tie-breaker and tests do not validate it. | Query sorts only `created_at asc`; Go mock iterates maps randomly. | Timestamp ties can make allocation non-deterministic. Order by `created_at ASC, id ASC` and items by `created_at ASC, id ASC`; add integration tests. |
| Business day/time windows depend on host-local time. | Calls to `time.Now()` and `DayOf()` use the server’s local zone. | A deployment in UTC can reset tokens, availability, expiry, and history on the wrong local day. Add `BUSINESS_TIMEZONE` (IANA name, e.g. `Asia/Kolkata`), load/validate it at boot, and inject a clock for tests. |
| Menu deletion can orphan active-order references or make them hard to query. | Shop can soft-delete any item; active order items retain menu IDs. | Define a policy: block deletion while referenced by active orders and deactivate instead, or retain immutable menu snapshots with a verified FK policy. |
| Input validation is incomplete. | Order input allows repeated menu IDs and unlimited number of lines; names/photo URLs have no length or URL policy. | Repeated lines bypass the intended per-line quantity ceiling and can make prep/order UX inconsistent. Deduplicate menu IDs, cap lines/total units/value, validate lengths and `http(s)` URLs, and reject invalid `qty` rather than converting it to 1. |

## P1 — security and privacy issues

| Finding | Evidence | Required change |
|---|---|---|
| JWT is placed in the SSE query string. | `useSSE.ts` creates `...?token=<JWT>`; middleware accepts it. | Query tokens are exposed to access logs, monitoring, browser history, and potentially referrers. Prefer a secure, `HttpOnly`, `SameSite` session cookie for SSE, or mint a short-lived one-use SSE ticket and redact `token` from all proxy/app logs. |
| Session JWT is stored in `localStorage`. | `frontend/src/api/client.ts`. | Any XSS can exfiltrate a 7-day bearer token. A secure `HttpOnly; Secure; SameSite=Lax/Strict` cookie is preferable. If retaining bearer tokens, add a strict CSP, avoid unsafe script sources, sanitize all untrusted content, reduce TTL, and use refresh/revocation design. |
| Security headers are absent. | Router only uses recovery and CORS. | At the reverse proxy and/or Gin middleware set CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (or stricter), `Permissions-Policy`, clickjacking protection (`frame-ancestors`/`X-Frame-Options`), HSTS on HTTPS, and cache-control for auth responses. |
| External photo URLs are unrestricted. | Shopkeeper-provided `photo_url` renders in `<img>`. | React prevents HTML injection here, but arbitrary remote URLs create tracking/content and resource risks. Allow an approved image host or server-side upload pipeline; validate scheme/length and consider an image proxy. |
| Token-validation hardening is incomplete. | Firebase parser accepts any RSA signing-method subtype, and app JWT parser does not explicitly pin accepted method. | Pin Firebase to `RS256`, pin app JWT to `HS256`, require/validate `iat` according to policy, use a clock skew/leeway policy, and keep the 5-second cert request timeout. Do not return detailed verifier errors to clients. |
| CORS configuration needs deployment validation. | Every response emits the configured origin and credentials. | Validate one exact HTTPS origin (no wildcard, no trailing-path ambiguity) at boot. Since auth is bearer-based today, credentials are unnecessary; if moving to cookies, add CSRF protection and origin checks. |

## P2 — reliability, operational, and documentation gaps

- In-memory SSE only reaches clients connected to the same instance, drops events for slow clients, and has no replay cursor. Client refetching limits damage, but use a shared broker plus reconnect/re-fetch behavior for replicas.
- Broadcasts are not transactional/outbox-backed. A committed change can miss a notification if the process dies after commit; clients should always refetch on reconnect and the backend should consider an outbox for dependable notifications.
- `CloseDay` is highly destructive, has no confirmation/idempotency/audit actor, and can expire orders that already have handed items. Require an explicit confirmation token, role/audit identity, idempotency key, a business-timezone date, and a documented policy for partially handed orders.
- The PWA configuration correctly makes `/api` NetworkOnly. Test offline UX explicitly so it never displays stale orders as live data.
- `backend/README.md` still documents old endpoint/env names (`ALLOWED_EMAIL_DOMAINS`, old `/stream` and `/close` paths). Update it from the v3 spec and API routes.
- The tests are mostly unit mocks and do not exercise Postgres constraints, transactions, migrations, concurrent requests, SSE auth, authorization, expiry, or re-pooling. Add a disposable-Postgres integration suite and `go test -race ./...` in CI.
- Add structured logs, health/readiness endpoints, DB connection-pool settings, backups/restore drills, secret rotation, and monitoring/alerts for auth failures, transaction conflicts, pool anomalies, and order-state transition failures.

## Suggested implementation order

1. Fail-closed production configuration, role guards, server limits, rate limits, and token handling plan.
2. Versioned SQL migrations plus Postgres integration tests for the intended schema.
3. Correct database-backed locking/atomic allocation and daily-token creation; decide whether one replica is a supported constraint.
4. Implement active-order trimming/re-pooling and the confirmed stock-out workflow.
5. Make events/writes reliable, then add SSE scaling/replay/outbox as needed.
6. Finish validation, timezone, destructive-operation safeguards, documentation, and operational controls.

## Environment values useful for the next verification pass

No real secrets are needed to review the code. For safe runtime/integration verification, provide a **non-production** `.env` privately (never commit or paste a production database URL/JWT secret):

```dotenv
APP_ENV=dev
DATABASE_URL=postgres://.../khaao_review?sslmode=disable
JWT_SECRET=<temporary-random-32+-byte-secret>
FIREBASE_PROJECT_ID=<Firebase-project-id>
ALLOWED_EMAIL_DOMAIN=<college-domain>
SHOPKEEPER_EMAILS=<test-shopkeeper-email>
AUTH_FAKE=true                 # local tests only; never production
HOLD_MINUTES=15
FRONTEND_ORIGIN=http://localhost:5173
SEED_SAMPLE_MENU=false
BUSINESS_TIMEZONE=Asia/Kolkata # recommended new setting; not implemented yet
```

For a real Firebase browser-login check, also provide the **public** frontend Firebase web-app values in `frontend/.env`:

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

Do **not** provide a Firebase service-account private key: this design does not require one. Do not provide production credentials in chat; use a secret manager or local untracked `.env` file.

## Verification performed

- `go test ./...` — passed.
- `npm run build` — passed.
- This does not prove concurrency safety: the current tests do not run against Postgres or multiple backend processes.
