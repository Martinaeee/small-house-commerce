-- Marks only the drafts an operator converted in the workbench. Shopper
-- checkouts that finish from their own draft keep their draft start clock but
-- stay false, so the orders list badges manual conversions alone.
--
-- Existing rows predate the manual conversion action, so the column default
-- classifies them correctly without touching any other fact.
ALTER TABLE "orders" ADD COLUMN "draft_converted_manually" BOOLEAN NOT NULL DEFAULT false;
