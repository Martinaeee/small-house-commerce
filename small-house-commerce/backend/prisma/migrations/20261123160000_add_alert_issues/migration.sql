-- P2-lite alert catalogue and issue history.
-- Additive only. The engine seeds/uses three rule codes; P2 Full extends the
-- catalogue without changing the issue shape.

CREATE TYPE "AlertSeverity" AS ENUM ('P0', 'P1', 'P2');
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'CLOSED');

CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "alert_rules_code_key" ON "alert_rules"("code");

CREATE TABLE "alert_history" (
    "id" UUID NOT NULL,
    "rule_code" VARCHAR(40) NOT NULL,
    "fingerprint" VARCHAR(160) NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" VARCHAR(240) NOT NULL,
    "detail" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "snoozed_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alert_history_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "alert_history_rule_code_fingerprint_key"
    ON "alert_history"("rule_code", "fingerprint");
CREATE INDEX "alert_history_status_last_seen_at_idx"
    ON "alert_history"("status", "last_seen_at");
CREATE INDEX "alert_history_severity_status_idx"
    ON "alert_history"("severity", "status");
