-- PDP presentation controls.
--
-- 1. The selling-point pill row ("Foldable", "Narrow Space", …) can be hidden
--    site-wide and/or pinned per product. INHERIT is the default so existing
--    products keep rendering exactly as they do today.
-- 2. One optional promo banner above the product title, authored per product
--    (and settable in bulk from the products list). Additive and nullable:
--    nothing renders until an editor fills it in.

-- CreateEnum
CREATE TYPE "SellingPointsVisibility" AS ENUM ('INHERIT', 'SHOW', 'HIDE');

-- AlterTable
ALTER TABLE "products"
  ADD COLUMN "selling_points_visibility" "SellingPointsVisibility" NOT NULL DEFAULT 'INHERIT',
  ADD COLUMN "pdp_banner_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pdp_banner_text" TEXT,
  ADD COLUMN "pdp_banner_background" TEXT,
  ADD COLUMN "pdp_banner_text_color" TEXT;

-- AlterTable
ALTER TABLE "site_settings"
  ADD COLUMN "hide_selling_points" BOOLEAN NOT NULL DEFAULT false;
