BEGIN;

CREATE TYPE "AdCostAuditAction" AS ENUM ('CREATE', 'UPDATE', 'VOID');

CREATE TABLE "cost_entries" (
    "id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "cost_date" DATE NOT NULL,
    "cost_type" TEXT NOT NULL DEFAULT 'ADS_COST',
    "entry_source" TEXT NOT NULL DEFAULT 'MANUAL',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount_usd" DECIMAL(12,2) NOT NULL,
    "php_per_usd" DECIMAL(12,6),
    "amount_php" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cost_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ad_cost_audit" (
    "id" UUID NOT NULL,
    "cost_entry_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" "AdCostAuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ad_cost_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cost_entries_owner_user_id_cost_date_idx" ON "cost_entries"("owner_user_id", "cost_date");
CREATE UNIQUE INDEX "cost_entries_link_id_cost_date_key" ON "cost_entries"("link_id", "cost_date");
CREATE INDEX "ad_cost_audit_cost_entry_id_created_at_idx" ON "ad_cost_audit"("cost_entry_id", "created_at");

ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "campaign_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ad_cost_audit" ADD CONSTRAINT "ad_cost_audit_cost_entry_id_fkey" FOREIGN KEY ("cost_entry_id") REFERENCES "cost_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ad_cost_audit" ADD CONSTRAINT "ad_cost_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
