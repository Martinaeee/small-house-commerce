# Dashboard — Operator Workbench (draft)

Status: **draft for review** · Branch: `feature/homepage-builder` · Date: 2026-10-21

This is the working draft for the admin Dashboard upgrade. It records the
analysis that was done before any code was written, the metric definitions
that were fixed once and reused everywhere, and how to test every module.

---

## 1. Phase 1 — Analysis of the existing project

### 1.1 Stack

| Layer | What is actually installed |
|---|---|
| Frontend | Next.js **16.3.4** (App Router, `output: standalone`), React 19.2.8, TypeScript 6, Tailwind **v4** (CSS-first `@theme`, no `tailwind.config`), **recharts 3.10.1** (already a dependency), zustand-free, **no** react-query/SWR/axios — data fetching is hand-rolled `useEffect` + `adminAuthedFetch` |
| Backend | NestJS **12**, Prisma **7.10** (multi-file schema in `prisma/schema/`, PostgreSQL via `@prisma/adapter-pg`), **Zod** for validation (`@Body(new ZodValidationPipe(schema))`), no Swagger, no class-validator |
| Auth | Admin JWT (`JwtAuthGuard`) + `@Permissions()` decorator + `PermissionsGuard`; 23 `PermissionCode` values, 6 roles. No `DASHBOARD` permission exists |
| Admin design system | Flat primitives in `src/components/admin/`: `Badge` (4 tones: green/amber/red/neutral), `EmptyState`, `Field`/`Select`, `Dialog`, `PageHeader`, `Pagination`, `TableSkeleton`, `Button` (`src/components/ui/Button.tsx`). **No** Card/StatCard/Tabs/Toast components — they are inline class strings. Tokens: `--color-admin-primary #1f5a47`, `--color-admin-canvas #f7f8f5`, `--color-admin-border #e5e8e3` |
| Docs | `docs/ADMIN_SPEC.md` §6 already specifies a Dashboard (Sales Overview / COD Metrics / Marketing Overview / Inventory Alert). `docs/DATABASE.md` §92 lists the dashboard data set. This build follows those documents |

### 1.2 Data that already existed

Reused as-is, no copy tables: `orders` (+`order_status`, `confirmation_status`,
`payment_status`, `subtotal`, `discount_total`, `shipping_total`,
`grand_total`), `order_items` (+`unit_cost_snapshot`), `order_shipping_address`
(province/city/barangay/postal_code — **no region column**), `payments`,
`shipments` (+`shipping_cost`), `inventory` (on_hand/reserved per sku×warehouse),
`skus` (+`price`, `compare_at_price`, `supplier_cost`, `landed_cost`),
`products`, `customers`, `newsletter_subscribers`, `newsletter_promotions`,
`campaign_links` + `campaign_link_visits` + `cost_entries`,
`product_landing_pages` (+`start_at`/`end_at`), `homepage_documents` /
`homepage_versions` (+`publish_at`/`unpublish_at`), `homepage_sections`
(legacy) and the V2 homepage document JSON with per-section `schedule`.

### 1.3 What did **not** exist and had to be added

| Gap | Resolution |
|---|---|
| No analytics table of any kind | New `analytics_events` table + `AnalyticsEventName` enum |
| No site-wide conversion rate (only per landing page / campaign link) | `page_view` events + `orders.tracking_session_id` |
| No impression/click tracking | `homepage_section_impression` / `homepage_section_click` events, recorded by IntersectionObserver |
| No inventory read endpoint | Dashboard queries `inventory` directly (no new endpoint needed) |
| No `Refund` model | Refunds exist only as `payment_status IN (REFUNDED, PARTIALLY_REFUNDED)` — the dashboard uses that and says so |
| No `Campaign` model | Reused `campaign_links` (campaign) + `product_landing_pages` (start/end window) + the existing marketing report for the numbers |
| No dashboard route at all | `/admin` is now the Dashboard (the admin had no index page before) |

---

## 2. Metric definitions (one definition per metric, used by every card)

Code: `backend/src/modules/dashboard/dashboard-metrics.ts` (pure functions, unit tested).

