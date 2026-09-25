# Admin Global Search — Phase B Design

**Date:** 2026-09-25
**Status:** Implemented and verified locally; awaiting Phase B acceptance (not pushed or deployed)
**Branch:** `feature/admin-product-ui-redesign`

## 1. Purpose

Replace the honest, non-interactive Global Search slot introduced in Admin Phase A with a real command palette that searches Products, Orders, Customers, and Shipments without changing business truth or leaking data across RBAC boundaries.

Success means an authorized operator can open search with `⌘K` / `Ctrl+K`, type a query, navigate grouped real results by keyboard or mouse, and land in the relevant existing admin context. The implementation must not introduce fake results, fake counts, a second Product/Order data path, or a schema migration.

## 2. Scope

### Included

- One authenticated aggregate search endpoint.
- Product, Order, Customer, and Shipment result groups.
- Exact → Prefix → Contains ranking.
- Entity-level RBAC omission.
- Product/SKU, Order, Customer, and Shipment result navigation.
- Stable Product Editor SKU deep linking.
- A full `/admin/search?q=...` results page for “View all results”.
- Loading, empty, error, keyboard, pointer, and accessibility states.
- Unit, integration, E2E, typecheck, lint, build, and screenshot verification.

### Excluded

- Notifications.
- PDP changes.
- Product Media workspace changes.
- Prisma schema changes or migrations.
- New npm dependencies.
- Fuzzy/typo/semantic/vector search.
- Search history, saved searches, analytics, or cross-user caching.
- `ORDER_VIEW_OWN` support until “own order” search scope is explicitly defined.

## 3. Existing Constraints Preserved

- Products remain guarded by `PRODUCT_MANAGE`.
- Orders remain guarded by `ORDER_VIEW_ALL` for the V1 admin workbench.
- Customers remain guarded by `CUSTOMER_MANAGE`.
- Shipment read results follow `ORDER_VIEW_ALL`; `SHIPMENT_CREATE` remains a write permission only.
- Existing ProductForm, Catalog Graph, Variant/SKU identities, inventory save flow, OrdersService checkout, and RBAC data model are unchanged.
- Existing `/admin/products?search=...` and `/admin/orders?search=...` URL filters remain valid.
- No production migration or deployment is part of this phase.

## 4. Approaches Considered

### A. Frontend fan-out to four list APIs — rejected

This would send four authenticated requests after every debounced query. The Product and Order list APIs load data and counts that a command palette does not need; Product list search also lacks SKU matching. It creates inconsistent failure/loading behavior and multiplies authorization and cancellation work in the browser.

### B. Aggregate controller calling existing full list methods — rejected

This reduces browser requests but retains the expensive list projections, count queries, stock enrichment, and missing ranking behavior. Shipment still has no list method, and Customer search still lacks email.

### C. Dedicated aggregate read model — selected

A new SearchModule owns a narrow, read-only cross-domain projection. It performs one permission snapshot query, then runs only authorized entity queries in parallel. Queries select only result fields, rank in PostgreSQL, fetch `limit + 1`, and never execute total counts. Existing domain write services remain untouched.

## 5. Backend Architecture

### 5.1 Endpoint

```text
GET /api/v1/admin/search?q=<query>&limit=<n>
Authorization: Bearer <admin access token>
Cache-Control: private, no-store
```

Validation:

- Trim and collapse repeated whitespace.
- `q`: 2–100 characters after normalization.
- `limit`: default 5, minimum 1, maximum 20.
- Exact and prefix matching are available from 2 characters.
- Contains matching is enabled only from 3 characters.
- Invalid input returns 400 through the existing ZodValidationPipe.

The command palette always requests `limit=5`. The full results page may request up to 20 per group.

### 5.2 Response

```ts
interface AdminSearchResponse {
  query: string;
  groups: {
    products?: SearchGroup<ProductSearchHit>;
    orders?: SearchGroup<OrderSearchHit>;
    customers?: SearchGroup<CustomerSearchHit>;
    shipments?: SearchGroup<ShipmentSearchHit>;
  };
}

interface SearchGroup<T> {
  items: T[];
  hasMore: boolean;
}
```

