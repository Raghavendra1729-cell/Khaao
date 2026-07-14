# Khaao — Build Plan v4 (shop status, tagging, UX rebuild)

Source-of-truth spec for the current work batch. Three subagents implement against
the **API contract** and **owned-files** boundaries below. Do not invent shapes that
diverge from this doc; if something is genuinely underspecified, prefer the smallest
change consistent with the existing code and note it.

Stack recap: Go 1.23 + Gin + GORM + Postgres (single instance, in-process mutex +
in-memory SSE hub). React 18 + Vite + TS + Tailwind + TanStack Query. Prices in paise.
Business timezone `Asia/Kolkata`. Backend loads `./.env` from `backend/`. DB `khaao`.

---

## 1. Locked product decisions

1. **Menu tagging.** Every item has a **required diet** (`veg` | `non_veg`) and
   **optional, multiple free tags** (e.g. `juice`, `noodles`, `fried rice`,
   `sandwich`). The add/edit form shows all previously-used tags to reuse and lets
   the shopkeeper type a new one. Diet is enforced (cannot save without it).
2. **Trending** = items most-ordered **today**, computed automatically. Falls back to
   newest items before any orders exist.
3. **Shop status = Open / Pause / Close** (control lives top-right of the shop UI):
   - **Open** — normal; students can order.
   - **Pause** — shopkeeper enters a *reopen time*; students see
     "Canteen is on a break — reopens at H:MM". No new orders.
   - **Close** — shop shut for now (NOT a day reset); students see "Canteen is
     closed". No new orders.
   - Every state change **asks for confirmation**.
   - **Guard:** cannot switch to Pause or Close while any order is active
     (incoming / in_progress / awaiting_payment). Shopkeeper must complete or cancel
     them first; the API returns 409 and the UI says so.
   - While paused/closed, `POST /api/orders` is rejected.
   - On reopening, prompt the shopkeeper to review/update the menu.
   - **History is untouched by pause/close.**
4. **"Close day" button is removed.** Order numbers still reset per calendar day
   automatically (existing `OrderDate` logic). No auto stock-reset; stock is managed
   by hand in the menu. Remove the `POST /api/shop/day/close` route, its controller,
   service method, and the History UI block. (The pool/allocation engine stays.)
5. **Prep board** no longer shows "waiting in pool" anywhere. Keep the allocation
   engine as-is; just stop surfacing `pool_qty` in the UI.
6. **Ratings** — DESIGN ONLY this batch (see §6). Do not build.

---

## 2. Data model & API contract (WP1 owns all of this)

### Models
- `MenuItem` (backend/internal/models/menu_item.go): add
  - `Diet string` — `gorm:"not null;default:'veg';check:diet IN ('veg','non_veg')"`, json `diet`.
  - `Tags` — a string array, json `tags`, **always serialized as a JSON array** (`[]`
    when empty). The driver is pgx (no `lib/pq`), so use
    `gorm.io/datatypes` → `datatypes.JSONSlice[string]` (add the dep with `go get
    gorm.io/datatypes`). Never emit `null` for tags — normalize to `[]`.
- New `ShopStatus` singleton (id fixed = 1):
  - `State string` — `open|paused|closed`, default `open`.
  - `ReopenAt *time.Time` — nullable; set only for `paused`.
  - `UpdatedAt time.Time`.
  - Seed one `open` row on boot if none exists.

### Endpoints
- `GET /api/menu` (public) — each item now includes `diet`, `tags`, and
  `order_count_today` (int; sum of ordered qty today across all non-rejected orders,
  0 if none). Used for trending + filters.
- `GET /api/shop-status` (public) — `{ "state": "...", "reopen_at": "RFC3339"|null }`.
- `POST /api/shop/status` (shopkeeper) — body
  `{ "state": "open|paused|closed", "reopen_at": "RFC3339"|null }`.
  - Guard: setting `paused`/`closed` with any active order → `409 {"error":"Finish or cancel the N active order(s) first."}`.
  - Setting `open` clears `reopen_at`.
  - Broadcast live: add `Hub.NotifyShopStatusUpdate()` (in
    `internal/realtime/hub.go`, modeled on `NotifyMenuUpdate`) that `broadcastAll`s
    an event `{ "type": "shop_status" }`. Call it on every status change. **Event name
    is `shop_status`** — WP2 and WP3 handle it in their realtime components by
    refetching shop status.
