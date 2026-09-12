# Admin Panel V1 — Design Spec

**Date:** 2026-09-12
**Status:** Draft — for human review. No implementation until approved.
**Scope:** DEVELOPMENT_PLAN Phase 4 "Basic Admin System" (Day 24–27). Acceptance: *business can process orders manually.*
**Companion:** `docs/superpowers/plans/2026-09-12-admin-panel-v1.md`
**Sources (ground truth):** backend controllers/DTOs/services in `backend/src/modules/{auth,orders,inventory,catalog,customers,users}`, `backend/prisma/schema/*.prisma` (identity, order, catalog), `backend/prisma/seed.ts` (RBAC grants), `docs/ADMIN_SPEC.md`, `docs/DEVELOPMENT_PLAN.md §Phase 4`, `docs/frontend/DESIGN_SYSTEM.md`, `docs/frontend/COMPONENT_LIBRARY.md`.

---

# 1. Purpose

The storefront is V1.0-complete. The backend already exposes a full ADMIN API surface (products / categories / orders / inventory / customers / users) guarded by JWT + RBAC. There is **zero admin web UI** — the last V1.0 launch gap. This document designs the V1 admin panel: the operational surface a merchant needs to run the store manually (process COD orders, adjust stock, manage products).

The admin panel lives **inside the existing Next.js app** at `frontend/src/app/admin/**` as its own route group. Same-origin; browser calls relative `/api/v1/*` via the existing Next rewrite (`next.config.ts`). It is desktop-first, responsive down to ~768px (ADMIN_SPEC §22: desktop first because admins operate from a computer).

# 2. Goals

