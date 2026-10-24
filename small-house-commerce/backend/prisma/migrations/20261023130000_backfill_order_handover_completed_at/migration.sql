-- Backfill the derived handover flag for orders whose handover events already
-- cover every ordered unit. Those events predate the column, so without this
-- the order would sit in the "to hand over" queue with nothing left to hand
-- over. Idempotent: rows that already carry a timestamp are left alone.

UPDATE "orders" o
SET "handover_completed_at" = COALESCE(
  (
    SELECT MAX(e."occurred_at")
    FROM "order_handover_events" e
    WHERE e."order_id" = o."id" AND e."type" = 'HANDED_OVER'
  ),
  now()
)
WHERE o."handover_completed_at" IS NULL
  AND o."order_status" = 'CONFIRMED'
  AND EXISTS (SELECT 1 FROM "order_items" i WHERE i."order_id" = o."id")
  AND NOT EXISTS (
    SELECT 1
    FROM "order_items" i
    WHERE i."order_id" = o."id"
      AND (
        SELECT COALESCE(SUM((item ->> 'quantity')::int), 0)
        FROM "order_handover_events" e,
             jsonb_array_elements(e."items") AS item
        WHERE e."order_id" = o."id"
          AND e."type" = 'HANDED_OVER'
          AND item ->> 'orderItemId' = i."id"::text
      ) < i."quantity"
  );
