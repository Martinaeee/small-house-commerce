-- W02 storefront observability report (read-only).
--
-- Runs against the storefront database only; no writes, no PII. The funnel
-- comes from the first-party analytics tables, order outcomes from `orders`,
-- and Meta delivery from the durable CAPI outbox. Log-only facts (request
-- timings per request, replay counts, recovery outcome) are produced by the
-- JSON request log; see storefront-observability-report.md for the commands.
--
--   psql "$DATABASE_URL" -f backend/scripts/storefront-observability.sql
--
-- Times are stored in UTC; `event_day` is already the Manila calendar day.

\pset pager off
\pset footer off

\echo '== 1. Funnel by day (Manila) =='
SELECT event_day,
       count(*) FILTER (WHERE event_name = 'PRODUCT_VIEW')            AS product_views,
       count(*) FILTER (WHERE event_name = 'ADD_TO_CART')              AS add_to_cart,
       count(*) FILTER (WHERE event_name = 'BEGIN_CHECKOUT')           AS begin_checkout,
       count(*) FILTER (WHERE event_name = 'CHECKOUT_SUBMIT_ATTEMPT')  AS submit_attempts,
       count(*) FILTER (WHERE event_name = 'CHECKOUT_SUBMIT_FAILED')   AS submit_failed,
       count(*) FILTER (WHERE event_name = 'PURCHASE')                 AS purchase_events
FROM analytics_events
GROUP BY event_day
ORDER BY event_day DESC
LIMIT 30;

\echo '== 2. Place Order success (per Manila day) =='
WITH per_day AS (
  SELECT (o.created_at AT TIME ZONE 'Asia/Manila')::date AS order_day, count(*) AS orders
  FROM orders o
  GROUP BY 1
), attempts AS (
  SELECT event_day,
         count(*) FILTER (WHERE event_name = 'ADD_TO_CART')             AS add_to_cart,
         count(*) FILTER (WHERE event_name = 'CHECKOUT_SUBMIT_ATTEMPT')  AS submit_attempts,
         count(*) FILTER (WHERE event_name = 'CHECKOUT_SUBMIT_FAILED')   AS failures
  FROM analytics_events
  GROUP BY event_day
)
SELECT a.event_day,
       a.add_to_cart,
       a.submit_attempts,
       a.failures,
       coalesce(p.orders, 0) AS orders_created,
       round((100.0 * coalesce(p.orders, 0) / NULLIF(a.submit_attempts, 0))::numeric, 1) AS place_order_success_pct
FROM attempts a
LEFT JOIN per_day p ON p.order_day = a.event_day
ORDER BY a.event_day DESC
LIMIT 30;

\echo '== 3. PDP -> checkout stage timings (seconds, p50/p90) =='
WITH steps AS (
  SELECT session_id,
         min(created_at) FILTER (WHERE event_name = 'PRODUCT_VIEW')          AS product_view_at,
         min(created_at) FILTER (WHERE event_name = 'ADD_TO_CART')            AS add_to_cart_at,
         min(created_at) FILTER (WHERE event_name = 'BEGIN_CHECKOUT')         AS begin_checkout_at,
         min(created_at) FILTER (WHERE event_name = 'CHECKOUT_SUBMIT_ATTEMPT') AS submit_at,
         min(created_at) FILTER (WHERE event_name = 'PURCHASE')               AS purchase_at
  FROM analytics_events
  GROUP BY session_id
)
SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM add_to_cart_at - product_view_at)))::numeric, 2) AS pdp_to_cart_p50_s,
       round((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM add_to_cart_at - product_view_at)))::numeric, 2) AS pdp_to_cart_p90_s,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM begin_checkout_at - add_to_cart_at)))::numeric, 2) AS cart_to_checkout_p50_s,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM submit_at - begin_checkout_at)))::numeric, 2) AS checkout_to_submit_p50_s,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM purchase_at - submit_at)))::numeric, 2) AS submit_to_purchase_p50_s
FROM steps;

\echo '== 4. Order outcomes by Manila day =='
SELECT (created_at AT TIME ZONE 'Asia/Manila')::date AS order_day,
       count(*) AS created,
       count(*) FILTER (WHERE order_status = 'CANCELLED') AS cancelled,
       count(*) FILTER (WHERE confirmation_status = 'NEEDS_REVIEW') AS needs_review,
       count(*) FILTER (WHERE idempotency_key IS NOT NULL) AS with_idempotency_key,
       round(sum(grand_total)::numeric, 2) AS gross_total
FROM orders
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;

\echo '== 5. First-party Purchase coverage (orders without a PURCHASE row) =='
WITH purchases AS (
  SELECT DISTINCT entity_id AS order_number
  FROM analytics_events
  WHERE event_name = 'PURCHASE' AND entity_id IS NOT NULL
)
SELECT (o.created_at AT TIME ZONE 'Asia/Manila')::date AS order_day,
       count(*) AS orders,
       count(*) FILTER (WHERE p.order_number IS NULL) AS orders_without_purchase,
       round((100.0 * count(*) FILTER (WHERE p.order_number IS NOT NULL) / count(*))::numeric, 1) AS purchase_coverage_pct
FROM orders o
LEFT JOIN purchases p ON p.order_number = o.order_number
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;

\echo '== 6. Meta CAPI outbox status =='
SELECT status::text AS status, count(*) AS rows, max(attempts) AS max_attempts, max(last_error) AS last_error
FROM meta_conversion_events
GROUP BY 1
ORDER BY 2 DESC;

\echo '== 7. Device and network mix (storefront events) =='
SELECT device_type,
       coalesce(metadata ->> 'networkType', '(unknown)') AS network_type,
       count(*) AS events
FROM analytics_events
GROUP BY 1, 2
ORDER BY 3 DESC;

\echo '== 8. Checkout failure reasons =='
SELECT coalesce(metadata ->> 'reason', '(none)') AS reason,
       coalesce(metadata ->> 'field', '(none)')  AS field,
       count(*) AS failures
FROM analytics_events
WHERE event_name = 'CHECKOUT_SUBMIT_FAILED'
GROUP BY 1, 2
ORDER BY 3 DESC;

\echo '== 9. Duplicate idempotency keys in orders (must be zero) =='
SELECT idempotency_key, count(*) AS orders
FROM orders
WHERE idempotency_key IS NOT NULL
GROUP BY 1
HAVING count(*) > 1;
