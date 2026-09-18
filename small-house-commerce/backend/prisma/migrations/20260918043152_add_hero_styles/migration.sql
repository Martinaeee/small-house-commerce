-- CreateEnum
CREATE TYPE "HeroOwnerType" AS ENUM ('CATEGORY', 'COLLECTION');

-- CreateEnum
CREATE TYPE "HeroBackgroundType" AS ENUM ('SOLID', 'IMAGE');

-- CreateTable
CREATE TABLE "hero_styles" (
    "id" UUID NOT NULL,
    "owner_type" "HeroOwnerType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "title_override" TEXT,
    "title_color" TEXT,
    "title_size" INTEGER,
    "title_font" TEXT,
    "background_type" "HeroBackgroundType" NOT NULL DEFAULT 'SOLID',
    "background_color" TEXT,
    "background_image_url" TEXT,
    "background_blur" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hero_styles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hero_styles_owner_type_owner_id_key" ON "hero_styles"("owner_type", "owner_id");
