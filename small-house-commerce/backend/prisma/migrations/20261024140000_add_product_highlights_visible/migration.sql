-- Whole-block visibility for the PDP "Why You’ll Love It" list.
--
-- Defaults to true so every existing product keeps rendering the block; the
-- admin form can switch it off without touching the stored bullets.

-- AlterTable
ALTER TABLE "products"
  ADD COLUMN "highlights_visible" BOOLEAN NOT NULL DEFAULT true;
