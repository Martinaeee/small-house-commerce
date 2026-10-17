BEGIN;

CREATE UNIQUE INDEX "products_active_slug_key"
ON "products" ("slug")
WHERE "status" = 'ACTIVE';

DROP INDEX "products_slug_key";

COMMIT;
