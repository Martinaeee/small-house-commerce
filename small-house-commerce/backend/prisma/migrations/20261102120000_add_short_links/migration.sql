-- Short links created from the marketing workbench. Additive: new table only.
CREATE TABLE "short_links" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "target_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "short_links_code_key" ON "short_links"("code");
CREATE UNIQUE INDEX "short_links_target_hash_key" ON "short_links"("target_hash");
