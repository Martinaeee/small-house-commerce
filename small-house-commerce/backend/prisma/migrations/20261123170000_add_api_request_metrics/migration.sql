-- P3: storefront API request samples for API & Checkout diagnostics.
-- Additive only. One row per recorded request; no body/query/IP/customer data.

CREATE TABLE "api_request_metrics" (
    "id" UUID NOT NULL,
    "request_id" VARCHAR(64) NOT NULL,
    "route_group" VARCHAR(40) NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "path" VARCHAR(512) NOT NULL,
    "status" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "sampled_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "api_request_metrics_route_group_sampled_at_idx"
    ON "api_request_metrics"("route_group", "sampled_at");
CREATE INDEX "api_request_metrics_sampled_at_idx"
    ON "api_request_metrics"("sampled_at");
CREATE INDEX "api_request_metrics_request_id_idx"
    ON "api_request_metrics"("request_id");

CREATE INDEX "analytics_events_checkout_request_id_idx"
    ON "analytics_events" ((metadata->>'requestId'), "created_at")
    WHERE event_name IN ('CHECKOUT_SUBMIT_ATTEMPT', 'CHECKOUT_SUBMIT_FAILED');
