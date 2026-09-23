# PDP Inline COD Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let shoppers select multiple combinations of one product and complete a safe, idempotent COD order inside PDP/LP without routing through `/checkout` or `/checkout/confirm`, while preserving the traditional cart Checkout.

**Architecture:** Extend the phase-1 `PdpPurchaseProvider` so `orderLines[0]` remains the top-PDP source of truth and additional lines reuse the same pure variant reducer. Extract customer/address/review/submission primitives from the existing Checkout, then make one OrdersService transaction authoritative for price, inventory, reservations, risk, duplicates, snapshots, and idempotent replay.

**Tech Stack:** PostgreSQL 18, Prisma 7.10, NestJS 12, Zod, Next.js 16.3.4, React 19, TypeScript, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-pdp-inline-cod-order-design.md`

## Global Constraints

- Execute only after every completion gate in `docs/superpowers/plans/2026-09-21-product-variant-options-media.md` passes.
- Consume the phase-1 selection reducer, media resolver, `PdpPurchaseProvider`, Variant Picker, structured snapshots, cart summary, and option labels; do not recreate them.
- `orderLines[0]` is the only writable top-PDP selection and quantity source.
- Inline orders contain one product and at most 20 unique SKUs; duplicate SKUs merge and the merged quantity must remain 1–99.
- Every non-placeholder line must be valid, confirmed, unique, and purchasable before review. A placeholder may exist only as the sole editing line.
- Confirmation and submission use one immutable validated snapshot containing all and only validated non-placeholder lines.
- Prices, totals, product state, SKU state, inventory, risk, and duplicate classification are server-authoritative.
- Order, address, items, structured snapshots, COD payment, history, inventory reservations/movements, risk log, NEEDS_REVIEW, duplicate flags, and idempotency fields commit atomically.
- Traditional Checkout, admin New Order, and Inline COD use one transport/submission adapter.
- Compatibility backend accepts a missing key while old bundles remain active. Enforcement is enabled only after caller migration and observation.
- Persist UNKNOWN submissions with the original key; refresh/retry must not generate a second key.
- Keep customer draft key `luwag_checkout_draft`; clear complete PII after success.
- Inline order does not modify the cart and never emits AddToCart.
- PDP/LP section order is Product Details → Specifications → Delivery & FAQs → Quick COD Order → Related Products → Reviews.
- Write a failing test and observe the expected failure before each production change.
- Before changing any Next.js route/layout/server-client boundary or dynamic import, read the relevant local guide under `frontend/node_modules/next/dist/docs/`; this repository uses Next.js 16 breaking APIs.
- Run `prisma generate` before backend typecheck/build after the migration.
- Production order migration and atomic transaction rollout require a fresh backup and explicit risk-gate confirmation.

## Delivered Interfaces

```ts
import type {
  ProductSelectionState,
  PurchaseLineState,
} from "@/lib/product-selection";

export type InlineOrderLine = PurchaseLineState;

export interface InlineOrderLineDraft {
  clientLineId: string;
  selectedValueIds: Readonly<Record<string, string>>;
  explicitlyTouchedOptionIds: readonly string[];
  selectionSource: "DEFAULT" | "DEEP_LINK" | "USER" | "CONFIRM_DIALOG";
  quantity: number;
}

export type PurchaseLineStatus =
  | "PLACEHOLDER"
  | "NEEDS_CONFIRMATION"
  | "UNAVAILABLE"
  | "OUT_OF_STOCK"
  | "READY";

export interface ResolvedPurchaseLine {
  line: InlineOrderLine;
  variantId: string | null;
  skuId: string | null;
  optionLabels: readonly { optionName: string; valueLabel: string }[];
  thumbnailUrl: string | null;
  status: PurchaseLineStatus;
}

export interface CheckoutCustomerValues {
  name: string;
  phone: string;
  province: string;
  city: string;
  barangay: string;
  postalCode: string;
  streetAddress: string;
  landmark: string;
  preferredDeliveryDate: string;
}

export type CheckoutField = keyof CheckoutCustomerValues;
export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

export interface CheckoutCustomerFormController {
  values: CheckoutCustomerValues;
  errors: CheckoutErrors;
  restored: boolean;
  revision: number;
  dateBounds: { min: string; max: string };
  setField<K extends CheckoutField>(field: K, value: CheckoutCustomerValues[K]): void;
  revalidateField(field: CheckoutField): void;
  refreshDateBounds(now?: Date): { min: string; max: string };
  validateAndFocus(): {
    valid: boolean;
    errors: CheckoutErrors;
    values: CheckoutCustomerValues;
  };
}

export interface CheckoutTotals {
  subtotal: number;
  compareAtTotal: number;
  savings: number;
  discount: 0;
  total: number;
}