Unauthorized groups are omitted, not returned with hidden totals or sentinel values.

`hasMore` is derived by requesting `limit + 1`; no count query is executed.

### 5.3 Product hit

```ts
interface ProductSearchHit {
  kind: "PRODUCT";
  productId: string;
  name: string;
  productCode: string | null;
  slug: string;
  status: "DRAFT" | "ACTIVE" | "DISABLED";
  matchedField: "PRODUCT_CODE" | "SKU_CODE" | "NAME" | "SLUG";
  matchedText: string;
  matchedSku: {
    skuId: string;
    skuCode: string;
    skuStatus: "ACTIVE" | "DISABLED";
    variantId: string;
    variantName: string;
    price: string | null;
    availableInventory: number;
  } | null;
}
```

Admin search includes Draft/Disabled products and disabled/unpriced SKUs because its purpose is navigation and repair, not storefront sellability.

One Product appears at most once. When several Product/SKU fields match, the best-ranked hit wins; an SKU match carries the matched SKU projection.

### 5.4 Order hit

```ts
interface OrderSearchHit {
  kind: "ORDER";
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  confirmationStatus: string;
  customerName: string | null;
  normalizedPhone: string;
  createdAt: string;
  matchedField: "ORDER_NUMBER" | "PHONE" | "CUSTOMER_NAME";
  matchedText: string;
}
```

### 5.5 Customer hit

```ts
interface CustomerSearchHit {
  kind: "CUSTOMER";
  customerId: string;
  name: string | null;
  normalizedPhone: string;
  email: string | null;
  riskLevel: string;
  matchedField: "PHONE" | "EMAIL" | "NAME";
  matchedText: string;
}
```

Email participates only when a real non-null value exists.

### 5.6 Shipment hit

```ts
interface ShipmentSearchHit {
  kind: "SHIPMENT";
  shipmentId: string;
  trackingNumber: string;
  carrier: string;
  status: string;
  orderId: string;
  orderNumber: string;
  matchedField: "TRACKING_NUMBER";
  matchedText: string;
}
```

Tracking numbers are not assumed unique; every matching Shipment remains a separate result.

## 6. Ranking and Query Semantics

All groups use these tiers:

1. Exact
2. Prefix
3. Contains
4. Stable deterministic tie-break

Product field priority within a tier:

1. productCode
2. skuCode
3. product name
4. slug

Order field priority:

1. orderNumber
2. normalized phone
3. customer name

Customer field priority:

1. normalized phone
2. email
3. name

Shipment matches trackingNumber only.

Queries use parameterized `Prisma.sql` / `$queryRaw` statements with explicit column lists and PostgreSQL `CASE` scores. User `%`, `_`, and backslash characters are escaped before constructing LIKE patterns, and all values remain bound parameters. A Product CTE ranks Product-field and SKU-field candidates, selects the highest-ranked row per Product, and orders the final five/six rows deterministically.

The service does not fetch arbitrary candidate pages and rank them after an unrelated database `take`, because that could omit an exact match. It also does not load all matches into application memory.

Phone behavior:

- A full valid Philippine mobile number is normalized with the existing phone utility.
- A partial phone query removes safe formatting characters for prefix/contains matching.
- Invalid text is not silently converted into a different complete number.

## 7. RBAC

The endpoint uses `JwtAuthGuard` for authentication. The SearchService then loads the current user with status and granted permissions in one narrow query.

- Missing or inactive user: 403.
- Products query: only with `PRODUCT_MANAGE`.
- Orders query: only with `ORDER_VIEW_ALL`.
- Customers query: only with `CUSTOMER_MANAGE`.
- Shipments query: only with `ORDER_VIEW_ALL`.
- No supported permission: successful response with an empty `groups` object; no entity query runs.

