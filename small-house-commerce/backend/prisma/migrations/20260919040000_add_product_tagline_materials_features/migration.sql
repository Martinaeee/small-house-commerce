-- AlterTable
-- Product first-screen subtitle + structured specifications (all nullable,
-- additive-only: no backfill, no default, existing rows untouched).
ALTER TABLE "products" ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "materials" TEXT,
ADD COLUMN     "features" TEXT;