export interface OrderReviewLine {
  key: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantId: string;
  skuId: string;
  skuCode: string;
  options: readonly { optionName: string; valueLabel: string }[];
  quantity: number;
  unitPrice: number;
  compareAtPrice: number | null;
  thumbnailUrl: string | null;
}

export interface OrderReviewModel {
  source: "checkout_route" | "pdp_inline";
  lines: readonly OrderReviewLine[];
  totals: CheckoutTotals;
  customer: CheckoutCustomerValues;
  preferredDeliveryDate: string | null;
}
```

```ts
export interface CreateOrderInput {
  customer: {
    name: string;
    phone: string;
    province: string;
    city: string;
    barangay?: string | null;
    postalCode?: string | null;
    streetAddress: string;
    landmark?: string | null;
  };
  items: readonly { skuId: string; quantity: number }[];
  attribution: Attribution;
  preferredDeliveryDate?: string | null;
}

export type OrderApiErrorCode =
  | "VALIDATION_ERROR"
  | "SKU_UNAVAILABLE"
  | "INSUFFICIENT_STOCK"
  | "IDEMPOTENCY_CONFLICT";

export type OrderSubmissionErrorCode =
  | OrderApiErrorCode
  | "NETWORK_ERROR"
  | "ORDER_SUBMISSION_UNKNOWN";

export interface OrderErrorDetailsByCode {
  VALIDATION_ERROR: { fieldErrors: Record<string, readonly string[]> };
  SKU_UNAVAILABLE: { skuId: string };
  INSUFFICIENT_STOCK: { skuId: string; requested: number; available: number };
  IDEMPOTENCY_CONFLICT: undefined;
  NETWORK_ERROR: undefined;
  ORDER_SUBMISSION_UNKNOWN: { idempotencyKey: string };
}

export interface CreateOrderOptions {
  idempotencyKey?: string;
}

export interface CreateOrderResponse {
  orderNumber: string;
  orderStatus: string;
  confirmationStatus: string;
  riskType: "RPT" | "RECHECK" | null;
  requiresReview: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
}

export class OrderSubmissionError<
  C extends OrderSubmissionErrorCode = OrderSubmissionErrorCode,
> extends Error {
  readonly status: number | null;
  readonly code: C;
  readonly details?: OrderErrorDetailsByCode[C];
}

export type PersistedSubmissionStatus = "READY" | "SUBMITTING" | "UNKNOWN";

export interface PersistedOrderSubmission {
  idempotencyKey: string;
  fingerprint: string;
  status: PersistedSubmissionStatus;
  savedAt: string;
}

export interface PreparedOrderSubmission extends PersistedOrderSubmission {
  status: "READY";
  payload: CreateOrderInput;
}

export interface OrderSubmissionStore {
  read(): PersistedOrderSubmission | null;
  write(value: PersistedOrderSubmission): void;
  clear(): void;
}
```

```ts
export interface CheckoutOptions {
  idempotencyKey?: string;
}

export interface InventoryReservationLine {
  skuId: string;
  quantity: number;
}
```

---

### Task 0: Phase 1 Contract Gate

**Files:**
- Read: `docs/superpowers/plans/2026-09-21-product-variant-options-media.md`
- Verify phase-1 exports under `frontend/src/lib/product-selection.ts`, `frontend/src/components/product/PdpPurchaseProvider.tsx`, `backend/src/modules/orders/order-item-snapshot.ts`.

**Interfaces:**
- Consumes all phase-1 delivered interfaces.
- Produces no code.

- [ ] **Step 1: Run the phase-1 focused suites**

```bash
pnpm --dir backend exec vitest run src/modules/catalog src/modules/cart src/modules/orders/order-item-snapshot.spec.ts
pnpm --dir frontend exec vitest run src/lib/product-selection.spec.ts src/lib/product-media.spec.ts src/components/product/ProductOptionSelector.spec.tsx src/components/cart/QuickAddView.spec.tsx
```

- [ ] **Step 2: Verify the required exports**

Run:

```bash
grep -R "export function.*resolveSelection\|export function.*variantSelectionReducer\|export function PdpPurchaseProvider\|export function buildOrderItemSnapshot" backend/src frontend/src
```

Expected: one canonical definition for each behavior.

- [ ] **Step 3: Stop if a contract is missing**

Do not create a second resolver/provider/snapshot builder. Return to the corresponding phase-1 task and complete it.

- [ ] **Step 4: Record the passing phase-1 commit SHA**

Run: `git rev-parse HEAD`

Expected: a commit containing the phase-1 acceptance gate.

- [ ] **Step 5: No commit**

This is a dependency gate; proceed only when all checks pass.

---

### Task 1: Add Compatible Order Idempotency Storage

**Files:**
- Modify: `backend/prisma/schema/order.prisma`
- Create: `backend/prisma/migrations/20260921120000_add_order_idempotency/migration.sql`
- Create: `backend/test/orders.idempotency.e2e-spec.ts`

**Interfaces:**
- Produces nullable `idempotencyKey` and `idempotencyFingerprint` on `Order`.

- [ ] **Step 1: Write failing database E2E assertions**

```ts
it("stores one nullable UUID key and rejects duplicate non-null keys", async () => {
  const first = await prisma.order.create({ data: legacyOrderData });
  const second = await prisma.order.create({ data: legacyOrderData });
  expect(first.idempotencyKey).toBeNull();
  expect(second.idempotencyKey).toBeNull();
  await expect(createTwoOrdersWithKey(sharedKey)).rejects.toMatchObject({
    code: "P2002",
  });
});
```

Also assert a 64-character fingerprint pair and multiple legacy null rows.

- [ ] **Step 2: Run and verify RED**

Run with the test database: `pnpm --dir backend exec vitest run --config vitest.config.e2e.ts test/orders.idempotency.e2e-spec.ts`

Expected: FAIL because the columns do not exist.

- [ ] **Step 3: Add the nullable fields, unique index, and pair check**

```sql
ALTER TABLE orders
  ADD COLUMN idempotency_key UUID,
  ADD COLUMN idempotency_fingerprint VARCHAR(64);

