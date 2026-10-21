BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "landing_page_visits"
  DROP CONSTRAINT "landing_page_visits_landing_page_id_fkey",
  ADD CONSTRAINT "landing_page_visits_landing_page_id_fkey"
    FOREIGN KEY ("landing_page_id") REFERENCES "product_landing_pages"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
