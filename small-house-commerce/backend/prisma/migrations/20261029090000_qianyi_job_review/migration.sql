ALTER TYPE "QianyiSyncStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "QianyiSyncStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "qianyi_sync_jobs"
  ADD COLUMN IF NOT EXISTS "auto_create_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pending_review" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "claimed_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "last_action" VARCHAR(1024);

CREATE INDEX IF NOT EXISTS "qianyi_sync_jobs_status_claimed_at_idx"
ON "qianyi_sync_jobs"("status", "claimed_at");