CREATE UNIQUE INDEX orders_idempotency_key_key
ON orders(idempotency_key);

ALTER TABLE orders ADD CONSTRAINT orders_idempotency_pair_check CHECK (
  (idempotency_key IS NULL AND idempotency_fingerprint IS NULL)
  OR (idempotency_key IS NOT NULL AND length(idempotency_fingerprint) = 64)
) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_idempotency_pair_check;
```

Keep old rows null and do not remove the columns on rollback.

- [ ] **Step 4: Validate, generate, migrate, and rerun E2E**

```bash
pnpm --dir backend exec prisma validate
pnpm --dir backend exec prisma generate
DATABASE_URL="postgresql://smallhouse:smallhouse@localhost:5432/small_house_test?schema=public" pnpm --dir backend exec prisma migrate deploy
pnpm --dir backend exec vitest run --config vitest.config.e2e.ts test/orders.idempotency.e2e-spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema/order.prisma backend/prisma/migrations/20260921120000_add_order_idempotency/migration.sql backend/test/orders.idempotency.e2e-spec.ts
git commit -m "feat(orders): add compatible idempotency storage"
```

---

### Task 2: Canonical Checkout Input and Typed Errors

**Files:**
- Modify: `backend/src/modules/orders/dto/order.dto.ts`
- Modify: `backend/src/common/pipes/zod-validation.pipe.ts`
- Create: `backend/src/common/pipes/zod-validation.pipe.spec.ts`
- Create: `backend/src/modules/orders/checkout-canonicalization.ts`
- Create: `backend/src/modules/orders/checkout-canonicalization.spec.ts`
- Create: `backend/src/modules/orders/order-errors.ts`

**Interfaces:**
- Produces canonical fingerprint input and `{code,message,details}` order errors.

- [ ] **Step 1: Write failing DTO/canonicalization/error tests**

```ts
it("merges duplicates before enforcing the quantity limit", async () => {
  expect(canonicalizeItems([
    { skuId, quantity: 40 },
    { skuId, quantity: 59 },
  ])).toEqual([{ skuId, quantity: 99 }]);
  expect(() => canonicalizeItems([
    { skuId, quantity: 60 },
    { skuId, quantity: 40 },
  ])).toThrowErrorMatchingObject({ code: "VALIDATION_ERROR" });
});
```

Cover 1/20/21 rows, 1/99/100 quantities, input-order independence, equivalent phone formats, null/missing attribution equivalence, semantic changes, and stable field error paths.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir backend exec vitest run src/modules/orders/checkout-canonicalization.spec.ts src/common/pipes/zod-validation.pipe.spec.ts
```

- [ ] **Step 3: Implement canonicalization and typed errors**

```ts
export function canonicalizeCheckoutInput(input: CheckoutInput): CanonicalCheckoutInput;
export function checkoutFingerprint(input: CanonicalCheckoutInput): string;
```

Add `.max(20)`, attribution fields, normalized phone/strings/nulls, merged sorted items, SHA-256, and an optional Zod pipe error factory without changing existing callers.

- [ ] **Step 4: Verify focused tests and typecheck**

```bash
pnpm --dir backend exec vitest run src/modules/orders/checkout-canonicalization.spec.ts src/common/pipes/zod-validation.pipe.spec.ts
pnpm --dir backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders/dto/order.dto.ts backend/src/common/pipes backend/src/modules/orders/checkout-canonicalization.ts backend/src/modules/orders/checkout-canonicalization.spec.ts backend/src/modules/orders/order-errors.ts
git commit -m "feat(orders): canonicalize checkout input and errors"
```

---

### Task 3: Batch Inventory Reservation Within One Transaction

