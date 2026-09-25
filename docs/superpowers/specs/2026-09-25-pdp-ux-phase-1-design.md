# PDP UX Phase 1 Design

**Date:** 2026-09-25  
**Status:** Approved for implementation  
**Scope:** Storefront PDP composition only; no new commerce state or write contract

## Goal

Improve product-detail conversion and information hierarchy on both `/products/[slug]` and `/lp/[slug]` while preserving every existing variant, cart, Order Now, checkout, tracking, media-resolution, review, and landing-page behavior.

## Binding constraints

- This phase is **PURE UI + REUSE EXISTING**.
- `PdpPurchaseProvider` remains the only owner of selection and purchase state. Do not introduce a second variant, price, quantity, cart, or purchase store.
- `PdpClient` remains the purchase-island implementation and continues to use the existing variant resolver, cart, Order Now, checkout, and tracking paths.
- Sticky purchase UI must consume the same `primaryLine`, `primaryDerived`, `setQuantity`, and `requestIntent` behavior as the hero.
- Reuse `ProductDetailBlock`, `ProductSpecs`, reviews, related products, and recently viewed; do not create parallel truth sources.
- Do not change ProductForm, Catalog Graph, Media Resolver, Prisma schema, migrations, dependencies, or any business write contract.
- Do not implement Inline COD or viewport-autoplay video.

## Existing state contract

The purchase state remains exclusively:

```ts
export interface PdpPurchaseContextValue {
  product: Product;
  orderLines: readonly PurchaseLineState[];
  primaryLine: PurchaseLineState;
  primaryDerived: ProductSelectionDerived;
  selectOption(lineId: string, optionId: string, valueId: string): void;
  confirmLine(lineId: string): void;
  setQuantity(lineId: string, quantity: number): void;
  addLine(): string;
  removeLine(lineId: string): void;
  changeLineVariant(lineId: string): void;
  syncLineFromUrl(lineId: string, variantId: string | null): void;
}
```

`requestIntent("ORDER_NOW" | "ADD_TO_CART", trigger)` remains the single gateway for immediate action versus option-confirmation dialog behavior. Hero and sticky controls must call it rather than reproduce its logic.

## Hero composition

The desktop hero remains a two-column gallery and purchase island; mobile remains a single-column flow. Recompose the purchase island in this order:

1. automatic breadcrumb;
2. product title and real tagline;
3. review summary link;
4. real price, compare-at price, savings, and stock state;
5. existing option selector;
6. compact **Dimensions & Fit** summary from Product-level assembled/folded dimensions only, with `View full dimensions →` targeting Specifications;
7. existing `deliveryWindows()` result presented as an estimate, never a guarantee;
8. shared quantity control;
9. primary **ORDER NOW** and secondary **ADD TO CART** actions;
10. truthful trust strip using only current policy: Cash on Delivery, nationwide delivery, secure checkout, and the actual returns/damage-claim policy.

Package dimensions, package weight, and volumetric weight are logistics data and must never be shown as furniture dimensions.

## Sticky section navigation

The sticky navigation contains exactly:

- Details
- Specifications
- Delivery & FAQs
- Reviews
- Order Now

Each item targets a stable section ID with adequate scroll margin. `Order Now` returns to the hero purchase section; it does not invoke checkout by itself. Navigation must remain usable by keyboard and must not cover section headings at mobile or desktop sizes.

## Detail-block conservation and mixed composition

Valid detail blocks are defined exactly as:

```ts
valid = API order entries whose url.trim() is non-empty
featured = valid[0] ?? null
remaining = valid.slice(1)
```

The UI must preserve every valid block exactly once, in API order, preserving `url`, `type`, and `alt`. It must not classify content using AI, OCR, filenames, alt text, or invented layout metadata.

The long-form page order is:

1. Description (when real content exists)
2. Why You’ll Love It (from the real `product.features` field only)
3. `featured` detail block (when present)
4. Product Specifications
5. every `remaining` detail block, in order
6. Material & Dimensions
7. Delivery & FAQs
8. Reviews
9. Related Products
10. Recently Viewed

No block may be lost or duplicated when there are zero, one, or many valid entries, including blank URL entries interleaved in the API response.

The backend may only stabilize ties by reading detail blocks with `sortOrder ASC, id ASC` in both public product and catalog-graph includes. No write ordering or graph contract changes are permitted.

## Specifications

Use only real fields:

- assembled width/height/depth;
- folded width/height/depth;
- `materials`;
- `productWeight` from the currently displayed/resolved SKU.

`features` moves to Why You’ll Love It and is not duplicated in the specification table. Assembly and Load Capacity remain absent because no source fields exist. If a field is missing, omit the row rather than invent a value.

## Related products

For both product and landing routes:

- query the same category;
- exclude the current product;
- require `availableInventory > 0` using the real storefront summary field;
- preserve API order;
- show at most four;
- render the real number available when fewer than four qualify.

No recommendation algorithm is added.

## Recently Viewed

Reuse the existing localStorage history and batch storefront API. On PDP/LP:

- exclude the current product;
- preserve existing visit order;
- show at most four;
- render only real batch-API products.

Homepage behavior remains unchanged when no exclusion/limit props are supplied.

## Sticky Buy

Add one shared-state sticky purchase surface that appears only after an `IntersectionObserver` reports that the hero purchase sentinel is no longer visible.

- Desktop: product thumbnail/name, selected-variant summary, current price, shared quantity control, primary Order Now, secondary Add to Cart.
- Mobile: compact current price/selection status plus the same two actions; it must not stack with or duplicate the old mobile sticky CTA.
- The bar reads `primaryLine` and `primaryDerived`, and calls the existing `setQuantity` and `requestIntent` paths.
- Disabled/loading/out-of-stock/choose-options behavior must match the hero because it is derived from the same state.
- It must respect reduced motion, safe-area insets, keyboard focus, and page width without horizontal overflow.

## Analytics and accessibility

- Existing `ViewContent` remains once per product ID.
- Existing `option_select`, `variant_confirm`, `AddToCart`, and Order Now behavior remains single-fire.
- Do not emit duplicate events merely because two visual action surfaces exist.
- Preserve native button keyboard activation, descriptive labels, visible focus, semantic headings, and section IDs.

## Verification and screenshots

Automated coverage must include:

- exact detail-block partition/conservation for blank, zero, one, and many blocks;
- stable backend tie ordering;
- real-only specification rows;
- related and recent filtering/limits;
- hero/sticky state identity and no duplicate purchase/analytics calls;
- observer show/hide behavior;
- both product and landing routes;
- existing variant deep-link, cart, checkout, scoped-media, review, and tracking regressions.

Browser verification covers 375×812, 768×1024, 1440×900, and 1920×1080, with screenshots of the hero, mixed details, and sticky buy. Console errors, page errors, hydration warnings, broken media, and horizontal overflow are release blockers.

## Out of scope

- Inline COD, new checkout flows, or purchase-state rewrites
- Video autoplay behavior
- FAQ, specification-template, or review schema changes
- New recommendation logic
- Product Media admin changes (handled in a later isolated phase)
- Push, merge, PR, or production deployment
