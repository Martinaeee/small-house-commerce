-- The advertising number of a link and of the order it produced.
-- FB posts get a generated FB-<AID>-<YYMMDD>-<nn>; Meta ads keep their real
-- ad ID when one was recorded, otherwise they get the same AD-shaped number.
-- Organic/direct/email links get none. Historical rows are filled here so the
-- admin lists show the same number for every order of one post.

ALTER TABLE "campaign_links" ADD COLUMN IF NOT EXISTS "adid" VARCHAR(120);
CREATE INDEX IF NOT EXISTS "campaign_links_adid_idx" ON "campaign_links" ("adid");

ALTER TABLE "order_attributions" ADD COLUMN IF NOT EXISTS "adid" VARCHAR(120);
CREATE INDEX IF NOT EXISTS "order_attributions_adid_idx" ON "order_attributions" ("adid");

CREATE TABLE IF NOT EXISTS "adid_counters" (
  "owner_user_id" UUID NOT NULL,
  "day_key" VARCHAR(6) NOT NULL,
  "kind" VARCHAR(2) NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "adid_counters_pkey" PRIMARY KEY ("owner_user_id", "day_key", "kind")
);

-- Number existing FB posts and Meta ads that never recorded a real ad ID.
WITH candidates AS (
  SELECT
    l.id,
    l.owner_user_id,
    l.aid_snapshot,
    l.source_type,
    l.ad_id,
    CASE
      WHEN l.post_date IS NOT NULL THEN to_char(l.post_date, 'YYMMDD')
      ELSE to_char(l.created_at AT TIME ZONE 'Asia/Manila', 'YYMMDD')
    END AS day_key,
    CASE WHEN l.source_type = 'FB_POST' THEN 'FB' ELSE 'AD' END AS kind,
    row_number() OVER (
      PARTITION BY
        l.owner_user_id,
        CASE
          WHEN l.post_date IS NOT NULL THEN to_char(l.post_date, 'YYMMDD')
          ELSE to_char(l.created_at AT TIME ZONE 'Asia/Manila', 'YYMMDD')
        END,
        CASE WHEN l.source_type = 'FB_POST' THEN 'FB' ELSE 'AD' END
      ORDER BY l.created_at, l.id
    ) AS seq
  FROM "campaign_links" l
  WHERE l.adid IS NULL
    AND l.source_type IN ('FB_POST', 'META_AD')
)
UPDATE "campaign_links" l
SET adid = CASE
  WHEN c.source_type = 'META_AD' AND c.ad_id IS NOT NULL THEN c.ad_id
  ELSE c.kind || '-' || c.aid_snapshot || '-' || c.day_key || '-' || lpad(c.seq::text, 2, '0')
END
FROM candidates c
WHERE l.id = c.id;

-- Continue the sequence from the highest number already handed out.
WITH generated AS (
  SELECT
    l.owner_user_id,
    CASE
      WHEN l.post_date IS NOT NULL THEN to_char(l.post_date, 'YYMMDD')
      ELSE to_char(l.created_at AT TIME ZONE 'Asia/Manila', 'YYMMDD')
    END AS day_key,
    CASE WHEN l.source_type = 'FB_POST' THEN 'FB' ELSE 'AD' END AS kind,
    row_number() OVER (
      PARTITION BY
        l.owner_user_id,
        CASE
          WHEN l.post_date IS NOT NULL THEN to_char(l.post_date, 'YYMMDD')
          ELSE to_char(l.created_at AT TIME ZONE 'Asia/Manila', 'YYMMDD')
        END,
        CASE WHEN l.source_type = 'FB_POST' THEN 'FB' ELSE 'AD' END
      ORDER BY l.created_at, l.id
    ) AS seq
  FROM "campaign_links" l
  WHERE l.source_type IN ('FB_POST', 'META_AD')
    AND NOT (l.source_type = 'META_AD' AND l.ad_id IS NOT NULL)
)
INSERT INTO "adid_counters" ("owner_user_id", "day_key", "kind", "last_number")
SELECT owner_user_id, day_key, kind, max(seq)
FROM generated
GROUP BY owner_user_id, day_key, kind
ON CONFLICT ("owner_user_id", "day_key", "kind")
DO UPDATE SET "last_number" = GREATEST("adid_counters"."last_number", EXCLUDED."last_number");

-- Copy the number onto the orders that link produced.
UPDATE "order_attributions" a
SET adid = l.adid
FROM "campaign_links" l
WHERE a.adid IS NULL
  AND a.link_id = l.id
  AND l.adid IS NOT NULL;
