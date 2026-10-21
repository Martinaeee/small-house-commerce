SET lock_timeout = '5s';

-- Out-of-the-box subscribe offer. The storefront only ever shows offer copy
-- while a promotion is actually live (`newsletterOfferAvailable`), so a default
-- promise has to be a real, redeemable promotion — not copy alone.
--
-- A database that has never had a promotion gets the default ₱59 first-order
-- discount; an install that already runs its own campaign is left untouched.
-- "At most one ACTIVE promotion" (newsletter_promotions_single_active) is
-- preserved: this insert only runs when the table is empty.
INSERT INTO "newsletter_promotions" (
    "id",
    "code",
    "discount_type",
    "discount_value",
    "min_spend",
    "max_uses",
    "per_customer_limit",
    "valid_from",
    "valid_until",
    "status",
    "created_at",
    "updated_at"
)
SELECT
    '00000000-0000-7000-8000-000000000059',
    'WELCOME59',
    'FIXED',
    59,
    0,
    NULL,
    1,
    NULL,
    NULL,
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "newsletter_promotions");

-- Matching default copy for the same fresh install. An operator's own copy is
-- never overwritten: the update only touches a row whose offer copy is empty.
UPDATE "site_settings"
SET "newsletter_offer_title" = 'Subscribe and get ₱59 off your first order',
    "newsletter_offer_body" = 'Join the LUWAG list for small-space ideas and take ₱59 off your first order.',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = '00000000-0000-0000-0000-000000000001'
  AND "newsletter_offer_title" = ''
  AND "newsletter_offer_body" = '';
