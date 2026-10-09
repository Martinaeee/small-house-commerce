-- CreateEnum
CREATE TYPE "FaqMode" AS ENUM ('SHARED', 'EXTEND', 'CUSTOM');

-- CreateTable
CREATE TABLE "shared_faq_sets" (
    "id" UUID NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "shared_faq_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_faqs" (
    "product_id" UUID NOT NULL,
    "mode" "FaqMode" NOT NULL DEFAULT 'SHARED',
    "items" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_faqs_pkey" PRIMARY KEY ("product_id")
);

-- AddForeignKey
ALTER TABLE "product_faqs" ADD CONSTRAINT "product_faqs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
