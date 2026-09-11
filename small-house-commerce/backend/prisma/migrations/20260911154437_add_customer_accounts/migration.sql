-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_refresh_tokens" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_email_key" ON "customer_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_customer_id_key" ON "customer_accounts"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_refresh_tokens_token_hash_key" ON "customer_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "customer_refresh_tokens_account_id_idx" ON "customer_refresh_tokens"("account_id");

-- CreateIndex
CREATE INDEX "customer_refresh_tokens_expires_at_idx" ON "customer_refresh_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_refresh_tokens" ADD CONSTRAINT "customer_refresh_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
