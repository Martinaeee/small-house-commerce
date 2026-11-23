-- Carousel groups: consecutive detail blocks sharing a non-null group_key
-- render as one swipeable module on the PDP. Additive and nullable, so every
-- existing shared/scoped block keeps its current single-image rendering.
ALTER TABLE "product_detail_blocks" ADD COLUMN "group_key" TEXT;
