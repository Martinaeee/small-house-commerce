-- Client-generated checkout idempotency keys. Additive and backward
-- compatible: existing rows and admin/manual orders stay NULL, and Postgres
-- unique indexes allow multiple NULL values.
--
-- Prisma 7.10.0 does not wrap migration SQL in a transaction (verified with
-- a failing two-statement probe), so both statements are re-runnable: a
-- failure after the columns were added must not block a retry.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "idempotency_hash" VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS "orders_idempotency_key_key" ON "orders"("idempotency_key");
