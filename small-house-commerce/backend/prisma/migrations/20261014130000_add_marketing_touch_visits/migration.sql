BEGIN;

ALTER TABLE "landing_page_visits" ADD COLUMN "visit_day" DATE;
UPDATE "landing_page_visits" SET "visit_day" = ("created_at" AT TIME ZONE 'Asia/Manila')::date;
ALTER TABLE "landing_page_visits" ALTER COLUMN "visit_day" SET NOT NULL;
ALTER TABLE "landing_page_visits" ALTER COLUMN "visit_day" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date;
DROP INDEX "landing_page_visits_landing_page_id_visit_key_key";
CREATE UNIQUE INDEX "landing_page_visits_landing_page_id_visit_key_visit_day_key" ON "landing_page_visits"("landing_page_id", "visit_key", "visit_day");

CREATE TABLE "campaign_link_visits" (
    "id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "visit_key" TEXT NOT NULL,
    "visit_day" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campaign_link_visits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "campaign_link_visits_link_id_visit_day_idx" ON "campaign_link_visits"("link_id", "visit_day");
CREATE UNIQUE INDEX "campaign_link_visits_link_id_visit_key_visit_day_key" ON "campaign_link_visits"("link_id", "visit_key", "visit_day");
ALTER TABLE "campaign_link_visits" ADD CONSTRAINT "campaign_link_visits_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "campaign_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
