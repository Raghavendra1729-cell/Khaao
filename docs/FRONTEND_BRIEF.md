# Khaao — Frontend Build Brief

Purpose of this document: describe exactly what each page needs to call, what
it gets back, and what to do with it. No visual/layout direction is given
here on purpose — that part is handled separately. Every endpoint below has
already been re-verified live against a running backend as of 2026-07-13
(request → response pairs shown are real, not hypothetical).

Base path for all endpoints: `/api`. All responses are JSON. All errors are
`{"error": "message"}` with a matching HTTP status.

## Auth (applies to every page)

- Send the session token as `Authorization: Bearer <token>` on every request
  except `GET /api/menu`, `GET /api/auth/config`, `POST /api/auth/firebase`.
- For the two SSE endpoints only (`GET /api/stream`, `GET /api/shop/stream`),
  the token must be passed as a query param instead — `?token=<token>` —
  because `EventSource` cannot set headers.
- `POST /api/auth/firebase` `{id_token}` → `{token, user: {id, name, email,
  role, photo_url}}`. `role` is `"student"` or `"shopkeeper"` — the backend
  decides this, not the client. Store `token`; use `user.role` to route to
  the student pages or the shopkeeper pages.
- Any `401` response means the token is invalid/expired — clear it and
  re-authenticate. Any `403` means the token is valid but the role is wrong
  for that endpoint (e.g. a student token hitting a `/shop/*` route).

---

## Student — Menu / booking page

- `GET /api/menu` → `{"items": [{id, name, price, photo_url, is_available,
  avail_from, avail_to, out_of_stock, status, orderable}]}`.
  - `price` is an integer in **paise** (₹1 = 100).
  - `orderable` is the single boolean to gate whether an item can be added to
    a cart right now — it's already computed server-side (in-stock, marked
    available, and within its time window if it has one). Don't recompute
    this client-side from the other fields.
  - `status` is one of `available | time_limited | out_of_stock |
    unavailable` — display-only, doesn't affect what you can order.
- `GET /api/orders/active` → `{"order": {...}}` or `404 {"error":"no active
  order"}`. A 404 here is the normal "nothing in progress" case, not a
  failure — treat it as "no active order," not an error state.
  - **A student can only have one active order at a time.** While
    `/orders/active` returns a real order, don't let the UI attempt to place
    a new one — `POST /api/orders` will reject it with `409` anyway
    (`"you already have an active order"`), but the cart/checkout should
    reflect this before the request is even made.
- `POST /api/orders` `{"items":[{"menu_item_id": number, "qty": number}]}` →
  `201 {"order": {...}}`.
  - `qty` must be 1–20 per line. Max 30 lines. Each `menu_item_id` may only
    appear once (send one line with the combined qty, not two lines for the
    same item).
  - Errors to handle: `400` (bad qty/duplicate item/empty cart), `409`
    (already has an active order), `422` (an item in the cart is no longer
    orderable — e.g. went out of stock between browsing and checkout; the
    message names which item).
