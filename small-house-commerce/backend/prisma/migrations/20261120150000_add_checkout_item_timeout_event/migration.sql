-- Checkout item load timeout: the storefront fires this when the Buy Now
-- product request exceeds its 10s deadline, so the funnel can count shoppers
-- who never saw the checkout form. Additive enum value; no data change.
ALTER TYPE "AnalyticsEventName" ADD VALUE IF NOT EXISTS 'CHECKOUT_ITEM_TIMEOUT';
