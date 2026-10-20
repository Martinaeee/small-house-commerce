-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('PENDING', 'CONVERTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "product_questions" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "asker_name" TEXT,
    "asker_email" TEXT,
    "status" "QuestionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_questions_product_id_status_created_at_idx" ON "product_questions"("product_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "product_questions_status_created_at_idx" ON "product_questions"("status", "created_at");

-- AddForeignKey
ALTER TABLE "product_questions" ADD CONSTRAINT "product_questions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