The existing `@Permissions(...)` decorator uses all-required semantics, so it is not placed on the aggregate controller with all entity permissions. Frontend permission checks only improve presentation; backend omission is authoritative.

`ORDER_VIEW_OWN` does not receive Order or Shipment results in V1. Supporting it later requires a separate owner-scope specification and tests.

## 8. Performance and Privacy

Per accepted request:

- One permission snapshot query.
- At most one narrow query per authorized group.
- Authorized group queries run in parallel.
- No Product graph hydration.
- No full Order items/risk history hydration.
- No total count.
- No shared response cache.
- No raw query, phone, or email value in application logs.

Frontend behavior:

- 250ms debounce.
- Do not request under two characters.
- AbortController cancels stale requests.
- A monotonically increasing request identity prevents an older response from replacing a newer query even if cancellation races.
- Only an identical in-flight request may be reused; resolved operational results are not cached.

Initial V1 requires no migration. Before release, run `EXPLAIN ANALYZE` against production-like row counts and record group timings. If p95 exceeds 150–200ms, a separately approved additive index migration is required; likely candidates are lower/trigram indexes for names/email and a non-null tracking-number index. No speculative index migration is bundled into this phase.

## 9. Frontend Architecture

### 9.1 Header integration

AdminShell injects a real `AdminGlobalSearch` through the existing `searchControl` slot in AdminGlobalHeader. The Phase A placeholder remains the fallback when the control is absent; it is not duplicated alongside the real control.

### 9.2 Command palette state

The component owns only transient search UI state:

- closed
- idle
- loading
- success
- empty
- error

It does not own Product, Order, Customer, Shipment, Cart, or business state.

Desktop and mobile use the same result model. The trigger remains in the Global Header; the result panel is a fixed command dialog so it is not clipped by shell containers.

Accessibility contract:

- `⌘K` / `Ctrl+K` opens and focuses input.
- Dialog has an accessible name.
- Input uses combobox semantics with `aria-expanded`, `aria-controls`, and active descendant.
- Results use grouped listbox/option semantics.
- Arrow Down/Up moves across visible results and skips headings/empty groups.
- Enter activates the highlighted result.
- Esc closes and restores focus to the opener.
- Pointer click activates the same navigation callback.
- Loading/error/empty text is announced without fabricating results.

### 9.3 Navigation targets

- Product match: `/admin/products/{productId}/edit`
- SKU match: `/admin/products/{productId}/edit?section=variants&sku={encodedSkuCode}`
- Order: `/admin/orders/{orderId}`
- Customer: `/admin/customers/{customerId}`
- Shipment: `/admin/orders/{orderId}#shipments`
- View all: `/admin/search?q={encodedQuery}`

The full results page uses the same API and renderer with `limit=20`; it is not a second search implementation.

## 10. Stable Context Navigation

### 10.1 Product SKU deep link

The edit page reads validated `section` and `sku` query parameters and passes a navigation request into ProductForm.

- `section=variants` selects the existing variants tab.
- VariantMatrix receives a requested SKU code.
- Rows register refs by stable SKU identity/code.
- A React layout effect focuses and scrolls the matching row after render.
- Same-page query changes are handled.
- Unknown section/SKU values degrade to the normal editor without an exception.

Forbidden: timeout-based focus, `querySelector`, `nth-child`, array-index identity, or a second Variant/SKU state.

### 10.2 Customer result

A minimal read-only `/admin/customers/[id]` page uses the existing guarded Customer GET endpoint. It shows only real Customer fields and addresses, handles 404/403/error states, and does not create a new customer-edit workflow.

### 10.3 Shipment result

The existing Shipment card on Order Detail receives a stable `id="shipments"` anchor. No Shipment page or Shipment API is added.

## 11. Error Handling

- 400: invalid query; client presents a non-destructive validation state.
- 401: existing admin auth handling logs out/redirects as today.
- 403: missing/inactive admin identity; an active user with no supported search permission instead receives `groups: {}` without entity queries.
- One entity query failure fails the aggregate request in V1; the client shows one retryable error instead of presenting potentially misleading partial completeness.
- Abort is silent and never shown as an error.
- Navigation does not occur when the highlighted result disappeared after a new response.