**Files:**
- Modify: `backend/src/modules/inventory/inventory.service.ts`
- Create: `backend/src/modules/inventory/inventory.service.spec.ts`

**Interfaces:**
- Produces: `reserveManyWithin(tx, warehouseId, orderId, lines)`.

- [ ] **Step 1: Write failing batch reservation tests**

```ts
it("locks and reserves twenty lines without per-line Prisma calls", async () => {
  await service.reserveManyWithin(tx, warehouseId, orderId, makeLines(20));
  expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  expect(tx.inventoryReservation.createMany).toHaveBeenCalledTimes(1);
  expect(tx.inventoryMovement.createMany).toHaveBeenCalledTimes(1);
  expect(tx.inventory.findUnique).not.toHaveBeenCalled();
});
```

Cover sorted lock order, missing row typed error, exact stock details, guarded update count mismatch, and no per-line update/create loop.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir backend exec vitest run src/modules/inventory/inventory.service.spec.ts`

- [ ] **Step 3: Implement ordered lock, check, update, and createMany**

```ts
async reserveManyWithin(
  tx: Prisma.TransactionClient,
  warehouseId: string,
  orderId: string,
  lines: readonly InventoryReservationLine[],
): Promise<void>;
```

Use one ordered `FOR UPDATE`, one guarded `UPDATE ... FROM (VALUES ...) RETURNING`, then two `createMany` calls. Keep `reserveWithin` for other flows.

- [ ] **Step 4: Verify inventory suite**

```bash
pnpm --dir backend exec vitest run src/modules/inventory/inventory.service.spec.ts
pnpm --dir backend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inventory/inventory.service.ts backend/src/modules/inventory/inventory.service.spec.ts
git commit -m "refactor(inventory): batch order reservations"
```

---

### Task 4: Atomic and Idempotent OrdersService Checkout

**Files:**
- Modify: `backend/src/modules/orders/orders.service.ts`
- Modify: `backend/src/modules/orders/orders.service.spec.ts`
- Modify: `backend/src/modules/orders/customer-risk.service.ts`
- Modify: `backend/src/modules/orders/customer-risk.service.spec.ts`
- Modify: `backend/test/orders.idempotency.e2e-spec.ts`

**Interfaces:**
- Consumes Task 2 canonical input, Task 3 reservation, and phase-1 snapshot builder.
- Produces `checkout(input, {idempotencyKey})` with safe replay.

- [ ] **Step 1: Write failing unit and real-database tests**

```ts
it("replays a matching key without another transaction", async () => {
  const first = await service.checkout(input, { idempotencyKey: key });
  const second = await service.checkout(input, { idempotencyKey: key });
  expect(second.orderNumber).toBe(first.orderNumber);
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});
```

Cover tx customer upsert, one SKU `findMany`, batch items, server prices, same-tx risk/log/duplicates/review state/payment/history/snapshots/reservations, rollback on risk or stock failure, key conflict, no-key compatibility, concurrent same-key, P2002 root-client replay, and one set of all side effects.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir backend exec vitest run src/modules/orders/orders.service.spec.ts src/modules/orders/customer-risk.service.spec.ts
pnpm --dir backend exec vitest run --config vitest.config.e2e.ts test/orders.idempotency.e2e-spec.ts
```

- [ ] **Step 3: Refactor checkout into one transaction**

```ts
async checkout(
  input: CheckoutInput,
  options: CheckoutOptions = {},
): Promise<CheckoutResult>;
```

Canonicalize before transaction, pre-check key on root client, repeat lookup in transaction, bulk load SKUs, build snapshots, classify risk with `tx`, create all rows, reserve once, and commit. Catch P2002 outside the transaction and query replay state with root Prisma only.

- [ ] **Step 4: Verify unit and E2E tests**

Run both Step 2 commands. Expected: PASS and one order/side-effect set per repeated key.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders backend/test/orders.idempotency.e2e-spec.ts
git commit -m "feat(orders): atomically create and replay COD orders"
```

---

### Task 5: Idempotency Header Compatibility and Enforcement Gate

**Files:**
- Modify: `backend/src/modules/orders/storefront/orders.controller.ts`
- Modify: `backend/src/modules/orders/admin/orders.controller.ts`
- Create: `backend/src/modules/orders/storefront/orders.controller.spec.ts`
- Modify: `backend/src/config/env.validation.ts`
- Modify: `backend/src/config/configuration.ts`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces `Idempotency-Key` forwarding and `ORDER_IDEMPOTENCY_REQUIRED` compatibility gate.

- [ ] **Step 1: Write failing controller/config tests**

Verify valid UUID forwarding, optional missing header when false, typed invalid-header 400, missing storefront key when true, admin forwarding, and atomic no-key compatibility.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --dir backend exec vitest run src/modules/orders/storefront/orders.controller.spec.ts`

- [ ] **Step 3: Implement header parsing and scoped enforcement**

