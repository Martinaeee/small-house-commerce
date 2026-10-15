-- CreateEnum
CREATE TYPE "OptimizerStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "optimizer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "aid" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "OptimizerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "optimizer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "optimizer_profiles_user_id_key" ON "optimizer_profiles"("user_id");
CREATE UNIQUE INDEX "optimizer_profiles_aid_key" ON "optimizer_profiles"("aid");

-- AddForeignKey
ALTER TABLE "optimizer_profiles" ADD CONSTRAINT "optimizer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
