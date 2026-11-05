-- Customer-service follow-up for unfinished checkout drafts.
-- The draft stays a draft: no stock, no customer, no order until an operator
-- converts it. Each saved result also appends one immutable timeline entry.

BEGIN;

CREATE TYPE "CheckoutDraftFollowUpStatus" AS ENUM (
  'TO_CONTACT',
  'NO_ANSWER',
  'FOLLOW_UP_LATER',
  'WANTS_TO_BUY',
  'DECLINED'
);

ALTER TABLE "checkout_drafts"
  ADD COLUMN "follow_up_status" "CheckoutDraftFollowUpStatus",
  ADD COLUMN "assignee_id" UUID,
  ADD COLUMN "next_follow_up_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_contacted_at" TIMESTAMPTZ(3),
  ADD COLUMN "follow_up_note" VARCHAR(500);

CREATE INDEX "checkout_drafts_follow_up_status_next_follow_up_at_idx"
  ON "checkout_drafts" ("follow_up_status", "next_follow_up_at");
CREATE INDEX "checkout_drafts_assignee_id_follow_up_status_idx"
  ON "checkout_drafts" ("assignee_id", "follow_up_status");

ALTER TABLE "checkout_drafts"
  ADD CONSTRAINT "checkout_drafts_assignee_id_fkey"
  FOREIGN KEY ("assignee_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "checkout_draft_follow_up_events" (
  "id" UUID NOT NULL,
  "draft_id" UUID NOT NULL,
  "operator_id" UUID,
  "from_status" "CheckoutDraftFollowUpStatus",
  "to_status" "CheckoutDraftFollowUpStatus" NOT NULL,
  "note" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checkout_draft_follow_up_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "checkout_draft_follow_up_events_draft_id_created_at_idx"
  ON "checkout_draft_follow_up_events" ("draft_id", "created_at");

ALTER TABLE "checkout_draft_follow_up_events"
  ADD CONSTRAINT "checkout_draft_follow_up_events_draft_id_fkey"
  FOREIGN KEY ("draft_id") REFERENCES "checkout_drafts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "checkout_draft_follow_up_events"
  ADD CONSTRAINT "checkout_draft_follow_up_events_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