```ts
const idempotencyKey = parseOptionalUuid(request.header("Idempotency-Key"));
return this.orders.checkout(body, { idempotencyKey });
```

Default `ORDER_IDEMPOTENCY_REQUIRED=false`. Enforce only Storefront when enabled. Log missing/replay/conflict with no customer PII.

- [ ] **Step 4: Verify controller, config, and build**

```bash
pnpm --dir backend exec vitest run src/modules/orders/storefront/orders.controller.spec.ts
pnpm --dir backend exec tsc --noEmit
pnpm --dir backend build
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders backend/src/config backend/.env.example
git commit -m "feat(orders): accept compatible idempotency headers"
```

---

### Task 6: Shared Customer, Address, and Date Primitives

**Files:**
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`
- Modify: `frontend/src/lib/checkoutDraft.ts`
- Modify: `frontend/src/lib/checkoutValidation.ts`
- Modify: `frontend/src/lib/deliveryWindow.ts`
- Create: `frontend/src/components/checkout/useCheckoutCustomerForm.ts`
- Create: `frontend/src/components/checkout/useCheckoutCustomerForm.spec.tsx`
- Create: `frontend/src/components/checkout/CheckoutCustomerFields.tsx`
- Create: `frontend/src/components/checkout/CheckoutAddressFields.tsx`
- Create: `frontend/src/components/checkout/CheckoutAddressFields.spec.tsx`
- Create: `frontend/src/components/checkout/CheckoutPreferredDateField.tsx`
- Create: `frontend/src/components/checkout/CheckoutAssuranceRow.tsx`

**Interfaces:**
- Produces the `CheckoutCustomerFormController` and shared field components from the spec.

- [ ] **Step 1: Write failing parity and lifecycle tests**

```tsx
it("produces the same errors for Checkout and Inline consumers", () => {
  const checkout = renderHook(() => useCheckoutCustomerForm());
  expect(checkout.result.current.validateAndFocus().errors).toEqual(
    expectedEmptyFormErrors,
  );
});
```

Cover existing fields/required markers, optional barangay/postal, downstream resets, manual postal protection, geolocation outcomes, V1 draft restore, 24-hour expiry, post-hydration restore, PII clear, Manila-midnight revalidation, and first-error focus.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/lib/checkoutDraft.spec.ts src/lib/checkoutValidation.spec.ts src/components/checkout/useCheckoutCustomerForm.spec.tsx src/components/checkout/CheckoutAddressFields.spec.tsx
```

- [ ] **Step 3: Extract existing behavior rather than rewrite it**

`CheckoutAddressFields` owns the heavy PSGC/postal imports. The hook composes existing validation/date/postal/geolocation helpers and returns one controller. Traditional Checkout immediately consumes the extracted components.

- [ ] **Step 4: Verify focused and full frontend tests**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/checkout frontend/src/lib/checkoutDraft.ts frontend/src/lib/checkoutValidation.ts frontend/src/lib/deliveryWindow.ts
git commit -m "refactor(checkout): share customer and address primitives"
```

---

### Task 7: Shared Order Review Content and Totals

**Files:**
- Modify: `frontend/src/components/checkout/checkoutItems.ts`
- Modify: `frontend/src/components/checkout/OrderPreview.tsx`
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`
- Modify: `frontend/src/components/checkout/CheckoutConfirmView.tsx`
- Create: `frontend/src/components/checkout/orderReview.ts`
- Create: `frontend/src/components/checkout/CheckoutTotals.tsx`
- Create: `frontend/src/components/checkout/CheckoutTotals.spec.tsx`
- Create: `frontend/src/components/checkout/OrderReviewContent.tsx`
- Create: `frontend/src/components/checkout/OrderReviewContent.spec.tsx`

**Interfaces:**
- Produces immutable `OrderReviewModel` and shell-independent `OrderReviewContent`.

- [ ] **Step 1: Write failing shared review tests**

Verify multiple SKU/options/thumbnails, separate Color/Size labels, display-only compare-at savings, full address/map/date/COD text, edit action slots, typed SKU highlighting, and map only for complete address.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/checkout/OrderReviewContent.spec.tsx src/components/checkout/CheckoutTotals.spec.tsx
```

- [ ] **Step 3: Extract review model/content without changing submission**

```ts
export function createOrderReviewModel(input: OrderReviewInput): OrderReviewModel;
```

Keep `totalsFor` as the only subtotal/savings calculation. `OrderReviewContent` owns rows/totals/address/map/date/COD/error display, not navigation/modal/submission.

- [ ] **Step 4: Verify traditional Checkout regression**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/checkout
git commit -m "refactor(checkout): share order review content"
```

---

