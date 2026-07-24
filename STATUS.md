# Khaao — Project Status

> **For the next agent:** read this top-to-bottom before touching code. It's the
> single source of truth for current state, architecture, and what's left. Full
> history of *how* we got here lives in `git log` (every **committed** change has
> a descriptive message) — this file only tracks the *current* picture, not a
> session-by-session diary. The one exception: work that's still **uncommitted**
> has no other record yet, so it's kept here (condensed) until it lands.

## Current state (2026-07-24)

**Everything planned is implemented, gate-clean and committed.** R1–R31,
F1–F24, the G-series (§ 9.3), every backend/frontend find-fix pass, the
design-polish pass, the component restructure, the 2026-07-22 bug fixes, the
§ 9.5 (T1–T5) 2026-07-22-audit fixes, and two rounds of a fresh 2026-07-24
find-fix pass are all **committed** (git log through `730318a`, backend and
frontend split into one commit each per round — `6e7972f`/`f652957` then
`2ffc90c`/`730318a`). The working tree is clean — nothing uncommitted
remains.

### Recent work, newest first

**2026-07-24 (second find-fix pass, same day, two more parallel agents by
stack — deeper pass, less-scrutinized areas):** owner asked for another
round on top of the pass below. Same split (one agent per stack, run in
background, briefed to treat everything already in this file — including
the pass below — as known and not to re-flag it), pointed at areas that had
gotten comparatively less attention in prior passes (rate limiting,
allocation, controllers, hub lifecycle, migrations on the backend;
`useSSE.ts`, `sw.ts`, prompt-coordination timing, `api/client.ts` on the
frontend). The backend agent's process stalled after finding and fully
implementing its fix (a harness watchdog issue, not a defect in the work
itself) — verified independently before trusting it: read every diff line
by line, then re-ran the full gate (build/vet/gofmt/test -race, plus the
integration suite against real Postgres) myself before committing. Found
and fixed 4 real bugs:

1. **[Concurrency] `services/menu.go` `MenuService.Update` could silently
   revert a concurrent `SetStock` call (a lost-update race).** `Update` did
   an unlocked `FindByID`, mutated only the `MenuItemInput`-owned fields in
   memory, then `Save()`d the whole row — GORM's `Save` writes every column
   verbatim, including `out_of_stock`, which `Update` itself never touches
   but `SetStock` owns via its own targeted single-column `UPDATE`. A
   `SetStock` call landing between `Update`'s read and its `Save` was
   silently reverted by `Update`'s stale in-memory snapshot: exactly the
   multi-device shopkeeper scenario already established as real in this
   codebase (the 2026-07-22 `ShopStatusControl` fix, counter tablet vs.
   owner's phone) — one device edits an item's price/name while another
   marks it out of stock at nearly the same moment; both actions report
   success, but the item silently stays orderable on the student menu.
   Fixed: `Update` now reads via a new `FindByIDForUpdate`
   (`SELECT … FOR UPDATE`) inside a `uow` transaction, so a concurrent
   `SetStock` either commits first (seen correctly) or blocks until
   `Update`'s transaction commits. New regression test
   (`TestMenuUpdateDoesNotClobberConcurrentStockChange`) with a fake repo
   modeling real Postgres row-locking semantics, verified to fail without
   the fix; also added `TestMenuUpdateAppliesInputFields` since `Update` had
   zero prior test coverage on its ordinary path.
2. **`internal/config/config.go` `Config.Location()` cached its result with
   a bare nil-check, a real data race for any concurrent caller that
   bypasses `Validate()`'s eager warm-up** (production is safe today only
   because every real boot calls `Validate()` first, which eagerly sets the
   cache — but correctness relying purely on caller discipline was the bug,
   and the new concurrency test above is exactly such a caller: two
   goroutines racing `Update`/`SetStock` against a bare `&config.Config{}`).
   Fixed with `sync.Once` so it's correct unconditionally.
3. **`api/client.ts` `apiFetch` treated every `401` as "the session died,"
   even for requests that never carried a token.** `POST /api/auth/firebase`
   (the login exchange itself) legitimately 401s for a bad/expired Firebase
   ID token or an unverified email, and `Login.tsx` renders that `ApiError`'s
   `.message` directly in its error banner — so a student whose sign-in was
   rejected for a real reason saw the hardcoded "Your session expired.
   Please log in again." instead of the backend's actual reason, and the
   (harmless but pointless) `khaao:unauthorized` event fired with nothing
   to clear. Fixed: the session-teardown branch now only fires when a token
   was actually sent (`res.status === 401 && token`); a token-less 401 falls
   through to the existing generic error-body path. Two new tests, verified
   the token-less case fails without the fix.
4. **`components/layout/PushNotificationSetup.tsx` could show its prompt on
   top of `InstallPrompt`'s.** The mount effect checked the shared
   install-prompt slot only once, synchronously, before an async
   `serviceWorker.ready` → `getSubscription()` chain — but
   `beforeinstallprompt` is a browser-timed event that can fire mid-chain
   (unlike the iOS hint, computed synchronously for exactly this reason),
   so both bottom-sheet prompts (same fixed slot) could end up visible at
   once. Fixed: re-check the slot again right before the actual
   `setShowPrompt(true)` call. New test file, verified to fail without the
   fix.

Full GATE after all four: backend — `go build`, `go vet`, `gofmt -l` clean,
`go test ./... -race` clean (unit and integration, real Postgres). Frontend
— `tsc -b --noEmit` clean, `lint` 0 errors/24 warnings (unchanged), `test`
71/71 (was 67/67 — 4 new tests), `build` 250.24 KB raw initial student JS
(a ~0.02 KB nudge from the two frontend fixes, both landing in the shared
initial chunk), `format:check` clean. Committed as `2ffc90c` (backend),
`730318a` (frontend).

**2026-07-24 (fresh full-stack find-fix pass, two parallel agents by
stack):** another evidence-based read of both stacks, disjoint from every
prior pass — backend and frontend each independently cross-checked against
this file's own §9.4/§9.5/§11 tables first, so nothing already-known or
deliberately-deferred got re-flagged. Found and fixed 2 real bugs, plus one
gap recorded (not fixed) as a new deferred item:

1. **[Security] `services/auth.go` `FirebaseLogin` never refreshed a
   returning user's stored email, silently undermining the shopkeeper-
   revocation guarantee.** The repeat-login branch (existing user found by
   `FirebaseUID`) refreshed `Name`/`PhotoURL` from the freshly verified
   Firebase identity but left `Email` frozen at whatever was stored on first
   login — even though `role` on that same login is recomputed from the
   *new* `identity.Email`. `AuthService.GetUser`'s per-request allowlist
   re-check (the 2026-07-21 instant-revocation fix) keys off that stale
   stored value, not the person's live identity: an admin removing a
   shopkeeper's *current* email from `SHOPKEEPER_EMAILS` would not actually
   revoke them if their old, forgotten email was still (or again)
   allow-listed, and conversely a legitimate Workspace email change could
   spuriously lock someone out. `FirebaseUID` is the stable identity
   Firebase guarantees across an email change, so the repeat-login path is
   exactly where the change would have surfaced. Fixed: refresh `Email`
   alongside `Name`/`PhotoURL` on every login. New regression test
   (`TestFirebaseLoginRefreshesStoredEmailOnRepeatLogin`), verified to fail
   without the fix.
2. **`pages/shop/MenuManage.tsx`'s photo picker erased a working photo on a
   failed re-upload.** The `catch` block unconditionally reset
   `form.photo_url` to `''` on any upload failure, including while editing
   an item that already had a working, previously-saved photo. A shopkeeper
   swapping a photo on flaky counter Wi-Fi who then pressed Save — a
   reasonable next action, since Save wasn't disabled and nothing indicated
   the existing photo had been touched — silently removed the item's live
   photo even though nothing new was ever successfully uploaded. Fixed: the
   `catch` block only shows the error toast now; `form.photo_url` is left
   exactly as it was. New regression test, verified to fail without the fix.

One gap found and deliberately **not** fixed — recorded as § 9.4-B15 instead
of a targeted code change: `item_pool.qty`/`menu_items.out_of_stock` have no
reset at a business-day boundary in the current codebase, even though
`docs/SPEC.md`'s frozen v3 baseline documents a `day/close` endpoint for
exactly this and the repo methods to do it (`ResetStock`/`ZeroAll`) still
exist unused. See § 9.4-B15 for the full write-up.

Full GATE after both fixes: backend — `go build`, `go vet`, `gofmt -l`
clean, `go test ./... -race` clean (unit and, where a local Postgres was
reachable, integration). Frontend — `tsc -b --noEmit` clean, `lint` 0
errors/24 warnings (unchanged baseline), `test` 67/67 (was 66/66 — 1 new
test), `build` succeeds, `format:check` clean.

**Bundle note:** rebuilding the previously-committed tree alone (no code
change) now also produces **250.22 KB** raw initial student JS, not the
250.01 KB this file previously recorded — confirmed via `git stash` before
either fix landed, so the drift is environmental (toolchain/dependency
version movement since that number was last measured), not caused by either
of today's fixes; both land in already-lazy chunks (the backend fix isn't
frontend code at all, and the frontend fix lives entirely in the lazy
`MenuManage` chunk). Recorded value below updated to the now-verified
250.22 KB; still over the § 9.1.8 250 KB line, same lever identified
(§ 9.4-B13).

**2026-07-22 (component restructure + fresh full-stack find-fix pass):** the
`frontend/src/components/` folder had grown to 30 files in one flat directory
mixing role-agnostic primitives, app-shell, and student-/shop-only code with
no separation — split it into `components/ui/` (11 role-agnostic primitives:
Button, Card, Modal, Toast, ConfirmDialog, EmptyState(+Icons), Spinner,
StatusBadge, QtyStepper, VegMark), `components/layout/` (5: Layout,
ProtectedRoute, ErrorBoundary, InstallPrompt, PushNotificationSetup),
`components/student/` (10: MenuItemCard, OrderModal, OrderTicket,
StudentRealtime(+test), StatusStamps, TrendingRail, FavoritesRail,
DietFilter, MenuSkeleton), and `components/shop/` (2: ShopRealtime,
ShopStatusControl). Two non-component pub-sub helper modules
(`promptCoordination.ts`, `shopNotifications.ts`) moved to `lib/` instead,
alongside `liveAnnouncer.ts` whose exact idiom they already mirrored — a
plain `.ts` state-store module living in `components/` was the odd one out,
not the convention. All moves via `git mv` (history preserved); every import
across the tree (30+ files) updated by hand for the new depth, including
`vi.mock()` string literals that a `from '...'` sed pass can't reach (caught
by a full test run, not by `tsc` — mock specifiers aren't type-checked).

