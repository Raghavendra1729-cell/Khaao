-- 000001_init_schema.down.sql
--
-- Reverses 000001_init_schema.up.sql. Tables are dropped in reverse
-- dependency order so no FK ever blocks a drop.
--
-- Deliberately NOT dropping the citext extension here: extensions are
-- shared, database-wide, idempotently-created infrastructure (CREATE
-- EXTENSION IF NOT EXISTS), not something this migration's rollback should
-- own tearing down — a down migration should undo the schema objects this
-- migration introduced, not reach into database-wide state that other
-- migrations or tools might also depend on.

DROP TABLE IF EXISTS push_subscriptions;
DROP TABLE IF EXISTS shop_statuses;
DROP TABLE IF EXISTS shopkeeper_emails;
DROP TABLE IF EXISTS item_ratings;
DROP TABLE IF EXISTS item_pool;
DROP TABLE IF EXISTS order_events;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS menu_items;
DROP TABLE IF EXISTS users;