### Task 8: Typed Durable Order Submission and Existing Caller Migration

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/lib/checkoutDraft.ts`
- Modify: `frontend/src/components/checkout/CheckoutConfirmView.tsx`
- Modify: `frontend/src/app/admin/(shell)/orders/page.tsx`
- Create: `frontend/src/lib/orderSubmission.ts`
- Create: `frontend/src/lib/orderSubmission.spec.ts`
- Create: `frontend/src/lib/api.spec.ts`
- Create: `frontend/src/components/checkout/CheckoutConfirmView.spec.tsx`

**Interfaces:**
- Produces `api.createOrder(payload,{idempotencyKey})`, `ApiError`, `prepareOrderSubmission`, `executeOrderSubmission`, and persisted READY/SUBMITTING/UNKNOWN state.

- [ ] **Step 1: Write failing transport and lifecycle tests**

```ts
it("restores an interrupted SUBMITTING request as UNKNOWN", () => {
  expect(restoreOrderSubmission({
    idempotencyKey: key,
    fingerprint,
    status: "SUBMITTING",
    savedAt,
  })?.status).toBe("UNKNOWN");
});
```

Cover header transmission, status/code/details, semantic key reuse/rotation, UNKNOWN edit block, offline READY error, post-dispatch rejection UNKNOWN, typed HTTP outcomes, success clear/handoff, cart removal only after success, and admin retry key reuse.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/lib/orderSubmission.spec.ts src/lib/api.spec.ts src/components/checkout/CheckoutConfirmView.spec.tsx
```

- [ ] **Step 3: Implement submission adapter and migrate Checkout/Admin**

```ts
export async function prepareOrderSubmission(args: {
  payload: CreateOrderInput;
  store: OrderSubmissionStore;
  uuid?: () => string;
}): Promise<PreparedOrderSubmission>;

export async function executeOrderSubmission(args: {
  prepared: PreparedOrderSubmission;
  store: OrderSubmissionStore;
  transport: (
    payload: CreateOrderInput,
    options: CreateOrderOptions,
  ) => Promise<CreateOrderResponse>;
}): Promise<CreateOrderResponse>;
```

Write SUBMITTING synchronously before fetch; any post-dispatch rejection is UNKNOWN. Known HTTP failures retain the same READY key for corrected retry. Success clears state and performs existing success handoff.

- [ ] **Step 4: Verify tests, typecheck, and build**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib frontend/src/components/checkout/CheckoutConfirmView.tsx frontend/src/components/checkout/CheckoutConfirmView.spec.tsx frontend/src/app/admin
git commit -m "feat(checkout): submit orders with durable idempotency"
```

---

### Task 9: Extend Canonical PDP Purchase State and Add Product Draft

**Files:**
- Modify: `frontend/src/components/product/PdpPurchaseProvider.tsx`
- Modify: `frontend/src/components/product/PdpPurchaseProvider.spec.tsx`
- Create: `frontend/src/components/product/pdp-purchase-lines.ts`
- Create: `frontend/src/components/product/pdp-purchase-lines.spec.ts`
- Create: `frontend/src/lib/inlineOrderDraft.ts`
- Create: `frontend/src/lib/inlineOrderDraft.spec.ts`
- Modify: `frontend/src/components/product/PdpClient.tsx`
- Modify: `frontend/src/components/product/MobileStickyCta.tsx`

**Interfaces:**
- Extends phase-1 context with resolved lines, provider revision, max 20, merge/change/restore, and product refresh.

- [ ] **Step 1: Write failing line and draft tests**

Verify top↔first-line identity, default display not purchase, deep-link unconfirmed, single SKU automatic resolution, quantity identity, mutation revision, duplicate merge, 99/100, 20/21 lines, last-line placeholder, product isolation, deep-link precedence, stale restored errors, normal expiry, and UNKNOWN retention.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/product/pdp-purchase-lines.spec.ts src/components/product/PdpPurchaseProvider.spec.tsx src/lib/inlineOrderDraft.spec.ts
```

- [ ] **Step 3: Extend the existing provider without parallel state**

```ts
export interface PdpPurchaseContextValue {
  product: Product;
  orderLines: readonly InlineOrderLine[];
  resolvedLines: readonly ResolvedPurchaseLine[];
  primaryLine: InlineOrderLine;
  primaryResolvedLine: ResolvedPurchaseLine;
  revision: number;
  maxLines: 20;
  addLine(selection: ProductSelectionState): { lineId: string; merged: boolean };
  restoreLines(lines: readonly InlineOrderLineDraft[]): void;
  refreshProduct(): Promise<void>;
}
```

Persist only selection intent and quantity; replay the reducer on restore and require confirmation again.

- [ ] **Step 4: Verify selection/provider/draft suites**

