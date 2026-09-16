-- CreateTable
CREATE TABLE "site_settings" (
    "id" UUID NOT NULL,
    "messenger_url" TEXT NOT NULL DEFAULT '',
    "support_email" TEXT NOT NULL DEFAULT 'support@luwag.ph',
    "support_hours" TEXT NOT NULL DEFAULT 'Mon–Sat, 9am–6pm (PHT)',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row with the fixed id; the app reads/writes only this row.
INSERT INTO "site_settings" ("id", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
