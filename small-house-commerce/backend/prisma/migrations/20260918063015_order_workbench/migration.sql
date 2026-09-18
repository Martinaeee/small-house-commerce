-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "assigned_at" TIMESTAMPTZ(3),
ADD COLUMN     "assigned_by" UUID,
ADD COLUMN     "assigned_to_id" UUID;

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "operator_id" UUID,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_risk_logs" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "risk_type" TEXT NOT NULL,
    "previous_order_id" UUID,
    "reason" TEXT,
    "operator_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_risk_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_notes" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID,
    "note_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_risk_flags" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "flag_type" TEXT NOT NULL,
    "reason" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "order_risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_merge_records" (
    "id" UUID NOT NULL,
    "primary_order_id" UUID NOT NULL,
    "merged_order_id" UUID NOT NULL,
    "operator_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_merge_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_notes_customer_id_idx" ON "customer_notes"("customer_id");

-- CreateIndex
CREATE INDEX "customer_risk_logs_customer_id_idx" ON "customer_risk_logs"("customer_id");

-- CreateIndex
CREATE INDEX "order_notes_order_id_idx" ON "order_notes"("order_id");

-- CreateIndex
CREATE INDEX "order_risk_flags_order_id_idx" ON "order_risk_flags"("order_id");

-- CreateIndex
CREATE INDEX "order_risk_flags_flag_type_resolved_idx" ON "order_risk_flags"("flag_type", "resolved");

-- CreateIndex
CREATE INDEX "order_merge_records_primary_order_id_idx" ON "order_merge_records"("primary_order_id");

-- CreateIndex
CREATE INDEX "orders_assigned_to_id_idx" ON "orders"("assigned_to_id");

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_risk_logs" ADD CONSTRAINT "customer_risk_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_risk_flags" ADD CONSTRAINT "order_risk_flags_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_merge_records" ADD CONSTRAINT "order_merge_records_primary_order_id_fkey" FOREIGN KEY ("primary_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_merge_records" ADD CONSTRAINT "order_merge_records_merged_order_id_fkey" FOREIGN KEY ("merged_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
