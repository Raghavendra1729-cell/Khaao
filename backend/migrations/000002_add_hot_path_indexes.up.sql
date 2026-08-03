-- The expiry worker runs every 15 seconds and only needs ready orders whose
-- collection deadline has passed. The existing status-only index still makes
-- Postgres inspect every ready order before applying expires_at; this partial
-- index keeps that recurring work bounded as order history grows.
CREATE INDEX IF NOT EXISTS idx_orders_ready_expiry
    ON orders (expires_at)
    WHERE status = 'ready';
