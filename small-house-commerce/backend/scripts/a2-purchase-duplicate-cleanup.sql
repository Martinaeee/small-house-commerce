-- A2 production data cleanup (NOT executed by this repository state).
--
-- Evidence: audit-local/20261109-4bf25f8b/a2-analytics-purchase-duplicates-20261109.json
-- Policy: keep the earliest PURCHASE row per order, delete only the later duplicate.
-- Approval required before running; run inside a transaction and verify counts.
--
--    psql "$PRODUCTION_DATABASE_URL" -f backend/scripts/a2-purchase-duplicate-cleanup.sql
--
-- Expected before: 22 PURCHASE rows, 2 orders with 2 rows (PH100020, PH100022).
-- Expected after:  20 PURCHASE rows, 0 orders with more than one row.

\set ON_ERROR_STOP on

BEGIN;

-- Guard: refuse to proceed when the duplicates are not exactly the two rows
-- this cleanup was approved for.
DO $$
DECLARE
  duplicate_rows integer;
BEGIN
  SELECT count(*) INTO duplicate_rows
  FROM analytics_events
  WHERE event_name = 'PURCHASE'
    AND id IN (
      '01a1bba3-90bf-7118-b639-dcb131c9e67b',
      '01a1baec-0a3b-7019-891a-162b408a1b95'
    );
  IF duplicate_rows <> 2 THEN
    RAISE EXCEPTION 'expected 2 approved duplicate rows, found %', duplicate_rows;
  END IF;
END $$;

-- PH100020: keep 01a19a5c-1347-7130-bb43-51d5019a3762 (2026-11-02 03:44:47 UTC),
-- delete 01a1bba3-90bf-7118-b639-dcb131c9e67b (2026-11-08 14:50:21 UTC).
DELETE FROM analytics_events
WHERE id = '01a1bba3-90bf-7118-b639-dcb131c9e67b'
  AND event_name = 'PURCHASE'
  AND entity_id = 'PH100020'
  AND created_at > (SELECT min(created_at) FROM analytics_events
                    WHERE event_name = 'PURCHASE' AND entity_id = 'PH100020');

-- PH100022: keep 01a19b6a-c167-70aa-bb1a-13811e1a00a0 (2026-11-02 08:40:27 UTC),
-- delete 01a1baec-0a3b-7019-891a-162b408a1b95 (2026-11-08 11:29:53 UTC).
DELETE FROM analytics_events
WHERE id = '01a1baec-0a3b-7019-891a-162b408a1b95'
  AND event_name = 'PURCHASE'
  AND entity_id = 'PH100022'
  AND created_at > (SELECT min(created_at) FROM analytics_events
                    WHERE event_name = 'PURCHASE' AND entity_id = 'PH100022');

-- Post-conditions: no PURCHASE duplicates remain, and the kept rows are intact.
DO $$
DECLARE
  remaining integer;
  kept integer;
BEGIN
  SELECT count(*) INTO remaining
  FROM (
    SELECT entity_id FROM analytics_events
    WHERE event_name = 'PURCHASE' AND entity_id IS NOT NULL
    GROUP BY entity_id HAVING count(*) > 1
  ) duplicates;
  SELECT count(*) INTO kept
  FROM analytics_events
  WHERE id IN (
    '01a19a5c-1347-7130-bb43-51d5019a3762',
    '01a19b6a-c167-70aa-bb1a-13811e1a00a0'
  );
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'duplicate PURCHASE rows still present: %', remaining;
  END IF;
  IF kept <> 2 THEN
    RAISE EXCEPTION 'kept rows missing: %', kept;
  END IF;
END $$;

COMMIT;

-- Verification (read-only, after commit):
SELECT entity_id, count(*) FROM analytics_events
WHERE event_name = 'PURCHASE' AND entity_id IS NOT NULL
GROUP BY entity_id HAVING count(*) > 1;  -- must return no rows
