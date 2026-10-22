-- Optional contact number for restock-alert follow-up. Additive and
-- nullable: existing rows keep working and the alert itself stays
-- email-only.
ALTER TABLE "back_in_stock_subscriptions" ADD COLUMN "phone" TEXT;
