# Khaao — Master Project Status

> **For the next agent:** This is the single source of truth. Read this top-to-bottom before touching any code. It contains the full why, what, how, what's done, what's next, and everything a new agent needs to pick up exactly where we left off.

## ⚡ START HERE (2026-07-14, seventeenth session handoff)

**State:** Batch 6 (dual-role Playwright QA) is done. **Everything is now committed to git** (4 commits this session — see below). The multi-session "nothing is committed" risk that caused the fifteenth-session incident is resolved as of this session; keep committing incrementally going forward instead of letting it build up again.

**What this session found and did:**
- Ran the dual-role Playwright QA pass (student agent → shopkeeper agent → resumed student agent) exactly as planned. Result: **one real, confirmed bug**, and two false alarms that were rigorously chased down and disproven rather than taken at face value:
  - **Real bug, fixed**: the install-prompt banner (`z-40`) and the student cart-summary bar (was `z-20`) overlap near the bottom of the screen; the banner was winning the stacking order and physically blocking taps on "View cart" — Playwright's click was refused with "intercepts pointer events," not just a visual glitch. Fixed by raising the cart bar to `z-50` (`pages/student/Menu.tsx`) — it never coexists with the checkout sheet (also `z-50`) since the cart bar only renders while the sheet is closed. Verified live: click succeeds, checkout sheet opens, with the banner still showing.
  - **False alarm #1**: the shopkeeper QA agent reported the bilingual Hindi labels (fifth-session-batch work) were completely missing from the live shopkeeper UI. Root cause, found by testing myself in the same browser session: a **stale PWA service-worker precache** (`workbox-precache-v2`) registered earlier in the QA session was intercepting requests and serving an old cached bundle, even though the Vite dev server itself was serving current source with the Hindi strings present. Unregistering the service worker + clearing caches made the Hindi labels render correctly everywhere. **Lesson for future QA sessions in this scratch PWA environment: if live behavior seems to contradict what's plainly in the source, check `navigator.serviceWorker.getRegistrations()` / `caches.keys()` before concluding it's a real bug** — a long-lived browser tab across many QA rounds will accumulate a stale precache.
  - **False alarm #2**: the same agent also reported the menu-item mistouch arm-then-confirm guard (`MenuManage.tsx`, thirteenth session) was completely missing — no arm state, no confirm step. Re-tested with click-and-check happening inside one script (no round-trip gap): it works exactly as designed (arms instantly, auto-disarms after ~3s, second tap within the window confirms and fires the stock-toggle call). **This is the same false-alarm class already documented in the fourteenth-session note below** (the ~3s auto-disarm timer expiring between separate tool calls looks identical to "nothing happened") — recurring, so it's worth remembering rather than re-discovering each time.
  - Also checked: cancelled orders showing ₹0.00 in student history regardless of the original order value is **intentional** (`pool.go` `Cancel()`: `order.TotalPrice = 0 // every item rejected; nothing owed` — cancel is submitted-only, so nothing was ever cooked/owed). Not a bug.
  - Rating round-trip re-verified end-to-end live (submit → `avg_rating`/`rating_count` update on `GET /api/menu`).