- `POST /api/orders` (student) — if status != `open`, reject `409 {"error": "..."}`
  ("The canteen is closed." / "The canteen is on a break.").
- `POST /api/shop/menu`, `PUT /api/shop/menu/:id` — accept `diet` (required; 400 if
  missing/invalid) and `tags` (optional array; trim, drop blanks, de-dupe).
- `GET /api/shop/menu` — include `diet` + `tags` (form needs them; the tag-reuse
  suggestion list is derived client-side from the returned items — no new endpoint).
- `GET /api/shop/history?date=` — add an `insights` object alongside existing
  `orders` + `total_paid`:
  `{ "order_count": int, "item_counts": [{"name": str, "qty": int}],
     "customers": [{"name": str, "order_count": int}] }`
  (item_counts sorted qty desc; customers sorted order_count desc).

### Frontend contract layer (WP1 also owns)
Update `frontend/src/api/types.ts` and the typed clients so WP2/WP3 build on settled
shapes:
- `MenuItem` type gains `diet: 'veg' | 'non_veg'`, `tags: string[]`, `order_count_today: number`.
- New `ShopStatus` type + `getShopStatus()` (public) and `setShopStatus(...)` (shop) in
  `frontend/src/api/shop.ts` (or a new `shopStatus.ts`).
- `MenuItemInput` gains `diet` + `tags`.
- Shop history response type gains `insights`.
- WP1 removes the backend `day/close` route/controller/service but **leaves the
  frontend `closeDay()` client function in `api/shop.ts` untouched** (harmless dead
  code) so intermediate type-checks stay green. WP2 removes the History UI that calls
  it; the now-unused export is deleted in final cleanup.
- `frontend/src/lib/sound.ts`: ADD two exported helpers so WP2/WP3 only import them
  (no edits needed there later):
  - `playStatusChange()` — a short single "ting" for a student order state change.
  - `playOrderComplete()` — a distinct chime for the shopkeeper when an order becomes
    fully ready / awaiting payment.

---

## 3. WP1 — Backend + FE contract layer  (Agent 1, runs first, blocking)

Owns: **all** `backend/**`, and frontend `src/api/*.ts`, `src/lib/sound.ts`.
Does NOT touch any `src/pages/**` or `src/components/**` (except leaving `sound.ts`
helpers).

Scope: everything in §2. Plus:
- Prep: ensure `markPrepDone` cannot exceed outstanding demand (so no surplus pool is
  created by normal cooking); leave `pool_qty` in the API but WP2 will stop showing it.
- Add tests: shop-status guard (blocked with active orders, allowed when none), order
  creation blocked when not open, menu create requires diet, history insights math.
- Update `backend/.env.example` / `SPEC.md` only if a documented contract changed.

Self-verify before finishing: `cd backend && go build ./... && go test ./... -race`
and `cd frontend && npx tsc -b --noEmit` (types compile against the new shapes).

---

## 4. WP2 — Shopkeeper UX  (Agent 2, after WP1)

Functional-first (design can be plain, but must be clean + mobile-usable). Owns:
`src/pages/shop/*`, `src/components/Layout.tsx`, `src/components/ShopRealtime.tsx`,
`src/App.tsx` (if routes needed), and any NEW shop-only components. Do NOT edit
`src/api/*`, `src/lib/sound.ts`, `src/index.css`, `tailwind.config.js`, shared
primitives (Button/Card/etc.), or `src/pages/student/*`.

1. **Orders → two subpages with a toggle button** (segmented control in-page, no new
   nav tab needed):
   - **"New orders"**: incoming accept/reject. Reject asks *which items are
     unavailable*, marks those menu items unavailable (call `setMenuItemStock` /
     stock endpoint), then cancels/rejects. Keep existing per-item accept checkboxes.
   - **"In progress"**: accepted + awaiting-payment orders. Each order card shows item
     count and, per item, `name ×N`. **Tap an order → a medium modal overlay** for
     just that order: change item state, partial handover ("give half" / give N),
     mark ready, collect payment. Tapping outside the modal closes it.
   - **Orders that are fully ready float to the top** of "In progress" for fast handout.
   - A **notification symbol in the shop header** when a new order arrives or an order
     item completes (badge/dot; clears when viewed).