1. An operator can **log in** with a backend `User` account and get a session whose nav and actions are driven by that account's RBAC permissions.
2. An operator can **process orders manually**: search/filter the order list, open an order detail with full context (customer, items, totals, shipping address, attribution, timeline), and Confirm or Cancel with correct backend semantics.
3. An operator can **adjust stock** with a reason, and see a searchable SKU/product stock list.
4. An operator can **manage products**: list/search, create, edit, toggle status, assign categories, manage image URLs — exactly what the backend product DTOs accept. **SKU/price/variant editing works only for products whose SKUs have never been ordered or reserved** (see §14 gap #5); scalar fields and status always work.
5. Minimal **category CRUD** (create/edit/delete) so the product form has a real category source.
6. RBAC is enforced by the **backend**; the UI only *mirrors* permission visibility from `/auth/me`.

# 3. Non-goals (explicit)

Out of scope for V1; referenced here so they are not silently included.

- **Sales dashboards / charts** — ADMIN_SPEC §6 (Sales Overview, COD Metrics, Marketing Overview, Inventory Alert). No charts, no KPI tiles.
- **COD risk center** — ADMIN_SPEC §9 (Recheck/RPT/Again/Duplicate orders, customer risk cards). No risk-level actions.
- **Customer history pages** — ADMIN_SPEC §10 (customer profile, order timeline, risk events).
- **Double-check orders / confirmation workflow pages** — ADMIN_SPEC §11. Confirm/Cancel ship as *actions on the order detail*, not as a separate workflow screen.
- **Marketing / FB modules** — ADMIN_SPEC §15 (Optimizer management, Facebook Pages/Posts, Ads Attribution).
- **FB order ingestion** — ADMIN_SPEC §16 (filtered FB-post order views).
- **Landing-page management** — ADMIN_SPEC §17.
- **Profit / finance reports** — ADMIN_SPEC §18 (Revenue, Product, Province, Optimizer reports), §20 audit-log UI.
- **System settings / user management UI** — ADMIN_SPEC §19 (payment/logistics settings, user management). The `users` API exists (SYSTEM_SETTINGS_EDIT) but no V1 UI. Logout + auth bootstrap only.
- **Collections admin** — `admin/collections` endpoints exist (PRODUCT_MANAGE) but V1 ships no collections UI (ruling).
- **Suppliers UI and reviews moderation** — V1.1 (see §15).
- **Shipments** — no shipment endpoints exist in the backend; `SHIPMENT_CREATE` is a permission without an endpoint. Out of V1.
- **File upload** — product images are URL strings in the DTO; no upload endpoint exists. Image "management" = editing URL rows.
- **New npm dependencies, new backend migrations, fake/seed data in the UI.** Real empty states only.

# 4. Information architecture

## 4.1 Route map

| Route | Screen | Backend endpoints used |
|---|---|---|
| `/admin/login` | Login (no shell) | `POST /auth/login`, `GET /auth/me` |
| `/admin/orders` | Order list | `GET /admin/orders` |
| `/admin/orders/[id]` | Order detail | `GET /admin/orders/:id`, `POST /admin/orders/:id/confirm`, `POST /admin/orders/:id/cancel` |
| `/admin/inventory` | Stock list + adjust | `GET /admin/products` (SKU source), `POST /admin/inventory/adjust` |
| `/admin/products` | Product list | `GET /admin/products`, `DELETE /admin/products/:id` |
| `/admin/products/new` | Create product | `POST /admin/products`, `GET /admin/categories` |
| `/admin/products/[id]/edit` | Edit product | `PATCH /admin/products/:id`, `GET /admin/products/:id`, `GET /admin/categories` |
| `/admin/categories` | Category tree CRUD | `GET /admin/categories`, `POST /admin/categories`, `PATCH /admin/categories/:id`, `DELETE /admin/categories/:id` |

URL vocabulary follows ADMIN_SPEC §5's tree, flattened to the four V1 modules: **Orders** (Sales → Orders), **Inventory** (Inventory → Stock), **Products** (Catalog → Products), **Categories** (Catalog → Categories).

## 4.2 Nav → role mapping

Nav items are rendered only when the signed-in account holds the granting permission. Backend grants come from `backend/prisma/seed.ts` `GRANTS` (roles are seed data, not schema; the `User → Role → Permission` chain is live). `/auth/me` returns `permissions: PermissionCode[]`; the UI maps each nav item to a required code:

| Nav item | Required permission | Who sees it (per seed grants) |
|---|---|---|
| Orders | `ORDER_VIEW_ALL` | SUPER_ADMIN, ADMIN, CONFIRMOR, WAREHOUSE, FINANCE |
| Inventory | `INVENTORY_VIEW` | SUPER_ADMIN, ADMIN, WAREHOUSE |
| Products | `PRODUCT_MANAGE` | SUPER_ADMIN, ADMIN |
| Categories | `PRODUCT_MANAGE` | SUPER_ADMIN, ADMIN |

Role-by-role consequence (grants from seed):

- **SUPER_ADMIN** — all four modules; every action.
- **ADMIN** — all four modules; Confirm/Cancel (ORDER_CONFIRM + ORDER_CANCEL), stock adjust (INVENTORY_ADJUST), product/category writes (PRODUCT_MANAGE). Cannot manage users (no SYSTEM_SETTINGS_EDIT).
- **CONFIRMOR** — Orders only. Can Confirm/Cancel, cannot touch products/inventory. (CUSTOMER_RISK_* and the confirm path exist but there is no risk UI in V1.)
- **WAREHOUSE** — Orders (read) + Inventory (read). Cannot adjust stock (no INVENTORY_ADJUST).
- **FINANCE** — Orders (read) only in V1 (REPORT_PROFIT_VIEW has no report UI).
- **OPTIMIZER** — has only `ORDER_VIEW_OWN`; **no V1 endpoint implements own-order filtering** (the admin orders endpoint requires `ORDER_VIEW_ALL`). An OPTIMIZER who logs in lands on the **"No modules available"** empty state. See §14 backend gap #3 / open question O3.

Action visibility inside a screen (permission → enabled/disabled/hidden):

| Action | Endpoint | Required permission |
|---|---|---|
| Confirm order | `POST /admin/orders/:id/confirm` | `ORDER_CONFIRM` |
| Cancel order | `POST /admin/orders/:id/cancel` | `ORDER_CANCEL` |
| Adjust stock | `POST /admin/inventory/adjust` | `INVENTORY_ADJUST` |
| Product create/edit/delete | `POST/PATCH/DELETE /admin/products` | `PRODUCT_MANAGE` |
| Category create/edit/delete | `POST/PATCH/DELETE /admin/categories` | `PRODUCT_MANAGE` |

# 5. Admin API surface (the contract the UI is built on)

All admin routes run behind `JwtAuthGuard` + `PermissionsGuard`. **Critical security fact:** the admin guard *rejects* JWTs carrying `kind: 'customer'` (backend/src/modules/auth/jwt-auth.guard.ts line 44), and admin login (`POST /auth/login`) mints tokens **without** that claim. Storefront customer tokens therefore cannot call admin routes.

## 5.1 Auth (`backend/src/modules/auth/auth.controller.ts`)

| Endpoint | Body | Response |
|---|---|---|
| `POST /auth/login` | `{email, password}` | `{accessToken, refreshToken, expiresAt, user:{id,name,email,status}}` |
| `POST /auth/refresh` | `{refreshToken}` | `{accessToken, refreshToken, expiresAt}` (rotates; previous token revoked server-side) |
| `POST /auth/logout` | `{refreshToken}` | `{ok:true}` (idempotent) |
| `GET /auth/me` (Bearer) | — | `{id, name, email, status, roles:[{code,name}], permissions:["ORDER_VIEW_ALL",…]}` |

- Login DTO: `email` (email, ≤255), `password` (8–128).
- TTLs from env: access 1h, refresh 7d.
- A disabled user (`status !== ACTIVE`) gets 401 on **login** and on **refresh** (`auth.service.ts` re-checks status on both), and **403** on permission-guarded calls while a still-valid access token lives (PermissionsGuard throws `ForbiddenException`). `GET /auth/me` itself is NOT status-checked (it runs only `JwtAuthGuard`), so `/me` keeps returning 200 for a disabled user until the access token expires — the UI bootstrap therefore clears the session when the next refresh is rejected (m3).

## 5.2 Orders (`backend/src/modules/orders/admin/orders.controller.ts`, service `orders.service.ts`)

- `GET /admin/orders?status=&search=&dateFrom=&dateTo=&page=&pageSize=` (requires `ORDER_VIEW_ALL`)
  - `status` = one of `OrderStatus`; `search` ≤255 matched against orderNumber / customer.name / customer.normalizedPhone (case-insensitive contains); `dateFrom`/`dateTo` = `YYYY-MM-DD`; `page`≥1; `pageSize` 1–100 default 20.
  - **Note: the query schema has NO `confirmationStatus` filter** (§14 gap #2).
  - Response: `{items: OrderListItem[], total, page, pageSize}`. Each item: full `Order` row (id, orderNumber, orderStatus, confirmationStatus, paymentStatus, currency, subtotal, discountTotal, shippingTotal, grandTotal, optimizerId, optimizerAidSnapshot, optimizerNameSnapshot, customerClassification, confirmedBy, confirmedAt, confirmationNote, createdAt, updatedAt, customerId) + `customer: Customer` + `items: [{id, skuCodeSnapshot, productNameSnapshot, quantity, lineTotal}]`.

  - **Wire-format note (applies to every admin response below):** the admin controllers return raw Prisma rows, so every `Decimal` column (subtotal, grandTotal, unitPrice, unitDiscount, unitCostSnapshot, lineTotal, sku price/compareAtPrice/supplierCost/landedCost, payment amount) arrives as a **JSON string**, and `Customer` has `name`, `normalizedPhone` (E.164), `email`, `currentRiskLevel` — there is **no `customer.phone`** field (the storefront paths `Number()`-convert Decimals; the admin paths do not). The UI renders money through a `formatAmount(value: string | number | null, currency?)` helper that coerces and formats, and displays the phone as `customer.normalizedPhone`.
- `GET /admin/orders/:id` (requires `ORDER_VIEW_ALL`) — full detail:
  `order + customer + items(full OrderItem: productNameSnapshot, skuCodeSnapshot, variantSnapshot, quantity, unitPrice, unitDiscount, unitCostSnapshot, lineTotal) + shippingAddress(fullName, phone, province, city, barangay, postalCode, streetAddress, landmark) + attribution(OrderAttribution) + payments(Payment[]) + statusHistory([{statusDomain, oldStatus, newStatus, source, operatorId, comment, createdAt}] asc) + reservations(InventoryReservation[])`.
- `POST /admin/orders/:id/confirm` (requires `ORDER_CONFIRM`) — sets `orderStatus=CONFIRMED`, `confirmationStatus=CONFIRMED`, `confirmedBy/At`, appends two history rows (ORDER_STATUS + CONFIRMATION_STATUS). **Guards:** 404 unknown; 400 if CANCELLED/DENIED; 400 if SHIPPING/SIGNED; 409 if already CONFIRMED. Returns the updated order (no include).
- `POST /admin/orders/:id/cancel` (requires `ORDER_CANCEL`) — sets `orderStatus=CANCELLED`, releases reservations (stock returns to available), appends one history row. **Guards:** 400 if terminal (`CANCELLED`, `DENIED`, `SIGNED`, `AFTER_SALES`); 400 if `SHIPPING`. Returns the updated order.

**Order status vocabulary** (`OrderStatus` enum): `NEW`, `PENDING`, `QUESTION`, `CONFIRMED`, `ABNORMAL`, `SHIPPING`, `SIGNED`, `CANCELLED`, `DENIED`, `AFTER_SALES`.
**Confirmation status** (`ConfirmationStatus`): `UNCONFIRMED`, `NEEDS_REVIEW`, `CONFIRMED`, `REJECTED`.
**Payment status** (`PaymentStatus`): `COD_PENDING`, `COLLECTED`, `SETTLEMENT_PENDING`, `SETTLED`, `ONLINE_PENDING`, `PAID`, `FAILED`, `REFUNDED`, `PARTIALLY_REFUNDED`.
**Source type** (`SourceType`): `FB_POST`, `META_AD`, `ORGANIC`, `DIRECT`, `EMAIL`, `OTHER`.

## 5.3 Inventory (`backend/src/modules/inventory/admin/inventory.controller.ts`, service `inventory.service.ts`)

- `POST /admin/inventory/adjust` (requires `INVENTORY_ADJUST`) — body `{skuId: uuid, quantity: int (-1_000_000..1_000_000), reason?: string | null ≤255}` (the DTO is `.nullable().optional()`; the controller coalesces null → undefined, so the client may omit reason or send an empty string).
  - Service rules: quantity **0 rejected**; negative must not push on-hand below 0; first adjustment for a SKU *creates* the inventory record (positive only; reason defaults to "initial stock"); returns `{onHand, reserved, available}` where `available = onHand − reserved`.
- **There are NO inventory GET endpoints.** No stock list, no movement history. `GET /admin/products` returns SKUs but **no stock counts** (the admin include is `variants: { include: { sku: true } }`; `availableInventory` is only added on the *storefront* path). See §14 gap #1.

## 5.4 Products (`backend/src/modules/catalog/admin/products.controller.ts`, service `products.service.ts`, DTO `dto/product.dto.ts`)

- `GET /admin/products?search=&status=&categoryId=&page=&pageSize=` (requires `PRODUCT_MANAGE`) → `{items, total, page, pageSize}`.
  - `search` ≤255 (name/slug contains, insensitive); `status` ∈ `ProductStatus`; `categoryId` uuid (exact-match, **not** subtree expansion — that is storefront-only).
  - Each item: `Product` + `images[]` (id, url, altText, sortOrder asc) + `variants[]` (id, name, position, sku: full `Sku` row including skuCode, status, supplierSku, supplierCost, costCurrency, landedCost, price, compareAtPrice, productWeight, packageWidth/Height/Depth, packageWeight, volumetricWeight).
- `GET /admin/products/:id` — same shape, 404 if missing.
- `POST /admin/products` — `createProductSchema` (see §9). 400 if category missing; 409 on slug conflict (P2002); 400 on FK violation (P2003). Returns created product (full admin include).
- `PATCH /admin/products/:id` — `updateProductSchema`: partial of base minus defaults; **`images` and `variants` are whole-list replacements** when present (variants are deleteMany + recreate). Returns updated product. **Limitation (spec §14 gap #5):** because the variant update recreates SKUs with new ids, any variants-bearing PATCH on a product whose SKUs are referenced by an order item or reservation (including RELEASED) fails with 400 `"Referenced record does not exist"`.
- `DELETE /admin/products/:id` — cascade deletes variants/SKUs/images; **blocked by order items or inventory reservations** (Restrict FKs on `skus.id` — reservations are retained even after release, so they keep blocking). **Cart items do NOT block** (`CartItem→Sku` is `onDelete: Cascade`). `remove()` has no try/catch (`products.service.ts:229-247`), so the restricted FK surfaces as an unhandled Prisma P2003 → **HTTP 500** with a generic message, NOT the clean 400 `"Referenced record does not exist"` (that string is produced only by create/update's `rethrowKnown`). Returns `{ok:true}` when it succeeds. A clean 400 would be a backend change → §14 gap #6.

**Product status** (`ProductStatus`): `DRAFT`, `ACTIVE`, `DISABLED`. *(The ruling's "ACTIVE/INACTIVE" maps to the real `ACTIVE` / `DISABLED` values; `DRAFT` is the create default and a valid saved state.)*
**SKU status** (`SkuStatus`): `ACTIVE`, `DISABLED`.
**Room**: `BEDROOM`, `STORAGE`, `DINING_LIVING`, `HOME_OFFICE`.
**Solution** (multi): `FOLDABLE`, `NARROW_SPACE`, `MOBILE`, `MULTIFUNCTIONAL`, `HIDDEN_STORAGE`, `RENTAL_FRIENDLY`.
**InternalProductRole**: `HERO`, `CORE`, `ENTRY`, `PREMIUM`, `PRE_ORDER`.

## 5.5 Categories (`backend/src/modules/catalog/admin/categories.controller.ts`, service `categories.service.ts`, DTO `dto/category.dto.ts`)

- `GET /admin/categories` (requires `PRODUCT_MANAGE`) — **tree** (roots ordered by sortOrder then name, nested `children[]`; every status included).
- `POST /admin/categories` — `{name, slug, parentId?, sortOrder=0, imageUrl?, status=ACTIVE}`; 409 on slug conflict.
- `PATCH /admin/categories/:id` — partial of create; 400 "A category cannot be its own parent".
- `DELETE /admin/categories/:id` — children promoted to root (SetNull); 400 "Category still has products" if products attached (Restrict). Returns `{ok:true}`.

**Category status** (`CategoryStatus`): `ACTIVE`, `DISABLED`.

## 5.6 Users (`backend/src/modules/users/users.controller.ts`, requires `SYSTEM_SETTINGS_EDIT` = SUPER_ADMIN only)

`GET /users`, `GET /users/:id`, `POST /users` (`{name,email,password,roleCodes[]}`), `PATCH /users/:id`. **Available but no V1 UI** (open question O6). Never expose `passwordHash`.

# 6. Auth & session mechanics

Mirrors the hard-won patterns of `frontend/src/lib/auth.ts` **exactly** (single-flight refresh, session epoch, access token in module memory), but in a **separate client module** (`lib/admin-auth.ts`) with its own refresh-only storage key, because admin identity is a different backend table (`User`, not `CustomerAccount`).

**Storage:** mirror `lib/auth.ts` — only the **refresh token persists**, under the single admin key `sh_admin_refresh` (TTL 7d, rotated on every refresh). The **access token (TTL 1h) lives only in module memory** and is never written to localStorage; there is **no `sh_admin_access` key** (M5).

Storefront keys (`sh_refresh`, cartId) are never touched by the admin client. A storefront customer token attached by a caller is rejected by the backend guard (`kind:'customer'`).

**Session lifecycle:**
1. `AdminAuthProvider` mounts → reads `sh_admin_refresh`; if present, runs single-flight `refreshAdminAccess()` → `adminAuthApi.me()` → `{status:'authed', admin}`. If no token or refresh/me fails → `clearAdminSession()` → `{status:'guest'}`.
2. Access token lives in module memory after bootstrap (mirrors `auth.ts`); the refresh token is persisted so a reload can bootstrap again.
3. Every admin fetch uses `adminAuthedFetch`: attach `Authorization: Bearer <access>`; on **401** → single-flight refresh (rotates the refresh token, writes the new refresh token under an epoch guard) → retry once; on refresh failure → `clearAdminSession()` (bumps epoch, wipes the key, emits `admin-session-end`).
4. **Logout** — synchronous local clear first (epoch bump, wipe the refresh key, emit), then best-effort `POST /auth/logout` with the refresh token. Never blocked by the network.

**Route guard:** `AdminShell` (client) redirects `guest → /admin/login?next=<path>` (using `safeAdminNext`, the admin variant of the `safeNext` whitelist — M1); `loading →` skeleton; `authed →` shell.

**Login redirect:** after `login()`, push `safeAdminNext(searchParams.get('next'))` — it validates like `safeNext` but defaults to `/admin/orders` (the shared `safeNext` defaults to the storefront `/account`, which an admin login must never land on).

# 7. RBAC enforcement model

- **Backend is the authority.** Every admin call is guarded server-side; the UI can hide or disable a control, but a 403 from the backend is still surfaced (inline alert with the backend message, no silent ignore).
- UI permission source of truth: `/auth/me` `permissions[]` captured at bootstrap. `hasPermission(code)` is a pure helper.
- **Nav filtering:** items rendered by permission (§4.2). **Action filtering:** Confirm/Cancel/adjust/delete buttons rendered only with the permission; disabled while a request is in flight.
- **Data-race policy:** when a 403/409/400 arrives, show the backend message verbatim and refetch the row/page so the UI resyncs with server truth.

# 8. Screens

Shared layout grammar (from DESIGN_SYSTEM tokens, see §12): page padding `px-4 md:px-8`, max-width `max-w-[1200px]` (the `--container-content: 1200px` token is defined in `globals.css:39` but Tailwind v4 does not mint a `max-w-container-content` utility from it — the codebase writes the arbitrary-value form, e.g. `frontend/src/app/page.tsx:59`, m10), cards `rounded-xl border border-border bg-card`, headings `text-xl font-semibold text-ink`, body `text-sm text-ink-secondary`.

## 8.1 `/admin/login`

Standalone page **not wrapped in the admin shell** (it needs no sidebar, and the shell would bounce it). Centered card (`mx-auto max-w-[420px]`), "Small House Admin" wordmark, email + password fields, submit, inline error.

- Fields: Email (`type=email`, `autoComplete=email`), Password (`type=password`, `autoComplete=current-password`).
- Action `login(email, password)` → `POST /auth/login` → persist the refresh token (access stays in module memory) → `GET /auth/me` → push `safeAdminNext(next)` (M1: the shared `safeNext` defaults to the storefront `/account`; `safeAdminNext` defaults to `/admin/orders`).
- **Errors:** 401 → "Invalid email or password." (backend returns `UnauthorizedException 'Invalid credentials'`; map to a friendly message). Network/5xx → message + form stays.
- Already-authed accounts hitting `/admin/login` are redirected on mount to `safeAdminNext(next)` (m12).

## 8.2 Admin shell (`app/admin/layout.tsx` + `AdminShell`)

- **Desktop (≥768px):** fixed left sidebar (w-56) with nav; top bar with current page title, signed-in user name + role(s), Logout button. Content area scrolls.
- **Mobile (<768px):** top bar with hamburger → slide-over drawer (backdrop, Esc, focus return to trigger) reusing the mega-menu drawer interaction pattern.
- Sidebar nav = §4.2 filtered list; active route highlighted (`bg-primary-light/40 text-cta`).
- Top-right: `{admin.name}` + role code chip + **Log out** (`adminAuthApi.logout()` → redirect `/admin/login`).
- **Guard states:** `loading` → full-height skeleton; `guest` → redirect login; `authed` but **zero visible nav items** (e.g. OPTIMIZER) → centered empty state "No modules available for your account. Contact a Super Admin." with logout.

## 8.3 `/admin/orders` — order list

**Layout:** PageHeader (title "Orders" + count), filter bar, data table, pagination.

**Filters (top bar):**
| Filter | Control | Backed by |
|---|---|---|
| Search | text input (order number / customer name / phone) | `GET /admin/orders?search=` |
| Order status | select of `OrderStatus` + "All statuses" | `GET /admin/orders?status=` |
| From / To date | two `<input type="date">` | `?dateFrom=&dateTo=` (YYYY-MM-DD) |
| *(Confirmation status — deferred, see §14 gap #2)* | — | — |

Filters submit on change (debounced search, 300ms); reset control clears the query; state kept in URL search params so a reload preserves it.

**Table columns** (ADMIN_SPEC §7.1, subset available from the list endpoint):
Order Number (link → detail) · Created · Customer (`customer.name`) · Phone (`customer.normalizedPhone`) · Items (`N items`, first product name truncated) · Total (`formatAmount(grandTotal, currency)`) · Order Status (Badge) · Confirmation Status (Badge) · Payment Status (Badge) · Actions.

**Actions:**
- **View** → row click / Order Number link → `/admin/orders/[id]`.
- **Confirm** (only if `ORDER_CONFIRM` and row is eligible: not CANCELLED/DENIED/SHIPPING/SIGNED and confirmationStatus ≠ CONFIRMED) → inline button. Confirmation dialog wording: *"Confirm order {orderNumber}? This marks it confirmed for fulfillment."* → `POST /admin/orders/:id/confirm`. Optimistic: button → pending spinner; on success replace the row's status cells from the returned order; on 409/400 show inline alert with backend message and refetch the page (server truth).
- **Cancel** (only if `ORDER_CANCEL` and not terminal/SHIPPING) → dialog wording: *"Cancel order {orderNumber}? Reserved stock is released."* → `POST /admin/orders/:id/cancel`. Same optimistic/error handling.

**Empty state:** "No orders found." + hint to clear filters when filters are active.
**Error state:** inline alert `role="alert"` + Retry button re-running the current query.

## 8.4 `/admin/orders/[id]` — order detail

**Layout:** back link ("← Orders"), PageHeader (order number + status badges), action bar (Confirm / Cancel), then stacked cards: Order, Customer & Address, Items, Attribution, Payments, Timeline.

**Order card** — orderNumber, createdAt, currency, orderStatus (Badge), confirmationStatus (Badge), paymentStatus (Badge), subtotal, discountTotal, shippingTotal, grandTotal (all amounts via `formatAmount`). Source: `GET /admin/orders/:id`.

**Customer & address card** — customer.name, customer.normalizedPhone, customer.currentRiskLevel, shippingAddress (fullName, phone, province, city, barangay, postalCode, streetAddress, landmark). Customer id shown muted (link target for future customer-history work).

**Items card** — table: productNameSnapshot, variantSnapshot, skuCodeSnapshot, quantity, unitPrice (`formatAmount`), unitDiscount, lineTotal (`formatAmount`). Cost snapshot (`unitCostSnapshot`) shown to roles with profit visibility only (`REPORT_PROFIT_VIEW`); otherwise omitted. Grand totals row.

**Attribution card (read-only)** — two sources (M3): the **Order row** supplies `optimizerAidSnapshot` (AID), `optimizerNameSnapshot`, `customerClassification`, `optimizerId`; the **`order.attribution` relation** supplies `sourceType` (SourceType label), `aidSnapshot`, `facebookPageId/PostId/PostTrackingCode`, `campaignId`, `adsetId`, `adId`, `landingPageId`, `utmSource/Medium/Campaign/Content/Term`, `fbclid`, `attributedAt`. (`OrderAttribution` has no `optimizerNameSnapshot`/`customerClassification` columns — reading them off the attribution object would render em-dash forever.) Empty fields render as em-dash, never omitted columns.

**Timeline card** — `statusHistory` asc: each row `{statusDomain} {old → new} · {source} · {operatorId} · {comment?} · {createdAt}`. Domain-badged (ORDER_STATUS / CONFIRMATION_STATUS). Newest last; the initial `NEW · SYSTEM` row present.

**Reservations** — compact list (skuId, quantity, status, warehouseId) as a sub-section of Items (read-only).

**Actions (same as list):** Confirm / Cancel with identical dialogs and error handling; after success, refetch the detail and the action bar re-renders from the returned statuses (Confirm disappears once CONFIRMED; Cancel once terminal).

## 8.5 `/admin/inventory` — stock list + adjust

**Important scoping (backend gap #1):** without a stock GET endpoint, live **On Hand / Reserved / Available cannot be shown in the list**. V1 sources the searchable SKU list from `GET /admin/products` (which yields SKU code, product name, variant, price, status) and shows adjusted counts **inline after each adjustment** (the adjust response returns `{onHand, reserved, available}`). Persistent stock columns and movement history await the human authorizing §14 gap #1.

**Layout:** PageHeader ("Inventory"), search input (matches SKU code and product name — the products endpoint `search` matches name/slug, so SKU-code search is a client-side filter over the fetched page-set within the products search; documented behavior), table, adjust dialog.

**Table columns:** SKU Code · Product · Variant · Price (`formatAmount(sku.price)`) · Sku Status (Badge) · Product Status (Badge) · Stock (last-known after-adjust `available`/`onHand` for rows adjusted this session; else "—") · Actions (Adjust).

**Action — Adjust** (requires `INVENTORY_ADJUST`): dialog with SKU read-only, Quantity (integer, positive or negative), Reason (required by practice; max 255). Confirmation wording: *"Adjust stock for {skuCode} by {±n}? Reason: {reason}."* → `POST /admin/inventory/adjust {skuId, quantity, reason}`. Optimistic: pending state on the row; success → inline notice "Updated — on hand {onHand}, reserved {reserved}, available {available}" + set the row's Stock cell. Error (400 negative on-hand, 0 qty): show backend message in the dialog, keep it open.

**Empty state:** "No SKUs found." **Search hint:** the products endpoint searches product name/slug; SKU-code matches are applied client-side to the loaded page — documented so operators use product-name search for reliable results until the gap is authorized.

## 8.6 `/admin/products` — product list

**Layout:** PageHeader + "New product" button (PRODUCT_MANAGE), filter bar, table, pagination.

**Filters:** Search (`?search=`), Status select (`DRAFT`/`ACTIVE`/`DISABLED`/All → `?status=`), Category select (from `GET /admin/categories` tree, flat options with indent → `?categoryId=`).

**Table columns:** Product (name + first image thumbnail/PlaceholderImage) · Slug · Category (name) · Status (Badge) · Price (first SKU's price, else "—") · Variants/SKUs count · Updated · Actions.

**Actions:** **Edit** → `/admin/products/[id]/edit`. **Delete** (PRODUCT_MANAGE) → dialog wording: *"Delete {name}? Its variants, SKUs and images are removed. This fails if any order item or reservation references its SKUs."* → `DELETE /admin/products/:id`. Optimistic: row removed. Error handling (M2): a blocked delete (order items or reservations — including RELEASED — on any SKU) surfaces as **HTTP 500** with a generic Prisma message, NOT the clean 400; cart items do not block (Cascade). On any non-2xx show the generic message, refetch, keep the row. **New product** → `/admin/products/new`.

## 8.7 `/admin/products/new` — create product

Full form over `createProductSchema` (§9). Sectioned cards: **Basics** (name, slug, description, categoryId select, status, room, internalRole, solutions multi-checkbox), **Dimensions** (width, height, depth, foldedWidth/Height/Depth), **Images** (repeating rows: url, altText, sortOrder), **Variants & SKUs** (repeating cards: variant name, position, and nested SKU fields: skuCode, status, price, compareAtPrice, supplierSku, supplierCost, costCurrency, landedCost, productWeight, packageWidth/Height/Depth, packageWeight, volumetricWeight).

- **Save** → `POST /admin/products`. Success → redirect to `/admin/products/[id]/edit`. Errors: 400 category missing / validation → field-level + top alert; 409 slug conflict → alert "A product with this slug already exists."
- Category select requires at least one category; if the tree is empty show an inline link to `/admin/categories`.

## 8.8 `/admin/products/[id]/edit` — edit product

Same form, loaded from `GET /admin/products/:id` (edit-only: no stock fields — stock lives in Inventory). **Save** → `PATCH /admin/products/:id`.

**Critical update semantics** (from the service): `images` and `variants` are **whole-list replacements** when present in the PATCH. The form must therefore submit the complete current lists (all rows, including untouched ones) whenever the user edited them — never a partial array. `status`/`solutions` are only sent when changed (they have no default in the update schema; omission leaves them untouched — do NOT send empty defaults that would wipe them).

**Hard limitation (spec §14 gap #5):** the variant update is `productVariant.deleteMany` + recreate (`products.service.ts:200-210`), so every SKU gets a **new id** on any variants-bearing PATCH. Because order items and reservations (including RELEASED) hold Restrict FKs on `skus.id`, the delete throws P2003 → **400 "Referenced record does not exist"**. Variant/SKU edits (including price changes via the variants list) therefore work only for products whose SKUs have never been ordered/reserved. Scalar product fields (name, slug, description, status, room, solutions, dimensions) and image edits on unreferenced products are unaffected. The form surfaces this 400 honestly (backend message, form stays open).

## 8.9 `/admin/categories` — category tree CRUD

**Layout:** PageHeader + "New root category" button, indented tree list (root → children), each row: name, slug, status Badge, sortOrder, actions.

- **New / Edit** dialog fields: name (required), slug (kebab), parentId (select of other categories, nullable), sortOrder (int), imageUrl (url, optional), status (ACTIVE/DISABLED). → `POST /admin/categories` / `PATCH /admin/categories/:id`.
- **Delete** dialog: *"Delete {name}? Child categories move to the root; this fails if any products use it."* → `DELETE /admin/categories/:id`; on 400 "Category still has products" show backend message.
- Client-side guard mirroring the service: parentId must not equal the category's own id ("A category cannot be its own parent").

# 9. Forms validation parity (zod DTOs → client)

Client validation mirrors the backend zod rules for **fast feedback**; the backend remains the authority (a mismatch always surfaces the backend error verbatim).

| Field | Rule (source) |
|---|---|
| Login email | email format, ≤255 (`auth.dto.ts`) |
| Login password | 8–128 (`auth.dto.ts`) |
| Product name | required, 1–255 (`product.dto.ts`) |
| Product slug | regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1–120, lowercase kebab (`category.dto.ts slugSchema`) |
| Product description | ≤5000, nullable |
| categoryId | valid uuid |
| status / room / internalRole / solutions | native enums `ProductStatus` / `Room` / `InternalProductRole` / `Solution[]` |
| width/height/depth, folded* | nonnegative numbers, nullable |
| image url | valid URL ≤2048 |
| image altText | ≤255 |
| variant name | 1–120 |
| variant position | int, default 0 |
| skuCode | required, 1–64 |
| sku price / compareAtPrice / costs / weights | nonnegative |
| sku status | `SkuStatus` enum |
| adjust quantity | int, −1_000_000..1_000_000, **nonzero** (service rejects 0) (`inventory.dto.ts`) |
| adjust reason | ≤255 |
| category name | 1–120 |
| category slug | kebab regex |
| category sortOrder | int |

# 10. Empty / loading / error states

- **Loading:** skeleton rows (`animate-pulse rounded bg-border`) sized to the expected table height; never a blank screen (COMPONENT_LIBRARY §24).
- **Empty:** real empty state card — `rounded-xl border border-border bg-card p-6 text-center`, primary line + secondary hint. Examples: "No orders found." / "No products yet — create your first product." / "No modules available for your account."
- **Error:** inline alert (`border border-sale/40 bg-sale/5 text-red-700`, `role="alert"`) showing the backend message; Retry button refetches. Mutation errors appear in the same surface as the action (dialog stays open for adjust; page alert for confirm/cancel/delete).
- **Out-of-stock / blocked states** are never faked; they come from the API.

# 11. Pagination conventions

- Backend pagination contract `Paged<T> = {items, total, page, pageSize}`; pageSize default 20 (orders/products).
- UI: Prev / Next + "Page {page} of {max(1, ceil(total/pageSize))}" + total count in the header. Page 1 while loading is a skeleton, not "Page 0 of 0".
- State lives in URL search params (`?page=2&status=…`) so browser back/forward and refresh keep the same page.

# 12. Accessibility baseline

- Semantic `<table>` with `<caption>`/`<th scope>`; sortable columns keyboard-accessible (V1 ships no column sort — backend has no sort param).
- All inputs have visible labels; focus ring `focus-visible:outline focus-visible:outline-2 focus-visible:outline-cta` (storefront pattern) on every interactive element.
- Dialogs: `role="dialog" aria-modal`, focus trap, `Esc` closes, initial focus on the primary control, focus returns to the trigger on close; backdrop click closes (consistent with the mega-menu drawer).
- Status is never color-only: badges pair the colored pill with the enum text (ADMIN_SPEC §22 colors as *enhancement*).
- `aria-live="polite"` on inline notices; mutation buttons announce pending/completed via `aria-busy` + disabled state.
- Touch targets ≥44px; admin is desktop-first but every control works at 768px.
- `prefers-reduced-motion`: dialogs/drawers render instantly.

**Status badge colors** (this map **extends** ADMIN_SPEC §22's green/yellow/red — §22 names only SIGNED/CONFIRMED/PAID, PENDING/RECHECK, DENIED/CANCELLED/FAILED, and RECHECK is not a real enum; the full map below covers every admin enum, using Tailwind's default palette as an admin-scope extension of the storefront beige palette, applied only inside `/admin/**`):
- Green (`bg-emerald-100 text-emerald-800`): `CONFIRMED`, `SIGNED`, `PAID`, `COLLECTED`, `SETTLED`, `CONFIRMED` (confirmation), `ACTIVE` (product/sku/category), `CONSUMED`, `RELEASED`.
- Amber (`bg-amber-100 text-amber-800`): `NEW`, `PENDING`, `QUESTION`, `ABNORMAL`, `SHIPPING`, `NEEDS_REVIEW`, `COD_PENDING`, `ONLINE_PENDING`, `DRAFT`, `ACTIVE` (reservation).
- Red (`bg-red-100 text-red-800`): `CANCELLED`, `DENIED`, `REJECTED`, `FAILED`, `REFUNDED`, `PARTIALLY_REFUNDED`, `DISABLED`.
- Neutral (`bg-border/40 text-ink-secondary`): `AFTER_SALES`, `SETTLEMENT_PENDING`, `PURCHASE_RECEIPT` etc. (anything unclassified renders neutrally, never unlabeled).

# 13. Security

1. **Separate token key.** Admin persists only the refresh token under `sh_admin_refresh`; the access token lives in module memory (mirroring `lib/auth.ts` — there is no `sh_admin_access` key, M5). The storefront client's `sh_refresh` and cart keys are never read/written by admin code.
2. **No customer-token acceptance.** The backend admin guard rejects `kind:'customer'` JWTs; the frontend admin client never attaches storefront tokens and never falls back to them.
3. **Permission-guarded routes.** Every `/admin/**` page sits behind the client route guard, and every data call carries the Bearer token; the backend guard is the enforcement boundary (UI hiding is UX, not security).
4. **localStorage exposure is bounded.** Only the rotating refresh token persists (TTL 7d, rotated on every refresh; the short-lived access token never touches storage). Logout wipes the key synchronously and revokes server-side (best effort). No token is ever placed in a URL; the `safeAdminNext` whitelist prevents open-redirect on the login redirect.
5. **No secrets in the client.** Supplier costs and profit fields render only under `REPORT_PROFIT_VIEW`; cost snapshots on order items are conditionally rendered with the same guard.
6. **403 handling is honest:** a permission the UI thought it had but the server denied is surfaced verbatim and the page resyncs — never swallowed.

# 14. Backend gaps (for human authorization — NO backend work until approved)

The design was deliberately constrained to the existing API. These are the places where the V1 UI is thinner than ADMIN_SPEC because the endpoint does not exist. **No backend change is designed or planned here**; each item is listed for the human to authorize separately.

1. **Inventory stock list + movement history.** There is no `GET /admin/inventory` (stock levels per SKU/warehouse) and no `GET /admin/inventory/movements` (the `InventoryMovement` model exists and is written by every mutation, but nothing reads it). Consequences in V1: the stock list cannot display On Hand / Reserved / Available; movement history (§14 of ADMIN_SPEC, ADMIN_SPEC §13 "View Movement History") cannot render. `available` is computed (`on_hand − reserved`) and is already returned by `POST /admin/inventory/adjust`.
2. **Order filter by confirmation status.** `orderQuerySchema` (`orders/dto/order.dto.ts`) accepts `status` (OrderStatus), `search`, `dateFrom`, `dateTo` — no `confirmationStatus`. ADMIN_SPEC §7.2 lists it. The list UI ships without the Confirmation-status filter until the query schema grows a `confirmationStatus` param (the detail page still shows the column from the response).
3. **OPTIMIZER own-orders.** `ORDER_VIEW_OWN` exists as a permission but no endpoint filters by `optimizerId`/attribution. An OPTIMIZER logging into V1 admin sees the "No modules" state. Either acceptable for V1 (documented) or needs an own-orders branch on `GET /admin/orders`.
4. **Product stock in admin product responses.** `GET /admin/products` items carry SKUs with no `availableInventory`/onHand (only the storefront serializer enriches stock). Purely additive display gap — stock editing already routes through the Inventory adjust endpoint.
5. **In-place variant/SKU update semantics.** The PATCH variant path deletes and recreates variants/SKUs (`products.service.ts:200-210`), assigning **new SKU ids**. Once a SKU is referenced by an order item or reservation (including RELEASED — Restrict FKs), any variants-bearing PATCH fails with 400 `"Referenced record does not exist"`. V1 consequence: SKU/price/variant editing works only for never-ordered products; scalar product fields and status toggles are unaffected. A fix requires in-place variant/SKU updates or an update-SKU endpoint — **not authorized for V1**.
6. **Product DELETE error status.** `remove()` has no try/catch, so a delete blocked by order items/reservations returns **HTTP 500** with a generic Prisma message instead of a clean 400. A fix (exception filter or try/catch mapping P2003 → 400) is a backend change — not authorized for V1; the UI treats any non-2xx as a blocked delete and refetches.

# 15. V1.1 (note only — no tasks planned here)

- **Reviews moderation:** `GET /admin/products/:productId/reviews`, `POST /admin/products/:productId/reviews`, `PATCH/DELETE /admin/reviews/:id` (all `PRODUCT_MANAGE`). Admin seeding for cold-start; `isVisible` toggling.
- **Suppliers UI:** `GET/POST/PATCH/DELETE /admin/suppliers` (PRODUCT_MANAGE) — needed to make the SKU form's supplier fields useful.
- Collections admin (PRODUCT_MANAGE endpoints exist), customer management UI (CUSTOMER_MANAGE), user management UI (SYSTEM_SETTINGS_EDIT).

# 16. Open questions for the human

- **O1. Inventory endpoints (gap #1):** authorize adding `GET /admin/inventory` (+ optional `GET /admin/inventory/movements`) so the Stock page can show live On Hand / Reserved / Available and movement history? V1 otherwise ships the searchable SKU list + adjust-only, with stock counts visible only immediately after an adjustment.
- **O2. Confirmation-status filter (gap #2):** authorize adding `confirmationStatus` to the order query schema?
- **O3. OPTIMIZER role in V1 (gap #3):** ship the "No modules" state, or add own-order filtering to `GET /admin/orders`?
- **O4. Product status vocabulary:** the ruling said "ACTIVE/INACTIVE"; the schema/DTO use `DRAFT` / `ACTIVE` / `DISABLED`. V1 encodes the real enum (DRAFT is the create default). Confirm `DRAFT` is an acceptable visible state in the UI.
- **O5. Route-group restructure:** giving `/admin` chrome-free layout requires moving the storefront routes into a `(storefront)` route group (URLs unchanged, root layout becomes minimal). Confirm this refactor is acceptable alongside the admin build.
- **O6. User management UI:** the `users` API is ready (SUPER_ADMIN only). Ship a minimal users list/create UI in V1, or defer to V1.1/V1.5? (V1 scope as ruled does not include it.)
- **O7. Admin status colors:** the spec introduces Tailwind emerald/amber/red badges under `/admin/**` (extending ADMIN_SPEC §22's green/yellow/red), extending the storefront beige palette. Confirm.
- **O8. SKU/price editing limit (gap #5):** variant/SKU edits (including price changes via the variants list) return 400 for any product whose SKUs have ever been ordered or reserved. V1 ships the limitation honestly; authorizing an in-place variant/SKU update endpoint (or update-SKU endpoint) is a backend change for a later wave.

# 17. Verification approach (per task in the plan)

Frontend-only gates (no backend work): `pnpm lint` + `pnpm exec tsc --noEmit` + `pnpm build`, run in `frontend/`, then a written Chrome/manual checklist per task at `http://localhost:3001` (desktop ≥1280px + 768px). The seed creates exactly **one** account (SUPER_ADMIN at `dev@smallhouse.test` — `backend/prisma/seed.ts` `ensureInitialAdmin`, m5); create ADMIN, CONFIRMOR, WAREHOUSE and OPTIMIZER users via `POST /api/v1/users` as SUPER_ADMIN for the role matrix. No test framework is added (frontend has none and the ruling forbids new deps).
