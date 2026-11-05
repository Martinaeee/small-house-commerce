BEGIN;

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

-- Recover counters from issued numbers, not mutable post dates.
WITH issued AS (
  SELECT l.owner_user_id, k.kind,
    regexp_match(
      substring(l.adid FROM length(k.kind || '-' || l.aid_snapshot || '-') + 1),
      '^([0-9]{6})-([0-9]+)$'
    ) AS parts
  FROM "campaign_links" l
  CROSS JOIN LATERAL (
    SELECT CASE WHEN l.source_type = 'FB_POST' THEN 'FB' ELSE 'AD' END AS kind
  ) k
  WHERE (l.source_type = 'FB_POST' OR
    (l.source_type = 'META_AD' AND NULLIF(btrim(l.ad_id), '') IS NULL))
    AND starts_with(l.adid, k.kind || '-' || l.aid_snapshot || '-')
)
INSERT INTO "adid_counters" ("owner_user_id", "day_key", "kind", "last_number")
SELECT owner_user_id, parts[1], kind, max(parts[2]::integer)
FROM issued
WHERE parts IS NOT NULL
GROUP BY owner_user_id, parts[1], kind
ON CONFLICT ("owner_user_id", "day_key", "kind")
DO UPDATE SET "last_number" = GREATEST("adid_counters"."last_number", EXCLUDED."last_number");

UPDATE "campaign_links"
SET adid = btrim(ad_id)
WHERE adid IS NULL AND source_type = 'META_AD' AND NULLIF(btrim(ad_id), '') IS NOT NULL;

-- Reserve only generated numbers; real Meta IDs do not consume a sequence.
WITH candidates AS (
  SELECT l.id, l.owner_user_id, l.aid_snapshot,
    CASE WHEN l.post_date IS NOT NULL THEN to_char(l.post_date, 'YYMMDD')
      ELSE to_char(l.created_at AT TIME ZONE 'Asia/Manila', 'YYMMDD') END AS day_key,
    CASE WHEN l.source_type = 'FB_POST' THEN 'FB' ELSE 'AD' END AS kind,
    l.created_at
  FROM "campaign_links" l
  WHERE l.adid IS NULL AND l.source_type IN ('FB_POST', 'META_AD')
), numbered AS (
  SELECT *,
    row_number() OVER (PARTITION BY owner_user_id, day_key, kind ORDER BY created_at, id) AS seq,
    count(*) OVER (PARTITION BY owner_user_id, day_key, kind) AS batch_size
  FROM candidates
), allocations AS (
  INSERT INTO "adid_counters" ("owner_user_id", "day_key", "kind", "last_number")
  SELECT owner_user_id, day_key, kind, count(*)::integer
  FROM candidates
  GROUP BY owner_user_id, day_key, kind
  ON CONFLICT ("owner_user_id", "day_key", "kind")
  DO UPDATE SET "last_number" = "adid_counters"."last_number" + EXCLUDED."last_number"
  RETURNING owner_user_id, day_key, kind, last_number
)
UPDATE "campaign_links" l
SET adid = n.kind || '-' || n.aid_snapshot || '-' || n.day_key || '-' ||
  lpad((a.last_number - n.batch_size + n.seq)::text,
    GREATEST(2, length((a.last_number - n.batch_size + n.seq)::text)), '0')
FROM numbered n
JOIN allocations a USING (owner_user_id, day_key, kind)
WHERE l.id = n.id;

-- Several links may use one real Meta ID, but generated IDs must be distinct.
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_links_generated_adid_key"
ON "campaign_links" ("adid")
WHERE source_type = 'FB_POST' OR
  (source_type = 'META_AD' AND NULLIF(btrim(ad_id), '') IS NULL);

UPDATE "order_attributions" a
SET adid = l.adid
FROM "campaign_links" l
WHERE a.adid IS NULL AND a.link_id = l.id
  AND a.source_type = l.source_type AND l.adid IS NOT NULL;

UPDATE "order_attributions"
SET adid = btrim(ad_id)
WHERE adid IS NULL AND source_type = 'META_AD' AND NULLIF(btrim(ad_id), '') IS NOT NULL;

COMMIT;
