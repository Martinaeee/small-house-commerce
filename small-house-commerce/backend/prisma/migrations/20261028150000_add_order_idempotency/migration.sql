-- Client-generated checkout idempotency keys. Additive and backward
-- compatible: existing rows and admin/manual orders stay NULL, and Postgres
-- unique indexes allow multiple NULL values.
ALTER TABLE "orders"
  ADD COLUMN "idempotency_key" VARCHAR(120),
  ADD COLUMN "idempotency_hash" VARCHAR(64);

CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");