2. **Prep board redesign** (`Prep.tsx`): remove all "waiting in pool" text. Empty
   state "No items to cook right now"; when items exist, show item cards with a
   **count badge at the corner (×3)**. Tap an item → a small in-between component to
   **select the amount done** → submits (`markPrepDone`). Keep it simple.
3. **Menu management redesign** (`MenuManage.tsx`): **box/grid** of item cards. Tap a
   card to toggle available/unavailable (mark/unmark). **Edit** button below the card
   opens the form. Form now has: required **Veg / Non-veg** selector, and a **tags**
   field that shows existing tags as chips to reuse + an "add new tag" input. This is
   the item the user flagged for extra care — make add/edit genuinely pleasant on
   mobile.
4. **Open / Pause / Close control** in the shop header (top-right). Confirm on every
   change; Pause prompts for a reopen time. Uses `getShopStatus`/`setShopStatus`.
   Surface the 409 "finish/cancel active orders first" message. When status != open,
   show the shopkeeper a clear banner + a prompt to review the menu on reopen.
5. **History** (`History.tsx`): remove the "Close day" block entirely. Keep per-day
   orders; add the **insights** panel (orders count, items sold e.g. "42 Cold Coffee",
   who ordered) from the new `insights` field. Improve the date picker into a nicer
   **calendar** with light animation.
6. **Shop sound/notifications**: in `ShopRealtime.tsx`, keep the new-order alert and
   add `playOrderComplete()` when an order transitions to fully ready / awaiting
   payment. Drive the header notification symbol.

Self-verify: `cd frontend && npx tsc -b --noEmit && npm run build`.

---

## 5. WP3 — Student UX (design-critical)  (Agent 3, after WP1, parallel to WP2)

**Load the `frontend-design` skill first** and design with real care — students churn
if it looks like a template. Owns: `src/pages/student/*`, `src/components/StudentRealtime.tsx`,
`src/index.css` + `tailwind.config.js` (global tokens/animations live here), and any
NEW student-only components. Do NOT edit `src/api/*`, `src/lib/sound.ts`,
`src/components/Layout.tsx`, or `src/pages/shop/*`.

1. **Menu becomes one rich page** (`Menu.tsx`):
   - A **"Today / Trending"** section first (sorted by `order_count_today` desc,
     fallback newest).
   - Then **category sections** grouped by tag, with **filter chips** (All + each tag,
     plus a **Veg / Non-veg** filter using `diet`). A veg/non-veg indicator dot on
     each card.
   - A way to **jump between categories** (sticky chip bar / anchor scroll).
   - **Closed/Paused banner**: when `getShopStatus().state != 'open'`, show
     "Canteen is closed" or "on a break — reopens at H:MM" and disable ordering.
   - Keep the cart/checkout flow working; keep the "one active order" rule.
2. **Order status animations** (`OrderStatus.tsx`): tasteful state-transition
   animations across the lifecycle (submitted → preparing → ready → awaiting payment),
   the ready moment especially. Respect `prefers-reduced-motion`.
3. **Student notifications on every transition** (`StudentRealtime.tsx`): a toast +
   `playStatusChange()` "ting" (+ existing vibrate/Notification on ready) on each
   meaningful status change, not just "ready". Keep it from double-firing.

Student nav stays two tabs (Menu, Order) — do not restructure `Layout`/`App`.

Self-verify: `cd frontend && npx tsc -b --noEmit && npm run build`.

---

## 6. Ratings — design only (deferred)

Propose (do not build): after an order is `completed`, the student may rate each item
1–5 ★ once. New `item_rating` table (order_item_id unique, menu_item_id, user_id,
stars, created_at). Aggregate `avg_stars` + `rating_count` shown on the student menu
card and in shop menu management. Rating prompt appears on the Order status page for
recently completed orders. Endpoints: `POST /api/orders/:id/ratings`,
`GET /api/menu` includes aggregates. To be scheduled in a later batch.

---

## 7. Verification (Claude, after all WPs)

- Backend: `go build ./... && go test ./... -race`; `scripts/smoke.sh`.
- Frontend: `npx tsc -b --noEmit && npm run build`.
- Drive the real app (servers already run on :8080 / :5173): place an order as a
  student, accept/prep/handover/collect as shop, pause the shop and confirm students
  are blocked + the active-order guard fires, tag an item veg/non-veg + filter it,
  confirm trending + history insights, confirm sounds/notifications on both sides.