- Order object shape (returned by active/create/history/all order actions):
  ```
  {
    id, order_no, order_date, status, total_price, paid,
    created_at, ready_at, expires_at,
    items: [{ id, menu_item_id, name, photo_url, qty, allocated_qty, handed_qty, status, price_each }]
  }
  ```
  - `order_no` is the **daily token number** shown to the student — always
    use this, never `id`, anywhere user-facing.
  - `photo_url` is copied from the menu item at the moment the order was
    placed (same denormalization as `name`/`price_each`) — it reflects
    what the photo was *then*, not necessarily the menu item's current
    photo (which may have since changed or the item been deleted). Render
    a thumbnail next to each item wherever an order's items are listed
    (active order, history, the shopkeeper's order board) whenever it's
    non-empty; there's nothing to show otherwise, don't render a broken
    image or a placeholder box.
  - `status` is one of: `submitted → preparing → partially_ready → ready →
    awaiting_payment → completed`, or a terminal branch `rejected /
    cancelled / expired`.
  - Per-item `status`: `pending → queued → allocated → handed_over`, or
    `rejected`. An item's `qty`/`allocated_qty`/`handed_qty` tell you exactly
    how much of that line is ready vs. already picked up — e.g. `qty:3,
    allocated_qty:2, handed_qty:1` means 2 of 3 are cooked, 1 of those 2 has
    been physically handed over.
  - `ready_at`/`expires_at` are only set once `status` first becomes `ready`.
    `expires_at` is when the hold window (`HOLD_MINUTES`, default 15) runs
    out — after that the order auto-expires and returns any unhanded units to
    the pool (this happens server-side on a timer; the frontend just needs to
    poll/refetch or listen for the SSE `order_update` event to see it flip to
    `expired`).

## Student — Order status / history page

- Same `GET /api/orders/active` as above for the live order.
- `POST /api/orders/:id/cancel` → `{"order": {...}}`, only valid while
  `status === "submitted"` (before the shopkeeper has accepted it). `409` if
  already accepted — the message says so, surface it directly.
- `GET /api/orders` → `{"orders": [...]}`, all of this student's past
  (terminal) orders, newest first. A cancelled/rejected order will always
  show `total_price: 0` — that's correct, not a display bug: nothing was
  ever owed on those.

## Real-time (student)

- `GET /api/stream` (SSE, token as query param). Messages:
  - `{"type": "order_update", "order": {...}}` — the student's own active
    order changed state. Replace whatever order data you're holding with
    this payload directly; no need to refetch `/orders/active` separately.
  - `{"type": "menu_update"}` — the menu changed (stock/availability/CRUD).
    Refetch `GET /api/menu`.
- If the connection errors repeatedly (the existing reconnect/backoff
  handling already covers this), treat it the same as a `401`: force
  re-login.

---

## Shopkeeper — Page 1: Orders (incoming, checklist, payment — one page)

This is the single page that covers everything you described as "accept or
reject, then a checklist, then paid or not" — it's all backed by one
endpoint for reads and four endpoints for actions. There is intentionally no
cooking action on this page (that's Page 2).

- `GET /api/shop/orders` → `{"incoming": [...], "in_progress": [...],
  "awaiting_payment": [...]}`. Three buckets, already split for you server
  side — don't re-derive them from a flat list:
  - `incoming` — status `submitted`. Not yet acted on.
  - `in_progress` — status `preparing` or `partially_ready` or `ready`. This
    is the "checklist" bucket: for each item, `allocated_qty - handed_qty`
    tells you how many units of that line are ready to hand over right now.
  - `awaiting_payment` — every item fully handed over; only "mark paid" is
    left.
  - Every order in every bucket includes `student_name` / `student_email`
    (shopkeeper-only fields, absent on the student's own view of the order).
  - **A `completed` order never appears here** — the instant it's marked
    paid it disappears from all three buckets (see Page 4).

### Accept / reject an incoming order

- `POST /api/shop/orders/:id/accept` `{"rejected_item_ids": [number, ...]}` →
  `{"order": {...}}`.
  - Pass an **empty array** (or omit the body entirely) to accept every item
    as-is — this is your "select none [as unable]" case.
  - Pass **some** item ids to trim just those lines — the order still gets
    accepted (`status` becomes `preparing`), those specific items become
    `status: "rejected"` and drop out of `total_price`, and every other item
    proceeds normally.
  - Pass **every** item id on the order → the whole order becomes
    `status: "rejected"` and `total_price: 0` — same end state as a plain
    reject, just reached by trimming everything instead. (Verified: total
    correctly zeroes in this case too.)
  - Only valid while the order is `status: "submitted"`. `409` otherwise
    (e.g. two shopkeepers both tap Accept on the same order — the second one
    correctly gets a 409, not a crash or a double-accept).
- `POST /api/shop/orders/:id/reject` (no body) → `{"order": {...}}`. Rejects
  the whole order outright without asking which items — use this for a
  simple "reject everything" action if you want it as a separate button from
  Accept-with-trim, though functionally Accept-with-all-items-trimmed does
  the same thing.

### Checklist: hand items to the student

- `POST /api/shop/orders/:id/items/:itemID/handover` `{"qty": number}` →
  `{"order": {...}}`.
  - `qty` must be ≥ 1 (a `qty: 0` or negative request is rejected with `400`
    now — it used to silently no-op as `qty: 1`, that's fixed). Omit the body
    entirely to hand over exactly 1 (that default still works).
  - `qty` cannot exceed what's currently ready-but-unhanded for that item
    (`allocated_qty - handed_qty`) — `409` if you try.
  - Once every non-rejected item on the order is fully handed, the order's
    `status` automatically flips to `awaiting_payment` in the same response
    — no separate call needed to trigger that transition.
- `DELETE /api/shop/orders/:id/items/:itemID` (no body) → `{"order": {...}}`
  — removes a line from an already-accepted order (e.g. it turns out to be
  unavailable). Only allowed if the student hasn't started collecting that
  item yet (`409` if `handed_qty > 0`). Any already-cooked-but-unhanded units
  for that item go back into the shared prep pool and get automatically
  reassigned (FCFS) to the next order still waiting on that same dish.

### Mark paid

- `POST /api/shop/orders/:id/paid` (no body) → `{"order": {...}}`. Only
  valid once `status === "awaiting_payment"` (`409` otherwise — e.g. trying
  to collect payment before every item is handed over). On success,
  `status` becomes `completed`, `paid` becomes `true`, and the order
  immediately stops appearing in `GET /api/shop/orders`.

---

## Shopkeeper — Page 2: Prep (the cook's screen)

This is the aggregate "how many of each dish are left to cook" screen you
described — one row per menu item, a quantity you select, then a single
confirm action.

- `GET /api/shop/prep` → `{"items": [{menu_item_id, name, remaining_qty,
  pool_qty}]}`.
  - `remaining_qty` — how many units of this dish are still needed across
    every currently-accepted order (this is the number to show as "left to
    cook").
  - `pool_qty` — units already marked done but not yet claimed by any
    waiting order (sitting ready for the next order that needs this dish).
  - This list is aggregated across **all** accepted orders — it has no
    concept of "which order" a unit belongs to; that matching happens
    automatically server-side (oldest waiting order first) the moment you
    confirm.
- `POST /api/shop/prep/:menu_item_id/done` `{"qty": number}` → `{"ok": true}`.
  - **This is a single call for the whole confirmed quantity** — if the
    shopkeeper dials the stepper up to 5 and hits confirm once, send
    `{"qty": 5}` in one request. Don't call this endpoint once per unit; it
    already handles a batch in one shot (verified: one call with `qty: 5`
    correctly allocates all 5 across however many waiting orders need them,
    same as 5 separate calls of `qty: 1` would).
  - `qty` must be ≥ 1 (`0`/negative is a `400`) and is now also capped at
    that item's current `remaining_qty` — the backend rejects `qty >
    remaining_qty` with `409 {"error": "only N more <item> needed right
    now"}` (or, if `remaining_qty` is 0, `"<item> isn't needed right now —
    no accepted order is waiting on it"`). A shopkeeper cooks to the orders
    actually on hand, not speculatively ahead of demand — enforced
    server-side so a direct API call can't bypass it either. Build the qty
    selector's max as `remaining_qty`, and don't render an actionable
    "done" control at all for a row where `remaining_qty` is 0 (still show
    the row if `pool_qty > 0`, just without the action — that's informing
    the shopkeeper of leftover unclaimed stock, not inviting more of it).
  - After this call, refetch (or wait for the SSE `prep_update` /
    `orders_update` events) — both the Prep list and the Page 1 checklist
    bucket will reflect the new `allocated_qty` immediately.

## Real-time (shopkeeper, both Page 1 and Page 2)

- `GET /api/shop/stream` (SSE, token as query param). Messages:
  - `{"type": "orders_update"}` — refetch `GET /api/shop/orders` (Page 1)
    and, if you keep a running total, `GET /api/shop/history` too.
  - `{"type": "prep_update"}` — refetch `GET /api/shop/prep` (Page 2).
  - `{"type": "menu_update"}` — refetch menu data (Page 3).
  - These are invalidation signals only — the message carries no payload
    beyond the type, always refetch the relevant endpoint on receipt.

---

## Shopkeeper — Page 3: Menu management

- `GET /api/shop/menu` → `{"items": [...]}` — same item shape as the public
  `/api/menu`, but includes unavailable/out-of-stock items too.
- `POST /api/shop/menu` `{"name", "price", "photo_url"?, "avail_from"?,
  "avail_to"?, "is_available"?}` → `201 {"item": {...}}`.
  - `price` in paise, must be > 0.
  - `avail_from`/`avail_to` are `"HH:MM"` 24h strings — set both or neither.
    An overnight window (e.g. `"22:00"`/`"06:00"`) is valid and wraps past
    midnight correctly — no special client-side handling needed.
  - `photo_url` must be `http://` or `https://` if provided.
  - `name` max 100 characters.
- `PUT /api/shop/menu/:id` — same body shape, full replace.
- `DELETE /api/shop/menu/:id` → `204` on success, `409` if the item is
  referenced by any currently-active (non-terminal) order — the message
  explains why; don't allow silent deletion in that case, surface the error.
- `POST /api/shop/menu/:id/stock` `{"out_of_stock": boolean}` → `{"item":
  {...}}` — the one-tap in/out-of-stock toggle, separate from full edit.

## Shopkeeper — Page 4: History

- `GET /api/shop/history?date=YYYY-MM-DD` (date optional, defaults to
  today in the business timezone) → `{"orders": [...], "total_paid":
  number}`.
  - `orders` — every order that reached a terminal state (`completed`,
    `rejected`, `cancelled`, or `expired`) **on that calendar date**,
    regardless of when it was created (grouped by `order_date`, which is
    the day the order was placed, in the business timezone).
  - `total_paid` — sum of `total_price` across only the orders where `paid
    === true`. Rejected/cancelled/expired orders always show
    `total_price: 0` and never contribute here.
  - When picking a default date client-side (e.g. for a date picker
    default), use the browser's **local** calendar date, not UTC
    (`toISOString()` is wrong here — it can show yesterday's date during
    the small hours). This already came up once and was fixed; flagging so
    it isn't reintroduced if this page is rebuilt from scratch.

## Shopkeeper — Close day (end-of-day, no dedicated page assumed)

- `POST /api/shop/day/close` (no body) → `{"ok": true}`. Expires every
  still-open order (regardless of how far along it is — this is an
  unconditional hard stop, unlike the automatic 15-minute expiry which
  protects any order with something already handed over), zeroes the entire
  prep pool, and resets every menu item's stock flag to available. No
  confirmation/idempotency at the API level — if you build a button for
  this, gate it with a real confirmation step client-side, since there's no
  undo.
