-- AlterTable
-- Gallery entries may be videos too; reuse the DetailBlockType enum
-- (IMAGE | VIDEO). Default IMAGE keeps every existing row a photo.
ALTER TABLE "product_images" ADD COLUMN     "type" "DetailBlockType" NOT NULL DEFAULT 'IMAGE';
