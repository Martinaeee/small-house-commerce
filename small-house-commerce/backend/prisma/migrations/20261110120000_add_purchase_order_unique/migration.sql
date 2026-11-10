-- Migration 82: one first-party PURCHASE row per order.
--
-- A refreshed, re-opened or replayed success page must never add a second
-- PURCHASE row for the same order. The ingest path already skips duplicates
-- with a read-then-write check; this partial unique index is the durable
-- guarantee under concurrency.
--
-- Partial: only PURCHASE rows that carry an order number are constrained.
-- Other event names and PURCHASE rows without entity_id are unaffected.
-- Prisma cannot express a partial index in schema.prisma; the model carries a
-- comment pointing here instead. `prisma migrate deploy` applies this file.
--
-- PREREQUISITE: run backend/scripts/a2-purchase-duplicate-cleanup.sql first
-- (two approved production duplicates) or this index creation fails.

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_events_purchase_order_unique"
ON "analytics_events" ("entity_id")
WHERE "event_name" = 'PURCHASE' AND "entity_id" IS NOT NULL;
