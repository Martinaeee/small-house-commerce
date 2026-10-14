# Variant Dimensions, Packaging Assist, and SKU Bundles

## Status

Design approved conversationally on 2026-10-09. This document is the review gate before implementation. It is intentionally local-only: no push, merge, pull request, deployment, or production data changes are part of this work.

## Goal

Make dimension and packaging entry accurate for variant SKUs, then add sellable SKU-level Bundles whose availability and inventory movements are derived from their component SKUs.

## Context and constraints

The existing catalog has two distinct data layers:

- `Product.width`, `Product.height`, and `Product.depth` are shared product dimensions.
- `Sku` owns purchase, price, inventory, and package fields: `productWeight`, `packageWidth`, `packageHeight`, `packageDepth`, `packageWeight`, and `volumetricWeight`.
- `ProductVariant` identifies one option combination and has a one-to-one SKU when it is sellable.
- Catalog graph saves happen before the separate stock batch write. New SKU identity mapping uses stable client keys.
- Checkout, reservations, cancellation, and shipment movements currently operate on SKU rows.
- The current UI and validation convention is centimeters (`cm`) and kilograms (`kg`).
- The current shipping-readiness predicate requires the five product/package fields to be complete for every ordinary SKU. `volumetricWeight` is optional.
- There is no existing Bundle table, component relationship, Bundle API, or Bundle UI.
- Current worktree changes for FAQ, media, PDP, homepage, and uploads are unrelated and must not be included in this feature.

The implementation must preserve existing media scopes, ProductForm upload ownership, catalog graph identity rules, stock batch semantics, and ordinary SKU behavior.

## Phase 1: variant dimensions and packaging assist

### Data contract

Add nullable SKU overrides for the physical product dimensions:

- `Sku.productWidth` mapped to `product_width`
- `Sku.productHeight` mapped to `product_height`
- `Sku.productDepth` mapped to `product_depth`

The values use centimeters, matching the existing Product dimension convention. They are independent from `packageWidth`, `packageHeight`, and `packageDepth`.

Resolution is explicit and stable:

1. If a selected SKU has a non-null override, use that dimension.
2. Otherwise use the Product-level `width`, `height`, or `depth`.
3. If both are null, omit that dimension from the storefront specification.

The raw nullable override remains visible in admin graph payloads so the operator can clear an override and return to the Product default. Storefront responses may expose the raw override plus the Product defaults; the shared PDP resolver must apply the fallback once, rather than each component inventing its own rule.

Extend all existing SKU contracts consistently:

- Prisma model and migration.
- Catalog graph DTO validation and wire types.
- Admin graph hydration, draft state, changed detection, and SKU write payload.
- Admin ProductForm and variant matrix editors.
- Admin product read/hydration and storefront product/SKU response types.

No new unit column, source column, lock flag, or dimension mode is stored. The common-dimension action is an editor operation, not persisted state.

### Admin behavior

The SKU/variant editor gets a compact Product dimensions group beside the existing package group:

- Product width, height, depth, each labelled `cm`.
- Package width, height, depth, and package weight remain separate and labelled with their existing units.
- `Apply to all variants` copies the current Product dimensions as SKU overrides for every materialized sellable variant.
- `Fill empty variant dimensions` only copies into null/empty SKU overrides.
- A per-SKU clear action removes the override and restores inheritance from Product.
- The editor must show whether a value is inherited or overridden.
- Bulk actions never change package fields, prices, stock, SKU codes, or option assignments.
- Existing lazy variant materialization and 100-candidate limits remain unchanged.

If a product has no materialized SKU for a candidate, the common action must not silently create a new stock-bearing row unless the existing matrix action already materializes that row. The UI should state how many materialized rows were changed.

### Packaging paste assist

Add a deterministic, pure parser used by the admin UI. It must not call an external service or an LLM and must not silently write values on paste.

Accepted forms include:

- Dimension triplets such as `30 x 20 x 10 cm`, `30 × 20 × 10 cm`, and `30*20*10 cm`.
- Labelled dimensions such as `W: 30, H: 20, L: 10 cm` or `width 30 cm, height 20 cm, depth 10 cm`.
- Weight labels such as `weight: 2 kg` or `2 kg` when the paste field is explicitly in weight mode.
- Units `mm`, `cm`, `m`, `in`, `ft`, `g`, `kg`, `lb`, and `oz`, converted to `cm` or `kg`.
- A unit omitted from a dimension triplet is interpreted as the existing UI unit (`cm`) and shown as an assumption in the preview.

The parser returns normalized candidate fields and warnings. It maps triplet order to width × height × depth; `length` is treated as depth. It rejects non-positive, non-finite, contradictory, or ambiguous values rather than guessing.

The UI flow is:

1. Operator pastes text into the packaging assist field for one SKU or chooses a selected set of SKUs.
2. The parser displays the candidate fields, normalized units, assumptions, and warnings.
3. `Fill empty fields` is the default apply mode; `Replace parsed fields` is an explicit alternative.
4. The operator confirms before draft values change.
5. Existing save and readiness validation handles the final payload.

The parser never computes or overwrites `volumetricWeight`. No carrier divisor exists in the current system, so a future volumetric-weight rule must be a separately specified feature.