```bash
pnpm --dir frontend exec vitest run src/lib/product-selection.spec.ts src/components/product/pdp-purchase-lines.spec.ts src/components/product/PdpPurchaseProvider.spec.tsx src/lib/inlineOrderDraft.spec.ts
pnpm --dir frontend exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/product/PdpPurchaseProvider.tsx frontend/src/components/product/PdpPurchaseProvider.spec.tsx frontend/src/components/product/pdp-purchase-lines.ts frontend/src/components/product/pdp-purchase-lines.spec.ts frontend/src/lib/inlineOrderDraft.ts frontend/src/lib/inlineOrderDraft.spec.ts frontend/src/components/product/PdpClient.tsx frontend/src/components/product/MobileStickyCta.tsx
git commit -m "feat(pdp): share canonical inline purchase state"
```

---

### Task 10: Inline Order Lines and Lazy Customer Form

**Files:**
- Create: `frontend/src/components/product/InlineOrderLines.tsx`
- Create: `frontend/src/components/product/InlineOrderLines.spec.tsx`
- Create: `frontend/src/components/product/InlineCodOrderForm.tsx`
- Create: `frontend/src/components/product/InlineCodOrderForm.spec.tsx`
- Modify: `frontend/src/components/product/PdpView.tsx`
- Modify: `frontend/src/app/(storefront)/lp/[slug]/page.tsx`

**Interfaces:**
- Consumes shared Variant Picker, provider, totals, form controller, and dynamic address fields.
- Produces visible form state but no submission yet.

- [ ] **Step 1: Write failing line/form tests**

Verify add/cancel, incomplete/nonexistent rejection, OOS visibility/no-add, duplicate merge announcement, change/cancel preservation, placeholder invariant, all-line review guard, first-line error focus, no address chunk before activation, Related isolation, and throttled customer/product draft writes.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/product/InlineOrderLines.spec.tsx src/components/product/InlineCodOrderForm.spec.tsx
```

- [ ] **Step 3: Compose the form and lazy address island**

Use `next/dynamic` for `CheckoutAddressFields` and activate near `#quick-order` or on top ORDER NOW. Do not copy validation, PSGC, postal, geolocation, date, totals, or variant code.

- [ ] **Step 4: Verify components and production build**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/product/InlineOrderLines.tsx frontend/src/components/product/InlineOrderLines.spec.tsx frontend/src/components/product/InlineCodOrderForm.tsx frontend/src/components/product/InlineCodOrderForm.spec.tsx frontend/src/components/product/PdpView.tsx frontend/src/app/'(storefront)'/lp
git commit -m "feat(pdp): add multi-option inline COD form"
```

---

### Task 11: Immutable Inline Review and Confirmation Shell

**Files:**
- Create: `frontend/src/components/checkout/OrderConfirmationShell.tsx`
- Create: `frontend/src/components/checkout/OrderConfirmationShell.spec.tsx`
- Modify: `frontend/src/components/product/InlineCodOrderForm.tsx`
- Modify: `frontend/src/components/product/InlineCodOrderForm.spec.tsx`

**Interfaces:**
- Consumes `OrderReviewContent` and `orderSubmission`.
- Produces desktop modal/mobile bottom sheet and final Inline submission.

- [ ] **Step 1: Write failing immutable-review and shell tests**

```tsx
it("submits exactly the frozen validated review lines", async () => {
  await user.click(screen.getByRole("button", { name: "REVIEW COD ORDER" }));
  mutateLiveProviderAfterOpen();
  await user.click(screen.getByRole("button", { name: "CONFIRM & PLACE COD ORDER" }));
  expect(createOrder).toHaveBeenCalledWith(payloadFromOriginalSnapshot, expect.anything());
});
```

Cover all-line/customer validation, same snapshot, InitiateCheckout fingerprint dedupe, focus trap/Esc/backdrop/return, mobile sheet, field error focus, SKU/stock refresh/highlight, conflict no retry, UNKNOWN same-key-only, no cart mutation, and success draft/PII clear.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/components/checkout/OrderConfirmationShell.spec.tsx src/components/product/InlineCodOrderForm.spec.tsx
```

- [ ] **Step 3: Implement shell and frozen snapshot submission**

Create the review snapshot after validation and store it independently of live provider/form state until closed. Shell owns dialog mechanics only; shared review and submission modules own content and transport.

