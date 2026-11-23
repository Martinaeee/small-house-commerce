-- P1.5: external node heartbeat, kept separate from storefront probe results.
-- A missing heartbeat means the node is offline; it must never be converted
-- into a storefront DOWN.

CREATE TABLE "probe_node_heartbeats" (
    "id" UUID NOT NULL,
    "node_key" VARCHAR(40) NOT NULL,
    "environment" "ProbeEnvironment" NOT NULL,
    "reported_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "probe_node_heartbeats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "probe_node_heartbeats_node_key_reported_at_key"
    ON "probe_node_heartbeats"("node_key", "reported_at");
CREATE INDEX "probe_node_heartbeats_environment_reported_at_idx"
    ON "probe_node_heartbeats"("environment", "reported_at");