- **Incident this session, for transparency**: while splitting the (large, multi-session, entirely uncommitted) working tree into logical commits, a careless single `mv` command with two same-named `push.go` sources (`services/push.go` and `controllers/push.go`) being moved to the same temp directory silently clobbered the untracked `services/push.go` (the Web Push notification **service** — VAPID sending logic). It was never committed, so there was no git history to recover from; Time Machine and editor local-history were checked and had nothing either. It was **reconstructed from every surviving call site** (`main.go`'s wiring, `pool.go`'s `e.pushSvc.NotifyNewOrder(ctx, order)` call, `controllers/push.go`'s `Subscribe` call, the `PushRepo` interface contract, `config.go`'s VAPID fields, `webpush-go`'s actual API via `go doc`) and then **re-verified live against the scratch backend**: subscribe endpoint works and correctly upserts on re-subscribe (via `FindByEndpoint`, not a duplicate-key error), and creating an order fires `NotifyNewOrder` and attempts a real signed webpush send (observed failing cleanly and correctly on a deliberately-fake test key, without crashing or wrongly deleting the subscription row). Full `go build/vet/test -race` green both in isolation and in the final combined tree. **Lesson: never batch multiple `mv` sources with duplicate basenames into one destination directory — collisions overwrite silently with no warning.** The Claude Code sandbox's own safety classifier caught and blocked a *second* attempt at a similar move-many-files-around maneuver later in the same session (an unnecessary "isolation build test" that wasn't worth the risk) — worth trusting that instinct rather than re-attempting file shuffling as a verification shortcut.
- **Committed everything, in 4 logical chunks** (hunk-split via `git add -p` where features were entangled in the same files, verified buildable at each stage):
  1. `fix(backend): shop-status guard blocks only accepted orders; extend Reject as post-accept escape hatch` — the thirteenth/fifteenth-session `CountAccepted` guard fix + `RejectAllSubmitted` + the post-accept `Reject` extension (`shopstatus.go`, relevant hunks of `pool.go`/`repository.go`/`gorm.go`, `pool_test.go`, one hunk of `wp1_test.go`).
  2. `feat(backend): item ratings, web push notifications, and Cloudinary photo uploads` — Batches 3+4 plus the standalone Cloudinary controller, and all the shared composition-root wiring (`main.go`, `routes.go`, `config.go`, `.env.example`, `go.mod`/`go.sum`, remaining `repository.go`/`gorm.go` hunks) that couldn't be cleanly split since all three features landed together this session without incremental commits.
  3. `fix(frontend): raise cart summary bar above install-prompt banner` — the one real bug this QA pass found.
  4. This `STATUS.md` update.
- `review.txt` (empty) and `review_doc.txt` (the raw product-feedback dump that drove this whole multi-session batch) were deliberately **left uncommitted/untracked** — they're scratch notes, not documentation. Still on disk if you want to grep the original feedback wording.

**Do this next:**
1. The Batch 6 QA pass is done and clean — no more QA needed for this feedback round unless new issues surface.
2. Pick up **§ "Also outstanding from before this session"** below (P1-b/c, P2-a/c/d/e, WP4 versioned migrations) — this is the actual remaining backlog now that the feedback-round batches (1–6) are fully done, verified, and committed.
3. Keep committing in small logical chunks as you go from here — don't let uncommitted work accumulate across sessions again.

**3 things that will bite you if skipped:**
- `backend/.env` has real VAPID keys (Web Push) and Cloudinary keys — **never regenerate or rotate them**, that invalidates every existing subscription/breaks uploads.
- The frontend PWA plugin is `injectManifest` mode with a hand-written `frontend/src/sw.ts` (not `generateSW`) — if you touch `vite.config.ts` or `sw.ts`, rebuild and verify `dist/sw.js` still registers with zero console errors before trusting it (a broken service worker breaks the *entire* app, both roles).
- **Never `mv` multiple untracked files with duplicate basenames into the same destination directory** — silent overwrite, no warning, and if the file was never committed there's no way back (this session's `push.go` incident, above). If you need to temporarily move files aside, move them one at a time to distinct destination paths, or better, use `git stash push --keep-index --include-untracked` (git tracks full paths, no collision risk) — though think hard about whether you actually need the isolation test at all before reaching for either.

**Everything below this line is the detailed record — read it if you need the "why," skip it if you just need the "what's next."**

---

### Big feedback-driven batch: all 6 batches done, QA pass complete (2026-07-14, sixteenth–seventeenth sessions)

User handed over a large, dense product-feedback message covering ~10 distinct asks. Explicit process instruction this time: **"fix specific problems one by one, not all at once"** (a reaction to how much got tangled together in earlier sessions) — so this session ran each as its own `agy` dispatch, independently verified (build/vet/test, tsc/build, and live curl/Playwright checks against a scratch DB) before starting the next, rather than one giant parallel blast. **Nothing in this session is committed to git yet** — see the fifteenth-session incident note below on why that matters for any rollback.

**Done, in order (all independently verified — not just self-reported):**
- **Batch 1 fix-up**: `OrderModal.tsx` still had the old "Give" labels, still let the counter person pick how many units were cooked (a real gap the user caught when asked "have you done it all" — the answer was no). Fixed: renamed Give→Handover, removed the interactive cook control (now read-only "N needed · M done"), added a shopkeeper "Cancel this order" button that uses the `Reject()` extension from the fifteenth session — live-verified via Playwright end-to-end (accept → cancel → order disappears from the list).
- **Batch 2 — cart persistence + PWA install + History restructure** (3 parallel `agy` tasks, disjoint files):
  - Student `Menu.tsx` cart now persists to `sessionStorage` (survives switching tabs and coming back; cleared on successful order submit) — the reported "cart empties when I switch pages" bug.
  - New `InstallPrompt.tsx`: listens for `beforeinstallprompt`, shows an install banner (with an iOS Safari "Add to Home Screen" fallback since iOS never fires that event); mounted in `Layout.tsx` as a sibling of header/nav (verified NOT nested inside the `backdrop-blur` header, so it doesn't hit the same containing-block bug fixed in the fourteenth session).
  - `History.tsx`: insights panel stays immediate/unconditional; the raw per-order list is now collapsed behind a "Show every order (N)" toggle instead of being a permanent scroll-dump.
- **Batch 3 — ratings, built for real** (previously design-only, BUILD_PLAN.md §6): new `ItemRating` model (unique on `order_item_id` — re-rating the same line is silently a no-op via `ON CONFLICT DO NOTHING`, verified live), `POST /api/orders/:id/ratings` (completed-orders-only, ownership-checked), `GET /api/menu`/`GET /api/shop/menu` now include `avg_rating` (rounded to 1 decimal — a rounding-omission bug caught on review and fixed directly) and `rating_count` (0 shown as "no ratings yet", never a fake "0 ★"). Student rating prompt on `OrderStatus.tsx`, average shown on `MenuItemCard`/`TrendingRail`/`MenuManage`. **Bug caught and fixed on review**: the first-pass implementation used `ErrConflict` (409) for the ownership check instead of the codebase's established `ErrForbidden` (403) pattern (matching `Cancel()`'s `order.UserID != userID` check) — fixed, plus a leftover raw chain-of-thought comment in the code was removed and the corresponding test updated. **Two agy dispatch attempts failed outright before this succeeded** (both terminated near-instantly with no useful error, no partial files written — looks like a transient issue with the model backend that session, not a prompt problem; switching from Claude Sonnet 4.6 to Gemini 3.1 Pro on the retry worked). This "instant clean failure, retry with a different model" pattern recurred for Batch 4 and Batch 5 too — worth trying immediately rather than debugging a terse "Agent execution terminated due to error" message.
- **Batch 4 — real Web Push notifications** (the biggest, highest-risk piece: "even when the phone is closed, ring and tell the shopkeeper a new order came in", not just the existing in-tab SSE sound). VAPID key pair generated once and stored in `backend/.env` (gitignored) — **do not regenerate these, rotating them invalidates every existing subscription**. New `PushSubscription` model + `POST /api/push/subscribe` + `GET /api/push/vapid-public-key`; `PoolEngine.CreateOrder` now also fires a best-effort, per-subscription-goroutine push to every shopkeeper (dead subscriptions returning 404/410 self-clean); wired via a `SetPushService` setter (same late-binding pattern as `ShopStatusService.SetPool` from the thirteenth session) to avoid touching every `NewPoolEngine` call site. **The frontend PWA plugin was switched from `generateSW` to `injectManifest` mode** (`vite.config.ts`) with a hand-written `frontend/src/sw.ts` (precache + `/api/` NetworkOnly preserved exactly as before, plus `push`/`notificationclick` listeners) — this is the single highest-blast-radius change in the whole batch, since a broken service worker breaks the entire app for both roles. Verified for real, not just by tsc/build: built `dist/sw.js`, ran it via `vite preview`, confirmed via Playwright the service worker actually registers and activates with **zero console errors**, and confirmed a live order-creation call with the push call wired in still returns 201 cleanly. New `PushNotificationSetup.tsx` (shop-role only, mirrors `InstallPrompt`'s look) handles the subscribe flow.
- **Batch 5 — bilingual Hindi+English labels**, shopkeeper-facing only (explicitly not student pages). A fixed translation glossary was given up front (see the task prompt in scratch, or just grep the shipped Hindi strings) so wording stayed consistent across 8 files rather than each agent inventing its own phrasing. Pattern used almost everywhere: English on top, smaller muted Hindi directly below (`text-[10px] opacity-80`), verified live at 375px that this doesn't overflow anywhere — including the tightest spot, the bottom nav tab bar (icon + English + Hindi all fit inside the existing 56px tab height).

**Explicitly discussed but NOT built** (the user asked for analysis, not code, on this one): whether the flexible per-item/partial handover model (hand over items one at a time as they finish cooking, vs. an all-or-nothing bundle) is actually a good idea. Gave a recommendation (keep the flexible buttons since the user explicitly asked for both single+bulk handover, but flagged the real risks — multi-trip customer confusion, counter-staff tracking load, payment blocked on the slowest item) and left it there for the user to decide whether to revisit later. Don't build an all-or-nothing handover mode unless they explicitly ask after reading that recommendation.

**Batch 6, the dual-role Playwright QA pass (2026-07-14, seventeenth session) — done.** Two Claude Sonnet subagents via the Agent tool (not `agy`/`codex` — Playwright MCP access made the built-in Agent tool the right fit here), one playing student and one playing shopkeeper, drove the real app against the same shared scratch environment set up in the sixteenth session (backend :18092 / frontend :18172 / `khaao_smoke` DB, still running). See the "seventeenth session handoff" section at the top of this file for the full results: one real bug found and fixed (install-prompt/cart-bar z-index collision), two false alarms rigorously chased down and disproven (stale service-worker precache; auto-disarm timer race — both documented above so they're not re-chased next time), and a from-first-principles reconstruction of an accidentally-deleted `push.go` (also documented above, with the lesson about batched `mv` with duplicate basenames).

**Also outstanding** (unchanged, still true): P1-b/c, P2-a/c/d/e from §9 below, WP4 versioned migrations. Ratings are now live (§9's old "deferred" note about ratings is stale — cross it out when next editing that section).

**Housekeeping**: everything is now committed (4 commits, seventeenth session) — the prior "nothing committed across many sessions" risk is resolved. Keep committing incrementally from here.

### Order lifecycle correction + a real incident with `git checkout --` (2026-07-14, fifteenth session)
Real feedback: a student ordered 4 items, the shopkeeper accepted with one item trimmed, had already cooked another, and the student cancelled anyway — a real loss. First instinct was to eliminate partial accept entirely; the user then correctly pushed back ("I would still need partial orders — some items can be done and some cannot in real life"). Final, reconciled policy:
- [x] **Partial accept stays** (`Accept(orderID, rejectedItemIDs)` unchanged) — the shopkeeper can still trim unavailable items at intake.
- [x] **Student `Cancel()` is submitted-only** (unchanged from the original design, never actually needed reverting once traced through — see incident note below) — this alone is the real fix for the loss scenario: once accepted, the student can no longer pull out.
- [x] **`Reject()` extended to work after accept too** (`preparing`/`partially_ready`/`ready`, not just `submitted`) — the shopkeeper's own escape hatch for "something unexpected after accepting" (out of an ingredient, etc.). Refused (409) once anything's been handed over. Returns allocated pool units and re-triggers FCFS reallocation to the next waiting order, mirroring `RemoveItem`'s existing tail.
- [x] `RejectAllSubmitted` (auto-decline pending orders on shop close, from the thirteenth session) — confirmed intact/restored.
- [x] `RemoveItem` (per-item post-accept trim) — kept as-is, not eliminated; still a legitimate "some items done, some not" tool.

**Incident, for the next agent's benefit:** a background `agy` task was dispatched to implement an *earlier, wrong* version of this (eliminate partial accept + `RemoveItem` entirely) before the user's correction arrived. It was stopped mid-flight via `TaskStop`, and the affected files were reverted with `git checkout -- <files>`. **This was a mistake** — since nothing from the thirteenth/fourteenth session's work had ever been committed, `git checkout --` reverted those files all the way back to `HEAD` (the *first* v4 batch, before the mobile-fix batch), silently discarding several already-verified fixes on those files (`RejectAllSubmitted`, the extended `Reject`, the Orders.tsx 2-subpage redesign, the student drop-notification tracking, the Cloudinary upload functions, the photo-signature route). All of it was manually reconstructed and re-verified (build/vet/test + tsc/build + live curl checks against a scratch DB) rather than lost. **Lesson for any future rollback: `git checkout --`/`git reset` only ever restores to the last commit — if nothing has been committed today, "revert this one change" and "wipe today's entire history on this file" are the same operation.** Commit incrementally, or at minimum `git stash` before reverting anything when the working tree hasn't been committed in a while.

### Live Playwright verification pass (2026-07-14, fourteenth session)
User installed the Playwright MCP plugin specifically to let the next pass drive the real app rather than reason from code alone — used it to log into the actual running app (via a temporary, reverted `AUTH_FAKE=true` flip against the real `khaao` DB, restored to `false` before finishing) and walk every shop-side flow end-to-end at a 390×844 mobile viewport.
- [x] **Found and fixed a real, live-reproduced bug**: the shop-status picker (Open/Paused/Closed) rendered as a broken, unstyled full-width strip instead of a proper modal overlay — visually matching a user-supplied screenshot. Root cause, confirmed via computed styles (not guessed): `Layout.tsx`'s `<header>` has `backdrop-blur`, and CSS `backdrop-filter`/`filter`/`transform` on an ancestor creates a new **containing block** for descendant `position: fixed` elements — so `Modal.tsx`'s `fixed inset-0` (rendered as a literal DOM child of the header, since `ShopStatusControl` is placed in the header's own JSX and `Modal` used no portal) was being sized/positioned relative to the ~56px header instead of the viewport (measured live: the "fixed" overlay's `getBoundingClientRect()` was exactly 390×56, matching the header). **Fixed by rendering `Modal.tsx` through `createPortal(..., document.body)`** — the correct, standard pattern for modals in React, which sidesteps ancestor containing-block issues entirely. Re-verified live post-fix: proper dimmed backdrop, centered/bottom-sheet card, correct title, closes on backdrop tap. This is the only component that lived inside the header, so no other overlay in the app was affected — but the general lesson stands: **never render a `fixed`-positioned overlay as a literal child of an element with `backdrop-filter`/`filter`/`transform` — always portal it to `document.body`.**
- [x] Live end-to-end walkthrough (real data, real Postgres) confirmed all of the thirteenth session's fixes actually work as designed: Prep list no longer shows ghost 0-qty items and items correctly disappear once done; Orders New/In-progress toggle, reject-with-item-checklist, per-item cook→ready→handed-over dots, and Collect-payment gating all work; History insights panel (orders/top items/regulars) populates correctly; the menu mistouch arm-then-confirm guard fires correctly (verified via direct DB checks — my first two test attempts falsely looked like a bug but were actually the auto-disarm timer expiring between my own tool round-trips, not a real defect); shop pause/close correctly blocks new student ordering and updates the student's paused-banner **live via SSE with zero page reload**.
- [x] Two screenshot-reported false alarms explicitly ruled out (documented so a future agent doesn't re-chase them): the bottom nav bar appearing to overlap page content is a known `Playwright fullPage: true` capture artifact with `position: fixed` elements (confirmed absent in a real scrolled-viewport screenshot) — this exact false-alarm class was already documented from an earlier session (§ "Concurrency simulation" session) recurring here on a different page.

### Mobile bug-fix + business/student perspective batch (2026-07-14, thirteenth session)
Real usage feedback (a screenshot of a broken mobile Prep page + a dense list of shopkeeper/student asks) drove this batch. Two Claude planning subagents (business/shopkeeper perspective, student perspective) were dispatched first to turn ambiguous asks into concrete, buildable decisions before any code was touched; their recommendations below were implemented via four parallel `agy` tasks, each independently verified (`go build/vet/test -race`, `tsc`, `npm run build`, plus live curl against a scratch DB and, for Cloudinary, a real upload attempt) rather than trusted at face value.
- [x] **Shop-status guard fixed**: pause/close now blocks only on *accepted* orders (`preparing`/`partially_ready`/`ready`/`awaiting_payment` — new `OrderRepo.CountAccepted`), not merely-`submitted` ones. `IsActiveOrderStatus` itself is untouched (still used by the student one-active-order check). Any still-`submitted` orders are auto-rejected the moment the shop actually transitions to paused/closed (`PoolEngine.RejectAllSubmitted`, reusing a new lock-free `rejectOrderTx` helper extracted from `Reject()` to avoid a mutex-reentrancy deadlock). 409 message updated to `"Finish or cancel the N accepted order(s) first."` `ShopStatusService` gets the `*PoolEngine` via a `SetPool()` setter (not a constructor arg) specifically to avoid breaking an existing, unowned test file mid-batch — verified live: submitted-only order → close succeeds → order auto-rejected with total zeroed.
- [x] **Student cancel extended past `submitted`**: now legal through `preparing`/`partially_ready`/`ready`, blocked (409) the moment anything's been handed over — mirrors `RemoveItem`'s existing FCFS-reallocation tail exactly. Frontend `isCancelable()` in `OrderStatus.tsx` gates the button on the same condition. Verified live: cancel succeeds pre-handover, refused with 409 once `handed_qty > 0`.
- [x] **Partial-trim student notification**: `StudentRealtime.tsx` now tracks newly-`rejected` item ids per order and shows one toast ("N item(s) removed... new total X") + `playStatusChange()`, replacing (not stacking on top of) the generic per-transition toast for that message — except when the *whole* order becomes rejected in the same message, which still gets the classic "order was rejected" wording (a real regression from the first pass of this fix, caught on review and patched before shipping). Persistent banner added to `OrderStatus.tsx` for as long as any item stays rejected on an active order.
- [x] **Mobile header overflow fixed** (`Layout.tsx`): the previous header (logo wordmark + status pill + bell + full name + Logout, all in one row) overflowed below ~400px — confirmed via a real screenshot showing loose unstyled text ("Already open.") above the page content. Root cause of that specific artifact: `Modal.tsx` sets `document.body.style.overflow = 'hidden'` while any modal is open (confirmed by matching devtools output) — a modal genuinely was open when the screenshot was taken, `Modal.tsx` itself has no bug. Fixed by redesigning the header to always show only three fixed-width elements (K mark, status pill, bell) plus a collapsed avatar-menu button (full name + Logout moved into a dropdown) — verified this fits comfortably at 375px.
- [x] **Prep list decluttered**: previously included any item with leftover pool stock even at zero remaining demand (why every item sat at "0 left to cook / not needed right now" — also confirmed via screenshot). Fixed at the source: `PoolEngine.PrepList` (`services/pool.go`) no longer unions in `poolByItem` for list membership, only items with `remaining_qty > 0` are ever returned; the frontend also filters defensively and the dead "not needed" card branch was deleted entirely.
- [x] **Orders page**: `InProgressOrderCard` gained a compact per-item status-dot row (cooking / ready / handed-over) visible on the collapsed card, not just inside `OrderModal`.
- [x] **Menu mistouch guard**: marking an item *unavailable* now requires an arm-then-confirm double-tap (inline "tap again" strip, auto-disarms after 3s) to prevent a rush-hour mistouch from silently pulling a popular item off the menu (real revenue-loss risk); marking *available again* stays a single immediate tap since that direction is always safe.
- [x] **Cloudinary image upload (signed)**: real credentials (`CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`) live in `backend/.env` (gitignored) and `backend/.env.example` documents them as blanks. New `POST /api/shop/menu/photo-signature` (shopkeeper-only) SHA-1-signs `folder=khaao-menu&timestamp=<ts>` + the secret, matching Cloudinary's documented algorithm — **independently re-verified by hand, the signature is mathematically correct**. `MenuManage.tsx`'s photo field is now a file picker that uploads straight to Cloudinary (bytes never touch our own Gin server, which has a 1 MiB body cap). **However, a live test upload against the real account failed**: `"Request forbidden due to missing permissions (actions=[\"create\"])"` — per Cloudinary's own support docs, this specific error is most commonly caused by the account being registered for the **Media Optimizer** product instead of **Programmable Media** (the classic upload API this integration uses requires Programmable Media). **This needs the user to check/fix on Cloudinary's dashboard side** — the code is not the problem, confirmed via independent signature recomputation and a real API round-trip that got as far as Cloudinary's own permission check.

### Build Plan v4 — shop status, menu tagging, trending, history insights (2026-07-14, eleventh/twelfth sessions)

**v4 backend landed cleanly** (`docs/BUILD_PLAN.md` is the spec): `ShopStatus` singleton (open/paused/closed, `POST /api/shop/status` refuses 409 to pause/close while any order is active, clear reopen_at on non-paused states), `MenuItem.Diet` (required `veg`/`non_veg`) + `MenuItem.Tags` (optional, free-form, reuse-first), `order_count_today` (trending), `ShopHistory` now returns `insights` (order_count, item_counts, customers). Backend build/vet/test all green from the start.

**But the first frontend integration pass (same session) was broken despite confident commit messages** — worth recording so it isn't repeated: several new components (`ShopStatusControl`, `OrderModal`, `Modal`, `TrendingRail`, `DietFilter`, `MenuItemCard`, `shopNotifications.ts`) were built to spec and compiled cleanly, but were **never imported or rendered anywhere** — `grep` for their usage returned nothing outside their own files. `Orders.tsx` and student `Menu.tsx` were still the pre-v4 versions, untouched. Worse, `MenuManage.tsx`'s form was never updated to send the now-required `diet` field, so **every menu create/update 400'd live** — and `History.tsx` still called the just-deleted `POST /shop/day/close` route, so the "Close day" button 404'd. `tsc`/`go build` all stayed green throughout because none of this breaks compilation — only live behavior. **Lesson: a clean typecheck and a confident commit message are not evidence of integration; grep for actual call sites and hit the live API before trusting either.**

**Fixed in a follow-up session** via three scoped agy CLI fix passes (disjoint file ownership, each independently re-verified — diffs read, not just self-reports trusted):
- `ShopStatusControl` + a header notification bell (`shopNotifications.ts`) now actually render in `Layout.tsx`; `ShopRealtime.tsx` now calls `pingShopNotification()`/`playOrderComplete()` on new-order and fully-ready transitions.
- `Orders.tsx` rebuilt into a "New orders" / "In progress" segmented-control toggle (was a 3-column kanban); reject now opens a checklist of the order's items, ticked = unavailable = auto-marked out of stock via `setMenuItemStock`, then rejects; `OrderModal` handles per-order handover/prep/pay as a medium overlay; fully-ready orders sort to the top of "In progress".
- `History.tsx`: dead "Close day" block + `closeDay()` client export removed entirely; replaced with an insights panel (orders completed, top items, top customers) fed by the already-existing `insights` field.
- `MenuManage.tsx`: the live-breaking bug fixed — diet (required) + reuse-first tag chips now always sent on create/update; redesigned into a tap-to-toggle card grid with a separate Edit button.
- `Prep.tsx`: "waiting in pool" text removed per explicit product request (engine internals unchanged).
- Student `Menu.tsx`: `TrendingRail` (sorted by `order_count_today`, falls back to newest before any orders land today), `DietFilter`, `MenuItemCard`, and tag-based category sections with sticky jump-chips are now actually wired in (were built, unused, in the broken pass); added a paused/closed banner via `getShopStatus()` that disables ordering.
- `StudentRealtime.tsx`: now plays `playStatusChange()` + toasts on every order-status transition, not just `ready` (which keeps its stronger chime/vibrate/Notification treatment); also invalidates the shop-status query on the `shop_status` SSE event so the banner updates live.

**Re-verified after the fix pass, this time including live checks, not just static ones**: `go build/vet/test -race` ✓, `npx tsc -b --noEmit` ✓, `npm run build` ✓, plus live curl against a scratch Postgres (`khaao_smoke`) confirming: old-style menu-create payload (no diet) still 400s as designed, new-style payload (with diet+tags) now succeeds and round-trips correctly, `POST /shop/day/close` is a confirmed 404, and the full pause/close active-order guard sequence (place order → pause refused 409 with a clear message → cancel → pause succeeds → student order attempt correctly blocked 409 → reopen succeeds).

**Not done this batch (unchanged from plan)**: ratings — design-only, see `docs/BUILD_PLAN.md` §6, not built. A nicer animated calendar picker on History was explicitly deprioritized in favor of the insights panel + bug fixes.

---

Last updated: **2026-07-13**. All changes verified: `go build ./...` ✓ · `go vet ./...` ✓ · `go test ./... -race` ✓ · `tsc --noEmit` ✓ · `npm run build` ✓ · `scripts/smoke.sh` (15/15) ✓ · live edge-case battery against a real Postgres (validation limits, role guards, menu delete-safety, ready-order auto-expiry, close-day, payment→history transition, full/partial trim) ✓ · Playwright browser verification of the UX changes ✓ · concurrent multi-student/multi-shopkeeper load simulation (~30k actions across 4 rounds, zero 5xx, zero data-invariant violations) ✓ · live dual-browser (student + shopkeeper) real-time SSE check ✓ · full endpoint walkthrough of the exact 4-page shopkeeper workflow (accept/reject variants, prep batch-confirm, checklist handover, payment→history) re-verified live, backend confirmed to already match the intended design as-is — see `docs/FRONTEND_BRIEF.md` ✓ · full visual redesign (frontend-only, backend untouched) verified with Playwright screenshots across every page in both roles ✓ · Prep-page interaction rebuilt to a demand-bounded stepper + server-side cap, item photos added across every order view ✓ · full mobile-viewport click-through usability audit of both roles (research-grounded) ✓

### Prep interaction fix + order photos (2026-07-13, ninth session)
User feedback from actually using the redesigned Prep page: the "+1 Done" button stayed big and fully active even when an item's `remaining_qty` was 0 (a real screenshot showed "Cold Coffee — 0 left to cook, 5 waiting in pool" with the done button still inviting more taps) — nothing stopped a shopkeeper from indefinitely over-cooking an item nobody had ordered. Also requested: photos on order views, not just the menu.
- [x] **`MarkDone` now caps `qty` at the item's actual `remaining_qty`** (`services/pool.go`): new `remainingByMenuItem()` helper (factored out of `PrepList`, reused by both) computes real unmet demand inside the same transaction/advisory-lock scope, so the check is atomic with the write. Exceeding it returns `409` with a specific message (names the item and, if it's a full 0, says so explicitly) — enforced server-side, not just hidden in the UI. Added `TestMarkDoneCappedAtRemainingDemand`.
- [x] **Prep row rebuilt** (`pages/shop/Prep.tsx`): the single always-on "+1 Done" tap target is now a `QtyStepper` bounded to `[1, remaining_qty]` plus a single "Done" confirm button (one batched API call, not N taps) — the exact "-num+, select 1 to n, confirm" interaction requested. When `remaining_qty` is 0 the action disappears entirely, replaced with a plain "Not needed right now" label; the informational row (chalkboard tile + pool count) still shows so leftover pool stock stays visible.
- [x] **`photo_url` denormalized onto `OrderItem`** (`models/order_item.go`, `services/pool.go` `CreateOrder`, `services/orders.go` `OrderItemResponse`): copied from the menu item at order-creation time, same pattern already used for `Name`/`PriceEach`, so a later menu photo change or deletion never retroactively alters a past order's display. Rendered as small kraft-framed thumbnails (only when non-empty) in: student active-order item list, student history list, all three shopkeeper Orders-page columns, and shop History cards.
- [x] `docs/FRONTEND_BRIEF.md` updated: the Prep section's "no requirement that qty ≤ remaining_qty" note was flipped (now documents the cap and its two error messages), and the Order object shape now documents `photo_url` per item.

### Visual redesign (2026-07-13, eighth session)
Frontend-only design pass (backend untouched) — full app reskin, "fresh direction" per user request, moving away from the previous cream/green identity. Concept: a college canteen's paper order-chit system — steel counter (`steel` page wash) with kraft-paper cards (`paper`) sitting on it, IBM Plex Mono for numbers/labels + IBM Plex Sans for body text, and a signature **ink-stamp status tracker** (`components/StatusStamps.tsx`) that replaces the old dot-progress timeline — four rubber-stamp marks (RECEIVED/COOKING/READY/PAID) that visibly land on the order ticket as the real order state changes, using an SVG turbulence filter for a distressed hand-stamped edge. New tokens in `tailwind.config.js`: `steel`, `paper`, `stamp` (rubber-stamp red, reserved for status marks + rare alerts), `edge` (hairline/divider), `brand` repointed to a deep moss green, `turmeric` kept. Student Menu page rebuilt as a kraft ledger list (no hero food photography). Shopkeeper Orders page's kanban columns get a small "bulldog clip" detail; Prep page's "left to cook" number gets a one-off dark chalkboard treatment (the only dark surface in the app, used narrowly).
- [x] Full token/font migration across every component and page; global find/replace of old `cream`/`sage`/`bg-white` classes to the new system, verified zero stragglers via grep.
- [x] Bug found + fixed **during** the redesign: menu item names were truncating mid-word ("Masala...", "Veg Fri...") in the new ledger-list layout because the badge shared a row with the name and a mandatory photo-thumbnail slot ate space even for items with no photo. Fixed: thumbnail only renders when `photo_url` exists, name gets its own full-width line, price+badge wrap below it.
- [x] Bug found + fixed: the "PAID" ink stamp was landing during `awaiting_payment` (before payment is actually collected), which is factually wrong — fixed `landedCount()` in `StatusStamps.tsx` so the PAID stamp only lands once `status === 'completed'`.
- [x] Accessibility: added the new `animate-stamp` keyframe to the existing `prefers-reduced-motion: reduce` disable list (was missed on first pass).
- [x] **Process note for the next agent**: verifying this required a live dev server, and the *user's own* long-running dev server (backend :8080 + frontend :5173) was active throughout. Editing the shared `vite.config.ts` proxy target to point at a scratch backend caused Vite to hot-reload the user's already-running frontend and silently reroute it to the scratch backend — a real near-miss. Recovered by reverting immediately, then switched to a fully isolated `vite.<name>.config.ts` + `vite --config ...` + distinct port for all further scratch verification, touching zero shared files. **Never edit `vite.config.ts`'s proxy target for a scratch check if a dev server might already be running on it — use an isolated config file instead.**
- [x] All 13+ screens screenshotted and visually verified (student: login, menu, checkout, all 4 order-status stamp states, history; shopkeeper: orders board, prep, history, menu + add-item form) against a scratch Postgres DB. Backend fully unaffected — `go build/vet/test` all still pass unchanged.

---

## 1. What is Khaao?

A **mobile-first installable PWA** for a single college canteen. Students sign in with their college Google account, build a cart, place one order at a time, and track it live. The shopkeeper/chef accepts orders, cooks to aggregate demand, hands items over one-by-one, and collects payment. No in-app payments, no OTP, no multi-canteen.

**Scale target:** ~2000 students, single college. Lunch/break rush = bursts of orders + ~1–2k long-lived SSE connections. Sustainably served by **one Go instance** (see §3 — topology decision).

---

## 2. Stack (v3, current — do not change without updating this doc)

| Layer | Details |
|---|---|
| **Backend** | Go 1.23 · Gin · GORM · **PostgreSQL only** (SQLite removed in v3) |
| **Architecture** | Layered SOLID: `controllers → services → repositories` with `authn`, `realtime`, `config`, `database` packages. Composition root in `cmd/server/main.go`. |
| **Auth** | Firebase Google sign-in only. Backend verifies Firebase ID tokens against Google's public certs (no Admin SDK, golang-jwt). Issues its own HS256 Khaao JWT. Role re-read from DB on every request — removing someone from the allowlist locks them out immediately. `FakeVerifier` for dev/e2e (disabled in production). |
| **Real-time** | Server-Sent Events. In-memory `realtime.Hub` in `internal/realtime/hub.go`. Students get `order_update` + `menu_update`. Shop gets `orders_update` + `prep_update` + `menu_update`. |
| **Frontend** | React 18 · TypeScript · Vite · Tailwind CSS 3.4 · TanStack Query · react-router · Firebase JS SDK · installable PWA (vite-plugin-pwa) |
| **Topology** | **ONE backend instance** (vertically scaled) behind a TLS reverse proxy (Caddy/nginx). This is an explicit, enforced constraint — see §3. |

---

## 3. Topology decision — why ONE instance (important for any new work)

This is a deliberate architectural choice, not an oversight. **Do not add Redis, distributed locks, or a distributed SSE transport.**

**Reasoning:**
- A single college canteen lunch rush = ~500–1000 orders in 30–60 min, ~1–2k concurrent SSE connections. Go handles this trivially on 2–4 vCPU.
- `PoolEngine.mu` (`sync.Mutex`) is correct and fast in one process. Each mutation is a single short DB transaction (single-digit ms). Even at 20 mutations/sec, queueing is imperceptible.
- Scaling out would require distributed locking (Postgres advisory locks) **and** distributed SSE (Redis/LISTEN NOTIFY) — weeks of work and new failure modes for a single canteen that will never need it.
- The DB is the ultimate arbiter: `SELECT … FOR UPDATE` is already in place inside every mutation transaction (see §4 — WP5 done), so a second instance would serialize correctly rather than corrupt data. But run one.

```
Students' phones (PWA)           Shopkeeper/Chef tablet
         │  HTTPS + SSE                    │
         ▼                                 ▼
┌────────────────────────────────────────────────────┐
│  Reverse proxy / TLS (Caddy or nginx)               │
│  • proxy_buffering off for /api/stream (SSE)        │
│  • long read timeout on SSE, short elsewhere        │
│  • gzip, security headers, HTTP/2                   │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│  ONE Go backend instance (2–4 vCPU, 1–2 GB RAM)    │
│  • in-process sync.Mutex  → correct, no dist. lock  │
│  • in-memory SSE hub      → correct, single process │
│  • ulimit nofile raised (each SSE = 1 fd)           │
│  • http.Server timeouts + body caps                 │
│  • SetMaxOpenConns(25) on sql.DB                    │
└────────────────────────────────────────────────────┘
         │  pooled conns
         ▼
┌────────────────────────────────────────────────────┐
│  Managed Postgres 15+ (citext ext, daily backups)   │
│  • SELECT … FOR UPDATE inside each mutation tx      │
│  • partial unique index + CHECK constraints         │
└────────────────────────────────────────────────────┘
```

---

## 4. Key workflows (for understanding state machine changes)

### Student
Login → Browse menu → Build cart → Place order (one active at a time) → Track live (SSE: Waiting → Cooking → Ready → Pay → Done) → Ready: chime + vibrate + browser notification → Pay at counter.

### Shopkeeper
Morning: update menu + set stock/availability. Triage incoming: Accept (can uncheck individual items to trim them) / Reject. Accepted orders enter the Prep pool. Hand over ready items ("Give 1" / "Give all N"). Remove item from an accepted order (prepared units return to pool → FCFS re-allocate). Collect payment. Close day (expire open orders, clear pool, reset stock).

### Chef / Prep screen
Sees aggregate remaining demand per menu item. Taps "+1 Done" per finished unit → unit enters the pool → FCFS allocated to the oldest waiting order for that item.

### State machines
```
Order:  submitted → preparing → partially_ready → ready
                             ↘ awaiting_payment → completed
        branch: submitted → cancelled (student)
        branch: submitted → rejected (shopkeeper)
        branch: ready → expired (15-min hold if nothing handed)

Item:   pending → queued → allocated → handed_over
        branch: rejected
```

Status is derived by a **pure `recomputeStatus` function** after every mutation. Prices are integers in **paise**. Daily order tokens reset per `BUSINESS_TIMEZONE` (default `Asia/Kolkata`).

---

## 5. Codebase map (where things live)

```
backend/
  cmd/server/main.go              → composition root, server lifecycle, expiry ticker
  internal/
    config/config.go              → fail-closed config: refuses production boot with dev defaults
    config/config_test.go         → table tests for every validation rule
    authn/authn.go                → TokenVerifier interface
    authn/firebase.go             → Firebase RS256 token verification (no Admin SDK)
    authn/fake.go                 → FakeVerifier for dev/e2e (AUTH_FAKE=true only)
    middleware/auth.go            → JWT bearer + ?token= parsing, RequireAuth, RequireRole
    middleware/cors.go            → CORS (single origin, set from FRONTEND_ORIGIN)
    middleware/security.go        → security headers (nosniff, X-Frame-Options, etc.)
    models/                       → GORM models with CHECK constraints + index tags
      user.go, menu_item.go, order.go, order_item.go,
      item_pool.go, order_event.go, shopkeeper_email.go
    database/database.go          → Open (GORM, citext, AutoMigrate, pool tuning), Seed
    repository/repository.go      → interfaces: UserRepo, MenuRepo, OrderRepo, PoolRepo, EventRepo, UnitOfWork
    repository/gorm.go            → GORM implementations of all interfaces
    realtime/hub.go               → in-memory SSE hub (fan-out by userID/role)
    services/
      errors.go                   → AppError (HTTP status + message), ErrBadRequest, ErrNotFound, ErrConflict, ErrInternal
      auth.go                     → AuthService: FirebaseLogin, GetUser, AuthConfig
      menu.go                     → MenuService: CRUD + stock toggle + delete safety
      orders.go                   → OrderService: ActiveOrder, OrderHistory, ShopOrders, ShopHistory
      pool.go                     → PoolEngine: CreateOrder, Accept, Reject, Cancel, Handover, Paid, MarkDone, RemoveItem, ExpiryTick, CloseDay, PrepList
      allocation.go               → FCFSAllocation (AllocationStrategy interface)
      auth_test.go                → auth domain/allowlist unit tests
      pool_test.go                → FCFS/status/recompute/RemoveItem/handover/paid unit tests
    controllers/
      auth.go                     → Firebase login, /auth/me, /auth/config + respondError helper
      menu.go                     → menu CRUD + stock endpoints
      orders.go                   → create/active/history/cancel/stream (SSE) endpoints
      shop.go                     → shop orders/history/accept/reject/handover/paid/remove/prep/closeday/stream
      health.go                   → GET /api/health (liveness probe, no auth)
    routes/routes.go              → Gin router setup, all routes + middleware

frontend/
  src/
    main.tsx                      → React root, QueryClient, BrowserRouter, providers
    App.tsx                       → Route tree (role-split: student vs shopkeeper)
    index.css                     → Tailwind + design tokens
    lib/
      firebase.ts                 → Firebase init + signInWithGoogle
      format.ts                   → formatPrice, formatTime, formatDateTime, formatCountdown, secondsUntil, rupeesToPaise, paiseToRupeesInput
      sound.ts                    → WebAudio beeps (no audio assets): playReadyChime, playIncomingAlert
    context/AuthContext.tsx       → AuthProvider + useAuth (loginWithGoogle, logout, isAuthenticated, user)
    hooks/useSSE.ts               → SSE hook with exponential backoff + MAX_RETRIES=8 cap
    api/
      types.ts                    → shared TypeScript types matching backend responses
      client.ts                   → apiFetch, getToken, getStoredUser, setAuthStorage, onUnauthorized
      auth.ts                     → fetchAuthConfig, loginWithFirebase, fetchMe, logout
      menu.ts                     → getMenu (student)
      orders.ts                   → createOrder, getActiveOrder, getOrderHistory, cancelOrder
      shop.ts                     → all shopkeeper API calls (menu, orders, history, prep, close-day)
    components/
      Layout.tsx                  → sticky header, bottom nav bar, badge counts, StudentRealtime/ShopRealtime mounted
      ProtectedRoute.tsx          → role gate (redirects to /login or back)
      StudentRealtime.tsx         → SSE handler: sets query cache, plays chime, browser notification, toasts
      ShopRealtime.tsx            → SSE handler: invalidates shop queries, plays incoming-order alert
      Button.tsx, Card.tsx, EmptyState.tsx, Spinner.tsx, Toast.tsx
      StatusBadge.tsx             → Badge, MenuStatusBadge, OrderStatusBadge, OrderItemStatusBadge
      OrderTicket.tsx             → daily token display
      QtyStepper.tsx              → +/- quantity control
    pages/
      Login.tsx                   → Google sign-in screen
      student/Menu.tsx            → menu browse + cart + checkout sheet + order submit
      student/OrderStatus.tsx     → active order timeline + item list + cancel + history
      shop/Orders.tsx             → 3-column kanban: Incoming / Cooking / Collect payment
      shop/Prep.tsx               → prep list with +1 Done tap targets
      shop/History.tsx            → date-filtered completed orders + total collected
      shop/MenuManage.tsx         → full menu CRUD + stock toggle + close-day

docs/
  SPEC.md                         → authoritative API contract + state machines
  01-flows.html                   → original flow diagrams (reference only)
  02-technical.html               → original technical brief (reference only)
scripts/
  smoke.sh                        → e2e smoke test script (boots server, tests full lifecycle)
```

---

## 6. Environment variables (copy `backend/.env.example` → `backend/.env`)

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `APP_ENV` | `dev` | `dev` / `test` / `production` — fail-closed validation runs only when `production` |
| `DATABASE_URL` | `postgres://...` | **Postgres only.** Must not be localhost URL in production. |
| `JWT_SECRET` | `dev-secret-change-me` | HS256 secret. **Must be ≥32 chars and not the default in production.** |
| `FIREBASE_PROJECT_ID` | *(empty)* | **Required in production.** Skip with `AUTH_FAKE=true` in dev. |
| `ALLOWED_EMAIL_DOMAIN` | `sst.scaler.com` | Students must have a Google account on this domain |
| `SHOPKEEPER_EMAILS` | *(empty)* | Comma-separated shopkeeper email allowlist, seeded to DB on boot |
| `AUTH_FAKE` | `false` | Dev/test only. Accepts `fake:<email>` tokens. **Rejected in production.** |
| `HOLD_MINUTES` | `15` | Minutes a fully-ready order holds before it expires |
| `BUSINESS_TIMEZONE` | `Asia/Kolkata` | IANA timezone for daily token reset, history dates, availability windows |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin. Must be `https://` in production. |
| `SEED_SAMPLE_MENU` | `true` | Seed ~6 sample items if menu table is empty on boot |

Frontend env (`frontend/.env.example` → `frontend/.env`):

| Var | Notes |
|---|---|
| `VITE_FIREBASE_API_KEY` | From Firebase console → Project settings → Web app |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Same as backend `FIREBASE_PROJECT_ID` |
| `VITE_FIREBASE_APP_ID` | From Firebase console |

---

## 7. API surface (base path `/api`)

All errors: `{"error": "message"}`. Auth: `Authorization: Bearer <token>` or `?token=` (SSE only).

**Public (no auth)**
- `GET /api/health` → `{"ok": true}` — liveness probe
- `GET /api/menu` → `{"items": [...]}` — student browseable menu
- `GET /api/auth/config` → `{"allowed_email_domain": "..."}`
- `POST /api/auth/firebase` `{id_token}` → `{token, user}`

**Authenticated**
- `GET /api/auth/me` → `{user}`

**Student** (authenticated + `role=student`)
- `POST /api/orders` `{items: [{menu_item_id, qty}]}` → `{order}`
- `GET /api/orders/active` → `{order}` or 404
- `GET /api/orders` → `{orders}` (history)
- `POST /api/orders/:id/cancel` → `{order}`
- `GET /api/stream` → SSE: `order_update`, `menu_update`

**Shopkeeper** (`/api/shop/*`, authenticated + `role=shopkeeper`)
- `GET /api/shop/menu` → all items incl. unavailable
- `POST /api/shop/menu` · `PUT /api/shop/menu/:id` · `DELETE /api/shop/menu/:id`
- `POST /api/shop/menu/:id/stock` `{out_of_stock}` → `{item}`
- `GET /api/shop/orders` → `{incoming, in_progress, awaiting_payment}`
- `GET /api/shop/history[?date=YYYY-MM-DD]` → `{orders, total_paid}`
- `POST /api/shop/orders/:id/accept` `{rejected_item_ids}` → `{order}`
- `POST /api/shop/orders/:id/reject` → `{order}`
- `DELETE /api/shop/orders/:id/items/:itemID` → `{order}` (trim + re-pool)
- `POST /api/shop/orders/:id/items/:itemID/handover` `{qty}` → `{order}`
- `POST /api/shop/orders/:id/paid` → `{order}`
- `GET /api/shop/prep` → `{items: [{menu_item_id, name, remaining_qty, pool_qty}]}`
- `POST /api/shop/prep/:menu_item_id/done` `{qty}` → triggers FCFS allocation
- `POST /api/shop/day/close` → expires open orders, clears pool
- `GET /api/shop/stream` → SSE: `orders_update`, `prep_update`, `menu_update`

---

## 8. What's DONE (all verified by build + tests + manual smoke)

### Core product — complete end-to-end
- [x] Firebase Google auth, server-side token verification (no Admin SDK), DB-allowlist shopkeepers, domain-gated students, Khaao JWT, DB-role-per-request
- [x] Full order lifecycle: cart → order → accept/reject/trim → Prep pool → FCFS allocation → per-item handover → awaiting_payment → paid
- [x] One active order per student enforced in code + partial unique index `uniq_active_order_per_user`
- [x] Menu CRUD + one-tap stock toggle; daily order tokens; order history; shopkeeper "collected today" total
- [x] Real-time SSE: student order updates, shop order/prep/menu updates, ready-chime + vibration + browser notification, new-order beep (WebAudio, no audio files)
- [x] Mobile-first installable PWA (service worker, offline shell, `/api` NetworkOnly)
- [x] All 6 test suites pass (`go test ./... -race`)

### Hardening pass (2026-07-13, first session) — all verified
- [x] **Fail-closed config** (`config/config.go`): in production, server refuses to boot if `JWT_SECRET` is default, `DATABASE_URL` is localhost, `FIREBASE_PROJECT_ID` is empty, `FRONTEND_ORIGIN` is non-https, or `APP_ENV` is unknown. `AUTH_FAKE` is dev/test only.
- [x] **`BUSINESS_TIMEZONE`** — all time operations use the configured timezone (daily token reset, availability windows, history dates, order expiry). Host timezone no longer matters.
- [x] **Role separation**: `RequireRole(student)` guards student routes; `RequireRole(shopkeeper)` guards shop routes. A shopkeeper token cannot call student endpoints.
- [x] **FCFS determinism**: `created_at ASC, id ASC` stable tiebreak at both orders and items level.
- [x] **Server hardening** (`middleware/security.go`, `main.go`): `ReadHeaderTimeout`, `ReadTimeout`, `IdleTimeout`, `MaxHeaderBytes`, 1 MiB body cap via `MaxBytesReader`; security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- [x] **Post-accept item trim + re-pool** (`DELETE /api/shop/orders/:id/items/:itemID`): shopkeeper removes an item from an accepted order; unhanded prepared units return to the pool; FCFS re-allocates to the next waiting order; total/status recompute; refuses if student has started collecting (409). Full unit test coverage + smoke.
- [x] **DB-level concurrency** (WP5): `SELECT … FOR UPDATE` on order/items/pool inside every mutation transaction, Postgres advisory lock for multi-process safety; `order_no` retry-once on unique violation; active-order check inside tx mapped to 409.
- [x] **Shop history `?date=` param** now correctly applied in business timezone.
- [x] **Frontend UX**: notification permission requested on order submit; vibrate on ready; "Give all N" handover; checkout sheet closes on backdrop tap; ready banner shows live countdown (not hardcoded "15 min"); token notifications use `order_no` not internal `id`.
- [x] **`MarkDone` validation**: menu item must exist; `qty` must be ≥1 and ≤ a sane upper bound.

### Cleanup pass (2026-07-13, second session)
- [x] Removed `backend/khaao.db` (SQLite leftover in a Postgres-only repo)
- [x] Removed `.DS_Store`
- [x] Fixed duplicate `useNavigate` import in `Menu.tsx` (was imported twice)
- [x] Fixed all toast/notification messages to use `order.order_no` (daily token) instead of `order.id` (DB primary key)
- [x] Removed trailing blank line in `services/orders.go`
- [x] Rewrote `backend/README.md` to match v3 stack (Postgres-only, Firebase auth, correct env vars and all current routes)

### Correctness + hardening pass (2026-07-13, third session)
- [x] **SSE retry bounding** (`hooks/useSSE.ts`): after `MAX_RETRIES=8` consecutive failures (~2 min of exponential backoff), stops reconnecting and dispatches `khaao:unauthorized` to force a re-login. Prevents infinite loops on expired/revoked tokens.
- [x] **`broadcast()` error logging** (`services/pool.go`): was silently swallowing DB errors with `_`; now logs them with `log.Printf` and returns early.
- [x] **Server-side menu validation strengthened** (`services/menu.go`): name max 100 chars, price must be > 0 (not ≥ 0), photo URL must be `http://` or `https://`, and both `avail_from`+`avail_to` are required together or both empty (was frontend-only before).
- [x] **Menu delete safety** (`services/menu.go` + `repository/gorm.go` + `repository/repository.go`): `DELETE /shop/menu/:id` returns 409 Conflict if any active (non-terminal) order has a non-rejected item for that menu item. Prevents orphaned `order_items`.
- [x] **Health endpoint** (`controllers/health.go`): `GET /api/health` → `{"ok": true}`, unauthenticated, suitable for reverse-proxy/k8s liveness probes.
- [x] **DB connection pool tuned** (`database/database.go`): `SetMaxOpenConns(25)`, `SetMaxIdleConns(5)`, `SetConnMaxLifetime(1h)`. Caps concurrent Postgres connections well within default `max_connections=100`.

### Bug-hunt pass (2026-07-13, fourth session)
Full re-review of every backend and frontend file, plus live endpoint testing against a real Postgres (golden-path `scripts/smoke.sh` + a scratch battery of validation/limit/expiry/close-day edge cases not covered by the existing suite). Found and fixed 4 real bugs; confirmed several look-alikes were already correct (see notes).
- [x] **`Handover`/`MarkDone` silently minted phantom units on `qty: 0`** (`services/pool.go`): both endpoints previously did `if qty <= 0 { qty = 1 }`, so an explicit `{"qty":0}` (or a negative qty) from the client was silently treated as "hand over 1" / "mark 1 done" instead of being rejected — verified live that this actually incremented `handed_qty` / the pool by 1 with no client-visible signal. Now returns `400 {"error":"qty must be at least 1"}` for `qty < 1`. A bodyless request still defaults to `qty: 1` (unchanged) since that default is applied in the controller before binding.
- [x] **`order_date` violated its own API contract** (`services/orders.go`): Postgres `date` columns round-trip through `database/sql` into a Go `string` as an RFC3339 timestamp (`"2026-07-13T00:00:00Z"`), not the `"YYYY-MM-DD"` the SPEC/`api/types.ts` promise — verified live on every order fetched after a DB round-trip (i.e. every order returned by the API). Added `normalizeDate()` in `ToOrderResponse` to trim to the first 10 chars. Harmless in practice today (nothing in the frontend parses `order_date`) but a real contract violation waiting to bite the next integration.
- [x] **Shopkeeper History date picker off-by-one at night** (`pages/shop/History.tsx`): default date was `new Date().toISOString().split('T')[0]` — UTC, not local/business time. Between 00:00–05:29 IST (business timezone is `Asia/Kolkata`, UTC+5:30) this showed *yesterday's* date by default, mismatched with the backend's own business-timezone-based "today". Replaced with a `todayLocal()` helper built from local Y/M/D.
- [x] **Cart item stuck once it goes unorderable** (`components/QtyStepper.tsx`, `pages/student/Menu.tsx`): if an item went out-of-stock or its time window closed *after* being added to the cart, the main menu grid's stepper disabled both `−` and `+`, so a student could not remove it from the cart from that screen (the checkout sheet's stepper had no such guard, so it was recoverable but confusing). `QtyStepper` now takes a separate `disableIncrease` prop; the grid only blocks increasing past what's orderable, decreasing to zero is always allowed.
- [x] **Verified already-correct / already-fixed**, so the notes below don't get re-litigated by the next agent:
  - Duplicate `menu_item_id` in `CreateOrder` (formerly listed as P1-a, "left to do") is **already implemented and unit-tested** (`services/pool.go` `CreateOrder`, `TestCreateOrderRejectsDuplicateMenuItems` in `pool_test.go`). Removed from §9.
  - Overnight availability windows (e.g. `22:00`–`06:00`) are already handled correctly by `withinWindow` in `services/menu.go` (wraps past midnight); only a same from/to instant is degenerate, not broken.
  - `ErrUnorderable` (422) for a nonexistent/unorderable menu item in `CreateOrder` is intentional, not a stray status code.
  - Full lifecycle re-verified live end-to-end: accept/reject/trim, FCFS re-pool, handover, payment, **ready-order auto-expiry via the 15s ticker** (tested with `HOLD_MINUTES=1`, confirmed units return to the pool and the student's slot frees up for a new order), and `day/close` (confirmed idempotent reset of stock + pool).

### Deeper lifecycle verification + UX pass (2026-07-13, fifth session)
Dispatched two parallel subagents: one for a deeper live-endpoint verification pass (specifically the payment→history transition the user asked about), one for a student/shopkeeper UX information-architecture discussion. Both subagents' output was independently re-verified (diffs read, tests re-run, changes re-tested live/in-browser) before being accepted here — see §"Executing actions with care" norms.
- [x] **`Accept()` full-trim didn't zero `TotalPrice`** (`services/pool.go` `Accept`, `allRejected` branch): found by the verification subagent. When a shopkeeper accepted an order but rejected every line item (full trim at accept time), `order.Status` correctly became `rejected` but `order.TotalPrice` kept the original pre-trim sum instead of resetting to 0 — inconsistent with `RemoveItem`'s equivalent full-trim path, which does zero it. Fixed with `order.TotalPrice = 0` in that branch; added `TestAcceptFullTrimZeroesTotalPrice` to `pool_test.go` (the subagent's fix had no test coverage, added it before accepting the fix).
- [x] **Verified live**: payment→history transition (a completed/paid order immediately disappears from all three `/api/shop/orders` buckets and appears in `/api/shop/history` with the correct `paid`/`total_price`), the same for rejected/cancelled/expired paths (never counted in `total_paid`), and partial-trim-mid-cook (order total recalculates to just the remaining item's cost, history shows the final trimmed total). Full endpoint sweep of every route in §7 confirmed correct, including both SSE endpoints.
- [x] **UX/IA discussion held with the user** (see chat history for the full write-up) covering: (a) whether splitting "mark cooked" (Prep tab) from "hand over" (Orders→Cooking column) forces one person to bounce between tabs — user said staffing varies, so the hybrid was implemented; (b) "Close day"'s placement; (c) the student's combined active-order/history page; (d) smaller nav/badge gaps. User asked for all recommended fixes to be implemented (with a broader "make it feel like a polished food-ordering app" aspiration noted for a possible future pass — not attempted here beyond the concrete items below).
- [x] **"Close day" moved from `MenuManage` to `History`** (`pages/shop/MenuManage.tsx`, `pages/shop/History.tsx`): now its own clearly-separated red "End of day" section below "Collected today", instead of sitting in the same button row as "Add item".
- [x] **Student double-empty-state collapsed** (`pages/student/OrderStatus.tsx`): a student with no active order and no history now sees one "Place your first order" prompt instead of two stacked empty-state boxes.
- [x] **Prep tab nav badge added** (`components/Layout.tsx`): shows a count of menu items with a cooking backlog (`remaining_qty > 0`), matching the existing pattern for the Orders/Order tabs' badges; rides the `['shop','prep']` query key so SSE `prep_update` events keep it live.
- [x] **"+1 done" shortcut added inside the Cooking column** (`pages/shop/Orders.tsx`): lets a shopkeeper mark a unit cooked without switching to the Prep tab — calls the same shared per-dish pool endpoint `POST /shop/prep/:menu_item_id/done`, so it's a convenience alias, not a new code path. Also moved "Remove" onto its own row above the Give buttons (was squeezed beside "Give 1", a plausible mis-tap during a rush).
- [x] **Verified in a real browser with Playwright** (chromium, installed for this check): all 4 UX changes render correctly and the interactive chain (`+1 done` → pool decrements → `Give all N` → handed over) works end-to-end via screenshots + live DOM assertions, not just `tsc`/build. Test used a scratch Postgres DB and a scratch backend port with a temporary (reverted) `vite.config.ts` proxy edit — the user's own long-running dev backend on port 8080 was detected and deliberately left untouched throughout.

### Concurrency simulation + real-device layout pass (2026-07-13, sixth session)
Built a repeatable concurrent-load simulator (Node script, not committed to the repo — lived in the scratch dir) driving N students placing/cancelling orders against 2 shopkeeper workers racing each other on accept/reject/prep/handover/remove/paid, plus a "chaos" mode adding random stock toggling and a mid-run `day/close`. Ran 4 rounds (~30k total actions) against a real Postgres, checking both HTTP-level anomalies (any 5xx) and DB-level data invariants (qty bounds, `total_price` bookkeeping, pool non-negativity, no orders stuck in an impossible state, no user with 2 active orders, event-log completeness) after each round. Found and fixed 2 more real bugs this way, on top of a 3rd found by a live dual-browser (Playwright) session driving an actual student tab and shopkeeper tab side by side over real SSE:
- [x] **`Reject()` and `Cancel()` never zeroed `TotalPrice`** (`services/pool.go`): same class of bug as the `Accept()` full-trim fix from the previous session, but far more common — it hit *every* plain reject and plain cancel (every item ends up `rejected`, so the correct total is 0), not just the narrow full-trim-at-accept path. 205 orders in the first simulation round alone had this stale nonzero total. This was silently visible to real users: both the student's own order history (`OrderStatus.tsx`) and the shopkeeper's History page display `order.total_price` for every order regardless of status, so a cancelled/rejected order was showing its full would-have-been price. Fixed with `order.TotalPrice = 0` in both functions; added `TestRejectZeroesTotalPrice` / `TestCancelZeroesTotalPrice` to `pool_test.go`. Re-ran the full simulation after the fix — 0 violations across all subsequent rounds.
- [x] **Shopkeeper pages capped to phone width on every screen size** (`components/Layout.tsx`): `<main>`, the header, and the bottom nav all used `max-w-md` (28rem/448px) unconditionally. That's correct for the student experience (single column, phone-first) but wrong for the shopkeeper's multi-column layouts (`Orders.tsx`'s 3-column kanban, `Prep.tsx`/`History.tsx`'s responsive grids) — `md:grid-cols-3` etc. could never actually engage because the container itself never grew past 448px on *any* device, including a full-width desktop browser. Found via the live Playwright dual-browser check: at a realistic 1280px window, the "New" column's Accept button visibly bled into the "Cooking" column and Playwright's own actionability check correctly refused to click it ("element intercepts pointer events") — a real, reproducible bug, not a test artifact. Fixed by making the container width role-conditional: students keep `max-w-md`, shopkeepers get `max-w-6xl`. Re-verified visually at 1280px: Orders, Prep, History, and MenuManage all render cleanly with no overlap.
- [x] **Verified already-safe, not a bug**: force-closing the day (`CloseDay`) while an order has been *partially* handed over leaves that order's items with their pre-close `AllocatedQty`/`HandedQty` and the order's `TotalPrice` at the full (not prorated) amount — unlike the 15s `ExpiryTick`, which protects any order with `HandedQty > 0` from expiring at all and returns unhanded allocations to the pool. `CloseDay` is deliberately a blunt, unconditional force-stop (matches its existing "highly destructive" framing and no-confirmation-token status). Confirmed via simulation this causes no data corruption, no double-charging (the order is never `Paid`, so it never counts toward `total_paid`), and no orphaned pool inventory (the whole pool is zeroed in the same transaction). This is exactly the open "policy for partially-handed orders" question already listed under P2-b — left alone pending an actual policy decision, not something to guess at.
- [x] **`.env.example` rewritten on both sides** (`backend/.env.example`, `frontend/.env.example`) with step-by-step "how to get this value" instructions for every credential (Firebase project + Web app setup from scratch, enabling the Google sign-in provider, generating `DATABASE_URL` via Homebrew Postgres or Supabase/Neon/Railway, generating `JWT_SECRET` via `openssl rand -base64 48`, and the `SHOPKEEPER_EMAILS` allowlist) — previously these files only named the variables with light hints, not a full walkthrough.

### Real credentials wired up + endpoint contract brief (2026-07-13, seventh session)
- [x] **Real `.env` files created** (`backend/.env`, `frontend/.env`, both gitignored — confirmed with `git check-ignore`) using the user's actual Firebase project (`khaao0`) and shopkeeper email; `.env.example` on both sides reverted to blank templates (no real keys ever belong in a git-tracked file) with two Q&A comments added inline: why the backend needs `FIREBASE_PROJECT_ID` even though only the frontend does the Firebase sign-in popup (token *verification* — checks the ID token's audience/issuer actually match your project, a real security check, not a redundant config copy), and why `ALLOWED_EMAIL_DOMAIN` is still needed alongside Firebase's own "Authorized domains" setting (the two control different things — website origins vs. student email addresses).
- [x] **Full live re-verification of the intended shopkeeper workflow**, endpoint by endpoint, against a scratch DB: student one-active-order booking, all three accept/reject variants (empty `rejected_item_ids` = full accept, some = partial trim, all = full trim/equivalent-to-reject — all three correctly total and disappear/persist as expected), the Prep page's "select qty via +/-, confirm once" pattern (confirmed a single `POST /shop/prep/:id/done {qty:5}` call correctly does the same as 5 separate calls of `qty:1` — no backend change needed for that interaction pattern), the handover checklist driving `preparing → ready → awaiting_payment` automatically, `paid` moving the order out of `/shop/orders` and into `/shop/history` with correct totals. Zero new bugs found — the backend already implements the intended 4-page shopkeeper design (Orders/checklist/payment on one page, Prep/cook on a second, Menu on a third, History on a fourth) exactly as described, with no restructuring needed.
- [x] **`docs/FRONTEND_BRIEF.md` added** — a page-by-page endpoint contract (request/response shapes, status codes, what triggers what) for whoever builds the frontend next, deliberately containing zero visual/layout guidance per the user's request. Written to be handed directly to a code-generation tool/agent as a spec.

### Backend UX enforcement + mobile usability audit (2026-07-13, tenth session)
Two rounds this session. First, user feedback from actually using the redesigned Prep page: "+1 Done" stayed big and fully active even at `remaining_qty: 0` (screenshot showed "Cold Coffee — 0 left to cook, 5 waiting in pool" with the button still inviting taps) — nothing stopped indefinite over-cooking of an unordered item. Also requested photos on order views. Then: a full mobile-viewport ("test it like a shopkeeper on their phone") click-through audit of every button in both roles, grounded in a couple of targeted searches on food-ordering-app UX conventions (confirmed the existing floating-cart-bar/checkout-summary/unified-order-board patterns already match industry norms — no structural rework needed there).
- [x] **`MarkDone` now caps `qty` at the item's actual `remaining_qty`** (`services/pool.go`): new `remainingByMenuItem()` helper (shared with `PrepList`) computes real unmet demand inside the same transaction/advisory-lock scope; exceeding it returns `409` naming the item (and saying so explicitly if it's a full 0). Enforced server-side, not just hidden in the UI. `TestMarkDoneCappedAtRemainingDemand` added.
- [x] **Prep row rebuilt** (`pages/shop/Prep.tsx`): the single always-on "+1 Done" tap target is now a `QtyStepper` bounded to `[1, remaining_qty]` plus one "Done" confirm (one batched call, not N taps). At `remaining_qty: 0` the action disappears, replaced by "Not needed right now" — the informational row (chalkboard tile + pool count) still shows so leftover pool stock stays visible.
- [x] **`photo_url` denormalized onto `OrderItem`** (`models/order_item.go`, `services/pool.go` `CreateOrder`, `services/orders.go` `OrderItemResponse`): copied from the menu item at order-creation time, same pattern as `Name`/`PriceEach`, so a later menu photo edit/delete never retroactively changes a past order's display. Rendered as small kraft-framed thumbnails (only when non-empty) in student active-order/history and all shopkeeper order/history views.
- [x] **Mobile usability audit findings, all fixed**:
  - The `ghost` button variant (`components/Button.tsx`, used by "Edit" and the menu-form "Cancel") had zero visual chrome — no border, no background. On desktop, hover reveals it's clickable; **touch devices have no hover**, so it read as inert text, not a button. Added a subtle `border-edge` so it's identifiable as tappable regardless of input method.
  - **`Reject` order had no confirmation dialog**, while structurally-lesser actions (Remove item, Delete menu item, Cancel order, Close day) all did — a mis-tap during a rush could drop a student's entire order with zero recourse. Added a `window.confirm` matching the existing pattern.
  - **No instructional copy above the accept-checklist checkboxes** — a first-time shopkeeper had two different "reject" mechanisms (uncheck one item vs. the big Reject button) with nothing distinguishing them. Added "Uncheck anything you're out of, then Accept the rest." (only shown when there's more than one item, where the ambiguity actually exists).
  - **Ruled out as a false alarm**: a screenshot appeared to show the "Collect payment" column overlapped by the fixed bottom nav bar. Verified via direct DOM measurement (`getBoundingClientRect`) and a real scroll-to-bottom screenshot that this was a `Playwright fullPage: true` capture artifact with `position: fixed` elements, not a real rendering bug — noting this here so it isn't "fixed" again by a future agent chasing a screenshot ghost.

---

## 9. What's LEFT — priority order (next agent starts here)

> Legend: **P0** = blocks 2000-student launch · **P1** = correctness/security before real use · **P2** = reliability/ops · **Deploy** = deployment milestone

### P0 — must do before real deployment

| # | What | Where | Notes |
|---|---|---|---|
| WP4 | **Versioned SQL migrations** | `database/database.go`, new `migrations/` dir | Replace AutoMigrate with golang-migrate. Add explicit FKs with `ON DELETE` semantics, CHECK constraints for every status enum, all indexes. Verify schema in CI. AutoMigrate is fine for dev but not for production schema evolution. |

### P1 — correctness + security (before real student use)

| # | What | Where | Notes |
|---|---|---|---|
| ~~P1-a~~ | ~~Dedupe `menu_item_id` in `CreateOrder`~~ | `services/pool.go` `CreateOrder` | **Already done** (verified 2026-07-13 fourth session) — `CreateOrder` already rejects a repeated `MenuItemID` with 400, covered by `TestCreateOrderRejectsDuplicateMenuItems`. Earlier revisions of this doc listed it as outstanding; it wasn't. |
| P1-b | **Session/token security** | `hooks/useSSE.ts`, `api/client.ts`, `middleware/auth.go` | SSE JWT is in the query string (visible in proxy logs, browser history). Options: (a) mint a short-lived one-use SSE ticket, (b) use an HttpOnly cookie. localStorage is XSS-exfiltratable for a 7-day token — consider `sessionStorage` + silent refresh, or full cookie-based sessions. |
| P1-c | **Rate limiting** | `routes/routes.go` or new middleware | Per-user/per-token rate limits on mutations (NOT per-IP — 2000 students share campus NAT). SSE connection cap per user (prevent one user holding 100 connections). |
| P1-d | **Reject-with-stock-out** | `services/pool.go` `Reject`, `services/menu.go` | When the shopkeeper rejects an order because an item is out of stock, optionally mark that item as `out_of_stock=true` on the menu. Currently reject just rejects the order. Decide policy and implement. |
| P1-e | **`avail_from` < `avail_to` validation (same-day only)** | `services/menu.go` `validateAndNormalize` / `withinWindow` | Overnight windows (e.g. `22:00`–`06:00`) are already handled correctly by `withinWindow` (verified 2026-07-13) — this is only about warning a shopkeeper who typos a same-day window backwards (e.g. meant `09:00`–`17:00`, typed `17:00`–`09:00` and unintentionally got an overnight window instead of an error). Low priority UX polish, not a correctness bug. |

### P2 — reliability + ops

| # | What | Where | Notes |
|---|---|---|---|
| P2-a | **Structured logs + metrics** | throughout | Replace `log.Printf` with `slog` (stdlib, Go 1.21+). Add request-level structured logging in middleware. Metrics/alerts for: auth failures, tx conflicts, pool anomalies, order-state transition failures. |
| P2-b | **`CloseDay` safety** | `services/pool.go` `CloseDay` | Highly destructive — no confirmation token, no idempotency, no audit actor. Add: explicit confirmation param, idempotency key, log who closed the day and when, define policy for partially-handed orders. |
| P2-c | **Postgres integration tests + CI** | `*_integration_test.go` | Current tests are all unit mocks. Need tests that run against a real Postgres (disposable, e.g. via `ory/dockertest`). Test: unique constraint, FK enforcement, concurrent order creates, expiry tick, re-pool. Run `go test -race ./...` in CI. |
| P2-d | **Load test** | `scripts/` | k6 load test: 2000 concurrent SSE connections + burst of order creates. Measure p95 latency, mutex queue depth, fd usage, Postgres connection count. Tune instance size and pool. |
| P2-e | **SSE outbox / replay** | `realtime/hub.go`, new outbox | Currently: if the process restarts between a DB commit and the SSE broadcast, the client misses the event. Clients refetch on reconnect (TanStack Query), which limits damage. For production: either document the refetch guarantee explicitly, or implement a lightweight Postgres LISTEN/NOTIFY outbox. |

### Deployment (deferred milestone)

| # | What | Notes |
|---|---|---|
| D-1 | **Provision managed Postgres** | Supabase / Neon / Railway / cloud provider. Turn on daily backups, test restore. Confirm `citext` extension is available. |
| D-2 | **Firebase setup** | Create project → enable Google sign-in → **add authorized domains** (this is the #1 launch gotcha — sign-in popups fail on unauthorized domains) → copy 4 `VITE_FIREBASE_*` values + `FIREBASE_PROJECT_ID`. |
| D-3 | **Deploy backend** | One instance (replicas=1 enforced). Raise `ulimit -n`. Set all env vars. Put Caddy/nginx in front with `proxy_buffering off` on `/api/stream`, long read timeout for SSE, short elsewhere. |
| D-4 | **Deploy frontend** | Static host (Netlify/Vercel/Cloudflare Pages). Set 4 `VITE_FIREBASE_*` at build time. Point `VITE_API_URL` at backend. |
| D-5 | **End-to-end verification** | One real `@sst.scaler.com` student + one real shopkeeper email must successfully log in, place an order, and complete the full lifecycle on production. |
| D-6 | **Runbook** | How to: close the day, rotate `JWT_SECRET`, add a shopkeeper, restore a backup, check logs. |

---

## 10. Keys and secrets needed (6 total — never commit)

| Secret | Used by | How to get |
|---|---|---|
| `FIREBASE_PROJECT_ID` | backend | Firebase console → ⚙ Project settings → **Project ID** |
| `VITE_FIREBASE_API_KEY` | frontend | Firebase console → Project settings → Your apps → Web app → SDK config |
| `VITE_FIREBASE_AUTH_DOMAIN` | frontend | `<project>.firebaseapp.com` (from same SDK config) |
| `VITE_FIREBASE_PROJECT_ID` | frontend | Same as backend `FIREBASE_PROJECT_ID` |
| `VITE_FIREBASE_APP_ID` | frontend | From same SDK config |
| `JWT_SECRET` | backend | `openssl rand -base64 48` — rotate = invalidates all sessions |
| `DATABASE_URL` | backend | `postgres://user:pass@host:5432/khaao?sslmode=require` |
| `SHOPKEEPER_EMAILS` | backend | Actual Google emails of shopkeeper(s), comma-separated |

**Firebase "Authorized domains" is the #1 launch gotcha** — the sign-in popup will silently fail if your production domain isn't listed. Go to: Firebase console → Authentication → Settings → Authorized domains → Add your domain.

---

## 11. How to run locally

```bash
# 1. Create Postgres DB
createdb khaao

# 2. Copy env files and fill in Firebase values
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit both files

# 3. Run backend (port 8080, auto-migrates schema, seeds sample menu)
cd backend && go run ./cmd/server

# 4. Run frontend (port 5173, proxies /api to backend)
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. Install as PWA from the browser address bar.

**Testing without Firebase** (dev only): Set `AUTH_FAKE=true` in `backend/.env`. Then `POST /api/auth/firebase` accepts `{"id_token": "fake:someone@sst.scaler.com:Name"}`. The UI always uses the real Google popup.

---

## 12. Verification commands (run before every merge)

```bash
# Backend
cd backend
go build ./...        # must be clean
go vet ./...          # must be clean
go test ./... -race   # all pass

# Frontend
cd frontend
npx tsc --noEmit      # 0 errors
npm run build         # must succeed (for PWA asset check)
```

---

## 13. Security considerations (known gaps, do not forget)

1. **SSE token in query string** — visible in proxy/server logs and browser history. See P1-b above.
2. **`localStorage` JWT** — exfiltratable via XSS. See P1-b above.
3. **No rate limiting** — a determined user can flood order-creates or hold many SSE connections. See P1-c above.
4. **Photo URLs are unrestricted** — shopkeeper can set any URL. React prevents HTML injection but arbitrary remote URLs create tracking/content risks. Consider allowing only specific image hosts or a server-side upload pipeline.
5. **Firebase token pinned to RS256, app JWT pinned to HS256** — already enforced in `authn/firebase.go` and `middleware/auth.go`. Do not change.
6. **CORS** — origin is pinned to `FRONTEND_ORIGIN`. No wildcard. Correct.
7. **CSP** — not set. Set at the reverse proxy level or as a Gin middleware before launch.

---

## 14. What the next agent should work on first

Pick from §9 in priority order. The most impactful next items are:

1. **P1-c** — rate limiting middleware (per-user, NAT-aware — medium effort)
2. **P1-b** — SSE token security (query-string JWT / localStorage exposure)
3. **P2-a** — structured logging with `slog` (good foundation for everything else)
4. **WP4** — versioned SQL migrations (high effort, but important for production schema safety)
5. **P2-c** — Postgres integration tests (important for confidence before real use)

(P1-a was struck off §9 this session — it was already implemented, not actually outstanding.)

All changes must:
- Keep `go build ./...`, `go vet ./...`, `go test ./...` clean
- Not touch topology (no Redis, no distributed locks, no multiple instances)
- Not change the API contract in `docs/SPEC.md` without documenting the change here
- Update §8 (done) and §9 (left) in this file after completing each item
