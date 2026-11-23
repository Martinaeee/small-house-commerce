-- P1.5: synthetic probe evidence for Storefront Health availability.
-- Additive only; no existing table is touched. The probe worker writes PROD
-- rows and the external node (later) writes EXTERNAL rows through the same
-- contract.

CREATE TYPE "ProbeEnvironment" AS ENUM ('PROD', 'EXTERNAL');
CREATE TYPE "ProbeCheck" AS ENUM ('PASS', 'FAIL', 'UNKNOWN');
CREATE TYPE "ProbeStatus" AS ENUM ('OPERATIONAL', 'DEGRADED', 'DOWN', 'UNKNOWN');

CREATE TABLE "synthetic_probe_runs" (
    "id" UUID NOT NULL,
    "run_id" VARCHAR(64) NOT NULL,
    "environment" "ProbeEnvironment" NOT NULL,
    "route_key" VARCHAR(40) NOT NULL,
    "route_path" VARCHAR(512) NOT NULL,
    "status" "ProbeStatus" NOT NULL,
    "dns" "ProbeCheck" NOT NULL,
    "tls" "ProbeCheck" NOT NULL,
    "http" "ProbeCheck" NOT NULL,
    "http_status" INTEGER,
    "latency_ms" INTEGER,
    "dom" "ProbeCheck" NOT NULL,
    "error_code" VARCHAR(120),
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "synthetic_probe_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "synthetic_probe_runs_environment_route_key_run_id_key"
    ON "synthetic_probe_runs"("environment", "route_key", "run_id");
CREATE INDEX "synthetic_probe_runs_route_key_checked_at_idx"
    ON "synthetic_probe_runs"("route_key", "checked_at");
CREATE INDEX "synthetic_probe_runs_checked_at_idx"
    ON "synthetic_probe_runs"("checked_at");