- [ ] **Step 4: Verify tests, accessibility behavior, and build**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/checkout/OrderConfirmationShell.tsx frontend/src/components/checkout/OrderConfirmationShell.spec.tsx frontend/src/components/product/InlineCodOrderForm.tsx frontend/src/components/product/InlineCodOrderForm.spec.tsx
git commit -m "feat(pdp): confirm inline COD orders in place"
```

---

### Task 12: Success Handoff, Attribution, Events, and PDP/LP Ordering

**Files:**
- Modify: `frontend/src/lib/tracking.ts`
- Modify: `frontend/src/components/tracking/MetaPixelInit.tsx`
- Modify: `frontend/src/components/tracking/PurchaseTracking.tsx`
- Modify: `frontend/src/components/product/PdpClient.tsx`
- Modify: `frontend/src/components/product/PdpView.tsx`
- Modify: `frontend/src/app/(storefront)/lp/[slug]/page.tsx`
- Modify: `frontend/src/app/(storefront)/order-success/[orderNumber]/page.tsx`
- Modify: `frontend/src/components/product/LandingViewTracker.tsx`
- Modify: `frontend/src/components/checkout/PreferredDateLine.tsx`

**Interfaces:**
- Produces final event sequencing, one Purchase per order, and exact section order.

- [ ] **Step 1: Write failing tracking and layout tests**

Verify full attribution, no render-time InitiateCheckout, no picker AddToCart, no Inline AddToCart, first-start only, final SKU line/add/submit data, no failed Purchase, one Purchase across remount/refresh/back-forward, order-number event ID, exact section order, sticky nav Order Now, and top/sticky focus.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec vitest run src/lib/tracking.spec.ts src/components/tracking/PurchaseTracking.spec.tsx src/components/product/PdpView.spec.tsx
```

- [ ] **Step 3: Implement dedupe and final composition**

Use `luwag:purchase:v1:<orderNumber>` as the per-order marker and Meta `eventID=orderNumber`. Remove the independent PDP TrustBar and place assurance inside Quick Order. Top/sticky Order Now focuses `#quick-order` without checkout navigation.

- [ ] **Step 4: Verify full frontend**

```bash
pnpm --dir frontend test
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend lint
pnpm --dir frontend build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/tracking.ts frontend/src/components/tracking frontend/src/components/product frontend/src/app/'(storefront)'/lp frontend/src/app/'(storefront)'/order-success
git commit -m "feat(pdp): integrate inline order attribution and success"
```

---

### Task 13: Real-Database and Browser Acceptance

**Files:**
- Modify: `frontend/package.json`
- Modify: `backend/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `frontend/playwright.config.ts`
- Create: `frontend/e2e/pdp-inline-cod.spec.ts`
- Create: `frontend/e2e/checkout-regression.spec.ts`
- Create: `frontend/e2e/order-idempotency.spec.ts`
- Modify: `backend/prisma/seed-e2e.ts`
- Create shared E2E fixture helpers under `frontend/e2e/fixtures/`.

**Interfaces:**
- Produces deterministic test products/orders and release gate.

- [ ] **Step 1: Write failing E2E scenarios and deterministic seed guards**

Seed `e2e-inline-table` with two purchasable combinations and one OOS combination, `e2e-related-chair`, `e2e-inline-offer`, and default-warehouse stock. Refuse to seed a database whose name does not end in `_test`.

Cover PDP/LP, 375/768/1280, top/sticky focus, add/change/remove/merge, structured review, modal/sheet, Related round-trip draft, response-loss same-header retry, one order, success/lookup, unchanged cart, traditional Checkout regression, lazy address requests, and zero console/hydration errors.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir frontend exec playwright test e2e/pdp-inline-cod.spec.ts e2e/checkout-regression.spec.ts e2e/order-idempotency.spec.ts
```

Expected: FAIL until fixtures and all integrated behavior exist.

- [ ] **Step 3: Add E2E scripts/fixtures and migration rollout documentation**

Add `test:e2e` scripts, deterministic cleanup, request-header capture, and response-loss interception. Document backup, compatibility flag false, old-tab observation, caller migration, metrics, and later flag enforcement.

- [ ] **Step 4: Run the complete phase gate**

```bash
pnpm --dir backend exec prisma validate
pnpm --dir backend exec prisma generate
pnpm --dir backend test
pnpm --dir backend test:e2e
pnpm --dir backend lint
pnpm --dir backend exec tsc --noEmit
pnpm --dir backend build
pnpm --dir frontend test
pnpm --dir frontend lint
pnpm --dir frontend exec tsc --noEmit
pnpm --dir frontend build
pnpm --dir frontend exec playwright test e2e/pdp-inline-cod.spec.ts e2e/checkout-regression.spec.ts e2e/order-idempotency.spec.ts
```

Expected: all exit 0 and repeated keys create one complete order.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json backend/package.json pnpm-lock.yaml frontend/playwright.config.ts frontend/e2e backend/prisma/seed-e2e.ts
git commit -m "test(e2e): cover inline COD and checkout compatibility"
```

## Phase 2 Completion Gate

Before starting Viewport Autoplay Media:

- All Task 13 commands pass from a clean test database.
- Traditional cart Checkout and admin New Order send durable keys and retain behavior.
- Compatibility backend accepts old no-key bundles while logging missing-key traffic.
- Inline PDP/LP orders are idempotent, atomic, and leave cart state unchanged.
- UNKNOWN refresh/retry uses the same key.
- Purchase fires once per order number.
- Enabling `ORDER_IDEMPOTENCY_REQUIRED=true` waits until missing-key traffic is zero across the old-tab window.
- Production migration/atomic-order deployment requires explicit database risk-gate approval.