### Phase 1 validation and tests

Cover the real save path, not only local input state:

- DTO accepts nullable SKU product dimensions and rejects negative/non-finite values.
- Graph hydration, diffing, client-key mapping, and write payload preserve overrides and clearing.
- Product fallback and SKU override resolve correctly on the storefront.
- Apply-all and fill-empty affect only the intended materialized SKU rows.
- Packaging parser handles labelled/triplet forms, unit conversion, missing-unit assumptions, malformed input, duplicate labels, and ambiguity.
- Confirmed packaging edits write only existing package fields and never volumetric weight.
- Existing shipping completeness and SKU stock batch behavior remain unchanged.
- ProductForm save/reload preserves both inherited and overridden dimensions.
- Browser coverage verifies the compact editor, inherited/overridden indication, preview-before-apply, and no console errors.

## Phase 2: SKU-level Bundles

Phase 2 starts only after Phase 1 has a green backend/frontend suite and browser verification. It is a separate implementation and review boundary because it changes inventory and order behavior.

### Bundle model

A Bundle is a normal sellable product presentation backed by one or more virtual Bundle SKUs. A component is always a concrete ordinary SKU, never merely a Product or ProductVariant.

Add a relationship table equivalent to:

- `id`
- `bundleSkuId`
- `componentSkuId`
- `quantity` (positive integer)
- `position`
- timestamps

Use separate named SKU relations, unique `(bundleSkuId, componentSkuId)`, indexes for both directions, and a database check for positive quantity. A Bundle SKU is marked virtual (`isBundle` or an equivalent explicit inventory mode) and must not own an ordinary inventory row.

The service layer must reject:

- self-reference;
- a Bundle component that is itself a Bundle, so V1 cannot recurse;
- duplicate components;
- missing, disabled, or cross-tenant component SKUs;
- zero, negative, non-integer, or excessive component quantities.

The admin editor binds components to exact component SKUs, displays their product/variant labels and current availability, and prevents editing ordinary stock for a virtual Bundle SKU. Bundle price, media, detail blocks, and SEO remain normal product data; no automatic discount or component-price calculation is added.

### Availability and inventory behavior

For a Bundle quantity requirement `q` and component available inventory `a`, Bundle available inventory is:

`min(floor(a / q))` across all components.

A Bundle with no valid components is unavailable and cannot be published or checked out. Storefront SKU responses expose the computed availability using the same `availableInventory` field so cart and PDP behavior remain consistent.

Cart rows continue to store the Bundle SKU and requested Bundle quantity. During checkout, the service expands each Bundle line into component requirements, aggregates duplicate component SKUs across all cart lines, and reserves component inventory in one database transaction. It never reserves the virtual Bundle SKU.

Cancellation releases the component reservations. Shipment consumes component inventory using the same order snapshot, not the current Bundle definition. Edit-order flows use the same expansion and reservation rules. Inventory reference/audit rows identify the originating order/line while retaining the concrete component SKU.

### Historical integrity and deletion protection

Add a versioned order-line component snapshot. At minimum it records the component SKU identity/code, component quantity per Bundle, total consumed quantity, position, and display labels needed for audit. Historical order behavior must not change if the Bundle definition is edited later.

Bundle component references must be included in the existing catalog graph SKU reference counts and `hasReferences`/rebuild protection. A component SKU referenced by a Bundle cannot be deleted or silently replaced. Virtual Bundle SKUs cannot be passed to ordinary stock-set endpoints.

### Phase 2 validation and tests

Cover:

- Bundle component DTO and database constraints.
- Self-reference, nested Bundle, duplicate, disabled, and cross-product rejection.
- Exact availability calculation, zero-component behavior, and component stock changes.
- Checkout with one Bundle, duplicate components across multiple lines, and insufficient component stock.
- Reservation creation/release, cancellation, shipment consumption, and edit-order paths in transactions.
- Historical component snapshots after the Bundle definition changes.
- Catalog graph delete/rebuild protection and virtual-SKU stock endpoint rejection.
- Admin UI save/reload, component ordering, availability display, and error states.
- Storefront/cart/PDP browser behavior without exposing component internals as separate customer cart lines.
- Regression coverage for ordinary SKU checkout, inventory, and product deletion.

## Non-goals

- No preassembled warehouse Bundle inventory in V1.
- No nested Bundles or recursive component graphs.
- No automatic Bundle discount, promotion engine, or coupon integration.
- No changes to the existing media upload API or media scope contract.
- No rewrite of the legacy product variants path beyond the minimum compatibility mapping.
- No production deployment or production-data migration as part of implementation.

## Implementation order and review gates

1. Write Phase 1 tests and implement the SKU dimension contract.
2. Implement and test the packaging parser and confirmation UI.
3. Run Phase 1 backend/frontend suites, type checks, lint, build, and browser verification.
4. Review the Phase 1 diff and preserve it as an independent local commit only when explicitly requested.
5. Write Phase 2 tests and implement the Bundle schema, admin editor, availability, reservation expansion, snapshots, and reference protection.
6. Run the full regression suite and browser/E2E verification for ordinary SKUs and Bundles.
7. Stop at the local review gate. Push, merge, PR, and deploy require a separate explicit authorization.