Then a fresh, evidence-based bug hunt across both stacks — frontend read
directly (hooks/useSSE.ts, api/client.ts, lib/cart.ts, lib/image.ts,
AuthContext.tsx, Login.tsx, sw.ts, PushNotificationSetup.tsx, Orders.tsx,
OrderModal.tsx, History.tsx, MenuManage.tsx), backend delegated to a
background pass over files/areas the two 2026-07-21 backend passes hadn't
already covered in depth (ratings.go, sse_ticket.go, gorm.go's query/preload
shapes, ratelimit.go, hub.go, main.tsx's expiry ticker, models vs.
migrations). Found and fixed 3 real bugs:

1. **[Data integrity] `services/ratings.go` `SubmitRatings` let a student
   rate an order item that was never delivered.** `itemMap` was built from
   *all* of `order.Items` with no filter on `Status`, and validation only
   checked the item belonged to the order and `stars` was 1–5 — never that
   `Status != rejected`. A line goes `rejected` when the shopkeeper trims it
   mid-order (`PoolEngine.RemoveItem`, e.g. running out of an ingredient)
   while the rest of the order proceeds normally to `completed`; the student
   never received that item but `POST /api/orders/:id/ratings` accepted a
   rating for it anyway, and `GormRatingRepo.GetMenuAggregates` aggregates
   purely by `menu_item_id`/`stars` with no join back to item status — so it
   directly pollutes that menu item's public `avg_rating`/`rating_count`
   shown to every student. The frontend already filters rejected items out
   of the normal rating UI (`OrderStatus.tsx`), so this wasn't reachable
   through the intended flow today, but it was a missing *server-side*
   invariant, not a deliberate tradeoff — trivially reachable via a direct
   API call, or by any future frontend regression that stops filtering.
   Fixed: reject with 400 if the targeted item's status is `rejected`. New
   regression test (`rating_a_rejected_item`), verified to fail without the
   fix.
2. **`sw.ts`'s push handler silently dropped a data-less push event** —
   showing nothing at all, which is exactly the browser-goodwill/throttling
   risk the handler's own adjacent comment already warns about for a
   malformed payload, just left unhandled for the "no payload" case. Not
   currently reachable (this backend's `push.go` always sends a marshaled
   payload for every push it fires), but a real defensive-coding gap for any
   push arriving without one. Fixed: fall back to the same generic
   notification in both cases.
3. **The backend's `avail_window_warning` (services/menu.go, set when
   `avail_from >= avail_to` on a menu item create/update — ambiguous between
   a genuine overnight window and a same-day typo) was a dead feature on the
   frontend.** `MenuItem` never declared the field and neither mutation
   handler in `MenuManage.tsx` read the response body, so a shopkeeper who
   mistyped an availability window got zero feedback despite the backend
   doing the work to compute it. Fixed: added the field to the `MenuItem`
   type and surfaced it as an `info` toast on both create and update.