| Metric | Definition |
|---|---|
| Net Sales | `SUM(subtotal) − SUM(discount_total) − refunded value` over orders in the period. A fully refunded order (`payment_status = REFUNDED`) subtracts its whole product value. `PARTIALLY_REFUNDED` has **no amount in the schema**, so it is counted in the refund rate but not subtracted — the page says so in a data note |
| Orders | Distinct orders created in the period, **excluding** `CANCELLED` and `DENIED` |
| AOV | Net Sales ÷ Orders |
| Conversion Rate | Sessions that placed an order ÷ sessions that visited (a `page_view` event). A later **cancellation does not undo the conversion** — the checkout happened; the cancellation is reported on its own as the cancel rate. Mixing the two would make the funnel contradict itself |
| Refund Rate | Orders whose payment status is refunded ÷ valid orders (count basis — the schema stores refund *state*, not amount) |
| Estimated Gross Profit | Net Sales − product cost − shipping cost − payment fees. **Withheld** (`N/A` + "Cost data incomplete") until every order line carries a cost snapshot. Shipping cost and payment fees are **not recorded by the platform at all**, so the published number is the product-cost margin and the KPI card states the reduced formula next to it (`净销售额 − 商品成本（未含运费、支付手续费）`) instead of promising the full one — see §7 |
| Est. stockout | Remaining units ÷ average daily units sold over the velocity window. `NO_RECENT_SALES` / `NEW_SKU` / `OUT_OF_STOCK` are reported instead of a number |
| Signed Rate | Signed orders ÷ **every order created in the period** — cancelled and denied stay in the denominator (BUSINESS_RULES §11, DATABASE.md §71). "Signed" means the order has at least one shipment and **every** shipment is SIGNED with a timestamp (DATABASE.md §69) |
| Shipping-to-Signed Rate | Signed orders ÷ orders that entered shipping. A different metric, reported separately and never under the signed-rate label (DATABASE.md §73) |
| Confirmation / Cancel / Denied rate | Confirmed / cancelled / denied orders ÷ every order created in the period |
| Product revenue | Product line revenue, net of the **order-level discount allocated to the lines in proportion to their amount**, so the column adds up to the period's placed revenue |
| Product profit | Product revenue − product cost. Published only when **every** line of that product carries a cost snapshot; otherwise `—` with the reason (a partial cost would read as real margin) |
| New vs returning customer | New = first valid order falls inside the period. Returning = ordered in the period and had ordered before it. Repeat rate = customers who ordered **in the period** and have ≥2 valid orders in total ÷ customers who ordered in the period. New + returning = the period's customers = the rate's denominator, so the three numbers always agree and an empty period reports "—" instead of a historical rate |

All time windows are **Asia/Manila calendar days**, converted to half-open UTC
intervals exactly like the marketing report does, so a day is never counted
twice or lost at midnight. Every period is compared with the immediately
preceding period of the same length.

---

## 3. Thresholds (configurable, not hard-coded in components)

`backend/src/modules/dashboard/dashboard.config.ts` — every value has an env
override, and the resolved object is returned to the UI so the card can explain
why a product was flagged.

| Env var | Default | Meaning |
|---|---|---|
| `DASHBOARD_LOW_STOCK_UNITS` | 10 | Remaining units at or below this = low stock |
| `DASHBOARD_STOCKOUT_HORIZON_DAYS` | 14 | Only surface stockouts within this horizon |
| `DASHBOARD_VELOCITY_WINDOW_DAYS` | 7 | Sales window for daily units sold |
| `DASHBOARD_LOW_CONVERSION_RATE` | 0.01 | Below this order/view ratio = low conversion |
| `DASHBOARD_MIN_VIEWS_FOR_CONVERSION` | 50 | Minimum views before the conversion rule applies |
| `DASHBOARD_HIGH_CANCELLATION_RATE` | 0.15 | Cancelled share = high cancellation |
| `DASHBOARD_MIN_ORDERS_FOR_CANCELLATION` | 5 | Minimum orders before that rule applies |
| `DASHBOARD_LOW_TRAFFIC_VIEWS` | 20 | Below this many views = low traffic |
| `DASHBOARD_HIGH_REFUND_RATE` | 0.05 | Refunded share = high refunds |
| `DASHBOARD_MIN_ORDERS_FOR_REFUND` | 5 | Minimum orders before that rule applies |

