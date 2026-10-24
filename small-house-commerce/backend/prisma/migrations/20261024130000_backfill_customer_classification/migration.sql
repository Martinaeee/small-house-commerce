-- Two kinds of historical rows carry a wrong customer classification:
--   1. orders created before the snapshot existed (NULL) — the list shows "—";
--   2. orders the old fallback labelled NEW even though the customer had
--      earlier orders (e.g. unstarted or cancelled ones).
-- Recompute both with the rule the app uses now: the first order is NEW, a
-- DENIED history is RECHECK, an active prior order is RPT, any other prior
-- order is AGAIN. Ordered by created_at so the earliest order of each customer
-- wins. Rows already labelled AGAIN/RPT/RECHECK are never touched, and the
-- predicate only matches NULL or non-first NEW rows, so re-running is harmless.

WITH ranked AS (
  SELECT
    o.id,
    o.customer_classification,
    row_number() OVER (
      PARTITION BY o.customer_id ORDER BY o.created_at, o.id
    ) AS position,
    COALESCE(
      bool_or(o.order_status = 'DENIED') OVER w,
      false
    ) AS denied_before,
    COALESCE(
      bool_or(o.order_status IN ('PENDING', 'SHIPPING', 'CONFIRMED')) OVER w,
      false
    ) AS active_before
  FROM orders o
  WINDOW w AS (
    PARTITION BY o.customer_id
    ORDER BY o.created_at, o.id
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
  )
)
UPDATE orders o
SET customer_classification = CASE
  WHEN r.position = 1 THEN 'NEW'
  WHEN r.denied_before THEN 'RECHECK'
  WHEN r.active_before THEN 'RPT'
  ELSE 'AGAIN'
END
FROM ranked r
WHERE o.id = r.id
  AND (
    r.customer_classification IS NULL
    OR (r.customer_classification = 'NEW' AND r.position > 1)
  );