Plus two doc corrections found along the way: § 4's codebase map claimed
`useSSE.ts` has a "MAX_RETRIES cap" — the hook now retries indefinitely with
only a *backoff-delay* cap (`MAX_BACKOFF_MS`); the attempt-count cap this
line described no longer exists in the code (confirmed via
`useSSE.test.ts`'s own comment referencing "the old MAX_RETRIES(8) cap").
And a stale comment in `OrderStatus.tsx` still pointed at
`components/StudentRealtime.tsx` post-reorg.

Full GATE after everything above: frontend — `tsc -b --noEmit` clean, `lint`
0 errors/23 warnings (unchanged baseline), `test` 61/61, `build` 250.01 KB
raw initial student JS (unchanged — the reorg is pure file movement, and the
`avail_window_warning` fix lands in a lazy-loaded route chunk), `format:check`
clean. Backend — `go build`, `go vet`, `gofmt -l` clean, `golangci-lint run`
0 issues, `go test ./... -race` clean (including the new ratings regression
test).

**2026-07-22 (frontend find-fix pass — realtime cache sync):** a fresh read of
the frontend focused on React Query cache keys vs. the SSE events that are
supposed to keep them live — the class of bug where a broadcast fires but the
component listening for it reads a *different* key. Found and fixed one real
one:

1. **The shopkeeper's header status pill never refetched from SSE or on
   reconnect — it only updated from its own mutation.**
   `components/ShopStatusControl.tsx` read its status from query key
   `['shop', 'status']`, but *nothing else in the app used that key*. The rest
   of the app (student `Menu.tsx`, both `StudentRealtime`/`ShopRealtime`
   invalidations) uses `['shop-status']`. Two consequences: (a)
   `hub.NotifyShopStatusUpdate()` explicitly `broadcastAll`s a `shop_status`
   event to **every** client "student AND shop" (its own doc comment), but
   `ShopRealtime.handleMessage` had no `shop_status` branch at all, so the shop
   silently dropped it; (b) `ShopRealtime`'s reconnect resync (`handleOpen`)
   *did* invalidate `['shop-status']` — a key the shop side never read — so
   even the "onOpen resyncs everything" self-heal missed the pill. Net: a
   status change made on another shopkeeper device/session (counter tablet vs.
   owner's phone) left this device's pill stale until a full reload. Since
   `refetchOnWindowFocus` is off and there's no refetch interval (main.tsx),
   nothing else masked it. **Fix:** unified `ShopStatusControl` onto the
   app-wide `['shop-status']` key (its own mutation `setQueryData`/invalidate
   included — a shorter string, so a net *reduction* on that path), and added
   the missing `shop_status` branch to `ShopRealtime.handleMessage` so the
   broadcast now lands instantly, matching the hub's documented intent. Only
   affects multi-device shopkeeper sessions (the pill is the shopkeeper's own
   info display; students were never affected — their `['shop-status']` path
   was already correct), so it's low-severity, but it silently defeated a
   broadcast the backend was already paying to send.

   **Bundle note:** the new `else if` branch is ~65 bytes of runtime code in
   the shared initial chunk, nudging the Vite-reported initial student JS from
   249.95 KB to **250.01 KB** — 0.01 KB past the 250 KB line § 9.1.8 calls a
   hard stop. Not byte-golfed back under: the honest lever is structural, not
   a 65-byte contortion of working notification code — `ShopRealtime` /
   `ShopStatusControl` are shopkeeper-only components that ride the *student's*
   shared chunk because `Layout.tsx` statically imports them. Lazy-splitting
   the shop shell out of the initial chunk (recorded as § 9.4-B13) reclaims far
   more than needed whenever the budget wants real headroom. Gate after fix:
   `tsc` clean, `lint` 0 errors/23 warnings (unchanged), `test` 61/61,
   `build` 250.01 KB initial student JS.

**2026-07-21 (full-stack find-fix pass):** a fresh, complete read of the
codebase — backend order/menu/shop-status/push lifecycle, and the frontend
booking, cancel, accept/reject/handover, menu-edit, and shop-status flows —
hunting for functional bugs and unhandled edge cases, not style. Found and
fixed one real backend security bug and 4 frontend bugs:

1. **[Security] `services/push.go` `Subscribe` had no validation on the
   client-supplied `endpoint` URL — a genuine SSRF.** `POST
   /api/push/subscribe` requires only `requireAuth` (any authenticated
   student, the lowest privilege tier), and `send()` later makes a real
   outbound HTTPS POST to `sub.Endpoint` via `webpush-go` whenever a push
   fires for that user (e.g. their own order reaching "ready" — easy to
   trigger almost at will). A self-generated P-256 keypair is trivial to
   produce and doesn't need to come from a real browser subscription —
   webpush-go's encryption step only checks the key is well-formed, not
   that it's genuine — so "valid encryption keys are required" was never a
   real barrier to pointing `endpoint` at an internal host or an
   attacker-controlled URL. Fixed with a hostname allowlist covering the
   three real Web Push vendors this PWA's target platforms use (`fcm.
   googleapis.com`, `updates.push.services.mozilla.com`,
   `web.push.apple.com`) — exact-hostname match, not prefix/suffix, so a
   lookalike like `fcm.googleapis.com.evil.example` doesn't sneak through.
   The legitimate flow (`PushNotificationSetup.tsx`) always gets its
   `endpoint` from the browser's own real `pushManager.subscribe()`, so
   this doesn't affect real usage; its existing catch/toast (F9) already
   handles a rejection gracefully if it ever fires. New `push_test.go`
   (9 cases: 6 rejected including the lookalike-host and http-scheme-to-a-
   real-host attempts, 3 real vendor hosts accepted). Full backend GATE
   re-run clean: `go build`, `go vet`, `gofmt -l`, `golangci-lint run` (0
   issues), `go test ./... -race`.

2. **`lib/cart.ts` `reorderIntoCart` merged quantities with no upper bound.**
   Every other path to a cart quantity (`QtyStepper`, the backend's
   `CreateOrder`) caps a line at 20 — reorder didn't, so reordering on top of
   an already-substantial cart could produce a qty >20 that the backend
   rejects whole-cloth with a generic "qty must be between 1 and 20," naming
   no item and stranding the student. Now clamps to the same 20, matching
   `QtyStepper`'s existing silent-clamp behavior. Regression tests added.
3. **`pages/shop/History.tsx`'s date input had no failure-safe boundary.**
   Clearing the native `<input type="date">` (a normal browser interaction)
   set `date` to `""`; stepping from there via `shiftDate("", 1)` produced
   the literal string `"NaN-NaN-NaN"`, which the backend 400s on a
   never-before-cached query key — tripping the `isError`-with-no-cached-data
   early return that replaces the *entire* section, date input included,
   with an error screen with no in-page way back. Fixed: empty input falls
   back to today; added `max={todayLocal()}` so the native picker can't be
   driven past today either (the ▶ button already blocked that path, the
   picker itself didn't).
4. **`pages/shop/MenuManage.tsx`'s tap-to-arm mistouch guard could desync
   from Edit.** The 3s auto-disarm timer keeps running while the edit form
   is open (the row isn't unmounted). A quick open-then-cancel of Edit
   within that window returned to a card that was still armed but no longer
   showing the "tap again" banner — the next incidental tap anywhere on the
   card would silently mark the item out of stock. Fixed: opening Edit now
   also disarms.
5. **`components/ShopStatusControl.tsx`'s pause-reopen time input had the
   same clearable-native-input gap as #3.** An emptied `<input type="time">`
   fed `reopenTimeToISO("")`, which built an Invalid Date and threw on
   `.toISOString()` inside the mutation (caught by React Query, so not a
   hard crash, but surfaced a misleading "Could not change status" toast for
   what was really a client-side blank field). Fixed at the same input
   boundary: falls back to the picker's own 30-minutes-from-now default.

One thing found and deliberately **not** changed — recorded as § 9.4-B12
instead of silently altering product behavior: an order that's had **some**
but not all items handed over, then abandoned by the student, has no
terminal path. `Reject` refuses once any item's `handed_qty > 0`; the 15-min
hold-then-expire in `ExpiryTick` explicitly skips any order with handover
activity. This matches § 3's documented state machine verbatim ("ready →
expired, 15-min hold **if nothing handed**") — it's a real operational gap
(the order, and the student's one-active-order slot, stay stuck until the
shopkeeper notices and manually hands over the remainder to force
`awaiting_payment`), but closing it means adding an explicit "write off /
abandon" action, which is a product decision, not a bug fix.

Full GATE after all five fixes: frontend — `npx tsc -b --noEmit` clean,
`npm run lint` 0 errors (23 pre-existing warnings, unchanged), `npm test`
61/61 (59 + 2 new `reorderIntoCart` cap cases), `npm run build` 249.95 KB raw
initial student JS (effectively unchanged, still under the 250 KB line).
Backend — `go build`, `go vet`, `gofmt -l` (clean), `golangci-lint run`
(0 issues), `go test ./... -race` (`internal/services` 2.259s, including 9
new `push_test.go` cases for the SSRF fix).

**2026-07-21 (backend find-fix pass):** same file-by-file, verify-
empirically discipline extended to `backend/` at the project owner's
explicit direction. Read every service/repository/middleware file at least
once; found and fixed 4 issues:

1. **`services/auth.go` `GetUser` didn't re-check the shopkeeper allowlist.**
   The allowlist was only ever consulted at `FirebaseLogin` time; a
   shopkeeper removed from `SHOPKEEPER_EMAILS` kept full access on their
   already-issued JWT for up to its full 7-day life. Fixed: `GetUser`
   re-verifies a shopkeeper-role user's email is still on the live allowlist
   on every request (student role has no equivalent per-user list, so this
   only costs a lookup for the handful of shopkeeper accounts). Regression
   test verified to fail without the fix.
2. **`services/pool.go` `Reject`/`Handover`/`Paid` silently returned empty
   `student_name`/`student_email`.** All three built their response from the
   transaction-scoped order (loaded via `FindByIDForUpdate`, which skips
   `Preload("User")` on purpose) while claiming `includeStudent=true`.
   `Accept`/`RemoveItem`/`CreateOrder` already re-fetched correctly — this
   was a 3-of-6 inconsistency, invisible today only because the frontend
   never reads a mutation response body (it always refetches the list
   instead). Fixed by adding the same re-fetch the other three use. New
   integration test (`TestIntegration_MutationResponsesIncludeStudentName`,
   real Postgres) — the mocked unit suite couldn't have caught this since
   the mock's `FindByID`/`FindByIDForUpdate` return the same pointer.
3. **gofmt drift in 8 files** (whitespace/alignment only, diffed before
   applying — same category the frontend already got bitten by once).
4. **CI had no Go equivalent of the frontend's format-check step at all** —
   the root cause of #3. Added `gofmt -l` to the `backend-unit` CI job.

Full GATE: `go build`, `go vet`, `gofmt -l` clean, `golangci-lint run`
(plain and `--build-tags=integration`, 0 issues each), `go test ./... -race`
(unit), `go test -tags=integration -p 1 ./... -race` (real Postgres),
`scripts/smoke.sh` 15/15.

**2026-07-20 (frontend design-polish micro-pass, two rounds):** a fresh
file-by-file read of the full frontend on top of the G-series diff, then a
second round hunting the same bug categories plus a live-browser sweep.
Found and fixed 8 issues: `Menu.tsx`'s diet-filter and search zero-results
states now use the shared `EmptyState` (icon + "Clear filter" action)
instead of a bare sentence; `MenuSkeleton.tsx` grew a bone for G2's search
input and lost a real CSS-specificity bug (`Bone`'s hardcoded `bg-edge/50`
default was silently beating every caller's lighter override in the
cascade — Tailwind emits utilities in ascending numeric order regardless of
JSX source order); `Orders.tsx` picked up `loading="lazy" decoding="async"`
on two thumbnail spots G1's file list didn't literally name, plus its tablet
skeleton now matches the real `lg:` two-column breakpoint; `TrendingRail.tsx`
got the missing `decoding="async"`; `OrderStatus.tsx`'s `RatingPrompt` had
the same cascade-collision bug as `Bone` (a `border-brand-dark` override
losing to `Card`'s baked-in `border-edge`) — fixed with a `ring-2` instead
of a border, since box-shadow can't collide with the property it was losing
to. Verified live across two scratch-stack Playwright rounds (both roles, a
real order lifecycle for real proportions). Gate unchanged: `tsc` clean,
`lint` 0/23, `test` 59/59, `build` 249.94 KB.

**2026-07-20 (G-series verification pass):** independently re-verified all
eight G-items diff-by-diff against § 9.3's spec, then did the live-browser
pass a previous round couldn't (no OAuth creds at the time) — an isolated
scratch stack, both roles, real SSE round-trip for G7. Found and fixed 2
more issues: (1) G2's search input showed a duplicate clear icon (Chromium/
WebKit paint their own native `::-webkit-search-cancel-button` on
`type="search"`, which Tailwind's preflight doesn't strip — fixed with a
6-line rule in `index.css`); (2) **CI was red on `origin/main`**,
independent of the G-series — `Orders.tsx`/`Prep.tsx` had drifted out of
Prettier format sometime during the F-series and nobody had checked the
Actions tab; fixed (`prettier --write`, whitespace only, diffed before
applying). `npm run format:check` is now clean repo-wide.

**G-series (G1–G8) and F-series (F1–F24) implementation:** see § 9.3 and
§ 9.2 below for the full per-item spec — everything listed there shipped as
written, gated after every item (types/lint/tests/build/no horizontal
scroll/reduced-motion), and (G-series) live-verified via Playwright against
an isolated scratch stack. F-series is committed (git log); G-series is the
newest layer of the uncommitted diff.

### Two things remain

1. **Decide on § 9.4-B12** (the partial-handover/abandoned-order gap) — or
   leave it recorded and unstarted, same as the rest of § 9.4. § 9.4-B13
   (lazy-split the shop shell for bundle headroom) is likewise recorded and
   unstarted.
2. **Deployment (D-1..D-7)** below — human-led, needs real infra access, not
   more code.

---

## 1. What is Khaao?

A **mobile-first installable PWA** for a single college canteen. Students sign
in with their college Google account, build a cart, place one order at a
time, and track it live. The shopkeeper/chef accepts orders, cooks to
aggregate demand, hands items over one-by-one, and collects payment. No
in-app payments, no OTP, no multi-canteen.

**Scale target:** ~2000 students, single college. Lunch/break rush = bursts of
orders + ~1–2k long-lived SSE connections. Sustainably served by **one Go
instance** (see § Topology decision).

---

## 2. Stack

| Layer | Details |
|---|---|
| **Backend** | Go 1.23 · Gin · GORM · **PostgreSQL only** |
| **Architecture** | Layered SOLID: `controllers → services → repositories` with `authn`, `realtime`, `config`, `database` packages. Composition root in `cmd/server/main.go`. |
| **Auth** | Firebase Google sign-in only. Backend verifies Firebase ID tokens against Google's public certs (no Admin SDK, golang-jwt). Issues its own HS256 Khaao JWT. Role re-read from DB on every request, including a live shopkeeper-allowlist re-check (2026-07-21). `FakeVerifier` for dev/e2e (`AUTH_FAKE=true`, disabled in production). |
| **Real-time** | Server-Sent Events, in-memory `realtime.Hub`. Students get `order_update`/`menu_update`. Shop gets `orders_update`/`prep_update`/`menu_update`/`shop_status`. Plus best-effort Web Push (VAPID) so a shopkeeper is notified of a new order even with the app closed. SSE connections authenticate via a short-lived one-use ticket (`POST /api/auth/sse-ticket`), never the raw JWT. |
| **Observability** | Structured `log/slog` throughout (JSON in production, text in dev/test) — `middleware.RequestLogger()` logs one line per request (method/path/status/latency/user_id); the shared `respondError` logs every 5xx at Error and every 409 (conflict) at Warn. |
| **Frontend** | React 18 · TypeScript · Vite · Tailwind CSS · TanStack Query · react-router · Firebase JS SDK · installable PWA (`injectManifest` mode, hand-written `frontend/src/sw.ts`) |
| **Uploads** | Menu photos go straight to Cloudinary via a backend-signed upload (image bytes never touch the Gin server). |
| **Topology** | **ONE backend instance** behind a TLS reverse proxy (Caddy/nginx). Deliberate, not deferred — see below. |

### Topology decision — why ONE instance

Deliberate architectural choice. **Do not add Redis, distributed locks, or a
distributed SSE transport** unless the scale target itself changes.

- A single canteen lunch rush = ~500–1000 orders in 30–60 min, ~1–2k concurrent
  SSE connections. Go handles this trivially on 2–4 vCPU.
- `PoolEngine.mu` (`sync.Mutex`) is correct and fast in one process — each
  mutation is a single short DB transaction (single-digit ms).
- Scaling out would need distributed locking (Postgres advisory locks) *and*
  distributed SSE (Redis/LISTEN-NOTIFY) — real cost for a scale this app will
  never hit.
- The DB is still the ultimate arbiter: `SELECT … FOR UPDATE` is already in
  every mutation transaction, so a second instance would serialize correctly
  rather than corrupt data if it ever came to that. But run one.

```
Students' phones (PWA)           Shopkeeper/Chef tablet
         │  HTTPS + SSE                    │
         ▼                                 ▼
┌────────────────────────────────────────────────────┐
│  Reverse proxy / TLS (Caddy or nginx)               │
│  • proxy_buffering off for /api/stream (SSE)        │
│  • long read timeout on SSE, short elsewhere        │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│  ONE Go backend instance (2–4 vCPU, 1–2 GB RAM)    │
│  • in-process sync.Mutex  → correct, no dist. lock  │
│  • in-memory SSE hub      → correct, single process │
│  • ulimit nofile raised (each SSE = 1 fd)           │
└────────────────────────────────────────────────────┘
         │  pooled conns
         ▼
┌────────────────────────────────────────────────────┐
│  Managed Postgres 15+ (citext ext, daily backups)   │
│  • SELECT … FOR UPDATE inside each mutation tx      │
└────────────────────────────────────────────────────┘
```

---

## 3. Key workflows

**Student:** Login → browse menu → cart → place order (one active at a time)
→ track live (SSE: Waiting → Cooking → Ready → Pay → Done) → ready triggers
chime + vibrate + push → pay at counter → optional post-order rating.

**Shopkeeper:** Set menu/stock/diet/tags in the morning → triage incoming
(accept with optional per-item trim, or reject) → Prep screen shows aggregate
remaining demand, mark units done → hand items over (per-item or bulk) →
collect payment → History shows completed orders + insights. Shop-status
control (open/paused/closed) blocks new orders and gates pause/close on
accepted-but-unfinished orders.

**State machines:**
```
Order:  submitted → preparing → partially_ready → ready
                             ↘ awaiting_payment → completed
        branch: submitted → cancelled (student, submitted-only)
        branch: submitted/preparing/partially_ready/ready → rejected (shopkeeper,
                 refused once anything's been handed over)
        branch: ready → expired (15-min hold if nothing handed — see § 9.4-B12
                 for the gap this leaves once *something* has been handed)

Item:   pending → queued → allocated → handed_over
        branch: rejected
```

Status is derived by a pure `recomputeStatus` function after every mutation.
Prices are integers in **paise**. Daily order tokens reset per
`BUSINESS_TIMEZONE` (default `Asia/Kolkata`).

---

## 4. Codebase map

```
backend/
  cmd/server/main.go              → composition root, server lifecycle, expiry ticker
  internal/
    config/config.go              → fail-closed config (refuses prod boot with dev defaults)
    authn/                        → Firebase RS256 verification + FakeVerifier (dev/test only)
    middleware/                   → auth (+ SSE ticket auth), CORS, security headers,
                                     ratelimit.go (per-user token bucket + SSE conn cap),
                                     logging.go (structured per-request slog)
    models/                       → GORM models (user, menu_item, order, order_item, item_pool,
                                     order_event, shopkeeper_email, shop_status, item_rating,
                                     push_subscription)
    database/database.go          → Open (GORM, citext, versioned SQL migrations via
                                     golang-migrate, pool tuning), Seed
    repository/                   → interfaces (repository.go) + GORM impls (gorm.go)
    realtime/hub.go                → in-memory SSE hub (fan-out by userID/role)
    services/
      auth.go, menu.go, orders.go, shopstatus.go, ratings.go, push.go, sse_ticket.go
      pool.go                     → PoolEngine: the core order/prep/handover/payment engine
      allocation.go                → FCFS allocation strategy
      *_test.go                    → unit tests (mocked repos)
    controllers/                   → auth, menu, orders, shop, shopstatus, push, cloudinary, health
    routes/routes.go               → all route wiring

frontend/
  src/
    main.tsx, App.tsx              → root, route tree (role-split: student vs shopkeeper)
    lib/                           → firebase init, format helpers, sound (WebAudio, no assets),
                                     cart.ts (cart derivation/persistence + G3 reorder merge),
                                     liveAnnouncer.ts (G7 aria-live pub-sub), promptCoordination.ts
                                     (InstallPrompt/PushNotificationSetup bottom-sheet-slot pub-sub),
                                     shopNotifications.ts (shopkeeper header-bell pub-sub)
    context/AuthContext.tsx        → auth state
    context/LanguageContext.tsx    → shopkeeper-only Hindi/English toggle (localStorage-persisted)
    hooks/useSSE.ts                → SSE hook, jittered exponential backoff (capped at
                                     MAX_BACKOFF_MS; retries indefinitely, no attempt-count cap —
                                     the "MAX_RETRIES cap" this line described until 2026-07-22 no
                                     longer exists in the code, see this session's find-fix pass)
    api/                           → typed API clients per domain
    components/ui/                 → role-agnostic primitives: Button, Card, Modal (portal-based),
                                     Toast, ConfirmDialog, EmptyState(+Icons), Spinner, StatusBadge,
                                     QtyStepper, VegMark
    components/layout/              → app shell: Layout (header+nav+realtime handlers),
                                     ProtectedRoute, ErrorBoundary, InstallPrompt,
                                     PushNotificationSetup
    components/student/            → MenuItemCard, OrderModal, OrderTicket, StudentRealtime,
                                     StatusStamps, TrendingRail / FavoritesRail (G8), DietFilter,
                                     MenuSkeleton
    components/shop/               → ShopRealtime, ShopStatusControl
    pages/student/                 → Menu (browse/cart/checkout/search/favorites), OrderStatus
                                     (tracking/history/rating/reorder)
    pages/shop/                    → Orders, Prep, History (day stepper + ledger bars), MenuManage
    sw.ts                          → hand-written service worker (injectManifest mode — precache +
                                     /api NetworkOnly + push/notificationclick listeners)

docs/
  SPEC.md                          → frozen v3 baseline spec (auth, core lifecycle, DB schema) — see
                                     its header note for what it does NOT cover
scripts/
  smoke.sh                         → e2e smoke test (boots server, full lifecycle)
```

---

## 5. Environment variables

Backend (`backend/.env`, copy from `backend/.env.example`):

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `APP_ENV` | `dev` | `dev`/`test`/`production` — fail-closed validation only runs in `production` |
| `DATABASE_URL` | — | Postgres only. Must not be localhost in production. |
| `JWT_SECRET` | — | HS256 secret, ≥32 chars, must not be the default in production |
| `FIREBASE_PROJECT_ID` | — | Required in production. Skip with `AUTH_FAKE=true` in dev. |
| `ALLOWED_EMAIL_DOMAIN` | `sst.scaler.com` | Student email domain |
| `SHOPKEEPER_EMAILS` | — | Comma-separated allowlist, seeded to DB on boot |
| `AUTH_FAKE` | `false` | Dev/test only — accepts `fake:<email>` tokens. Rejected in production. |
| `HOLD_MINUTES` | `15` | Minutes a fully-ready order holds before expiring |
| `BUSINESS_TIMEZONE` | `Asia/Kolkata` | IANA tz for daily tokens, history dates, availability windows |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin, must be `https://` in production |
| `SEED_SAMPLE_MENU` | `true` | Seed sample menu if empty on boot |
| `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET` | — | Menu photo uploads. Cloud `r2avfle3`, a Programmable Media account. **Never regenerate** these once real menu photos exist (see § 10). |
| `VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT` | — | Web Push. **Never regenerate — rotating invalidates every existing subscription.** |

Frontend (`frontend/.env`, copy from `frontend/.env.example`): `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.

---

## 6. How to run locally

```bash
createdb khaao
cp backend/.env.example backend/.env      # fill in Firebase/Cloudinary/VAPID values
cp frontend/.env.example frontend/.env
cd backend && go run ./cmd/server          # :8080, runs migrations, seeds sample menu
cd frontend && npm install && npm run dev  # :5173, proxies /api to backend
```

Testing without Firebase (dev only): `AUTH_FAKE=true` in `backend/.env`, then
`POST /api/auth/firebase {"id_token": "fake:someone@sst.scaler.com:Name"}`.
The UI always uses the real Google popup — fake tokens are for curl/Playwright,
not the login button.

**Verification before any commit:**
```bash
cd backend && go build ./... && go vet ./... && gofmt -l . && go test ./... -race
cd frontend && npx tsc -b --noEmit && npm run lint && npm test && npm run build
```

---

## 7. API surface

See `docs/SPEC.md` for the frozen v3 core contract (auth, orders, menu, shop
endpoints, state machines). Added since that doc was written:

- `POST /api/orders/:id/ratings` — student submits 1–5★ per item on a
  completed order (ownership-checked, re-rating is a no-op)
- `GET /api/menu` / `GET /api/shop/menu` — now include `avg_rating`,
  `rating_count`, `diet`, `tags`, `order_count_today`
- `GET /api/shop-status`, `POST /api/shop/status` — open/paused/closed
  control; pause/close refused (409) while any *accepted* order is still
  outstanding (submitted-but-not-yet-triaged orders don't block it)
- `POST /api/shop/menu/photo-signature` — signs a direct-to-Cloudinary upload
- `GET /api/push/vapid-public-key`, `POST /api/push/subscribe` — Web Push
- `GET /api/shop/history` — now includes an `insights` block (order_count,
  item_counts, customers)
- `POST /api/auth/sse-ticket` — mints a short-lived one-use ticket for `?ticket=`
  on the SSE endpoints (replaces the raw JWT in the query string)
- `POST /api/shop/menu` (create) / `PUT /api/shop/menu/:id` (update) responses
  now include `avail_window_warning` (non-blocking, omitted when empty) —
  set when `avail_from >= avail_to`, since that's ambiguous between a
  genuine overnight window and a same-day typo

---

## 8. What's DONE

- Full order lifecycle: cart → order → accept/reject/trim → prep pool → FCFS
  allocation → per-item handover → payment → history, with one active order
  per student enforced in code and at the DB level (partial unique index)
- Firebase Google auth, DB-driven role/allowlist re-read on every request —
  removing a shopkeeper locks them out immediately, both for actions
  (long-standing) and now (2026-07-21) even on an already-issued JWT
- Shop status control (open/paused/closed), menu diet + tags + trending,
  history insights with a day stepper and proportional ledger bars
- Item ratings (1–5★ per order item, menu-level average + count)
- Menu search, diet-filter persistence, "Order this again" (reorder merges
  additively into the cart, capped at the same 20/line every other path
  enforces), and device-local "Your usuals" favorites — the student-side
  depth features (G-series)
- A visually-hidden `aria-live` region announcing the same status
  transitions that already chime/vibrate, for screen-reader parity (G7)
- Web Push notifications for new orders (best-effort, self-cleaning dead
  subscriptions), alongside the existing in-tab SSE sound
- Cloudinary signed photo uploads for menu items
- Installable PWA (custom service worker, offline shell, `/api` NetworkOnly)
- Real-time SSE for both roles; ready-chime + vibration + browser
  notification for students, incoming-order alert for shopkeepers
- Server hardening: fail-closed prod config, request timeouts/body caps,
  security headers, DB row-locking (`SELECT … FOR UPDATE`) + advisory locks
  for concurrency correctness
- Full mobile-first visual redesign (paper-chit/steel-counter theme, the
  "ready" moment as the signature animated beat), and a Hindi/English
  **language toggle** on shopkeeper-facing pages. Student pages stay
  English-only by design and are guarded to stay that way even if a
  shopkeeper's stored preference is 'hi' on a shared device.
- Structured `log/slog` logging, Postgres integration test suite + CI,
  k6 load test script, root error boundary, crash-proof cart, network-
  tolerant SSE, redirect sign-in for installed PWAs, Cloudinary
  thumbnailing, one `ConfirmDialog`/`Modal` system (no `window.confirm`),
  offline banner, ESLint/Prettier/Vitest + golangci-lint wired into CI,
  route-group/Firebase code-splitting
- All backend unit tests pass (`go test ./... -race`); `scripts/smoke.sh`
  covers the full golden-path lifecycle live against Postgres

---

## 9. What's LEFT

**All planned code-side work, including § 9.5 (T1–T5), is implemented,
gate-clean and committed.** The remaining items are, in priority order:

1. Decide on § 9.4 (B1–B15) — nothing in it is authorized to start on its own.
2. Deployment (D-1..D-7, human-led).

**Caveats worth knowing (recorded, not tasks):**

- **R14 residual race (documented in `shopstatus.go`):** the accepted-order
  check + status save are atomic under the engine's advisory lock, but
  `RejectAllSubmitted` runs as a *separate* transaction afterwards (nesting
  would deadlock on the advisory lock). A concurrent Accept can still land in
  the commit-to-sweep gap, leaving the shop paused with one accepted order.
  Narrow; closing it fully means restructuring `RejectAllSubmitted` to join
  the caller's transaction. Not worth it unless observed live.
- **Bundle budget:** raw initial student JS is at 250.24 KB (Vite-reported,
  2026-07-24) — over the 250 KB hard stop (§ 9.1.8). Treat this as
  over-budget: the next addition of real size **must** trim something first,
  and § 9.4-B13 (lazy-split the shop shell out of the shared initial chunk)
  is the identified lever to get back under.
- Student history is `LIMIT 20` (no pagination yet — see § 9.4-B5); shop
  history caps the *response list* at 200 rows but computes insights/totals
  over the full day.
- A slow SSE consumer is dropped by closing its channel; the browser
  reconnects and `onOpen` resyncs it. Deliberate self-heal, not data loss.

### 9.1 Mobile design rules — read before ANY frontend change

Students use this exclusively on phones (installed PWA); the shopkeeper uses
a phone or counter tablet. These are standing rules, not suggestions:

1. **Design at 375×667 first** (iPhone SE class), then check ~360 px small
   Android and ~768–1024 px shopkeeper tablet. Desktop only needs to not
   break. DevTools device mode is the working canvas, but iOS-specific
   behavior is only ever proven on a real device (D-6).
2. **Touch targets ≥ 44×44 px** — `min-h-[44px]` is the established idiom.
   No hover-only affordances (hover doesn't exist on touch); `hover:` styles
   are progressive extras, tap feedback comes from `active:`/pressed states.
3. **Thumb zone:** primary actions live at the bottom — bottom nav, sticky
   footer CTAs, bottom sheets. `Modal` already renders as a bottom sheet on
   phones and a centered card at `sm:`. **Every overlay goes through
   `Modal`/`ConfirmDialog`** — never `window.confirm`, never a hand-rolled
   `fixed` div (§ 10: a `fixed` child of a `backdrop-filter` ancestor breaks;
   `Modal` portals to `document.body` for exactly that reason).
4. **Safe areas:** anything pinned to the bottom (nav, modal footers) needs
   the `pb-safe` utility, or the iOS home indicator overlaps it.
5. **No horizontal page scroll, ever.** Wide content scrolls inside its own
   `overflow-x-auto` container; long labels get `min-w-0` + truncation on
   flex children (Hindi item names run long).
6. **Inputs:** font-size ≥ 16 px on every input or iOS zooms the page on
   focus; set `inputmode`/`type` so the right keyboard opens (numeric for
   qty/price). **Native `date`/`time` inputs are user-clearable** (an "×"
   affordance or Backspace) — always guard the `onChange` handler against an
   empty value rather than letting it flow into downstream date arithmetic
   (see the History/ShopStatusControl fixes in "Current state" above).
7. **The network is hostile** (campus Wi-Fi, elevators): every screen must
   stay usable on cached data — stale data + the offline banner beats an
   error state (`isError` alone must never replace rendered data; see R25).
   Never treat a network failure as an auth failure (R3). Every mutation
   shows a pending state and toasts on error.
8. **Performance budget:** initial student JS ≤ ~250 KB raw (currently
   250.24 KB — over, see § 9 bundle-budget caveat and § 9.4-B13). New
   heavy dependencies must be lazy chunks (follow
   `App.tsx`'s route-group `lazy()` pattern; `lib/firebase` is dynamically
   imported at the moment of login). Menu photos always render through
   `cloudinaryThumb(url, 2×display-px)` — never a raw `secure_url`.
9. **iOS installed-PWA rules** (standalone mode is the real target, and it
   has separate storage from Safari):
   - No `new Notification(...)` — only `registration.showNotification` via
     the service worker. No `navigator.vibrate`. WebAudio starts suspended —
     unlock on first user gesture (`lib/sound.ts` pattern). Web Push is the
     only screen-off signal.
   - Sign-in uses `signInWithRedirect` in standalone mode (popups break
     there) — keep both paths working when touching auth.
   - Feature-detect everything (`'Notification' in window`, etc.) — webview
     capability sets vary wildly.
10. **Visual language:** stay inside the paper-chit/steel-counter theme —
    the Tailwind tokens (`paper`, `ink`, `edge`, `steel`, `stamp`,
    `turmeric`, `brand`), `font-display` for headings, and the existing
    `Card`/`Button`/`EmptyState`/`StatusBadge`/`Modal` components. Don't
    invent new grays/shadows/radii; don't add a UI library. **A hardcoded
    base class merged with a caller `className` can silently lose the
    Tailwind cascade tie** (utilities are emitted in source-file order, not
    JSX order — bit both `Bone` and `Card` this pass; a `ring-*` box-shadow
    sidesteps the collision when a border override needs to win).
11. **Language:** shopkeeper-facing strings are paired via `useLanguage()`
    (`language === 'hi' ? … : …`); student-facing UI is English-only by
    design and guarded to stay that way (`Layout.tsx`).
12. **Orientation:** never lock it — the manifest deliberately has no
    `orientation` key; shopkeeper tablets go landscape.

### 9.2 Frontend design-polish backlog (F-series) — DONE, committed

**Status: complete and committed** (git log — five parallel worktree agents
by file-ownership group, each diff reviewed before merging; two real bugs
caught in review and fixed directly: a Hindi-copy leak-into-student-session
risk in `ConfirmDialog`, and an `InstallPrompt`/`PushNotificationSetup`
timing gap). Kept below as the spec of what shipped — nothing here is an
open task.

Design direction (still binding for any future frontend beauty work): the
identity is the **paper chit and the steel counter** — kraft-paper order
tokens stamped as they move down the line, cool institutional steel around
them. IBM Plex Mono for the "printed on the chit" voice (numbers, prices,
stamps), IBM Plex Sans for everything else. `brand` moss = the awning,
`stamp` red = rubber-stamp ink, `turmeric` = the kitchen. **Sharpen this,
don't dilute it toward generic food-delivery** (no gradients, no
glassmorphism, no emoji-as-icon). The signature element is the rubber-stamp
language on the **"ready" moment** — the emotional peak of the product.

F1–F12 (rule violations & small bugs) and F13–F24 (the beauty pass — Login
as a set-piece, the Ready-moment animation choreography, skeletons over
spinners, empty states with a hand-drawn glyph, order age on incoming
cards, the prep-board tally tick, shopkeeper tablet layout, Modal focus
trap, keyframe reconciliation) are the two halves of the backlog; all 24
items shipped. Gate on the fully merged tree: `tsc` clean, `lint` 0 errors/
23 warnings, `test` 53/53 at the time, `build` 249.37 KB.

### 9.3 Frontend depth backlog (G-series) — IMPLEMENTED, GATED, UNCOMMITTED

**Status: G1–G8 all implemented, gated, and live-verified** (isolated
scratch stack, both roles, a real SSE round-trip for G7) — see "Current
state" above. Sitting uncommitted in the working tree for review. Kept below
as the spec of what shipped:

- **G1 — floor sweep:** `loading="lazy" decoding="async"` on every thumbnail
  that didn't already have it; grew the `RatingPrompt` "Skip" hit area to
  44px.
- **G2 — menu search:** quiet client-side search (name + tags, no network),
  composes with the diet filter, hides `TrendingRail`/chip-bar while active;
  category `<section>`s stay mounted-but-hidden so F7's scroll-spy observer
  never loses its element references.
- **G3 — "Order this again":** `reorderIntoCart` in `lib/cart.ts` (unit-
  tested, additive merge, capped at 20/line as of the 2026-07-21 fix above)
  writes straight to the shared `khaao_cart_v2` key so it works from
  `/order` even though `Menu` is unmounted there. Honest full/partial/none
  toast.
- **G4 — diet filter persistence:** `khaao_diet_filter_v1`, validated
  against the live union before trusting a stored value.
- **G5 — History day stepper:** ◀/▶ + "Jump to today", local-date
  arithmetic (never `toISOString()`, which drifts a day near local
  midnight); now also guards against an emptied native date input (2026-07-21).
- **G6 — Top-items ledger bars:** hand-built proportional meter bars
  (`dataviz` skill's "meter" spec — brand fill over brand-light track,
  `aria-hidden`, numbers stay the accessible content), 6% width floor so a
  small count is still visible.
- **G7 — live status announcements:** a Layout-level `sr-only
  aria-live="polite"` region fed by `lib/liveAnnouncer.ts`, reusing the
  `prevStatusRef` transition-detection idiom already in `StudentRealtime`/
  `ShopRealtime` rather than duplicating it. Announces exactly the
  transitions that already chime.
- **G8 — "Your usuals":** a pin toggle on `MenuItemCard`'s photo corner
  (ink-line SVG, not an emoji), `khaao_favorites_v1` localStorage, a
  `FavoritesRail` deliberately distinct from `TrendingRail` (solid brand
  border, no rank numbers — this is "yours," not "everyone's data").

GATE: `tsc` clean, `lint` 0 errors, `test` 59/59 baseline + reorder cases,
`build` under the 250 KB line throughout, `format:check` clean repo-wide
(fixed a pre-existing drift in `Orders.tsx`/`Prep.tsx` found along the way).

### 9.4 Deferred backlog — recorded for LATER, **NOT authorized**

Backend work, product decisions, or deliberately-postponed frontend.
Nothing here may be started without the owner picking it deliberately.

| # | What | Why it's deferred |
|---|---|---|
| B1 | Order notes to kitchen ("less spicy") | Backend: new order field + validation; UI on both faces. |
| B2 | Favorites sync across devices | Backend: table + endpoints. G8 ships device-local first. |
| B3 | Menu item descriptions | Backend: new column + API field; would unlock a student item-detail sheet. |
| B4 | Scheduled pickup time slots | Product decision + backend scheduling; changes the FCFS model. |
| B5 | Student history beyond `LIMIT 20` | Backend pagination param (R13) + UI. Not felt until months of use. |
| B6 | Weekly/range shop insights | Backend aggregation across days + a real dataviz pass. |
| B7 | Queue position / ETA for students | Backend derivation from pool state; needs careful honesty about accuracy. |
| B8 | Shopkeeper allowlist admin UI | Backend endpoints; today it's env-seeded (`SHOPKEEPER_EMAILS`), fine at this scale. |
| B9 | httpOnly cookie sessions | § 11.2 — an architecture project, not a task. |
| B10 | iOS splash screens (`apple-touch-startup-image`) | Pure asset generation; wait for D-6 real-device pass to prove it's worth the asset set. |
| B11 | SW update-prompt UX | `registerType` is `autoUpdate` today; switching to a "refresh for update" prompt is a product decision. |
| B12 | Abandoned-order recovery | Found 2026-07-21: an order with *some* but not all items handed over, then abandoned, has no terminal path — `Reject` refuses once `handed_qty > 0` on any item, and `ExpiryTick` skips any order with handover activity (matches § 3's documented state machine, not a bug). The order — and the student's one-active-order slot — stays stuck until the shopkeeper notices and manually hands over the remainder to force `awaiting_payment`. A real fix needs an explicit shopkeeper "write off / abandon" action: new endpoint + service method + UI + copy + Hindi pairing — a product decision on what that action should mean (unpaid-completed? a new terminal status?), not a bug fix. |
| B13 | Lazy-split the shop shell out of the shared initial chunk | Found 2026-07-22: `ShopRealtime`, `ShopStatusControl` (and the shop bits of `Layout`) are shopkeeper-only but ride the *student's* initial JS chunk because `Layout.tsx` statically imports them — so the ~250 KB "initial student JS" budget is partly spent on code students never run. The 2026-07-22 realtime fix pushed that number to 250.01 KB, 0.01 KB over the § 9.1.8 hard stop; this is the identified lever to get well back under. Frontend-only, but touches the always-mounted shell (needs a `lazy()`/`Suspense` boundary around the shop-only realtime/status components, following App.tsx's route-group pattern) — real enough to want a deliberate pass and a live re-verify, not a reactive tweak. Reclaims far more than the 65 bytes that tipped it over. |
| B14 | "Accept" with every item unchecked silently rejects the order | Found 2026-07-22 (low priority, arguably-correct behavior): on the shop New-orders card, unchecking *all* pending items and pressing the green **Accept** marks them all out of stock and sends `rejectedItemIds = all`, which the backend's `Accept` turns into a full `OrderRejected` (allRejected branch). Outcome is defensible (you're out of everything → nothing to fulfil), but a green "Accept" producing a rejection is a mild UX trap. A fix would disable/relabel Accept when nothing is checked (point the shopkeeper at Reject instead) — cosmetic, and a product-copy decision + Hindi pairing, so recorded rather than changed. |
| B15 | No business-day reset for `item_pool.qty` / `menu_items.out_of_stock` | Found 2026-07-24: `docs/SPEC.md`'s frozen v3 baseline documents a `POST /api/shop/day/close` endpoint zeroing the pool and resetting `out_of_stock`, and `MenuRepo.ResetStock`/`PoolRepo.ZeroAll` still exist in `repository.go`/`gorm.go` for exactly that — but nothing in the current codebase calls either one (no route, no service method, no scheduler; confirmed by full-repo grep). Leftover pool units (e.g. `ExpiryTick` returning allocated-but-unclaimed units to the pool at day's end with no other order waiting) silently carry into the next business day and get instantly FCFS-allocated to the first new order for that item — food from a previous day served without the shopkeeper cooking or acknowledging anything. Real and reachable, but the correct fix needs a product decision (automatic at local midnight vs. tied to the open/paused/closed shop-status transition vs. an explicit new shopkeeper action), not a targeted code change, so recorded rather than implemented. |

### 9.5 Find-fix tasks (T-series) — 2026-07-22 audit, DONE, committed

**Status: complete and committed** (2026-07-23). A fresh full-stack read on
2026-07-22 (after everything above had landed and committed) found six real
defects that no prior pass covered, grouped into five file-disjoint tasks
(T1–T5). All five landed: each got its own regression test, verified to fail
without the fix before the fix was written. Gate after all five: backend
`go build` / `go vet` / `gofmt -l` clean, `go test ./...` all green; frontend
`tsc -b --noEmit` clean, `lint` 0 errors / 24 warnings, `test` 66/66 (was
61/61 — 5 new tests, one per task). Kept below as the spec of what shipped —
nothing here is an open task.

| Task | Files owned (nothing else) | Stack |
|---|---|---|
| **T1** | `backend/internal/middleware/auth.go` (+ new middleware test) | Go |
| **T2** | `frontend/src/context/AuthContext.tsx`, `src/api/client.ts`, `src/api/auth.ts` (+ test) | TS |
| **T3** | `frontend/src/pages/shop/Orders.tsx` | TS |
| **T4** | `backend/internal/services/menu.go`, `backend/internal/services/pool.go` (+ tests) | Go |
| **T5** | `frontend/src/components/shop/ShopRealtime.tsx` | TS |

---

#### T1 — [HIGH] A transient DB error is served to the client as `401`, which force-logs-out every user and destroys their token

`middleware/auth.go` collapses *every* error from `authSvc.GetUser` into
`401 {"error":"unknown user"}` — in `RequireAuth` (the `if err != nil` after
the `GetUser` call) and identically in `RequireSSEAuth`. But
`AuthService.GetUser` (`services/auth.go`) returns two very different classes
of error:

- **Genuine auth failures** — `ErrNotFound("user not found")` when the user
  row is gone, or when a shopkeeper's email is no longer on the live
  allowlist. 401 is correct here; this is the 2026-07-21 instant-revocation
  behavior and must keep working.
- **Infrastructure failures** — a raw driver error propagated straight out of
  `userRepo.FindByID` or `emailRepo.Exists`: connection-pool exhaustion,
  managed-Postgres failover, a statement timeout, a context deadline. 401 is
  flatly wrong here; the session is fine, the database blinked.

The frontend takes 401 at face value and treats it as terminal:
`api/client.ts` clears `khaao_token`/`khaao_user` and dispatches
`khaao:unauthorized`, which `AuthContext` turns into a forced redirect to
`/login`. The 7-day JWT is *destroyed* — recovery is a full Google sign-in,
not a retry.

**Failure scenario:** lunch rush. `database.go` caps the pool at
`SetMaxOpenConns(25)`, and every `PoolEngine` mutation serializes on the
`pg_advisory_xact_lock` in `GormUnitOfWork.WithTx`, so connections are held
while queued. Auth adds 1–2 more queries on *every single request* (2 for a
shopkeeper — user lookup plus the allowlist check) with no caching, on top of
the SSE-driven refetch fan-out. One `too many connections` or
`context deadline exceeded` out of the pool and every student mid-order is
logged out and bounced to the sign-in screen at once. A brief managed-Postgres
failover — exactly what D-1 provisions — does the same thing.

This is also the server-side twin of the rule the project already enforces on
the client: § 9.1.7 / R3, "never treat a network failure as an auth failure."
It was only ever enforced in one direction.

**Fix:** `services.AppError` already carries the right `Status`, and
`controllers`' `respondError` already does exactly this destructuring — the
middleware just doesn't. In both `RequireAuth` and `RequireSSEAuth`,
`errors.As` the error to `*services.AppError` and return 401 only for a
genuine 401/404; anything else (including a bare non-`AppError` driver error)
must be a **503** with a retryable message, so the client surfaces "try again"
instead of wiping the session. Keep the `slog.Warn` for real auth failures and
use `slog.Error` for the infrastructure branch — they are different incidents
and should not share a log line.

**Fold in while you're here (same file, same fix):** `RequireSSEAuth` calls
`tickets.Consume(ticket)` — which deletes the ticket unconditionally —
*before* `GetUser` can fail. With the bug above, a DB blip therefore burns the
ticket *and* 401s, and `useSSE`'s reconnect loop spins minting fresh tickets
against a database that is already struggling. Consuming before validating is
the right order (one-use must mean one-use), so don't reorder it; just make
sure the 503 path doesn't feed a tight remint loop.

**Test:** a middleware-level test with a fake `UserRepo` that returns a
plain `errors.New("connection refused")` — assert 503, not 401 — plus the
existing-behavior case (repo returns nil user → still 401). Verify both fail
before the fix.

---

#### T2 — [HIGH] Logout leaves the previous student's order history, cart and favorites on a shared device

`AuthContext.logout()` and the `onUnauthorized` handler both do only
`setUser(null)` + `navigate('/login')`. Two stores survive that:

1. **The React Query cache.** The `QueryClient` is constructed at module scope
   in `main.tsx` and is never cleared. `['orders','history']` (every past
   order: item names, quantities, prices, order numbers), `['orders','active']`
   and `['menu']` all stay resident.
2. **`localStorage`.** `api/auth.ts`'s `logout()` calls `clearAuthStorage()`,
   which removes *only* `khaao_token` and `khaao_user`. Left behind:
   `khaao_cart_v2` (the previous student's cart — ids and quantities),
   `khaao_favorites_v1` ("Your usuals", explicitly personal), and
   `khaao_rated_orders`.

**Failure scenario:** shared hostel phone, or the canteen's own demo handset.
Student A logs out. Student B signs in — no page reload, it's a SPA — and
lands on `/`. `Menu.tsx` hydrates its cart from `khaao_cart_v2` and its pins
from `khaao_favorites_v1`, so B starts with A's cart. B taps "Order status"
and `OrderStatus.tsx` mounts against the same `QueryClient`: `['orders',
'history']` is already populated with A's orders and renders **immediately**.
`staleTime` is 10s, and by deliberate design (R25, § 9.1.7) a failed refetch
must *not* blank rendered data — so on the flaky campus Wi-Fi this app is
built for, A's history can stay on B's screen indefinitely. This is a
cross-account data leak, and the codebase already treats shared devices as a
real threat model (the `isShop`-gated Hindi guard in `Layout.tsx` exists for
exactly this reason).

**Fix:** make session teardown clear everything session-scoped, from **both**
exits — the explicit `logout()` and the `khaao:unauthorized` handler, which
today are separate code paths that must not drift. Call `queryClient.clear()`
(`AuthContext` needs `useQueryClient()`), and extend `clearAuthStorage()` to
remove the student-local `khaao_*` keys. Judgment call worth stating in the
commit message: `khaao_install_dismissed` is device-scoped, not
user-scoped — leave it. `khaao_lang` is already render-time-guarded by
`isShop`; clearing it is optional but harmless.

**Also note (record it, don't necessarily fix it here):** the device's Web
Push subscription row stays bound to student A server-side. `services/push.go`
`Subscribe` re-binds the row to B only if B actually opts into notifications;
until then, an "order ready" push for A (ordering from another device) lands
on the phone B is holding. Fixing properly means an unsubscribe call on
logout — flag it and let the owner decide rather than expanding this task's
file ownership.

**Test:** a test that seeds `['orders','history']` and the `khaao_*` keys,
calls logout, and asserts both are empty. Verify it fails without the fix.

---

#### T3 — [MEDIUM] Shop Accept/Reject silently swallow every "mark out of stock" failure

In `pages/shop/Orders.tsx`, `IncomingOrderCard`'s `acceptMutation` and
`rejectMutation` both do
`await Promise.allSettled(...map((i) => setMenuItemStock(i.menu_item_id, true)))`
and then **never inspect the results**. `allSettled` by construction never
rejects, so every one of those calls can fail and the mutation still reports
success.

**Failure scenario:** rush hour. The shopkeeper unchecks the three items
they've just run out of and hits the green Accept. The three
`POST /api/shop/menu/:id/stock` calls 429 against their own bucket
(`middleware/ratelimit.go`: burst 40, refill 4/s — reachable when
accept/handover/done traffic is already flowing), or simply fail on a counter
tablet that dropped Wi-Fi for two seconds. The order is accepted, those lines
are correctly rejected on that one order, and the shopkeeper sees no error at
all — **but the items stay in stock on the student menu.** Students keep
ordering food that does not exist, and the shop has to reject each new order
by hand. The failure is invisible precisely when it's most likely.

**Fix:** inspect the settled results, collect the names of the items whose
stock update rejected, and show an error toast naming them ("Couldn't mark
Samosa, Chai out of stock — set them manually on the Menu tab"), with the
Hindi pairing. Then still invalidate `['shop','menu']` so the true state
lands. The order accept/reject itself must **not** be blocked by a stock-flag
failure — accepting the order is the more important half and already
succeeded; this is about telling the truth, not about rolling back.

**Do not** also change the all-unchecked Accept behavior — that is § 9.4-B14,
deliberately deferred as a product-copy decision.

---

#### T4 — [MEDIUM] Deleting a menu item strands its prep-pool row, and the prep API then returns a nameless ghost item forever

`MenuService.Delete` blocks the delete while an active order references the
item (`HasActiveItemsForMenuItem`), then calls `repo.Delete` — which is a
**soft** delete (`models.MenuItem.DeletedAt` is a `gorm.DeletedAt`). It never
touches `item_pool`. The schema's
`item_pool.menu_item_id → menu_items(id) ON DELETE CASCADE` looks like it
covers this, but a soft delete is an `UPDATE`; the cascade never fires.

`PoolEngine.PrepList` then unions the pool's menu-item ids with the ids that
have outstanding demand, and resolves names via `menuRepo.FindMapByIDs` —
which *does* respect the soft delete. So the deleted item comes back as
`{menu_item_id: N, name: "", remaining_qty: 0, pool_qty: K}` on every
`GET /api/shop/prep` from then on, permanently.

**Reachable, not theoretical:** cooked units return to the pool on `Reject`,
`RemoveItem` and `ExpiryTick`, and stay there when no other order is waiting
on that item. With the last order now terminal, `HasActiveItemsForMenuItem` is
false and the delete is allowed. The stranded units are real cooked food that
the system has silently stopped counting.

Blast radius is contained on the UI today only by accident —
`Prep.tsx` filters `remaining_qty > 0` before rendering, which its own comment
frames as defensive, not as the thing holding this together. The API response
is still wrong, and any future consumer of `/api/shop/prep` inherits the bug.

**Fix:** zero (or delete) the item's `item_pool` row inside a
`uow.WithTx` alongside the delete, so both land or neither does — `MenuService`
does not currently hold a `UnitOfWork`, so wiring one in is part of this task.
Belt-and-braces, also skip ids that resolve to no menu item in `PrepList`
rather than emitting `name: ""`.

**Fold in while you're in `menu.go` (same file):** `Delete`'s
`HasActiveItemsForMenuItem` check and the delete itself are two separate
statements with no transaction around them — a `CreateOrder` landing in the
gap produces exactly the orphaned `order_items` row the check exists to
prevent. Putting the whole thing in the `WithTx` above closes it for free,
since that transaction takes the same advisory lock every `PoolEngine`
mutation takes.

**Test:** an integration test that puts units in the pool for an item with no
active orders, deletes the item, and asserts `PrepList` returns no row for it
and the pool row is gone/zero.

---

#### T5 — [LOW] The shop's reconnect resync misses `['shop','history']`

`ShopRealtime.handleOpen` invalidates `['shop','orders']`, `['shop','prep']`,
`['shop','menu']` and `['shop-status']` on every (re)connect. But
`handleMessage`'s `orders_update` branch invalidates `['shop','history']`
*as well* — so the one query kept fresh **only** by an event is the one the
"onOpen resyncs everything" self-heal doesn't cover.

**Failure scenario:** the counter tablet's SSE stream drops mid-rush (§ 10's
slow-consumer drop, a backend restart, an elevator). Orders complete while
it's disconnected. On reconnect everything else refreshes and the History tab
— including the day's `total_paid` — keeps showing pre-drop numbers until some
*later* order happens to complete and fire a fresh `orders_update`.

This is the same class of bug as the 2026-07-22 shop-status-pill fix: a key
that one code path refreshes and its sibling path doesn't. One line.

---

### Deployment (the remaining human-led milestone — needs real infra, not just code)

**`deploy/RUNBOOK.md` is the expanded, step-by-step version of this table**
(each D-item maps to a runbook section) — follow it, don't re-derive.
Artifacts ready and committed: `deploy/Caddyfile` (tool-validated with
`caddy validate`), `deploy/khaao-backend.service`, `deploy/RUNBOOK.md`.
**Agent/human split:** almost everything below needs a human with
domain/server/dashboard access. An agent's useful roles here are (a) pair
on D-4/D-5 config and debugging once the human has access set up, (b)
verify D-6 findings and fix anything they surface, (c) keep this table and
the runbook in sync with reality as steps complete.

| # | What | Notes |
|---|---|---|
| D-1 | **Provision managed Postgres** | Runbook § 1. Supabase/Neon/Railway. Daily backups on from day one, test a restore *before* go-live. Confirm `citext` available. `?sslmode=require`. |
| D-2 | **Firebase setup** | Runbook § 2. Enable Google sign-in → **add authorized domains** (the #1 launch gotcha — sign-in silently fails on an unauthorized domain, and R4's redirect flow depends on it too). |
| ~~D-3~~ | ~~Cloudinary account check~~ | **Done.** Live-verified via a direct signed-upload test against Cloudinary's API. Current `backend/.env` (cloud `r2avfle3`) is a working Programmable Media account. **Never regenerate the credentials** (§ 5). |
| D-4 | **Deploy backend** | Runbook § 4 + § 6. ONE instance (replicas=1 enforced). Raise `ulimit -n` (the systemd unit's `LimitNOFILE` covers it). Caddy in front: `proxy_buffering off` on `/api/stream`, long SSE read timeout — the committed Caddyfile already encodes this. `APP_ENV=production` (fail-closed config validates the rest). |
| D-5 | **Deploy frontend** | Runbook § 5. Static host (Netlify/Vercel/Cloudflare Pages), `VITE_FIREBASE_*` set at build time. |
| D-6 | **End-to-end production verification** | Runbook § 7. One real student + one real shopkeeper complete a full order lifecycle on production. **Must include the real-device checks:** (R4) Google sign-in *inside* the installed PWA on iOS and Android — not just in a browser tab; (R5) the "ready" moment on a locked/backgrounded phone — push arrives, SW notification shows, chime plays after first-touch unlock; CSP console check per § 11.5 (no "Refused to …" errors during real Firebase login or Cloudinary photo upload — the CSP has never been exercised against the real providers). |
| D-7 | **Runbook for ongoing ops** | **Written** — Runbook § 8 covers rotate `JWT_SECRET`, add/remove a shopkeeper, check logs, restore a backup. Remaining: validate the steps against the real deployment during/after D-6. |

---

## 10. Operational lessons (worth 30 seconds before you repeat one)

- **Commit incrementally** once review is done — a prior multi-session
  stretch where nothing was committed led to a `git checkout --` wiping real
  work, because with nothing committed "undo my last edit" and "wipe this
  file's entire uncommitted history" are the same command.
- **Never batch-`mv` files with duplicate basenames into one destination** —
  silent overwrite, no warning. Move one at a time to distinct paths, or use
  `git stash push --keep-index --include-untracked` if you need to isolate
  changes.
- **Never regenerate the VAPID key pair or Cloudinary credentials** —
  invalidates every existing push subscription / breaks uploads.
- **A `fixed`-positioned overlay must never be a literal DOM child of an
  element with `backdrop-filter`/`filter`/`transform`** — that ancestor
  becomes the fixed element's containing block instead of the viewport.
  Portal it to `document.body` (see `Modal.tsx`).
- **A hardcoded base class merged with a caller `className` can silently
  lose the Tailwind cascade tie** — utilities are emitted in source-file
  order, not JSX/component-nesting order. Bit `MenuSkeleton`'s `Bone` (a
  `/50` default beat every lighter caller override) and `RatingPrompt`'s
  `Card` (a `border-brand-dark` override lost to `Card`'s own baked-in
  `border-edge`) independently, in the same session. A `ring-*` (box-shadow)
  sidesteps the collision when an override specifically needs to win.
  Verify against the actual *compiled* CSS, not assumed source order.
- **Native `date`/`time` inputs are user-clearable to `""`** (an "×"
  affordance or Backspace) — always guard the `onChange` handler, not just
  the arithmetic downstream of it. An empty value cascading into date/time
  math produces `NaN`/`Invalid Date`, and if that then becomes a *new*,
  never-before-cached query key, an `isError`-with-no-cached-data guard can
  end up replacing the entire section (including the input that would let
  the user recover) with an error screen. Found independently in both
  `History.tsx`'s date stepper and `ShopStatusControl.tsx`'s reopen-time
  picker in the same session (2026-07-21) — same root cause, same fix
  shape: fall back to a sane default at the input boundary.
- **The menu mistouch-guard's ~3s auto-disarm can look like a missing
  feature** if you click-then-check across two separate tool round-trips (the
  timer expires in between) — test click+check inside one script. Also:
  the guard's timer keeps running while a sibling UI state (e.g. the Edit
  form) is open, since the row component isn't unmounted — a quick
  open-then-cancel within the window can return to a card that's still
  armed but not showing why (fixed 2026-07-21: entering Edit now disarms).
- **A long-lived browser tab in a scratch PWA setup can serve a stale
  service-worker precache** even though Vite is serving current source — if
  live behavior contradicts what's plainly in the code, check
  `navigator.serviceWorker.getRegistrations()` / `caches.keys()` first.
- **`Playwright fullPage: true` screenshots can visually misplace
  `position: fixed` elements** — capture artifact, not a rendering bug;
  verify with a real scrolled-viewport screenshot or `getBoundingClientRect()`.
- **Don't touch the shared `frontend/vite.config.ts` proxy target for a
  scratch/QA check if a real dev server might be running** — it hot-reloads
  the live session onto the scratch backend. Use an isolated
  `vite.<name>.config.ts` + distinct port, and remember it still needs the
  same `VitePWA` plugin as the real one (`main.tsx` imports
  `virtual:pwa-register`, which only exists if the plugin is present).
- **Orphaned scratch server processes can silently hold a Postgres
  connection open for a full day**, blocking `scripts/smoke.sh`'s own
  `dropdb`. Cross-reference `psql -c "SELECT pid,datname,client_port FROM
  pg_stat_activity"` against `ps aux`/`lsof` before assuming the script is
  broken.
- **When a third-party integration fails (e.g. a 403 from Cloudinary),
  reproduce it directly against the provider's API with curl** — bypasses
  the app entirely and gives an unambiguous status code + body in ~10
  seconds instead of guessing from a vague browser console error.
- **The auto-mode permission classifier can deny `agy
  --dangerously-skip-permissions` case-by-case based on what a specific
  prompt touches**, even within one session with no settings change in
  between — don't assume one approved invocation means the next one will
  be; doing the work directly is a legitimate fallback when denied.
- **A GitHub Actions step can be silently broken from the moment it's added
  and nobody notices until a human checks the Actions tab** — `git push`
  succeeding is not the same as CI passing. Check `gh run list` /
  `api.github.com/repos/<owner>/<repo>/actions/runs` yourself rather than
  assuming green, especially after adding/bumping a CI-only action.
- **Local tool verification and CI-green are two different claims** — a
  script/workflow that isn't part of routine verification (e.g.
  `scripts/loadtest.js`) can drift silently as the code it exercises
  changes underneath it. The fix isn't "trust it more," it's "actually run
  it periodically."

---

## 11. Known security gaps (tracked)

1. ~~SSE token in the query string~~ — **fixed**: SSE now authenticates via a
   short-lived one-use ticket (`services/sse_ticket.go`), never the raw JWT.
2. `localStorage` JWT — still XSS-exfiltratable. Left as-is deliberately —
   fixing this properly means full cookie-based sessions (httpOnly +
   SameSite), a bigger architectural change than a hardening pass (§ 9.4-B9).
   **Partially mitigated** by the CSP (`script-src 'self'`, no
   `unsafe-inline`/`unsafe-eval`) — the standard primary defense against the
   script-injection XSS that would actually be needed to read `localStorage`
   in the first place.
3. ~~No rate limiting~~ — **fixed**: per-user token-bucket limiter on mutations
   plus a per-user SSE connection cap (`middleware/ratelimit.go`), live-verified.
4. Photo URLs are restricted to `http(s)://` only at the API layer
   (`services/menu.go` `validateAndNormalize`). **Tightened further** via
   the CSP's `img-src`, which only allows `'self'`, `blob:` (local
   pre-upload preview), and `https://res.cloudinary.com` — an arbitrary
   external image URL set by hand (bypassing the UI) won't actually load in
   the browser even though the API itself still accepts any http(s) URL as
   a value.
5. ~~No CSP set~~ — **fixed**: `Content-Security-Policy` set in both
   `middleware/security.go` (Gin, defense in depth) and `deploy/Caddyfile`
   (the one that matters in production). Scoped to what the code actually
   calls (Firebase, Cloudinary, Google profile photos). **NOT YET
   live-verified against a real Firebase Google sign-in + Cloudinary
   upload** — check the browser console for "Refused to ..." errors the
   first time this runs against real Firebase/Cloudinary (D-6).
6. **An already-open SSE stream survives shopkeeper de-provisioning.** REST
   auth re-reads the role from the DB on every request, and (since
   2026-07-21) `GetUser` also re-verifies a shopkeeper's email is still on
   the live allowlist, so a removed shopkeeper is locked out of all
   *actions* immediately. Their existing `/api/shop/stream` connection,
   though, was authorized at connect time and keeps delivering read-only
   shop events until it next drops and fails to re-mint a ticket. Accepted
   as-is: exposure is read-only event metadata, the population is a
   hand-picked allowlist, and any reconnect ends it.
7. ~~`POST /api/push/subscribe` accepted any client-supplied `endpoint` URL
   with no validation~~ — **fixed (2026-07-21)**: `services/push.go`
   `Subscribe` now validates `endpoint` against a hostname allowlist of the
   real Web Push vendors (`fcm.googleapis.com`,
   `updates.push.services.mozilla.com`, `web.push.apple.com`) before saving
   it. This was a genuine SSRF, reachable by any authenticated student (the
   route is `requireAuth` only, no role gate): the backend later makes a
   real outbound HTTPS POST to `sub.Endpoint` (via `webpush-go`) whenever a
   push fires for that user, and a self-generated-but-valid P-256 keypair —
   trivial to produce, no real browser needed — was enough to get a
   malicious/internal `endpoint` past the only check that existed
   (`binding:"required"`, i.e. non-empty). See "Current state" above for
   the full writeup and `push_test.go` for the regression coverage.

Also: Gin runs in `ReleaseMode` when `APP_ENV=production`; `SetTrustedProxies(nil)`
is set explicitly (`internal/routes/routes.go`) — harmless since no code path
reads client IP (rate limiting is per-authenticated-user), but makes that
non-use explicit rather than accidental.

Already correct, do not change: Firebase token verification pinned to RS256
(`authn/firebase.go` checks the signing method explicitly); CORS pinned to
`FRONTEND_ORIGIN` (no wildcard); the app JWT's `ParseToken` uses
`jwt.WithValidMethods` (alg-pinned).
