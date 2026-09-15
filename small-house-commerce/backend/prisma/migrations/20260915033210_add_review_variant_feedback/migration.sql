-- AlterTable
ALTER TABLE "product_reviews" ADD COLUMN     "variant" TEXT;

-- CreateTable
CREATE TABLE "review_helpful_votes" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "visitor_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_helpful_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "reason" TEXT,
    "visitor_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_helpful_votes_review_id_visitor_hash_key" ON "review_helpful_votes"("review_id", "visitor_hash");

-- CreateIndex
CREATE INDEX "review_reports_review_id_idx" ON "review_reports"("review_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_review_id_visitor_hash_key" ON "review_reports"("review_id", "visitor_hash");

-- AddForeignKey
ALTER TABLE "review_helpful_votes" ADD CONSTRAINT "review_helpful_votes_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "product_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "product_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
