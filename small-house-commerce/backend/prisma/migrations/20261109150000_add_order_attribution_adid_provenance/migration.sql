-- Provenance for the order advertising number (adid).
--
-- `adid_source` records which rule produced the frozen number:
--   LINK                    a verified CampaignLink supplied its own number
--   META_DYNAMIC            the click carried a real Meta ad ID (dynamic AID mode)
--   META_DYNAMIC_FALLBACK   link verified but carried no number; dynamic ID used
--   LEGACY                  a pre-AID credential with a real Meta ad ID
--   NONE                    no number could be frozen
--
-- `adid_missing_reason` explains NONE without ever fabricating a value:
--   NO_TOUCH, TOKEN_INVALID, MISSING_META_AD_ID, LINK_MISMATCH,
--   MISSING_LINK, ORGANIC_TOUCH
--
-- Additive and nullable: existing orders keep NULL provenance until a new
-- order is written.

ALTER TABLE "order_attributions"
  ADD COLUMN "adid_source" VARCHAR(24),
  ADD COLUMN "adid_missing_reason" VARCHAR(48);