## 12. Files

Paths in this section are relative to `small-house-commerce/`.

### Backend additions

- `backend/src/modules/search/search.module.ts`
- `backend/src/modules/search/admin/search.controller.ts`
- `backend/src/modules/search/search.service.ts`
- `backend/src/modules/search/dto/search.dto.ts`
- `backend/src/modules/search/search.service.spec.ts`
- `backend/src/modules/search/admin/search.controller.spec.ts`

### Backend modification

- `backend/src/app.module.ts`

### Frontend additions

- `frontend/src/components/admin/AdminGlobalSearch.tsx`
- `frontend/src/components/admin/AdminGlobalSearch.spec.tsx`
- `frontend/src/app/admin/(shell)/search/page.tsx`
- `frontend/src/app/admin/(shell)/search/page.spec.tsx`
- `frontend/src/app/admin/(shell)/customers/[id]/page.tsx`
- `frontend/src/app/admin/(shell)/customers/[id]/page.spec.tsx`
- Global-search E2E coverage in a dedicated spec or the existing admin shell E2E suite.

### Frontend modifications

- `frontend/src/components/admin/AdminShell.tsx`
- `frontend/src/lib/admin-api.ts`
- `frontend/src/i18n/zh.ts`
- `frontend/src/i18n/en.ts`
- `frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx`
- `frontend/src/components/admin/ProductForm.tsx`
- `frontend/src/components/admin/VariantMatrix.tsx`
- `frontend/src/app/admin/(shell)/orders/[id]/page.tsx`

No Prisma schema, migration, package manifest, Product business API, Order business API, Notification, PDP, or Media file is modified.

## 13. Testing

Development follows RED → GREEN for each behavior.

### Backend

- DTO trim/min/max/limit validation.
- Exact/prefix/contains order for every entity.
- ProductCode exact before SKU/name/slug.
- Matched SKU projection and Product deduplication.
- Available inventory equals on-hand minus reserved.
- Draft/Disabled Product and disabled/unpriced SKU navigation.
- Phone normalization and partial digits.
- Nullable Customer email.
- Duplicate tracking numbers remain separate Shipments.
- `hasMore` via `limit + 1` and no count call.
- SQL wildcard escaping and parameterization.
- Active-user check.
- Per-group RBAC and proof unauthorized queries do not run.
- Response excludes cost/supplier/internal fields.
- PostgreSQL integration fixtures verify real SQL ranking.

### Frontend

- Phase A placeholder is replaced, not duplicated.
- Command shortcuts, opener focus restoration, Esc, arrows, Enter, and click.
- Debounce, minimum length, AbortController, and stale response suppression.
- Loading, empty, error, retry, and mixed-group rendering.
- Unauthorized/omitted group handling.
- Product/SKU, Order, Customer, and Shipment links.
- Full results page uses the same renderer/API.
- Product Editor stable section/SKU focus without timers or DOM selectors.
- Customer detail real API states.

### E2E and release verification

- Admin with all permissions sees all four groups.
- Warehouse sees Order/Shipment results but not Product/Customer results.
- Unsupported-role account sees no leaked groups.
- Keyboard-only search and navigation.
- SKU result lands on the correct Product Editor tab and row.
- Shipment result lands on the Shipment section.
- Customer result opens the real Customer record.
- No console, page, hydration, or unauthorized network errors.
- 1440 and 1920 screenshots for the search palette and full results page.
- Frontend/backend unit suites, TypeScript, ESLint, both builds, Playwright, and `git diff --check` pass.

## 14. Migration and Deployment Gates

- Prisma schema changes: none.
- Database migration: none.
- New dependency: none.
- Production deployment: not part of implementation completion; normal deployment requires the existing release gate.
- If performance evidence later requires indexes, stop and report the exact additive migration, production risk, rollback, and backup procedure before executing it.
