-- 000001_init_schema.up.sql
--
-- Baseline schema for Khaao. This is a from-scratch baseline (no prior
-- production data exists yet — see STATUS.md § Deployment), so it CREATEs
-- everything directly rather than reconciling an AutoMigrate-created schema.
--
-- Source of truth used to write this: backend/internal/models/*.go (GORM
-- struct tags) as of the WP4 migrations work, cross-checked against actual
-- GORM/gorm.io/driver/postgres type-mapping behavior (e.g. Go `int`/`uint`
-- fields map to BIGINT/BIGSERIAL, not INTEGER/SERIAL, because gorm sizes
-- them from reflect.Kind bit-width, which is 64 for plain int/uint on
-- amd64/arm64 — verified by reading gorm's schema/field.go and the postgres
-- driver's DataTypeOf directly, not assumed).
--
-- Column nullability follows the models exactly: a column is NOT NULL only
-- where the corresponding Go struct field carries an explicit gorm:"not
-- null" tag. Where a model has no such tag (e.g. menu_items.created_at,
-- push_subscriptions.user_id/endpoint/p256dh/auth), the column is left
-- nullable here too, even though in practice application code always
-- populates it — that's a pre-existing property of the current schema, not
-- something this migration should silently tighten.
--
-- Foreign keys are a genuinely new addition (GORM's AutoMigrate only creates
-- FK constraints where a Go-level association struct field exists, which is
-- inconsistent in this codebase — e.g. order_events.order_id had no
-- associated Go relation and so likely had no FK at all). ON DELETE choices
-- below are a deliberate design decision, not a mechanical translation:
--
--   * orders.user_id            -> users(id)        ON DELETE RESTRICT
--   * item_ratings.user_id      -> users(id)        ON DELETE RESTRICT
--   * item_ratings.menu_item_id -> menu_items(id)    ON DELETE RESTRICT
--   * order_items.menu_item_id  -> menu_items(id)    ON DELETE RESTRICT
--       Restrict deletion of a "parent of record" (a user or a menu item)
--       while durable business/history rows still reference it — orders,
--       ratings, and order line items are the closest thing this app has to
--       financial/audit history, and should never silently disappear or get
--       orphaned just because someone hard-deletes a user or a menu item.
--       (In practice menu items are soft-deleted via deleted_at and users
--       are never deleted by any code path today, so this is a safety net,
--       not something that fires routinely.)
--
--   * order_items.order_id      -> orders(id)        ON DELETE CASCADE
--   * order_events.order_id     -> orders(id)        ON DELETE CASCADE
--   * item_ratings.order_item_id -> order_items(id)   ON DELETE CASCADE
--       These are child rows that only make sense as part of their parent
--       order aggregate (line items, the audit event log, and a rating of
--       a specific line item). If an order is ever hard-deleted, its whole
--       subtree should go with it rather than leaving orphans. Deleting an
--       order this way already cascades ratings two levels down via
--       order_items, which is intentional.
--
--   * item_pool.menu_item_id    -> menu_items(id)     ON DELETE CASCADE
--   * push_subscriptions.user_id -> users(id)         ON DELETE CASCADE
--       Pure derived/operational state (the live prep-pool counter for a
--       menu item; a device's push registration) that has no independent
--       meaning once its owner is gone — already precedent for hard-deleting
--       push_subscriptions rows in application code (dead-subscription
--       cleanup), so CASCADE here just matches that existing intent.
--
-- One index (idx_order_items_menu_item_id) is added beyond anything any
-- GORM struct tag asks for: order_items.menu_item_id had no index tag, but
-- it's now the child side of an ON DELETE RESTRICT foreign key, and Postgres
-- does not auto-index FK columns — without an index, every menu_item delete
-- (and every FK-driven existence check against it) forces a sequential scan
-- of order_items. Everything else below is a literal translation of a GORM
-- tag; this is the one deliberate addition.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id           BIGSERIAL PRIMARY KEY,
    firebase_uid TEXT NOT NULL,
    email        CITEXT NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    photo_url    TEXT NOT NULL DEFAULT '',
    role         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_users_role CHECK (role IN ('student', 'shopkeeper'))
);

CREATE UNIQUE INDEX idx_users_firebase_uid ON users (firebase_uid);
CREATE UNIQUE INDEX idx_users_email ON users (email);

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------
CREATE TABLE menu_items (
    id           BIGSERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    price        BIGINT NOT NULL,
    photo_url    TEXT,
    diet         TEXT NOT NULL DEFAULT 'veg',
    tags         JSONB,
    is_available BOOLEAN NOT NULL DEFAULT true,
    avail_from   TEXT,
    avail_to     TEXT,
    out_of_stock BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ,
    deleted_at   TIMESTAMPTZ,
    CONSTRAINT chk_menu_items_price CHECK (price >= 0),
    CONSTRAINT chk_menu_items_diet CHECK (diet IN ('veg', 'non_veg'))
);

CREATE INDEX idx_menu_items_deleted_at ON menu_items (deleted_at);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
    id          BIGSERIAL PRIMARY KEY,
    order_no    BIGINT NOT NULL,
    order_date  DATE NOT NULL,
    user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    status      TEXT NOT NULL,
    total_price BIGINT NOT NULL DEFAULT 0,
    paid        BOOLEAN NOT NULL DEFAULT false,
    paid_at     TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    ready_at    TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_orders_total_price CHECK (total_price >= 0),
    CONSTRAINT chk_orders_status CHECK (status IN (
        'submitted', 'preparing', 'partially_ready', 'ready',
        'awaiting_payment', 'completed', 'rejected', 'cancelled', 'expired'
    ))
);

-- One order number per business day (order_date), and a plain index on
-- order_date alone for date-range history queries.
CREATE UNIQUE INDEX idx_orders_date_no ON orders (order_date, order_no);
CREATE INDEX idx_orders_order_date ON orders (order_date);
-- A student's orders sorted newest-first.
CREATE INDEX idx_user_created ON orders (user_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders (status);

-- One active (non-terminal) order per student, enforced at the DB level —
-- the app also enforces this in code, but this partial unique index is the
-- authoritative backstop against a race producing two concurrent active
-- orders for the same student.
CREATE UNIQUE INDEX uniq_active_order_per_user
    ON orders (user_id)
    WHERE status IN ('submitted', 'preparing', 'partially_ready', 'ready', 'awaiting_payment');

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
CREATE TABLE order_items (
    id            BIGSERIAL PRIMARY KEY,
    order_id      BIGINT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    menu_item_id  BIGINT NOT NULL REFERENCES menu_items (id) ON DELETE RESTRICT,
    name          TEXT NOT NULL,
    photo_url     TEXT,
    price_each    BIGINT NOT NULL,
    qty           BIGINT NOT NULL,
    allocated_qty BIGINT NOT NULL DEFAULT 0,
    handed_qty    BIGINT NOT NULL DEFAULT 0,
    status        TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_order_items_price_each CHECK (price_each >= 0),
    CONSTRAINT chk_order_items_qty CHECK (qty > 0 AND qty <= 20),
    CONSTRAINT chk_order_items_allocated_qty CHECK (allocated_qty >= 0 AND allocated_qty <= qty),
    CONSTRAINT chk_order_items_handed_qty CHECK (handed_qty >= 0 AND handed_qty <= allocated_qty),
    CONSTRAINT chk_order_items_status CHECK (status IN (
        'pending', 'queued', 'allocated', 'handed_over', 'rejected'
    ))
);

CREATE INDEX idx_order_items_order_id ON order_items (order_id);
-- Not a literal GORM tag translation — added because menu_item_id is now the
-- child side of an ON DELETE RESTRICT FK; see file header note.
CREATE INDEX idx_order_items_menu_item_id ON order_items (menu_item_id);

-- ---------------------------------------------------------------------------
-- order_events
-- ---------------------------------------------------------------------------
CREATE TABLE order_events (
    id         BIGSERIAL PRIMARY KEY,
    order_id   BIGINT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    payload    JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_events_order_id ON order_events (order_id);

-- ---------------------------------------------------------------------------
-- item_pool (singular table name — models.ItemPool overrides TableName())
-- ---------------------------------------------------------------------------
CREATE TABLE item_pool (
    menu_item_id BIGINT PRIMARY KEY REFERENCES menu_items (id) ON DELETE CASCADE,
    qty          BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_item_pool_qty CHECK (qty >= 0)
);

-- ---------------------------------------------------------------------------
-- item_ratings
-- ---------------------------------------------------------------------------
CREATE TABLE item_ratings (
    id            BIGSERIAL PRIMARY KEY,
    order_item_id BIGINT NOT NULL REFERENCES order_items (id) ON DELETE CASCADE,
    menu_item_id  BIGINT NOT NULL REFERENCES menu_items (id) ON DELETE RESTRICT,
    user_id       BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    stars         BIGINT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_item_ratings_stars CHECK (stars >= 1 AND stars <= 5)
);

CREATE UNIQUE INDEX idx_item_ratings_order_item_id ON item_ratings (order_item_id);
CREATE INDEX idx_item_ratings_menu_item_id ON item_ratings (menu_item_id);
CREATE INDEX idx_item_ratings_user_id ON item_ratings (user_id);

-- ---------------------------------------------------------------------------
-- shopkeeper_emails
-- ---------------------------------------------------------------------------
CREATE TABLE shopkeeper_emails (
    email      CITEXT PRIMARY KEY,
    note       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- shop_statuses (models.ShopStatus — a singleton row, id fixed at 1 by app code)
-- ---------------------------------------------------------------------------
CREATE TABLE shop_statuses (
    id         BIGSERIAL PRIMARY KEY,
    state      TEXT NOT NULL DEFAULT 'open',
    reopen_at  TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    CONSTRAINT chk_shop_statuses_state CHECK (state IN ('open', 'paused', 'closed'))
);

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE push_subscriptions (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT REFERENCES users (id) ON DELETE CASCADE,
    endpoint   TEXT,
    p256dh     TEXT,
    auth       TEXT,
    created_at TIMESTAMPTZ
);

CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions (user_id);
CREATE UNIQUE INDEX idx_push_subscriptions_endpoint ON push_subscriptions (endpoint);