---

## 4. API

Three grouped reads — the page never fires a request per card.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/admin/dashboard/overview?range=…` | KPIs, sales series, needs-attention, order pipeline, orders by location, customer snapshot, scheduled content, recent orders, quick-create entries, data notes |
| `GET /api/v1/admin/dashboard/products?range=…&sort=…` | Product performance (orders, units, revenue, signed rate, profit, growth), product anomalies, inventory alerts, period fulfilment metrics, resolved thresholds |
| `GET /api/v1/admin/dashboard/marketing?range=…` | Active campaigns, homepage section performance |
| `GET /api/v1/admin/inventory/costs` | Cost backfill grid: every active SKU with its cost, stock and 30-day sales |
| `PATCH /api/v1/admin/inventory/costs` | Bulk landed/supplier cost write; per-row settled results |
| `POST /api/v1/storefront/events` | Public first-party event ingest (batched, ≤20 events, rate limited per address) |
| `GET /api/v1/admin/orders` (drill-down target) | The workbench list. `status` and `paymentStatus` accept a comma-separated set; `dateFrom`/`dateTo` are **Manila calendar days** (`[day 00:00, next day 00:00)` Manila) — the same days the dashboard counts, so a tile's link lands on exactly the orders it counted |

`range` accepts `TODAY`, `YESTERDAY`, `LAST_7_DAYS`, `LAST_30_DAYS`,
`THIS_MONTH`, `LAST_MONTH`, `CUSTOM` (+`from`/`to`, `YYYY-MM-DD`).
`sort` accepts `revenue` (default), `orders`, `signed_rate`, `units` and only
affects the product table — changing it re-reads the product group alone, not
sales and campaigns.

The three groups load in parallel and fail **independently** — a broken
campaign report never blanks the sales numbers.

---

## 5. Permissions

The page itself is open to any signed-in operator; each group is gated by the
permission that already governs its source module, and an unreadable group
returns an empty list plus a `capabilities` flag instead of a 403.

| Group | Requires |
|---|---|
| Sales, orders, locations, customers | `ORDER_VIEW_ALL` |
| Gross profit | `REPORT_PROFIT_VIEW` (+ sales) |
| Inventory | `INVENTORY_VIEW` |
| Products | `PRODUCT_MANAGE` |
| Campaigns | `MARKETING_VIEW_ALL` / `MARKETING_VIEW_OWN` (owner-scoped by the existing marketing report) |
| Homepage performance, scheduled content | `PRODUCT_MANAGE` |
| Cost backfill grid (Inventory → 补录成本) | `PRODUCT_MANAGE` |

`ORDER_VIEW_OWN` deliberately does **not** unlock the dashboard: the aggregates
cover every order, so an owner-scoped account must not see site-wide numbers.
The nav entry is hidden from such accounts too.

---

## 6. How to test each module

| Module | How to check |
|---|---|
| KPIs + period | Open `/admin`, change the period selector; every card changes. Compare with the same range in the Orders list |
| Sales overview | Chart shows revenue bars + order line; the four totals match the Orders list totals for the range |
| Needs attention | Each row links to a **filtered** list (e.g. `status=CONFIRMED`), not the plain Orders page |
| Orders overview | Every tile links to its status filter **and to the period's Manila days** (`dateFrom`/`dateTo`); the drill-down list length equals the tile count |
| Orders by location | Aggregated from the order address snapshot; "Metro Manila" merges the NCR spellings only |
| Active campaigns | Numbers match `/admin/marketing/compare` for the same range (same report service) |
| Top products | Revenue per product matches the product report |
| Product performance table | Columns: orders, units, revenue, signed rate, profit, growth. Change the ranking (销售额 / 订单数 / 签收率 / 件数) — only the product group re-reads. The signed rate's denominator includes cancelled and denied orders; the profit column shows `—` until the product's cost snapshot is complete |
| Fulfilment & COD metrics | 确认率 / 签收率 / 发货→签收率 / 取消率 / 拒绝率, with the raw counts under each. Cross-check the signed rate against the Orders list for the same period |
| Products needing attention | Change a threshold env var and reload — the flags change |
| Inventory alerts | "Est. stockout" shows `--`/reason when there is no recent sales; restock links to the SKU in the inventory list |
| Homepage performance | Scroll the live homepage, then reload the dashboard; impressions appear per section. Scroll back and forth — the count does not inflate |
| Customer snapshot | New + returning = the period's customers; the repeat rate divides by that same group, so it moves with the period and is "—" when the period is empty |
| Scheduled content | Every row comes from a real publish/schedule field (homepage version, section schedule, landing page, promo code) |
| Recent orders | Rows open the order detail |
| Quick create | Only entries whose target feature exists are listed |
| Permission states | Sign in as an optimizer, a confirmer and a warehouse account — each group shows what that role may read, and the rest says "No permission" |
| Cost backfill | Inventory → 补录成本. The grid opens on the SKUs that still have no landed cost, busiest first. Type a cost, press 保存 — only the changed rows are sent, and a row that fails is listed with its reason. New orders placed afterwards carry the cost snapshot, and the dashboard's profit column becomes real |

---

## 7. Known gaps

- **Conversion rate and homepage performance need traffic.** They are honest
  zeros-with-reason until the storefront has been visited after this release.
  The page says "Conversion rate needs storefront sessions" rather than
  showing 0%.
- **Profit is `N/A` until cost data is complete.** `landedCost` is optional on
  a SKU; orders created before a cost existed carry no snapshot. The per-product
  profit column behaves the same way — a product with a partial cost shows `—`.
  The fix is the cost backfill grid (`/admin/inventory/cost`): it writes the
  landed cost of every SKU in one batch, and orders placed afterwards carry
  the snapshot. Orders placed BEFORE the cost was filled keep their missing
  snapshot — the dashboard never back-fills history.
- **Shipping cost and payment fees are not recorded anywhere in the schema.**
  `shipments.shipping_cost` is never written by any code path and there is no
  COD/gateway fee column. The published gross profit is therefore the
  **product-cost margin**; the KPI card states the reduced formula next to the
  number (`净销售额 − 商品成本（未含运费、支付手续费）`) instead of claiming the
  full one. It is deliberately **not** shown as `N/A`: with the fees
  structurally unrecorded, a strict `N/A` would blank a requested metric
  forever. Product cost stays strict — a partially costed period is `N/A`.
- **"支付失败" is 0 in every environment.** No code path ever writes
  `payment_status = FAILED` (the platform has COD only), so the backlog card
  and its drill-down are wired and exact but count nothing until a payment
  gateway exists. The drill-down filters on the payment status itself
  (`?paymentStatus=FAILED`) and lists every order status the card counted, so
  the list length equals the card.
- **Two backlog drill-downs stay approximate** (they were, and still are,
  approximations rather than exact filters): "待付款" counts orders with a
  pending payment under any live status, while its link lists five order
  statuses; "退款 / 售后" counts refunded **or** after-sales orders, while its
  link can only show the after-sales half — the order list filters by
  inclusion, so an `OR` cannot be expressed. The two cards this round fixed
  (the order tiles and failed payments) are exact.
- **Order-level discounts are allocated, not stored per line.** The dashboard
  splits `discountTotal` across the order's lines in proportion to their
  amount so the product revenue column reconciles with the period total.
- **Partial refunds have no amount.** The schema records the state only.
- **No region column on orders.** Location is aggregated by province, which
  is what the order snapshot actually stores.
- **Search events are recorded but not yet surfaced** on the dashboard.

---

## 8. 验收记录（真实环境跑通）

Verified against a real PostgreSQL 18 (a throwaway `small_house_verify`
database — the shared dev database was left untouched), the whole order
lifecycle driven through the real API:

**Migration** — all 54 migrations applied, including
`20261021090000_add_dashboard_analytics`. `prisma migrate diff` afterwards
reports **no drift** against the Prisma schema (the only difference in the
whole database is a pre-existing index-name truncation on
`promo_code_redemptions`, unrelated to this work).

**Fixtures** — 2 products (one with a landed cost, one without), 3 orders:
A = 2× CART-WH-03 (confirmed → shipped → signed), B = 1× CHAIR-SD-01
(cancelled), C = 1× CART-WH-03 (left new). 4 visitor sessions, 2 of which
ordered.

| Figure | Dashboard | Hand-checked |
|---|---|---|
| Net Sales | ₱3,897 | 2×1299 + 1×1299, cancelled excluded ✓ |
| Orders | 2 | A + C ✓ |
| AOV | ₱1,948.50 | 3897 ÷ 2 ✓ |
| Conversion | 75% | 3 ordering sessions ÷ 4 sessions ✓ |
| Gross profit | ₱1,197 | 3897 − (900×3) ✓, cost coverage 100% |
| Signed rate (period) | 33.33% | 1 signed ÷ 3 created — the denominator keeps cancelled and denied ✓ |
| Shipping → signed | 100% | 1 ÷ 1 ✓ |
| Cancel rate | 33.33% | 1 ÷ 3 ✓ |
| Rolling Cart | 2 orders · 3 units · ₱3,897 · signed 1 (50%) · cost ₱2,700 · profit ₱1,197 | ✓ |
| Folding Chair | 1 order · 0 valid · revenue ₱0 · cost/profit withheld | ✓ (cancelled order contributes no revenue; no valid line means no cost to publish) |
| Inventory alert | CHAIR-SD-01: 8 left, stockout "not enough data" | ✓ (no sales velocity — no invented number) |

**Impression tracking** — a real browser scrolled the live homepage: 12
sections produced **13 rows / 13 distinct section ids** (one per section, no
duplicates); a second impression of the same section in the same session was
dropped by the database index.

**Cost backfill** — typed a landed cost into the grid and saved: the row
left the "missing cost" filter, the success line appeared, and
`skus.landed_cost` changed from NULL to 640 in the database.

**Also fixed while verifying**
- the previous-period label was off by one day (UTC truncation);
- the conversion rate excluded cancelled orders from the numerator while the
  denominator counted every session — a mixed口径 that made the funnel
  contradict itself;
- the labels that came from the API were English sentences inside an
  otherwise Chinese page — the API now returns stable keys and the interface
  owns the wording.

---

## 9. 真实数据验收（第二次）

The shared dev database (`small_house`) is used by **two migration
lineages** — `main` has 29 migrations, this branch has 38 — so migrating it
here would make the main checkout's `prisma migrate` report applied-but-
missing migrations. It was therefore **left untouched**.

Instead the database was dumped, restored into `small_house_real`, and only
that copy was migrated. It carries the real data: **15 orders from
2026-09-15 to 09-18**, 8 SKUs (3 with a landed cost), real customers and
real shipment addresses.

Read with the range "上月" (2026-09-01 → 09-30):

| Figure | Dashboard | Independent SQL |
|---|---|---|
| Net Sales | ₱41,979 | `SUM(subtotal - discount_total)` = 41,979.00 ✓ |
| Valid orders | 14 | 15 created − 1 cancelled = 14 ✓ |
| AOV | ₱2,998.50 | 41,979 ÷ 14 ✓ |
| Gross profit | ₱16,779 | 41,979 − 25,200 (product cost) ✓, cost coverage 100% (16/16 order lines carry a snapshot) |
| Confirmed / signed / cancelled | 3 / 0 / 1 | ✓ |
| Confirmation rate | 20% (3/15) | ✓ |
| Signed rate | 0% (0/15) | ✓ — the denominator keeps the cancelled order |
| Shipping → signed | — (0/0) | ✓ — **a dash, not 0%**: no shipment has ever been recorded |
| Cancel rate | 6.7% (1/15) | ✓ |
| By location | Metro Manila 12 (₱37,981) · Cebu 2 (₱3,998) | identical group-by ✓ |
| Customers | 11 new · 0 returning · 9.1% repeat (1/11) | ✓ |
| Product performance | E2E Chair mtvr8y53: 9 orders / 11 units / ₱21,989 / cost ₱13,200 / profit ₱8,789 | ✓ |
| Inventory alerts | 7 SKUs out of stock, 1 with 10 left and no sales pace | ✓ |
| Conversion | — "no traffic data" | ✓ — the real database predates the tracking release |

One product of this pass changed the design: with twenty out-of-stock
products, the anomaly card was filled with them and the conversion,
cancellation and refund findings never surfaced. The card now takes the
rows round by round, so every detected issue type gets a slot before any
type is repeated.

---

## 10. 验收记录（第三轮：四个已知问题）

Four defects that the second round left open were fixed with tests first.

### 10.1 What changed

| # | Defect | Fix |
|---|---|---|
| 1 | The order tiles' drill-down carried the **UTC date of the window's start instant** (`dateFrom=2026-08-31` for the September window) | `orderTiles()` now uses the window's own Manila days (`window.fromDate` / `window.toDate`), and the order list reads its `dateFrom`/`dateTo` as Manila calendar days (`[day 00:00, next day 00:00)` Manila) so the drill-down set equals the tile count |
| 2 | Repeat purchase rate was a **lifetime** rate: the denominator was every customer who ever ordered, so an empty period still showed a historical rate | The snapshot is scoped to the period: denominator = customers who ordered in it (new + returning), numerator = those with ≥2 valid orders in total. An empty period now reports "—" |
| 3 | The "failed payments" card linked to `?status=NEW,PENDING,CONFIRMED,SHIPPING` — a filter unrelated to the count | The order list accepts `paymentStatus` (comma-separated set) and shows it as an active **Payment** control; the card links `?paymentStatus=FAILED&status=<every status the card kept>` so the list length equals the card |
| 4 | The gross-profit KPI showed a number while its hint promised the full formula (shipping and payment fees are subtracted, but neither is recorded) | The KPI card states the formula it actually applied (`净销售额 − 商品成本（未含运费、支付手续费）`) and the API carries `partial: true`. Product cost stays strict (`N/A` while a line has no snapshot) |

### 10.2 Evidence

**Tests (all written before the fix, watched failing first)**

| Suite | Result |
|---|---|
| Backend `vitest run` | 129 files · 1628 tests passed (11 integration files skipped without their database) |
| Backend dashboard integration spec on a dedicated `small_house_dashboard_dev` database (55 migrations applied) | 4/4 passed — period-scoped customer snapshot, Manila-day order filter, payment-status filter, tile links |
| Frontend `vitest run` | 227 files · 2216 tests passed |
| `tsc --noEmit` (both packages) · `oxlint` · `eslint` | clean (2 pre-existing warnings in files this round did not touch) |

**Real data (`small_house_real`, 15 orders, 11 customers)**

| Check | Result |
|---|---|
| September window, dashboard vs the order list's date filter | 15 orders either way — all real orders were placed between 11:07 and 23:29 Manila, so the old 8-hour skew was latent, not visible on this data |
| Customer snapshot, September | 11 new · 0 returning · 1 repeat · 11 period customers → 9.09% (identical to the old query on this data, because every customer ordered in September) |
| Customer snapshot, **empty window (May 2026)** | new: **0 period customers → rate "—"**; the old query reported 11 customers and 9.09% for a month with **zero** orders — the reported bug, reproduced and fixed |
| `payment_status` distribution | 15 × `COD_PENDING`, **no `FAILED`** — the card is wired and exact but counts 0 until a gateway exists |
| Order timestamps | 11:07 → 23:29 Manila; none in the 00:00–08:00 band where a UTC-day filter would have skewed the drill-down |

### 10.3 Behaviour changes to report

- **The admin order list's From/To inputs are now Manila calendar days.** They
  were UTC days, which put an order placed at 00:30 Manila on the previous
  day and dropped the last second of a day (`lte 23:59:59Z`). Landing pages,
  the marketing report and the dashboard already used Manila days; the order
  list was the only outlier.
- **The order list gained a "Payment" filter** (and a `paymentStatus` query
  parameter). Without a visible control the dashboard's drill-down would have
  applied an invisible filter.
- **`customerSnapshot.totalCustomers` was renamed to `periodCustomers`** and now
  counts the period's customers. The field was not rendered anywhere; the new
  name says what it is.
- **`grossProfit` gained `partial`** (and the KPI carries it), so the interface
  can tell a reduced formula from the full one.

