# Marketing Workbench Filters, Grouping and Funnel Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch new Agent or Workflow runs.

**Goal:** Give the admin marketing workbench product/optimizer filters, column sorting, a product → source-type → link two-level tree view with thumbnails, and add-to-cart / checkout-started funnel metrics attributed per campaign link.

**Architecture:** The browser attaches its existing signed marketing-touch credential to every first-party analytics event; the backend verifies the HMAC once per batch, stores the resolved `campaign_link_id` on `analytics_events`, and the marketing report reads those events as two new metrics per group. The report endpoint gains `mode` (FLAT/TREE), `sortBy`/`sortDirection`, in-memory sorting over the already-materialized rows, and a TREE response whose aggregates are summed from link rows (visits deduped by a `GROUPING SETS` query). The two admin tables gain filter selects, sortable headers, 40×40 product thumbnails and the two new columns.

**Tech Stack:** NestJS 12, Prisma (raw SQL + `prisma generate`), PostgreSQL 18, Zod, Vitest, Next.js 16, React 19, Testing Library.

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-29-marketing-workbench-filters-grouping-design.md` (committed as `4c5aa286` on `deploy/footer-20261023`; Task 0 carries it onto the feature branch).

## Global Constraints

- **Baseline:** the production revision is `36269e6` (merge containing both order idempotency `57e06ef` and footer/policy `b0cbb819`). NEVER build from a dirty `deploy/*` worktree. Before any deploy, re-verify the server's `main`; if it has moved past `36269e6`, rebase onto it first.
- **Deploy order is backend-first (or simultaneous).** The front end starts sending `marketingCredential`; the analytics DTO is `.strict()`, so an old backend would reject the whole batch and lose events. The migration (`campaign_link_id`) must run before the new backend starts.
- Backend builds require `pnpm prisma generate` before `pnpm build` (`pnpm build` alone does not regenerate the client).
- Do not touch storefront pages, Header/Footer/navigation, global theme, or anything outside the files listed per task (the user has a standing "ask before global-chrome changes" rule).
- `frontend/src/i18n/zh.ts` keys mirror `en.ts` 1:1 (TS enforces via `satisfies typeof en`); every new key is added to both in the same commit as its first consumer.
- Thumbnails = product's first image with `type: 'IMAGE', variantId: null, optionValueId: null`, ordered `sortOrder asc, id asc`, `take: 1`; render 40×40 (`h-10 w-10 rounded object-cover`), placeholder block when absent.
- Reports are event counts, not people. The UI copy for the funnel hint is exactly (en) `"Add to cart / checkout started are event counts, accumulated since this feature shipped"` and (zh) `"加购 / 发起购物为事件次数，自功能上线起累计"`.
- Sorting: `null` values (unspent CPA/ROAS, missing visits) sort last in **both** directions; ties break by `id` ascending regardless of direction (stable across pagination).
- TREE mode returns all scoped links with no pagination; the UI warns when the link count exceeds 500.
- Every commit: `git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "<message>"` (the repo's shared config has no commit identity).
- Tests run with pnpm from `small-house-commerce/backend` and `small-house-commerce/frontend`. Next.js 16 dev servers use `localhost`, never `127.0.0.1`.

## Review Focus

These are the inputs the spec implies but no single task's happy-path test exercises. Each is pinned to the task that owns it.

1. **A credential-less or expired/invalid credential batch of ADD_TO_CART events must still be stored** with `campaign_link_id = null`, never dropped and never attributed — Task 3.
2. **One batch carrying two different credentials** attributes each event to its own link, and one credential shared by many events is verified exactly once — Task 3.
3. **One browser session visiting two links of the same product on the same day inflates summed visits**; TREE product/source totals must dedupe (product=5 even when links sum to 7) while all other metrics sum — Task 7.
4. **Sorting a column where most rows have `—` (no cost recorded or zero visits)** must push nulls last in asc *and* desc and keep row order stable across pages — Task 4.
5. **A `MARKETING_VIEW_OWN` account manually passing another optimizer's `ownerUserId`** must be rejected before any report read — Task 5 (pins the existing guard against regression once filters relax the UI).
6. **The old flat report contract must not break**: `groupBy=LINK/PAGE/PRODUCT/OWNER`, `otherSources`, pagination and every existing derived metric keep their current values — Task 6 (existing spec extended, not replaced).

---

## File Structure

Backend (all under `small-house-commerce/backend/`):

- `prisma/schema/analytics.prisma` — add nullable `campaignLinkId` + index.
- `prisma/migrations/20261029120000_add_analytics_campaign_link/migration.sql` — CREATE.
- `src/modules/analytics/dto/analytics-event.dto.ts` — accept `marketingCredential`.
- `src/modules/analytics/analytics.service.ts` — resolve credential → `campaignLinkId`.
- `src/modules/analytics/analytics.module.ts` — import `CatalogModule`.
- `src/modules/marketing/marketing-report-sort.ts` — CREATE: sort values, comparator, sort fn.
- `src/modules/marketing/marketing-report-sort.spec.ts` — CREATE.
- `src/modules/marketing/dto/marketing-report.dto.ts` — `mode`/`sortBy`/`sortDirection`.
- `src/modules/marketing/dto/marketing-report.dto.spec.ts` — CREATE.
- `src/modules/marketing/marketing-report-metrics.ts` — raw type + serialized fields.
- `src/modules/marketing/marketing-report-tree.ts` — CREATE: pure tree builder.
- `src/modules/marketing/marketing-report-tree.spec.ts` — CREATE.
- `src/modules/marketing/marketing-report.service.ts` — CTE, thumbnails, sorting, TREE response.
- `src/modules/marketing/marketing-report.service.spec.ts` — extend.
- `src/modules/marketing/marketing-report-metrics.spec.ts` — extend fixtures.
- `src/modules/marketing/campaign-links.service.ts` — product thumbnail in rows.
- `src/modules/marketing/campaign-links.service.spec.ts` — extend.
- `src/generated/prisma/**` — regenerated client (committed).

Frontend (all under `small-house-commerce/frontend/`):

- `src/lib/commerce-events.ts` + `src/lib/commerce-events.spec.ts` — first-party mirror.
- `src/lib/tracking.ts` + `src/lib/tracking.spec.ts` — `currentMarketingCredential()`.
- `src/lib/analytics.ts` + `src/lib/analytics.spec.ts` — credential on every event.
- `src/lib/marketing-api.ts` — types + query passthrough.
- `src/components/admin/marketing/ReportColumns.tsx` — CREATE: shared headers + metric cells.
- `src/components/admin/marketing/ReportColumns.spec.tsx` — CREATE.
- `src/components/admin/marketing/ReportTreeTable.tsx` — CREATE: tree renderer.
- `src/components/admin/marketing/ReportTreeTable.spec.tsx` — CREATE.
- `src/components/admin/marketing/ReportTable.tsx` + spec — filters, sort, new columns, mode switch.
- `src/components/admin/marketing/CampaignLinksList.tsx` + spec — product/owner filters, thumbnail.
- `src/i18n/en.ts`, `src/i18n/zh.ts` — new keys (Task 8).

---

### Task 0: Baseline worktree and branch

**Files:** none created by the feature yet.

**Interfaces:**
- Produces: a clean worktree `$WT` (any path under `/private/tmp`, e.g. `/private/tmp/luwag-marketing-20261029`) on branch `feat/marketing-workbench-filters`, based on `36269e6` and merged with the latest `origin/main`, containing this plan, the spec, and green baseline tests.

- [ ] **Step 1: Fetch and worktree**

```bash
git -C /Users/Admin1/Desktop/菲律宾家居/建站/codex建站 fetch origin
git -C /Users/Admin1/Desktop/菲律宾家居/建站/codex建站 worktree add /private/tmp/luwag-marketing-20261029 -b feat/marketing-workbench-filters 36269e6
cd /private/tmp/luwag-marketing-20261029
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" merge --no-edit origin/main
# If the merge conflicts beyond trivial overlap, STOP and report — do not hand-resolve large divergences silently.
```

- [ ] **Step 2: Carry the spec and this plan onto the branch**

```bash
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" cherry-pick 4c5aa286
# If cherry-pick conflicts, instead copy the two files from the homepage-builder worktree:
#   small-house-commerce/docs/superpowers/specs/2026-10-29-marketing-workbench-filters-grouping-design.md
# and commit `docs(marketing): carry the workbench filters spec onto the feature branch`.
```

- [ ] **Step 3: Green baseline**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/marketing src/modules/analytics
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/components/admin/marketing src/lib/commerce-events.spec.ts src/lib/analytics.spec.ts src/lib/tracking.spec.ts src/lib/marketing-api.spec.ts
```
Expected: all pass. If anything fails before our changes, fix the environment (e.g. `pnpm install`) before continuing; do not commit failing baselines.

- [ ] **Step 4: Commit** (nothing to commit if cherry-pick was clean; otherwise commit the copied spec).

---

### Task 1: First-party funnel emission in the commerce-event adapter

**Files:**
- Modify: `frontend/src/lib/commerce-events.ts`
- Test: `frontend/src/lib/commerce-events.spec.ts`

**Interfaces:**
- Consumes: existing builders (`addToCartEvent`, `initiateCheckoutEvent`) and `emitCommerceEvent`.
- Produces: `CommerceEvent.productId?: string` (first-party only, never sent to Meta); `emitCommerceEvent` now also calls `trackFirstParty(name, payload)` for `AddToCart`/`InitiateCheckout`. Task 2 relies on `trackFirstParty` being called from here — nothing else may emit `ADD_TO_CART`/`BEGIN_CHECKOUT`.

- [ ] **Step 1: Write the failing tests** (add to `commerce-events.spec.ts`; extend the existing hoisted mocks)

```ts
const analytics = vi.hoisted(() => ({ trackFirstParty: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackFirstParty: analytics.trackFirstParty }));
```
In `beforeEach`: `analytics.trackFirstParty.mockReset()`.

```ts
describe("first-party funnel mirror", () => {
  it("mirrors AddToCart with product id and final SKU and still tracks Meta", () => {
    emitCommerceEvent(addToCartEvent({ productId: "prod-1", productName: "Chair", skuId: "sku-1", quantity: 2, price: 500 }));
    expect(tracking.track).toHaveBeenCalledTimes(1);
    expect(analytics.trackFirstParty).toHaveBeenCalledWith("ADD_TO_CART", { productId: "prod-1", entityId: "sku-1" });
  });

  it("mirrors InitiateCheckout once with the SKU list as entityId and no productId", () => {
    emitCommerceEvent(initiateCheckoutEvent({ items: [{ skuId: "sku-1", quantity: 1 }, { skuId: "sku-2", quantity: 3 }], value: 2500 }));
    expect(analytics.trackFirstParty).toHaveBeenCalledWith("BEGIN_CHECKOUT", { productId: null, entityId: "sku-1,sku-2" });
  });

  it("truncates a long InitiateCheckout entityId at 120 characters", () => {
    const id = "s".repeat(300);
    emitCommerceEvent(initiateCheckoutEvent({ items: [{ skuId: id, quantity: 1 }], value: null }));
    const payload = analytics.trackFirstParty.mock.calls[0][1] as { entityId: string | null };
    expect(payload.entityId).toHaveLength(120);
  });

  it("does not create first-party funnel events for views, purchases or custom events", () => {
    emitCommerceEvent(viewContentEvent({ productId: "prod-1", productName: "Chair", skuId: "sku-1", price: 100 }));
    emitCommerceEvent(purchaseEvent({ orderId: "PH100011", items: [{ skuId: "sku-1", quantity: 1 }], value: 100 }));
    emitCommerceEvent(optionSelectEvent({ productId: "prod-1", optionKind: "SIZE", optionValueId: "v1", selectionSource: "USER" }));
    expect(analytics.trackFirstParty).not.toHaveBeenCalled();
  });

  it("does nothing for a refused builder event", () => {
    emitCommerceEvent(addToCartEvent({ productId: "p", productName: "Chair", skuId: null, quantity: 0, price: null }));
    expect(analytics.trackFirstParty).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/lib/commerce-events.spec.ts
```
Expected: FAIL — `trackFirstParty` never called (and no `@/lib/analytics` export mocked yet may surface as a missing-mock error).

- [ ] **Step 3: Implement**

In `commerce-events.ts`:

```ts
import { trackFirstParty } from "./analytics";

export interface CommerceEvent {
  name: string;
  data: Record<string, unknown>;
  /** true → Meta custom event (trackCustom); false → standard event (track). */
  custom: boolean;
  /** The product the event belongs to. First-party analytics only; never sent to Meta. */
  productId?: string;
}
```
`addToCartEvent` gains `productId: input.productId,` in its returned object (Meta `data` unchanged). `initiateCheckoutEvent` gains no `productId` (multi-product context).

Replace `emitCommerceEvent`:

```ts
/** Fires through the right Meta channel; null-safe so callers can pass builders' refusals. */
export function emitCommerceEvent(event: CommerceEvent | null): void {
  if (event === null) return;
  if (event.custom) trackCustom(event.name, event.data);
  else track(event.name, event.data);
  recordFirstPartyFunnel(event);
}

function contentIds(event: CommerceEvent): string[] {
  const ids = event.data.content_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Mirrors the paid funnel into first-party analytics so the marketing
 * workbench can break add-to-cart / checkout-started down per campaign link.
 * Every standard commerce event already passes here, which is what keeps the
 * store funnel and Meta pixel strictly co-sourced.
 */
function recordFirstPartyFunnel(event: CommerceEvent): void {
  if (event.name === "AddToCart") {
    trackFirstParty("ADD_TO_CART", { productId: event.productId ?? null, entityId: contentIds(event)[0] ?? null });
  } else if (event.name === "InitiateCheckout") {
    trackFirstParty("BEGIN_CHECKOUT", { productId: null, entityId: contentIds(event).join(",").slice(0, 120) || null });
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/lib/commerce-events.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/commerce-events.ts frontend/src/lib/commerce-events.spec.ts
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(analytics): mirror AddToCart and InitiateCheckout into first-party events"
```

---

### Task 2: Attach the marketing credential to first-party events

**Files:**
- Modify: `frontend/src/lib/tracking.ts`, `frontend/src/lib/analytics.ts`
- Test: `frontend/src/lib/tracking.spec.ts`, `frontend/src/lib/analytics.spec.ts`

**Interfaces:**
- Consumes: `storedTouch()` (exists in `tracking.ts`), `MARKETING_TOUCH_STORAGE_KEY = "sh:marketing-touch"`.
- Produces: `currentMarketingCredential(): string | null` (exported from `tracking.ts`); every emitted first-party event gains `marketingCredential?: string`. Task 3 verifies it server-side. Import direction must remain `analytics.ts → tracking.ts` (no runtime cycle: `api.ts` only imports `Attribution` as a type).

- [ ] **Step 1: Failing test in `tracking.spec.ts`**

```ts
import { currentMarketingCredential, readAttribution } from "./tracking";

describe("currentMarketingCredential", () => {
  it("returns the stored valid credential", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ credential: "server.credential", expiresAt: "2099-01-01T00:00:00Z" }));
    expect(currentMarketingCredential()).toBe("server.credential");
  });

  it("returns null without a stored credential and on the server", () => {
    expect(currentMarketingCredential()).toBeNull();
  });
});
```
(The storage-fixture pattern — `window.localStorage.setItem(KEY, …)` — already exists in that file.)

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/lib/tracking.spec.ts
```
Expected: FAIL — `currentMarketingCredential` is not exported.

- [ ] **Step 3: Implement in `tracking.ts`** (place next to `storedTouch`)

```ts
/**
 * The current marketing-touch credential for this browser, or null. Analytics
 * attaches it to every event so the server can resolve which campaign link
 * produced the visit — the same credential checkout uses to attribute orders.
 */
export function currentMarketingCredential(): string | null {
  if (typeof window === "undefined") return null;
  return storedTouch()?.credential ?? null;
}
```

- [ ] **Step 4: Failing test in `analytics.spec.ts`**

```ts
it("attaches the stored marketing credential to every event", () => {
  window.localStorage.setItem("sh:marketing-touch", JSON.stringify({ credential: "server.credential", expiresAt: "2099-01-01T00:00:00Z" }));
  const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchSpy);
  window.history.replaceState({}, "", "/products/table");

  trackFirstParty("PRODUCT_VIEW", { productId: "product-1" });
  flushAnalytics();

  const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
  expect(body.events[0]).toMatchObject({ marketingCredential: "server.credential" });
});

it("omits the credential field when no marketing touch is stored", () => {
  const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchSpy);
  window.history.replaceState({}, "", "/products/table");

  trackFirstParty("PRODUCT_VIEW", { productId: "product-1" });
  flushAnalytics();

  const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
  expect(body.events[0]).not.toHaveProperty("marketingCredential");
});
```

- [ ] **Step 5: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/lib/analytics.spec.ts
```
Expected: FAIL — event lacks `marketingCredential`.

- [ ] **Step 6: Implement in `analytics.ts`**

```ts
import { currentMarketingCredential } from "./tracking";
```
Add to `FirstPartyEvent`: `marketingCredential?: string;`. In `baseEvent`, before the return:

```ts
  const credential = currentMarketingCredential();
  return {
    ...,
    ...(credential ? { marketingCredential: credential } : {}),
  };
```
(Applied to every event, not only commerce ones — future funnel steps then exist without another payload change.)

- [ ] **Step 7: Run to verify pass**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/lib/analytics.spec.ts src/lib/tracking.spec.ts src/lib/commerce-events.spec.ts
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/tracking.ts frontend/src/lib/tracking.spec.ts frontend/src/lib/analytics.ts frontend/src/lib/analytics.spec.ts
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(analytics): attach the marketing touch credential to first-party events"
```

---

### Task 3: Backend ingest — verify the credential, store `campaign_link_id`

**Files:**
- Modify: `backend/src/modules/analytics/dto/analytics-event.dto.ts`, `backend/src/modules/analytics/analytics.service.ts`, `backend/src/modules/analytics/analytics.module.ts`, `backend/prisma/schema/analytics.prisma`
- Create: `backend/prisma/migrations/20261029120000_add_analytics_campaign_link/migration.sql`
- Regenerate: `backend/src/generated/prisma/**`
- Test: `backend/src/modules/analytics/analytics.service.spec.ts`

**Interfaces:**
- Consumes: `MarketingTouchService.resolve(credential)` → claims with `linkId: string | null` (exported by `CatalogModule`); `analyticsEvent.createMany`.
- Produces: `AnalyticsEvent.campaignLinkId` (uuid, nullable, indexed); `MarketingReportService` (Task 6) joins `analytics_events.campaign_link_id = scoped_links.id`.

- [ ] **Step 1: Schema + migration**

In `analytics.prisma` inside `model AnalyticsEvent` (before `eventDay` is fine; keep column order sensible):

```prisma
  /// Campaign link that produced this event. Resolved server-side from the
  /// signed marketing-touch credential the batch carries; null for organic
  /// or invalid touches. Never a copy of client-supplied ids.
  campaignLinkId String? @map("campaign_link_id") @db.Uuid
```
and add to the model's index list:

```prisma
  @@index([campaignLinkId, eventName, eventDay])
```

Create the migration directory and file `migration.sql`:

```sql
-- Attribute first-party funnel events (add to cart, checkout started, …) to
-- the campaign link whose touch credential the batch carried. Additive and
-- nullable: historical events keep working with campaign_link_id NULL and
-- are never backfilled.
ALTER TABLE "analytics_events" ADD COLUMN "campaign_link_id" UUID;
CREATE INDEX "analytics_events_campaign_link_id_event_name_event_day_idx"
  ON "analytics_events" ("campaign_link_id", "event_name", "event_day");
```

Then regenerate the client:

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm prisma generate
```
Expected: exit 0, `Generated Prisma Client` written under `src/generated/prisma`. **Do not** run `migrate dev` against any shared database from this worktree; the production DB gets the migration at deploy time.

- [ ] **Step 2: Failing tests in `analytics.service.spec.ts`**

Update `makeService`:

```ts
import { AnalyticsService } from "./analytics.service.js";

function makeService(touch?: { resolve: (credential: string) => Promise<{ linkId: string | null } | null> }) {
  const prisma = { analyticsEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  const marketingTouch = { resolve: vi.fn(async () => null) };
  return { prisma, marketingTouch, service: new AnalyticsService(prisma as never, (touch ?? marketingTouch) as never) };
}
```
All existing `makeService()` call sites keep working (add a destructure only where a call site needs `marketingTouch`).

New tests:

```ts
it("stores a valid touch credential's campaign link on the event", async () => {
  const { prisma, service } = makeService();
  (service as unknown as { marketingTouch: { resolve: (c: string) => Promise<object | null> } });
  // The service was built with the default touch mock; point it at a claim:
  // rebuild below is unnecessary — see the helper test instead.
  expect(true).toBe(true); // replaced by the explicit test below
});

it("attributes each event to its own link and verifies each distinct credential once", async () => {
  const resolve = vi.fn()
    .mockResolvedValueOnce({ linkId: "link-a" })
    .mockResolvedValueOnce({ linkId: "link-b" });
  const { prisma, marketingTouch, service } = makeService();
  (service as unknown as { marketingTouch: unknown }); // typing aid only
  Object.assign(marketingTouch, { resolve });
  await service.ingest(
    [
      event({ eventName: "ADD_TO_CART", marketingCredential: "cred-a" }),
      event({ eventName: "ADD_TO_CART", marketingCredential: "cred-a" }),
      event({ eventName: "BEGIN_CHECKOUT", marketingCredential: "cred-b" }),
    ],
    "client",
  );
  const data = prisma.analyticsEvent.createMany.mock.calls[0][0].data;
  expect(data[0].campaignLinkId).toBe("link-a");
  expect(data[1].campaignLinkId).toBe("link-a");
  expect(data[2].campaignLinkId).toBe("link-b");
  expect(resolve).toHaveBeenCalledTimes(2);
});

it("keeps storing events whose credential is missing or invalid, with no link", async () => {
  const resolve = vi.fn().mockRejectedValue(new Error("boom"));
  const { prisma, marketingTouch, service } = makeService();
  Object.assign(marketingTouch, { resolve });
  await expect(service.ingest(
    [event({ eventName: "ADD_TO_CART", marketingCredential: "cred-x" }), event({ eventName: "ADD_TO_CART" })],
    "client",
  )).resolves.toMatchObject({ accepted: 2 });
  const data = prisma.analyticsEvent.createMany.mock.calls[0][0].data;
  expect(data[0].campaignLinkId).toBeNull();
  expect(data[1].campaignLinkId).toBeNull();
});
```
Note: the throw path means `resolve` failures must be caught inside the service (select the first test above or drop it; the two real tests are the second and third blocks — keep only those two and the expired-credential-returns-null case below):

```ts
it("treats an expired credential as unattributed, not an error", async () => {
  const resolve = vi.fn().mockResolvedValue(null);
  const { prisma, marketingTouch, service } = makeService();
  Object.assign(marketingTouch, { resolve });
  await service.ingest([event({ eventName: "ADD_TO_CART", marketingCredential: "expired" })], "client");
  const data = prisma.analyticsEvent.createMany.mock.calls[0][0].data;
  expect(data[0].campaignLinkId).toBeNull();
  expect(marketingTouch.resolve).toHaveBeenCalledOnce();
});
```
Cleanup instruction for the implementer: the first placeholder block above ("stores a valid touch credential…") exists only to make the RED phase explicit — delete it; the three real tests are "attributes each event…", "keeps storing events…", "treats an expired credential…".

- [ ] **Step 3: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/analytics/analytics.service.spec.ts
```
Expected: FAIL — `AnalyticsService` takes one argument; `campaignLinkId` undefined.

- [ ] **Step 4: Implement**

`dto/analytics-event.dto.ts` — inside the object schema (after `metadata`):

```ts
    /** Signed marketing-touch credential; the server verifies it and keeps
     *  only the resolved campaign link id. */
    marketingCredential: z.string().max(8192).optional(),
```

`analytics.service.ts`:

```ts
import { MarketingTouchService } from '../marketing/marketing-touch.service.js';

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingTouch: MarketingTouchService,
  ) {}
```
Replace the row-building section of `ingest`:

```ts
    const linkIds = new Map<string, string | null>();
    const resolveLinkId = async (credential: string | undefined): Promise<string | null> => {
      if (!credential) return null;
      const cached = linkIds.get(credential);
      if (cached !== undefined) return cached;
      // An unverifiable credential is the shopper's problem to fix by
      // touching a real link again; the event itself is still valid traffic.
      let linkId: string | null = null;
      try {
        linkId = (await this.marketingTouch.resolve(credential))?.linkId ?? null;
      } catch {
        linkId = null;
      }
      linkIds.set(credential, linkId);
      return linkId;
    };

    const rows: Prisma.AnalyticsEventCreateManyInput[] = [];
    for (const batchEvent of events) {
      if (!this.isStorefrontEvent(batchEvent)) continue;
      const row = this.toRow(batchEvent);
      row.campaignLinkId = await resolveLinkId(batchEvent.marketingCredential);
      rows.push(row);
    }
    if (rows.length === 0) return { accepted: 0 };
```
(Keep the rate limiter, `resolveProductIds`, the `createMany` call and the catch exactly as they are.)

`analytics.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AnalyticsService } from './analytics.service.js';
import { StorefrontAnalyticsController } from './storefront/analytics.controller.js';

@Module({
  // CatalogModule exports MarketingTouchService; the analytics ingest verifies
  // the signed touch credential the browser attaches to each event batch.
  imports: [CatalogModule],
  controllers: [StorefrontAnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 5: Run to verify pass**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/analytics src/modules/marketing
```
Expected: all green. If a Nest wiring test (e2e) exists for analytics, run `pnpm vitest run --config ./vitest.config.e2e.ts analytics` too.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema/analytics.prisma backend/prisma/migrations/20261029120000_add_analytics_campaign_link backend/src/generated/prisma backend/src/modules/analytics
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(analytics): attribute first-party funnel events to campaign links"
```

---

### Task 4: Sort helper for report rows

**Files:**
- Create: `backend/src/modules/marketing/marketing-report-sort.ts`
- Test: `backend/src/modules/marketing/marketing-report-sort.spec.ts`

**Interfaces:**
- Consumes: `MarketingReportSerializedRow` (created in Task 6 — this task compiles against the intended shape below; implement the type export in Task 6 and keep this module's code as written here). To make Task 4 self-contained, define locally:

```ts
export interface SortableReportRow {
  id: string;
  label: string;
  ownerName: string | null;
  productName: string | null;
  visits: number | null;
  addToCarts: number;
  checkouts: number;
  submittedOrders: number;
  validOrders: number;
  confirmedOrders: number;
  signedOrders: number;
  validOrderValuePhp: string;
  signedGrossPhp: string;
  spendUsd: string;
  spendPhp: string;
  orderCpaUsd: string | null;
  signedCpaUsd: string | null;
  orderRoas: string | null;
  signedRoas: string | null;
  conversionRate: string | null;
}
```
and in Task 6 make `MarketingReportSerializedRow` structural-compatible (it is). The sort module's functions accept `SortableReportRow`.
- Produces: `marketingReportSortValues` (const tuple), `type MarketingReportSort`, `marketingReportSortValue(row, sortBy)`, `compareMarketingReportRows(a, b, sortBy, direction)`, `sortMarketingReportRows(rows, sortBy, direction)`. Tasks 5 (DTO) and 6/7 (service/tree) import all four.

- [ ] **Step 1: Failing tests** (`marketing-report-sort.spec.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { compareMarketingReportRows, marketingReportSortValue, sortMarketingReportRows } from './marketing-report-sort.js';
import type { SortableReportRow } from './marketing-report-sort.js';

const row = (overrides: Partial<SortableReportRow> = {}): SortableReportRow => ({
  id: 'id', label: 'A', ownerName: 'Opt', productName: 'Chair', visits: 1,
  addToCarts: 0, checkouts: 0, submittedOrders: 0, validOrders: 0, confirmedOrders: 0, signedOrders: 0,
  validOrderValuePhp: '0.00', signedGrossPhp: '0.00', spendUsd: '0.00', spendPhp: '0.00',
  orderCpaUsd: null, signedCpaUsd: null, orderRoas: null, signedRoas: null, conversionRate: null, ...overrides,
});

describe('marketing report sorting', () => {
  it('maps every sort value to its field', () => {
    expect(marketingReportSortValue(row({ validOrders: 3, validOrderValuePhp: '12.00' }), 'VALID')).toBe(3);
    expect(marketingReportSortValue(row({ validOrderValuePhp: '12.00' }), 'VALID_VALUE')).toBe(12);
    expect(marketingReportSortValue(row({ label: 'Ad B' }), 'NAME')).toBe('Ad B');
    expect(marketingReportSortValue(row({ ownerName: null }), 'OWNER')).toBeNull();
  });

  it('sorts numerics ascending and descending', () => {
    const rows = [row({ id: 'b', validOrders: 2 }), row({ id: 'a', validOrders: 1 }), row({ id: 'c', validOrders: 3 })];
    expect(sortMarketingReportRows(rows, 'VALID', 'ASC').map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortMarketingReportRows(rows, 'VALID', 'DESC').map(r => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('always puts nulls last regardless of direction', () => {
    const rows = [row({ id: 'x', orderCpaUsd: null }), row({ id: 'y', orderCpaUsd: '2.00' })];
    expect(sortMarketingReportRows(rows, 'ORDER_CPA', 'ASC').map(r => r.id)).toEqual(['y', 'x']);
    expect(sortMarketingReportRows(rows, 'ORDER_CPA', 'DESC').map(r => r.id)).toEqual(['y', 'x']);
  });

  it('breaks ties by id ascending in both directions so pagination stays stable', () => {
    const rows = [row({ id: 'b', validOrders: 1 }), row({ id: 'a', validOrders: 1 })];
    for (const direction of ['ASC', 'DESC'] as const) {
      expect(sortMarketingReportRows(rows, 'VALID', direction).map(r => r.id)).toEqual(['a', 'b']);
    }
    expect(compareMarketingReportRows(row({ id: 'b' }), row({ id: 'a' }), 'NAME', 'ASC')).toBeGreaterThan(0);
  });

  it('sorts text with the zh locale and ignores case', () => {
    const rows = [row({ id: '1', label: 'beta Ad' }), row({ id: '2', label: 'Alpha Ad' })];
    expect(sortMarketingReportRows(rows, 'NAME', 'ASC').map(r => r.id)).toEqual(['2', '1']);
  });

  it('never mutates the input array', () => {
    const rows = [row({ id: 'b', validOrders: 2 }), row({ id: 'a', validOrders: 1 })];
    sortMarketingReportRows(rows, 'VALID', 'ASC');
    expect(rows.map(r => r.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/marketing/marketing-report-sort.spec.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `marketing-report-sort.ts`**

```ts
import type { MarketingReportSerializedRow } from './marketing-report-metrics.js';

/** Sort keys the report API exposes, in the order the UI lists them. */
export const marketingReportSortValues = [
  'NAME', 'PRODUCT', 'OWNER',
  'VISITS', 'ADD_TO_CARTS', 'CHECKOUTS', 'SUBMITTED', 'VALID', 'CONFIRMED', 'SIGNED',
  'VALID_VALUE', 'SIGNED_GROSS', 'SPEND_USD', 'SPEND_PHP',
  'ORDER_CPA', 'SIGNED_CPA', 'ORDER_ROAS', 'SIGNED_ROAS', 'CONVERSION',
] as const;
export type MarketingReportSort = (typeof marketingReportSortValues)[number];
export type MarketingReportSortDirection = 'ASC' | 'DESC';

type SortValue = string | number | null;

/**
 * Column value for a sort key. Monetary strings convert to numbers so '9.00'
 * cannot outrank '100.00'; derived ratios keep their null (never-ratio) state.
 */
export function marketingReportSortValue(row: MarketingReportSerializedRow, sortBy: MarketingReportSort): SortValue {
  switch (sortBy) {
    case 'NAME': return row.label;
    case 'PRODUCT': return row.productName;
    case 'OWNER': return row.ownerName;
    case 'VISITS': return row.visits;
    case 'ADD_TO_CARTS': return row.addToCarts;
    case 'CHECKOUTS': return row.checkouts;
    case 'SUBMITTED': return row.submittedOrders;
    case 'VALID': return row.validOrders;
    case 'CONFIRMED': return row.confirmedOrders;
    case 'SIGNED': return row.signedOrders;
    case 'VALID_VALUE': return Number(row.validOrderValuePhp);
    case 'SIGNED_GROSS': return Number(row.signedGrossPhp);
    case 'SPEND_USD': return Number(row.spendUsd);
    case 'SPEND_PHP': return Number(row.spendPhp);
    case 'ORDER_CPA': return row.orderCpaUsd === null ? null : Number(row.orderCpaUsd);
    case 'SIGNED_CPA': return row.signedCpaUsd === null ? null : Number(row.signedCpaUsd);
    case 'ORDER_ROAS': return row.orderRoas === null ? null : Number(row.orderRoas);
    case 'SIGNED_ROAS': return row.signedRoas === null ? null : Number(row.signedRoas);
    case 'CONVERSION': return row.conversionRate === null ? null : Number(row.conversionRate);
  }
}

/**
 * Order rule for the report and the tree's product/source/link levels:
 * nulls last in both directions, ties broken by id ascending so a page
 * boundary can never reshuffle equal rows.
 */
export function compareMarketingReportRows(a: MarketingReportSerializedRow, b: MarketingReportSerializedRow, sortBy: MarketingReportSort, direction: MarketingReportSortDirection): number {
  const factor = direction === 'DESC' ? -1 : 1;
  const av = marketingReportSortValue(a, sortBy);
  const bv = marketingReportSortValue(b, sortBy);
  if (av === null && bv === null) return a.id.localeCompare(b.id);
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp = typeof av === 'number' && typeof bv === 'number'
    ? av - bv
    : String(av).localeCompare(String(bv), 'zh');
  return cmp === 0 ? a.id.localeCompare(b.id) : cmp * factor;
}

export function sortMarketingReportRows<Row extends MarketingReportSerializedRow>(rows: Row[], sortBy: MarketingReportSort, direction: MarketingReportSortDirection): Row[] {
  return [...rows].sort((a, b) => compareMarketingReportRows(a, b, sortBy, direction));
}
```
*(The spec-test's `SortableReportRow` above is satisfied structurally by `MarketingReportSerializedRow`; if the local interface is exported, keep it only if Task 6 has not landed yet — delete the local interface and rely on the structural type once Task 6 exists. The test file then imports the type from `marketing-report-metrics` instead. Implement Task 6's metrics type first if needed to compile; the plan's Task order stays RED→GREEN per task by stubbing the type in Task 4:)*

```ts
// Task 4 transitional type, replaced by the real export in Task 6:
export interface SortableReportRow { /* …the interface above… */ }
```
and Task 6's `MarketingReportSerializedRow` extends it.

- [ ] **Step 4: Run to verify pass**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/marketing/marketing-report-sort.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/marketing/marketing-report-sort.ts backend/src/modules/marketing/marketing-report-sort.spec.ts
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(marketing): report row comparator with nulls last and stable ties"
```

---

### Task 5: Report query DTO — mode, sortBy, sortDirection

**Files:**
- Modify: `backend/src/modules/marketing/dto/marketing-report.dto.ts`
- Create: `backend/src/modules/marketing/dto/marketing-report.dto.spec.ts`

**Interfaces:**
- Consumes: `marketingReportSortValues`, `MarketingReportSort` from `marketing-report-sort.js` (Task 4).
- Produces: `MarketingReportQuery` now carries `mode: 'FLAT' | 'TREE'`, `sortBy: MarketingReportSort`, `sortDirection: 'ASC' | 'DESC'`, all defaulted. Tasks 6/7 read them.

- [ ] **Step 1: Failing test** (`marketing-report.dto.spec.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { marketingReportQuerySchema } from './marketing-report.dto.js';

describe('marketing report query schema', () => {
  it('defaults to flat order by name ascending', () => {
    expect(marketingReportQuerySchema.parse({})).toMatchObject({ mode: 'FLAT', sortBy: 'NAME', sortDirection: 'ASC' });
  });

  it('accepts every documented combination', () => {
    const parsed = marketingReportQuerySchema.parse({ mode: 'TREE', sortBy: 'ADD_TO_CARTS', sortDirection: 'DESC' });
    expect(parsed).toMatchObject({ mode: 'TREE', sortBy: 'ADD_TO_CARTS', sortDirection: 'DESC' });
  });

  it('rejects unknown modes, sorts and directions', () => {
    for (const input of [
      { mode: 'TREE_FLAT' }, { mode: 5 },
      { sortBy: 'CLICKS' }, { sortDirection: 'desc' },
    ]) {
      expect(marketingReportQuerySchema.safeParse(input).success).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/marketing/dto/marketing-report.dto.spec.ts
```

- [ ] **Step 3: Implement** — in `marketing-report.dto.ts` add to the schema object (before the closing of the zod object, keeping `.strict()`):

```ts
import { marketingReportSortValues } from '../marketing-report-sort.js';

  mode: z.enum(['FLAT', 'TREE']).default('FLAT'),
  sortBy: z.enum(marketingReportSortValues).default('NAME'),
  sortDirection: z.enum(['ASC', 'DESC']).default('ASC'),
```

- [ ] **Step 4: Run to verify pass** — same command; also run the whole DTO suite: `pnpm vitest run src/modules/marketing/dto`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/marketing/dto/marketing-report.dto.ts backend/src/modules/marketing/dto/marketing-report.dto.spec.ts
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(marketing): tree mode and sorting on the report query"
```

---

### Task 6: Report metrics, thumbnails and flat-mode sorting

**Files:**
- Modify: `backend/src/modules/marketing/marketing-report-metrics.ts`, `backend/src/modules/marketing/marketing-report-metrics.spec.ts`, `backend/src/modules/marketing/marketing-report.service.ts`, `backend/src/modules/marketing/marketing-report.service.spec.ts`

**Interfaces:**
- Consumes: `sortMarketingReportRows`/`MarketingReportSort` (Task 4).
- Produces:
  - `MarketingReportRawRow` gains `sourceType: string | null`, `addToCarts: bigint`, `checkouts: bigint`.
  - `serializeMarketingReportRow(row, productThumbnailUrl?)` returns `sourceType`, `addToCarts`, `checkouts`, `productThumbnailUrl`; exports `type MarketingReportSerializedRow = ReturnType<typeof serializeMarketingReportRow>` (extends `SortableReportRow` from Task 4).
  - Service responds with `mode`, `sortBy`, `sortDirection` and sorted/paginated rows; thumbnails come from a batched `product.findMany`.

- [ ] **Step 1: Failing tests**

In `marketing-report-metrics.spec.ts` add `sourceType: 'META_AD', addToCarts: 3n, checkouts: 1n` to the raw fixture and:

```ts
it('exposes funnel event counts and product thumbnail', () => {
  const row = serializeMarketingReportRow({ ...rawFixture, addToCarts: 3n, checkouts: 1n, sourceType: 'META_AD' }, '/uploads/chair.jpg');
  expect(row).toMatchObject({ addToCarts: 3, checkouts: 1, sourceType: 'META_AD', productThumbnailUrl: '/uploads/chair.jpg' });
  expect(serializeMarketingReportRow(rawFixture)).toMatchObject({ addToCarts: 0, checkouts: 0, productThumbnailUrl: null });
});
```
(read the existing fixture name from the file; keep its other assertions intact.)

In `marketing-report.service.spec.ts` extend `setup`'s prisma mock with `product: { findMany: vi.fn(async () => []) }` and the `raw` fixture with `sourceType: 'META_AD', addToCarts: 3n, checkouts: 1n`, then add:

```ts
it('counts add-to-cart and checkout events and returns product thumbnails', async () => {
  const linkId = '33333333-3333-4333-a333-333333333333';
  const { service, prisma } = setup([{ ...raw, id: linkId }]);
  (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ ...raw, id: linkId }]);
  (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'p1', images: [{ url: '/uploads/chair.jpg' }] }]);
  const result = await service.report(query, account);
  expect(result).toMatchObject({ mode: 'FLAT', sortBy: 'NAME', sortDirection: 'ASC' });
  expect(result.rows[0]).toMatchObject({ addToCarts: 3, checkouts: 1, productThumbnailUrl: '/uploads/chair.jpg', sourceType: 'META_AD' });
});

it('sorts flat rows server-side and pages after sorting', async () => {
  const rows = [
    { ...raw, id: 'b', label: 'B', validOrders: 1n, productId: 'p-b' },
    { ...raw, id: 'a', label: 'A', validOrders: 2n, productId: 'p-a' },
    { ...raw, id: 'c', label: 'C', validOrders: 3n, productId: 'p-c' },
  ];
  const { service, prisma } = setup(rows);
  (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const result = await service.report({ ...query, sortBy: 'VALID', sortDirection: 'DESC', pageSize: 2 }, account);
  expect(result.total).toBe(3);
  expect(result.rows.map(r => r.id)).toEqual(['c', 'b']);
  expect(result.rows.map(r => r.validOrders)).toEqual([3, 1]);
});

it('rank-less rows (no spend) sort last in both directions', async () => {
  const rows = [
    { ...raw, id: 'a', label: 'A', spendUsd: new Prisma.Decimal('0'), spendPhp: new Prisma.Decimal('0'), validOrders: 1n, orderCpaUsd: null },
    { ...raw, id: 'b', label: 'B', validOrders: 1n }, // CPA derived
  ];
  const { service, prisma } = setup(rows);
  (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  // b's CPA is derived from spendUsd 0 → still null per existing rules; both null,
  // so ties must fall back to id — this pins null-last + stable-id semantics end to end.
  for (const direction of ['ASC', 'DESC'] as const) {
    const result = await service.report({ ...query, sortBy: 'ORDER_CPA', sortDirection: direction }, account);
    expect(result.rows.map(r => r.id)).toEqual(['a', 'b']);
  }
});

it('stays scoped when a view-own account passes a foreign owner', async () => {
  const { service, prisma } = setup();
  await expect(service.report({ ...query, ownerUserId: '33333333-3333-4333-a333-333333333333' }, account)).rejects.toMatchObject({ status: 404 });
  expect(prisma.$queryRaw).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/marketing/marketing-report-metrics.spec.ts src/modules/marketing/marketing-report.service.spec.ts
```

- [ ] **Step 3: Implement**

`marketing-report-metrics.ts`:

```ts
const countFields = ['submittedOrders', 'validOrders', 'confirmedOrders', 'signedOrders', 'duplicateOrders', 'riskOrders', 'afterSalesOrders', 'refundStatusOrders'] as const;
type CountField = typeof countFields[number];
export type MarketingReportRawRow = Record<CountField, bigint> & {
  kind: 'REGISTERED' | 'DIRECT' | 'LEGACY' | 'UNVERIFIED'; id: string; label: string;
  ownerUserId: string | null; ownerName: string | null; aid: string | null;
  productId: string | null; productName: string | null; productCode: string | null; landingPageId: string | null;
  sourceType: string | null;
  visits: bigint | null; pageTotalVisits?: bigint | null;
  addToCarts: bigint; checkouts: bigint;
  validOrderValuePhp: Prisma.Decimal; signedGrossPhp: Prisma.Decimal; spendUsd: Prisma.Decimal; spendPhp: Prisma.Decimal;
  expectedCostDays: bigint; recordedCostDays: bigint;
};

export interface SortableReportRow {
  id: string; label: string; ownerName: string | null; productName: string | null;
  visits: number | null; addToCarts: number; checkouts: number;
  submittedOrders: number; validOrders: number; confirmedOrders: number; signedOrders: number;
  validOrderValuePhp: string; signedGrossPhp: string; spendUsd: string; spendPhp: string;
  orderCpaUsd: string | null; signedCpaUsd: string | null; orderRoas: string | null; signedRoas: string | null;
  conversionRate: string | null;
}
export type MarketingReportSerializedRow = SortableReportRow & { kind: MarketingReportRawRow['kind']; ownerUserId: string | null; aid: string | null; productCode: string | null; landingPageId: string | null; sourceType: string | null; productThumbnailUrl: string | null; pageTotalVisits: number | null; expectedCostDays: number; recordedCostDays: number; costCoverageComplete: boolean; periodBasis: 'TOUCH' | 'ORDER_CREATED'; };
```
In `serializeMarketingReportRow(row: MarketingReportRawRow, productThumbnailUrl: string | null = null)`:

```ts
  const counts = Object.fromEntries(countFields.map(key => [key, Number(row[key])])) as Record<CountField, number>;
  const visits = registered && row.visits !== null ? Number(row.visits) : null;
  return {
    ...,
    sourceType: row.sourceType,
    addToCarts: Number(row.addToCarts ?? 0n),
    checkouts: Number(row.checkouts ?? 0n),
    productThumbnailUrl,
    ...existing fields unchanged,
  };
```
(`?? 0n` keeps `serializeMarketingTotals`'s performance-side callers, whose rows lack the new columns, working: performance SQL is unchanged in this wave.)

`marketing-report.service.ts` — replace the whole body of `report` after access checks:

```ts
    const owner = scope.all ? query.ownerUserId : account.id;
    const from = new Date(new Date(`${query.from}T00:00:00.000Z`).getTime() - 8 * 3600_000);
    const end = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 16 * 3600_000);
    const ids = query.linkIds?.map(id => Prisma.sql`${id}::uuid`);
    const filters = Prisma.sql`l.created_at < ${end}::timestamptz
      ${owner ? Prisma.sql`AND l.owner_user_id = ${owner}::uuid` : Prisma.empty}
      ${query.productId ? Prisma.sql`AND l.product_id = ${query.productId}::uuid` : Prisma.empty}
      ${query.landingPageId ? Prisma.sql`AND l.landing_page_id = ${query.landingPageId}::uuid` : Prisma.empty}
      ${ids ? Prisma.sql`AND l.id IN (${Prisma.join(ids)})` : Prisma.empty}`;
    const groupKey = { LINK: Prisma.sql`l.id::text`, PAGE: Prisma.sql`COALESCE(l.landing_page_id::text, 'PRODUCT:' || l.product_id::text)`, PRODUCT: Prisma.sql`l.product_id::text`, OWNER: Prisma.sql`l.owner_user_id::text` }[query.groupBy];
    const groupLabel = { LINK: Prisma.sql`s.name`, PAGE: Prisma.sql`COALESCE(s.page_name, s.product_name)`, PRODUCT: Prisma.sql`s.product_name`, OWNER: Prisma.sql`s.owner_name` }[query.groupBy];
    const rows = await this.prisma.$queryRaw<MarketingReportRawRow[]>(Prisma.sql`
      WITH scoped_links AS (
        SELECT l.*, ${groupKey} AS group_key, p.name AS page_name,
          product.name AS product_name, product.product_code,
          COALESCE(op.display_name, u.name) AS owner_name
        FROM campaign_links l JOIN products product ON product.id = l.product_id
        JOIN users u ON u.id = l.owner_user_id LEFT JOIN optimizer_profiles op ON op.user_id = u.id
        LEFT JOIN product_landing_pages p ON p.id = l.landing_page_id
        WHERE ${filters}
      ), groups AS (
        SELECT s.group_key AS id, MIN(${groupLabel}) AS label,
          CASE WHEN COUNT(DISTINCT s.owner_user_id) = 1 THEN MIN(s.owner_user_id::text) END AS "ownerUserId",
          CASE WHEN COUNT(DISTINCT s.owner_user_id) = 1 THEN MIN(s.owner_name) END AS "ownerName",
          CASE WHEN COUNT(DISTINCT s.aid_snapshot) = 1 THEN MIN(s.aid_snapshot) END AS aid,
          CASE WHEN COUNT(DISTINCT s.product_id) = 1 THEN MIN(s.product_id::text) END AS "productId",
          CASE WHEN COUNT(DISTINCT s.product_id) = 1 THEN MIN(s.product_name) END AS "productName",
          CASE WHEN COUNT(DISTINCT s.product_id) = 1 THEN MIN(s.product_code) END AS "productCode",
          CASE WHEN COUNT(DISTINCT s.landing_page_id) = 1 THEN MIN(s.landing_page_id::text) END AS "landingPageId",
          CASE WHEN COUNT(DISTINCT s.source_type) = 1 THEN MIN(s.source_type::text) END AS "sourceType"
        FROM scoped_links s GROUP BY s.group_key
      ), visits AS (… unchanged …), page_visits AS (… unchanged …), expenses AS (… unchanged …), coverage AS (… unchanged …),
      commerce_events AS (
        SELECT s.group_key,
          COUNT(*) FILTER (WHERE e.event_name = 'ADD_TO_CART') AS "addToCarts",
          COUNT(*) FILTER (WHERE e.event_name = 'BEGIN_CHECKOUT') AS "checkouts"
        FROM analytics_events e JOIN scoped_links s ON s.id = e.campaign_link_id
        WHERE e.event_name IN ('ADD_TO_CART','BEGIN_CHECKOUT')
          AND e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
        GROUP BY s.group_key
      ), order_facts AS (${marketingOrderFactsSql(orderWhere)}), registered_orders AS (… unchanged …), other_orders AS (… unchanged …)
      SELECT 'REGISTERED' AS kind, g.id, g.label, g."ownerUserId", g."ownerName", g.aid,
        g."productId", g."productName", g."productCode", g."landingPageId", g."sourceType",
        COALESCE(v.count, 0) AS visits, ${query.groupBy === 'PAGE' ? Prisma.sql`pv.count` : Prisma.sql`NULL::bigint`} AS "pageTotalVisits",
        COALESCE(o."submittedOrders", 0) AS "submittedOrders", COALESCE(o."validOrders", 0) AS "validOrders",
        COALESCE(o."confirmedOrders", 0) AS "confirmedOrders", COALESCE(o."signedOrders", 0) AS "signedOrders",
        COALESCE(o."validOrderValuePhp", 0) AS "validOrderValuePhp", COALESCE(o."signedGrossPhp", 0) AS "signedGrossPhp",
        COALESCE(ce."addToCarts", 0) AS "addToCarts", COALESCE(ce."checkouts", 0) AS "checkouts",
        COALESCE(e.usd, 0) AS "spendUsd", COALESCE(e.php, 0) AS "spendPhp",
        COALESCE(c.expected, 0) AS "expectedCostDays", COALESCE(e.recorded, 0) AS "recordedCostDays",
        COALESCE(o."duplicateOrders", 0) AS "duplicateOrders", COALESCE(o."riskOrders", 0) AS "riskOrders",
        COALESCE(o."afterSalesOrders", 0) AS "afterSalesOrders", COALESCE(o."refundStatusOrders", 0) AS "refundStatusOrders"
      FROM groups g
      LEFT JOIN visits v ON v.group_key = g.id LEFT JOIN page_visits pv ON pv.id = g.id
      LEFT JOIN expenses e ON e.group_key = g.id LEFT JOIN coverage c ON c.group_key = g.id
      LEFT JOIN registered_orders o ON o.group_key = g.id LEFT JOIN commerce_events ce ON ce.group_key = g.id
      UNION ALL
      SELECT o.kind, o.kind, o.kind, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::bigint,
        o."submittedOrders", o."validOrders", o."confirmedOrders", o."signedOrders", o."validOrderValuePhp", o."signedGrossPhp",
        0::bigint, 0::bigint,
        0::numeric, 0::numeric, 0::bigint, 0::bigint,
        o."duplicateOrders", o."riskOrders", o."afterSalesOrders", o."refundStatusOrders"
      FROM other_orders o
      ORDER BY kind, label, id
    `);
    const registered = rows.filter(row => row.kind === 'REGISTERED');
    const thumbnails = await this.productThumbnails(registered.map(row => row.productId));
    const otherSources = rows.filter(row => row.kind !== 'REGISTERED').map(row => serializeMarketingReportRow(row));
    if (query.mode === 'TREE') return this.treeResponse(query, registered, thumbnails, otherSources); // Task 7; until then, guard: throw is wrong — implement Task 6 without it (see below).
    const serialized = registered.map(row => serializeMarketingReportRow(row, thumbnails.get(row.productId ?? '') ?? null));
    const sorted = sortMarketingReportRows(serialized, query.sortBy, query.sortDirection);
    return {
      from: query.from, to: query.to, groupBy: query.groupBy, mode: 'FLAT',
      sortBy: query.sortBy, sortDirection: query.sortDirection, asOf: new Date().toISOString(),
      page: query.page, pageSize: query.pageSize, total: sorted.length,
      rows: sorted.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), otherSources,
    };

  private async productThumbnails(productIds: Array<string | null>): Promise<Map<string, string | null>> {
    const unique = [...new Set(productIds.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const products = await this.prisma.product.findMany({
      where: { id: { in: unique } },
      select: { id: true, images: { where: { type: 'IMAGE', variantId: null, optionValueId: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { url: true } } },
    });
    return new Map(products.map(product => [product.id, product.images[0]?.url ?? null]));
  }
```
**Task-6 note:** when `mode === 'TREE'` arrives before Task 7, `mode: query.mode` is returned and the same FLAT body is used (tree view simply shows flat rows until Task 7 wires the real response). Implement Task 6 WITHOUT the `if (query.mode === 'TREE')` line; Task 7 inserts it.

The `orderWhere` block (built above `rows`) is unchanged from the current file — keep it verbatim.

- [ ] **Step 4: Run to verify pass** — both spec files; also `pnpm vitest run src/modules/marketing` for collateral damage.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/marketing/marketing-report-metrics.ts backend/src/modules/marketing/marketing-report-metrics.spec.ts backend/src/modules/marketing/marketing-report.service.ts backend/src/modules/marketing/marketing-report.service.spec.ts
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(marketing): funnel metrics, thumbnails and server-side sorting in the report"
```

---

### Task 7: TREE mode — product → source → link aggregation

**Files:**
- Create: `backend/src/modules/marketing/marketing-report-tree.ts`, `backend/src/modules/marketing/marketing-report-tree.spec.ts`
- Modify: `backend/src/modules/marketing/marketing-report.service.ts`, `backend/src/modules/marketing/marketing-report.service.spec.ts`

**Interfaces:**
- Consumes: `MarketingReportRawRow` (with `sourceType`, `addToCarts`, `checkouts`), `serializeMarketingReportRow`, `compareMarketingReportRows`/`sortMarketingReportRows`/`MarketingReportSort` (Task 4), `MarketingReportSerializedRow`.
- Produces:
  - `type MarketingReportVisitRow = { product: string; source: string | null; visits: bigint }`.
  - `buildMarketingReportTree(rows: MarketingReportRawRow[], visits: MarketingReportVisitRow[], thumbnails: Map<string, string | null>, sortBy: MarketingReportSort, sortDirection: MarketingReportSortDirection): MarketingReportTreeProduct[]`.
  - `interface MarketingReportTreeProduct { product: { id: string; name: string; productCode: string | null; thumbnailUrl: string | null }; totals: MarketingReportSerializedRow; sources: MarketingReportTreeSource[] }`, `interface MarketingReportTreeSource { sourceType: string; totals: MarketingReportSerializedRow; links: MarketingReportSerializedRow[] }`.
  - Service: when `query.mode === 'TREE'`, response = `{ from, to, groupBy, mode: 'TREE', sortBy, sortDirection, asOf, linkCount, tree, otherSources }` and runs the grouped-visits query.

- [ ] **Step 1: Failing tree unit tests** (`marketing-report-tree.spec.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { buildMarketingReportTree, type MarketingReportVisitRow } from './marketing-report-tree.js';
import type { MarketingReportRawRow } from './marketing-report-metrics.js';

const P1 = '11111111-1111-4111-a111-111111111111';
const P2 = '22222222-2222-4222-a222-222222222222';
const link = (overrides: Partial<MarketingReportRawRow> & { id: string; sourceType: string; productId: string }): MarketingReportRawRow => ({
  kind: 'REGISTERED', label: overrides.id, ownerUserId: null, ownerName: null, aid: null,
  productName: overrides.productId === P1 ? 'Chair' : 'Table', productCode: 'LUW-1', landingPageId: null,
  visits: 2n, pageTotalVisits: null, addToCarts: 1n, checkouts: 0n,
  submittedOrders: 1n, validOrders: 1n, confirmedOrders: 0n, signedOrders: 0n,
  duplicateOrders: 0n, riskOrders: 0n, afterSalesOrders: 0n, refundStatusOrders: 0n,
  validOrderValuePhp: new Prisma.Decimal('1000'), signedGrossPhp: new Prisma.Decimal('0'),
  spendUsd: new Prisma.Decimal('10'), spendPhp: new Prisma.Decimal('570'),
  expectedCostDays: 1n, recordedCostDays: 1n,
  ...overrides,
});
const visits = (rows: MarketingReportVisitRow[]) => rows;

const thumbnails = new Map<string, string | null>([[P1, '/uploads/chair.jpg']]);

describe('marketing report tree', () => {
  const rows = [
    link({ id: 'l-meta', productId: P1, sourceType: 'META_AD', visits: 3n, addToCarts: 2n, validOrders: 2n, signedOrders: 1n, signedGrossPhp: new Prisma.Decimal('500'), expectedCostDays: 2n, recordedCostDays: 1n }),
    link({ id: 'l-post', productId: P1, sourceType: 'FB_POST', visits: 4n, addToCarts: 1n, validOrders: 1n, spendUsd: new Prisma.Decimal('5'), spendPhp: new Prisma.Decimal('285') }),
    link({ id: 'l-table', productId: P2, sourceType: 'META_AD', visits: 1n, addToCarts: 0n, validOrders: 0n, productName: 'Table', validOrderValuePhp: new Prisma.Decimal('0'), spendUsd: new Prisma.Decimal('0'), spendPhp: new Prisma.Decimal('0') }),
  ];
  const visitRows: MarketingReportVisitRow[] = [
    { product: P1, source: null, visits: 6n },   // 7 summed link-visits dedupe to 6
    { product: P1, source: 'META_AD', visits: 3n },
    { product: P1, source: 'FB_POST', visits: 4n },
    { product: P2, source: null, visits: 1n },
  ];

  it('sums orders, money, spend and funnel events but dedupes visits', () => {
    const tree = buildMarketingReportTree(rows, visitRows, thumbnails, 'NAME', 'ASC');
    expect(tree).toHaveLength(2);
    expect(tree[0].product).toEqual({ id: P1, name: 'Chair', productCode: 'LUW-1', thumbnailUrl: '/uploads/chair.jpg' });
    expect(tree[0].totals).toMatchObject({ visits: 6, submittedOrders: 3, validOrders: 3, signedOrders: 1, addToCarts: 3, checkouts: 0, spendUsd: '15.00', expectedCostDays: 3, recordedCostDays: 2, costCoverageComplete: false });
    expect(tree[0].totals.signedGrossPhp).toBe('500.00');
    // conversion uses the deduped visit count, not summed link visits (7)
    expect(tree[0].totals.conversionRate).toBe((new Prisma.Decimal(3).div(6)).toFixed(4));
  });

  it('keeps source-level totals with their own deduped visits', () => {
    const tree = buildMarketingReportTree(rows, visitRows, thumbnails, 'NAME', 'ASC');
    const chair = tree[0].sources;
    expect(chair.map(s => s.sourceType)).toEqual(['FB_POST', 'META_AD']); // alphabetical under NAME
    const meta = chair.find(s => s.sourceType === 'META_AD')!;
    expect(meta.totals).toMatchObject({ visits: 3, validOrders: 2, spendUsd: '10.00', expectedCostDays: 2, recordedCostDays: 1 });
    expect(meta.links.map(l => l.id)).toEqual(['l-meta']);
  });

  it('sorts links inside each source by the requested metric', () => {
    const links = [
      link({ id: 'm1', productId: P1, sourceType: 'META_AD', validOrders: 1n }),
      link({ id: 'm2', productId: P1, sourceType: 'META_AD', validOrders: 5n }),
    ];
    // both links share visitRows via the shared set; build small visits so groups stay consistent
    const shared = [
      { product: P1, source: null, visits: 9n },
      { product: P1, source: 'META_AD', visits: 9n },
      { product: P2, source: null, visits: 1n },
    ];
    const tree = buildMarketingReportTree([...links, rows[2]], shared, thumbnails, 'VALID', 'DESC');
    const meta = tree[0].sources.find(s => s.sourceType === 'META_AD')!;
    expect(meta.links.map(l => l.id)).toEqual(['m2', 'm1']);
  });

  it('treats unknown source types as OTHER without throwing', () => {
    const odd = [link({ id: 'l-x', productId: P2, sourceType: 'OTHER', productName: 'Table' })];
    const tree = buildMarketingReportTree(odd, [{ product: P2, source: null, visits: 1n }, { product: P2, source: 'OTHER', visits: 1n }], new Map(), 'NAME', 'ASC');
    expect(tree[0].sources[0].sourceType).toBe('OTHER');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/marketing/marketing-report-tree.spec.ts
```

- [ ] **Step 3: Implement `marketing-report-tree.ts`**

```ts
import { Prisma } from '../../generated/prisma/client.js';
import { serializeMarketingReportRow, type MarketingReportRawRow, type MarketingReportSerializedRow } from './marketing-report-metrics.js';
import { compareMarketingReportRows, sortMarketingReportRows, type MarketingReportSort, type MarketingReportSortDirection } from './marketing-report-sort.js';

export type MarketingReportVisitRow = { product: string; source: string | null; visits: bigint };

export interface MarketingReportTreeSource {
  sourceType: string;
  totals: MarketingReportSerializedRow;
  links: MarketingReportSerializedRow[];
}
export interface MarketingReportTreeProduct {
  product: { id: string; name: string; productCode: string | null; thumbnailUrl: string | null };
  totals: MarketingReportSerializedRow;
  sources: MarketingReportTreeSource[];
}

/** Ordered ← additive: orders/money/spend/funnel counts/coverage days sum per link row. */
interface Totals {
  submittedOrders: bigint; validOrders: bigint; confirmedOrders: bigint; signedOrders: bigint;
  duplicateOrders: bigint; riskOrders: bigint; afterSalesOrders: bigint; refundStatusOrders: bigint;
  addToCarts: bigint; checkouts: bigint;
  validOrderValuePhp: Prisma.Decimal; signedGrossPhp: Prisma.Decimal; spendUsd: Prisma.Decimal; spendPhp: Prisma.Decimal;
  expectedCostDays: bigint; recordedCostDays: bigint;
}
const zero = (): Totals => ({
  submittedOrders: 0n, validOrders: 0n, confirmedOrders: 0n, signedOrders: 0n,
  duplicateOrders: 0n, riskOrders: 0n, afterSalesOrders: 0n, refundStatusOrders: 0n,
  addToCarts: 0n, checkouts: 0n,
  validOrderValuePhp: new Prisma.Decimal(0), signedGrossPhp: new Prisma.Decimal(0),
  spendUsd: new Prisma.Decimal(0), spendPhp: new Prisma.Decimal(0),
  expectedCostDays: 0n, recordedCostDays: 0n,
});
function add(target: Totals, row: MarketingReportRawRow): void {
  for (const key of ['submittedOrders', 'validOrders', 'confirmedOrders', 'signedOrders', 'duplicateOrders', 'riskOrders', 'afterSalesOrders', 'refundStatusOrders', 'addToCarts', 'checkouts', 'expectedCostDays', 'recordedCostDays'] as const) target[key] += row[key];
  target.validOrderValuePhp = target.validOrderValuePhp.plus(row.validOrderValuePhp);
  target.signedGrossPhp = target.signedGrossPhp.plus(row.signedGrossPhp);
  target.spendUsd = target.spendUsd.plus(row.spendUsd);
  target.spendPhp = target.spendPhp.plus(row.spendPhp);
}
function toRaw(totals: Totals, identity: { id: string; label: string; productId: string; productName: string; productCode: string | null; sourceType: string | null }, visits: bigint): MarketingReportRawRow {
  return {
    kind: 'REGISTERED', ownerUserId: null, ownerName: null, aid: null, landingPageId: null,
    pageTotalVisits: null, visits, ...identity, ...totals,
    duplicateOrders: totals.duplicateOrders, // explicit for readability; spread already carries it
  };
}

/**
 * Product → source-type → link tree. Everything sums up from link rows except
 * visits: one tab can register under two links of the same product on the same
 * day, so visit totals come from the deduped GROUPING SETS query instead.
 */
export function buildMarketingReportTree(rows: MarketingReportRawRow[], visits: MarketingReportVisitRow[], thumbnails: Map<string, string | null>, sortBy: MarketingReportSort, sortDirection: MarketingReportSortDirection): MarketingReportTreeProduct[] {
  const productVisits = new Map<string, bigint>();
  const sourceVisits = new Map<string, bigint>();
  for (const visit of visits) {
    if (visit.source === null) productVisits.set(visit.product, visit.visits);
    else sourceVisits.set(`${visit.product}:${visit.source}`, visit.visits);
  }
  interface SourceNode { sourceType: string; totals: Totals; links: MarketingReportRawRow[] }
  interface ProductNode { id: string; name: string; code: string | null; totals: Totals; sources: Map<string, SourceNode> }
  const products = new Map<string, ProductNode>();
  for (const row of rows) {
    const productId = row.productId ?? '';
    const node = products.get(productId) ?? { id: productId, name: row.productName ?? productId, code: row.productCode, totals: zero(), sources: new Map<string, SourceNode>() };
    add(node.totals, row);
    const sourceType = row.sourceType ?? 'OTHER';
    const source = node.sources.get(sourceType) ?? { sourceType, totals: zero(), links: [] };
    add(source.totals, row);
    source.links.push(row);
    node.sources.set(sourceType, source);
    products.set(productId, node);
  }
  return [...products.values()]
    .map((node): MarketingReportTreeProduct => {
      const thumbnail = thumbnails.get(node.id) ?? null;
      const sources = [...node.sources.values()].map(source => {
        const sourceRaw = toRaw(source.totals, { id: `${node.id}:${source.sourceType}`, label: source.sourceType, productId: node.id, productName: node.name, productCode: node.code, sourceType: source.sourceType }, sourceVisits.get(`${node.id}:${source.sourceType}`) ?? 0n);
        const totals = serializeMarketingReportRow(sourceRaw, thumbnail);
        return { sourceType: source.sourceType, totals, links: sortMarketingReportRows(source.links.map(link => serializeMarketingReportRow(link, thumbnail)), sortBy, sortDirection) };
      });
      sources.sort((a, b) => compareMarketingReportRows(a.totals, b.totals, sortBy, sortDirection) || a.sourceType.localeCompare(b.sourceType));
      const productRaw = toRaw(node.totals, { id: node.id, label: node.name, productId: node.id, productName: node.name, productCode: node.code, sourceType: null }, productVisits.get(node.id) ?? 0n);
      return { product: { id: node.id, name: node.name, productCode: node.code, thumbnailUrl: thumbnail }, totals: serializeMarketingReportRow(productRaw, thumbnail), sources };
    })
    .sort((a, b) => compareMarketingReportRows(a.totals, b.totals, sortBy, sortDirection) || a.product.name.localeCompare(b.product.name, 'zh'));
}
```
*(The `duplicateOrders` line in `toRaw` is redundant with the spread — remove it; the spread already carries every Totals key. Keep the file lean.)*

- [ ] **Step 4: Run tree unit tests**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/marketing/marketing-report-tree.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Service integration (failing test first)**

Add to `marketing-report.service.spec.ts`:

```ts
it('returns a tree response and dedupes product visits with GROUPING SETS', async () => {
  const linkRow = { ...raw, id: LINK, productId: P1, productName: 'Chair', sourceType: 'META_AD' };
  const postRow = { ...raw, id: 'link-post', label: 'Post', productId: P1, productName: 'Chair', sourceType: 'FB_POST', validOrders: 1n, visits: 4n };
  const { service, prisma } = setup([linkRow, postRow]);
  (prisma.$queryRaw as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce([linkRow, postRow])          // main aggregate query
    .mockResolvedValueOnce([{ product: P1, source: null, visits: 6n }, { product: P1, source: 'META_AD', visits: 2n }, { product: P1, source: 'FB_POST', visits: 4n }]);
  (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: P1, images: [{ url: '/up.jpg' }] }]);
  const result = await service.report({ ...query, mode: 'TREE' }, account);
  expect(result.mode).toBe('TREE');
  expect(result.linkCount).toBe(2);
  expect(result.tree).toHaveLength(1);
  expect(result.tree[0].totals).toMatchObject({ visits: 6, validOrders: raw.validOrders + 1 });
  expect(result.tree[0].sources.map(s => s.sourceType)).toEqual(['FB_POST', 'META_AD']);
  expect(result.otherSources).toEqual([]);
});
```
with `const P1 = '11111111-1111-4111-a111-111111111111';` added near `OWNER`/`LINK` (make sure it differs from the `OWNER` constant).
Also extend the raw fixture with `sourceType: 'META_AD', addToCarts: 3n, checkouts: 1n`.

Then implement in the service: above the flat return, replace Task 6's plain flow:

```ts
    const serialized = registered.map(row => serializeMarketingReportRow(row, thumbnails.get(row.productId ?? '') ?? null));
    if (query.mode === 'TREE') {
      const visitRows = await this.prisma.$queryRaw<MarketingReportVisitRow[]>(Prisma.sql`
        WITH scoped_links AS (
          SELECT l.id, l.product_id, l.source_type FROM campaign_links l WHERE ${filters}
        )
        SELECT l.product_id::text AS product, l.source_type::text AS source,
          COUNT(DISTINCT (v.visit_key, v.visit_day)) AS visits
        FROM campaign_link_visits v JOIN scoped_links l ON l.id = v.link_id
        WHERE v.visit_day BETWEEN ${query.from}::date AND ${query.to}::date
        GROUP BY GROUPING SETS ((l.product_id, l.source_type), (l.product_id))
      `);
      return {
        from: query.from, to: query.to, groupBy: query.groupBy, mode: 'TREE',
        sortBy: query.sortBy, sortDirection: query.sortDirection, asOf: new Date().toISOString(),
        linkCount: registered.length,
        tree: buildMarketingReportTree(registered, visitRows, thumbnails, query.sortBy, query.sortDirection),
        otherSources,
      };
    }
    const sorted = sortMarketingReportRows(serialized, query.sortBy, query.sortDirection);
    // … flat return continues, identical to Task 6 …
```
Imports: `buildMarketingReportTree, type MarketingReportVisitRow` from `./marketing-report-tree.js`.

- [ ] **Step 6: Run to verify pass**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/marketing
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/marketing/marketing-report-tree.ts backend/src/modules/marketing/marketing-report-tree.spec.ts backend/src/modules/marketing/marketing-report.service.ts backend/src/modules/marketing/marketing-report.service.spec.ts
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(marketing): product-to-source-to-link tree aggregation for reports"
```

---

### Task 8: Campaign link rows carry the product thumbnail

**Files:**
- Modify: `backend/src/modules/marketing/campaign-links.service.ts`
- Test: `backend/src/modules/marketing/campaign-links.service.spec.ts`

**Interfaces:**
- Produces: `CampaignLinkRow.productThumbnailUrl: string | null` (first product image; null without image). Used by Task 11's UI.

- [ ] **Step 1: Failing test** — in `campaign-links.service.spec.ts`, update the fixture `product` to include `images: [{ url: '/uploads/chair.jpg' }]` and add:

```ts
it('returns product thumbnails with each link', async () => {
  const { service } = setup();
  const link = await service.createLink({ ...base }, owner);
  expect(link.productThumbnailUrl).toBe('/uploads/chair.jpg');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run src/modules/marketing/campaign-links.service.spec.ts
```

- [ ] **Step 3: Implement** — in `campaign-links.service.ts`:

```ts
const details = {
  product: {
    select: {
      name: true, productCode: true, slug: true, status: true,
      images: {
        where: { type: 'IMAGE' as const, variantId: null, optionValueId: null },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { url: true },
      },
    },
  },
  // landingPage / owner unchanged
} satisfies Prisma.CampaignLinkInclude;
```
In `serialize`, after the existing line:

```ts
productThumbnailUrl: product.images[0]?.url ?? null,
```

- [ ] **Step 4: Run to verify pass** — same command.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/marketing/campaign-links.service.ts backend/src/modules/marketing/campaign-links.service.spec.ts
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(marketing): product thumbnail on campaign link rows"
```

---

### Task 9: Frontend API types and i18n keys

**Files:**
- Modify: `frontend/src/lib/marketing-api.ts`, `frontend/src/i18n/en.ts`, `frontend/src/i18n/zh.ts`

**Interfaces:**
- Produces (consumed by Tasks 10–12):
  - `MarketingReportRow` gains `sourceType: string | null; addToCarts: number; checkouts: number; productThumbnailUrl: string | null; productCode: string | null` (productCode already exists) — the first four are new.
  - `MarketingReportQuery` gains `mode?: "FLAT" | "TREE"; sortBy?: string; sortDirection?: "ASC" | "DESC"`.
  - `MarketingReport` gains `mode: "FLAT" | "TREE"; sortBy: string; sortDirection: "ASC" | "DESC"; tree?: MarketingReportTreeProduct[]; linkCount?: number`.
  - `export interface MarketingReportTreeProduct { product: { id: string; name: string; productCode: string | null; thumbnailUrl: string | null }; totals: MarketingReportRow; sources: Array<{ sourceType: string; totals: MarketingReportRow; links: MarketingReportRow[] }>; }`
  - `CampaignLinkRow` gains `productThumbnailUrl: string | null`.

- [ ] **Step 1: Types** — apply the interface changes above; `marketingApi.report` passes the query through `queryString` unchanged, so no call-site change is needed.

- [ ] **Step 2: i18n keys** — insert next to the existing `marketing_report_*` block in **both** `en.ts` and `zh.ts` (zh keeps `satisfies typeof en` green):

```ts
// en.ts
  marketing_report_add_to_cart: "Add to cart",
  marketing_report_checkout: "Checkout started",
  marketing_report_view: "View",
  marketing_report_view_flat: "Flat list",
  marketing_report_view_tree: "Group by product",
  marketing_report_filter_product: "Product",
  marketing_report_all_products: "All products",
  marketing_report_funnel_hint: "Add to cart / checkout started are event counts, accumulated since this feature shipped",
  marketing_report_sort_hint: "Click a column header to sort",
  marketing_report_tree_total: "{count} links in total",
  marketing_report_tree_too_many: "More than 500 links are listed — narrow by product or optimizer",
  marketing_report_thumbnail_missing: "No product image",
  marketing_link_filter_owner: "Optimizer",
// zh.ts
  marketing_report_add_to_cart: "加购",
  marketing_report_checkout: "发起购物",
  marketing_report_view: "视图",
  marketing_report_view_flat: "平铺",
  marketing_report_view_tree: "按商品分组",
  marketing_report_filter_product: "商品",
  marketing_report_all_products: "全部商品",
  marketing_report_funnel_hint: "加购 / 发起购物为事件次数，自功能上线起累计",
  marketing_report_sort_hint: "点击表头排序",
  marketing_report_tree_total: "共 {count} 条链接",
  marketing_report_tree_too_many: "链接超过 500 条，请先按商品或投放师筛选",
  marketing_report_thumbnail_missing: "商品暂无图片",
  marketing_link_filter_owner: "投放师",
```

- [ ] **Step 3: Verify compile**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/components/admin/marketing/ReportTable.spec.tsx src/components/admin/marketing/CampaignLinksList.spec.tsx && pnpm exec tsc --noEmit
```
Expected: existing fixtures now intentionally fail typecheck until Tasks 10–12 update them; **to keep Task 9 green**, also add the four new fields to the `ReportTable.spec.tsx` fixture row (`sourceType: 'META_AD', addToCarts: 0, checkouts: 0, productThumbnailUrl: null, mode-chain: result gains mode:'FLAT', sortBy:'NAME', sortDirection:'ASC'`) and to `CampaignLinksList.spec.tsx`'s `row` (`productThumbnailUrl: null`). Keep other spec edits for their own tasks.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/marketing-api.ts frontend/src/i18n/en.ts frontend/src/i18n/zh.ts frontend/src/components/admin/marketing/ReportTable.spec.tsx frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(marketing): report tree types and workbench copy"
```

---

### Task 10: Shared report columns and metric cells

**Files:**
- Create: `frontend/src/components/admin/marketing/ReportColumns.tsx`
- Create: `frontend/src/components/admin/marketing/ReportColumns.spec.tsx`

**Interfaces:**
- Consumes: `MarketingReportRow` (Task 9), `useAdminI18n`.
- Produces:
  - `export interface ReportColumn { key: Parameters<AdminI18n['t']>[0]; sortBy?: string; numeric?: boolean }`
  - `export const reportColumns: ReportColumn[]` (the ORDER from the spec §5.1, with `marketing_report_coverage` last).
  - `export function ReportMetricCells({ row }: { row: MarketingReportRow })` — renders every `<td>` after the first column, in column order.
  - `export function ProductThumb({ url, label }: { url: string | null; label: string })` — the 40×40 image or placeholder.

- [ ] **Step 1: Failing test** (`ReportColumns.spec.tsx`)

```tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reportColumns, ReportMetricCells, ProductThumb } from "@/components/admin/marketing/ReportColumns";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import type { MarketingReportRow } from "@/lib/marketing-api";

const row = { kind: "REGISTERED", id: "l1", label: "Ad A", ownerUserId: null, ownerName: null, aid: null, productId: "p1", productName: "Chair", productCode: "C1", landingPageId: null, sourceType: "META_AD", visits: 2, pageTotalVisits: null, addToCarts: 3, checkouts: 1, submittedOrders: 3, validOrders: 2, confirmedOrders: 1, signedOrders: 1, validOrderValuePhp: "12000.00", signedGrossPhp: "10000.00", spendUsd: "50.00", spendPhp: "2865.00", orderCpaUsd: "25.00", signedCpaUsd: "50.00", orderRoas: "4.19", signedRoas: "3.49", conversionRate: "1.0000", expectedCostDays: 3, recordedCostDays: 3, costCoverageComplete: true, duplicateOrders: 0, riskOrders: 0, afterSalesOrders: 0, refundStatusOrders: 0, periodBasis: "TOUCH", productThumbnailUrl: null } as MarketingReportRow;

const cell = (name: string) => screen.getByRole("cell", { name });

describe("shared report column model", () => {
  it("orders columns exactly per spec §5.1 and sorts only numeric+identity columns", () => {
    expect(reportColumns.map(c => c.key)).toEqual([
      "marketing_internal_name", "marketing_report_visits", "marketing_report_add_to_cart", "marketing_report_checkout",
      "marketing_report_submitted", "marketing_report_valid", "marketing_report_confirmed", "marketing_report_signed",
      "marketing_report_valid_value", "marketing_report_signed_gross", "marketing_cost_usd", "marketing_cost_php",
      "marketing_report_order_cpa", "marketing_report_signed_cpa", "marketing_report_order_roas", "marketing_report_signed_roas",
      "marketing_report_conversion", "marketing_report_coverage",
    ]);
    expect(reportColumns.find(c => c.key === "marketing_report_add_to_cart")?.sortBy).toBe("ADD_TO_CARTS");
    expect(reportColumns.find(c => c.key === "marketing_internal_name")?.sortBy).toBeUndefined();
  });

  it("renders the new funnel columns between visits and submitted orders", () => {
    render(<table><tbody><tr><ReportMetricCells row={row} /></tr></tbody></table>, { wrapper: AdminI18nProvider });
    expect(cell("3")).toBeInTheDocument();      // addToCarts
    expect(cell("1")).toBeInTheDocument();      // checkouts
    expect(cell("PHP 12000.00")).toBeInTheDocument();
    expect(cell("完整（3 / 3 日）")).toBeInTheDocument();
  });

  it("renders dashes for missing ratios", () => {
    render(<table><tbody><tr><ReportMetricCells row={{ ...row, orderCpaUsd: null, orderRoas: null }} /></tr></tbody></table>, { wrapper: AdminI18nProvider });
    expect(screen.getAllByRole("cell", { name: "—" }).length).toBeGreaterThanOrEqual(2);
  });

  it("renders a 40x40 thumb or a labelled placeholder", () => {
    render(<><ProductThumb url="/a.jpg" label="Chair" /><ProductThumb url={null} label="Chair" /></>);
    expect(screen.getByRole("img", { name: "Chair" })).toHaveAttribute("src", "/a.jpg");
    expect(screen.getByRole("img", { name: "商品暂无图片" })).toBeInTheDocument();
  });
});
```
(Assertion strings use the zh dictionary default; adjust to the exact zh strings above if the provider language differs.)

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/components/admin/marketing/ReportColumns.spec.tsx
```

- [ ] **Step 3: Implement `ReportColumns.tsx`**

```tsx
"use client";
import type { ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { MarketingReportRow } from "@/lib/marketing-api";

export interface ReportColumn {
  key: Parameters<ReturnType<typeof useAdminI18n>["t"]>[0];
  sortBy?: string;
  numeric?: boolean;
}

export const reportColumns: ReportColumn[] = [
  { key: "marketing_internal_name" },
  { key: "marketing_report_visits", sortBy: "VISITS", numeric: true },
  { key: "marketing_report_add_to_cart", sortBy: "ADD_TO_CARTS", numeric: true },
  { key: "marketing_report_checkout", sortBy: "CHECKOUTS", numeric: true },
  { key: "marketing_report_submitted", sortBy: "SUBMITTED", numeric: true },
  { key: "marketing_report_valid", sortBy: "VALID", numeric: true },
  { key: "marketing_report_confirmed", sortBy: "CONFIRMED", numeric: true },
  { key: "marketing_report_signed", sortBy: "SIGNED", numeric: true },
  { key: "marketing_report_valid_value", sortBy: "VALID_VALUE", numeric: true },
  { key: "marketing_report_signed_gross", sortBy: "SIGNED_GROSS", numeric: true },
  { key: "marketing_cost_usd", sortBy: "SPEND_USD", numeric: true },
  { key: "marketing_cost_php", sortBy: "SPEND_PHP", numeric: true },
  { key: "marketing_report_order_cpa", sortBy: "ORDER_CPA", numeric: true },
  { key: "marketing_report_signed_cpa", sortBy: "SIGNED_CPA", numeric: true },
  { key: "marketing_report_order_roas", sortBy: "ORDER_ROAS", numeric: true },
  { key: "marketing_report_signed_roas", sortBy: "SIGNED_ROAS", numeric: true },
  { key: "marketing_report_conversion", sortBy: "CONVERSION", numeric: true },
  { key: "marketing_report_coverage" },
];

/** 40×40 product thumbnail; placeholder keeps the row height stable. */
export function ProductThumb({ url, label }: { url: string | null; label: string }) {
  const { t } = useAdminI18n();
  if (url === null) return <span aria-hidden className="mt-0.5 h-10 w-10 shrink-0 rounded bg-slate-100 text-slate-300" role="img" aria-label={t("marketing_report_thumbnail_missing")} />;
  // eslint-disable-next-line @next/next/no-img-element -- admin-only data URL comes from trusted uploads
  return <img src={url} alt={label} className="mt-0.5 h-10 w-10 shrink-0 rounded object-cover" />;
}

export function ReportMetricCells({ row }: { row: MarketingReportRow }): ReactNode {
  return <>
    <td className="px-3 py-3 tabular-nums">{row.visits ?? "—"}</td>
    <td className="px-3 py-3 tabular-nums">{row.addToCarts}</td>
    <td className="px-3 py-3 tabular-nums">{row.checkouts}</td>
    <td className="px-3 py-3 tabular-nums">{row.submittedOrders}</td>
    <td className="px-3 py-3 tabular-nums">{row.validOrders}</td>
    <td className="px-3 py-3 tabular-nums">{row.confirmedOrders}</td>
    <td className="px-3 py-3 tabular-nums">{row.signedOrders}</td>
    <td className="whitespace-nowrap px-3 py-3">PHP {row.validOrderValuePhp}</td>
    <td className="whitespace-nowrap px-3 py-3">PHP {row.signedGrossPhp}</td>
    <td className="whitespace-nowrap px-3 py-3">USD {row.spendUsd}</td>
    <td className="whitespace-nowrap px-3 py-3">PHP {row.spendPhp}</td>
    <td className="whitespace-nowrap px-3 py-3">{row.orderCpaUsd === null ? "—" : `USD ${row.orderCpaUsd}`}</td>
    <td className="whitespace-nowrap px-3 py-3">{row.signedCpaUsd === null ? "—" : `USD ${row.signedCpaUsd}`}</td>
    <td className="px-3 py-3">{row.orderRoas ?? "—"}</td>
    <td className="px-3 py-3">{row.signedRoas ?? "—"}</td>
    <td className="px-3 py-3">{row.conversionRate === null ? "—" : `${(Number(row.conversionRate) * 100).toFixed(2)}%`}</td>
    <td className="min-w-48 px-3 py-3 text-xs"><span className={row.costCoverageComplete ? "text-emerald-700" : "text-amber-800"}>{row.costCoverageComplete ? "完整" : "费用未完整录入"}</span></td>
  </>;
}
```
The coverage text must reuse the i18n call, not literals — replace the last cell's inner text with `{t(...)}` exactly as the current `ReportTable.tsx:71` does, keeping the zh strings above only as test expectations of `t()`'s output (the shared i18n strings `marketing_report_complete` / `marketing_report_incomplete` already exist with those texts). Note the two `<td>`s here come after the caller's identity `<td>` — the caller renders `<td>`-0 itself, then `<ReportMetricCells row={row} />`.

Also: the `kind`/`av` naming — `ProductThumb`'s placeholder is `role="img"` to keep a stable accessible name for tests.

- [ ] **Step 4: Run to verify pass** — same command.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/marketing/ReportColumns.tsx frontend/src/components/admin/marketing/ReportColumns.spec.tsx
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(marketing): shared report columns with funnel cells and thumbnails"
```

---

### Task 11: ReportTable — filters, sorting, new columns, tree mode

**Files:**
- Modify: `frontend/src/components/admin/marketing/ReportTable.tsx`, `frontend/src/components/admin/marketing/ReportTable.spec.tsx`
- Create: `frontend/src/components/admin/marketing/ReportTreeTable.tsx`, `frontend/src/components/admin/marketing/ReportTreeTable.spec.tsx`

**Interfaces:**
- Consumes: `reportColumns`/`ReportMetricCells`/`ProductThumb` (Task 10), TREE types (Task 9), `marketingApi.linkContext()` for the product filter dropdown (active products only — a link to an inactive product is still listed when no filter is set; documented in the spec), `sortMarketingReportRows`-shaped `sortBy` strings passed to the API.
- Produces: `ReportTable` renders TREE when `data.mode === "TREE"`; the tree renderer is `ReportTreeTable({ tree, funnelHint })` with default-expanded product and source levels and per-session collapse state.

- [ ] **Step 1: Failing tests in `ReportTable.spec.tsx`**

Update the `result` fixture to `{ ...result, mode: "FLAT", sortBy: "NAME", sortDirection: "ASC", groupBy: "LINK" }` (keep `rows`). New tests:

```tsx
it("lists product and owner filters and defaults to the tree view", async () => {
  vi.mocked(marketingApi.linkContext).mockResolvedValue({ products: [{ id: "p1", name: "Chair", productCode: "C1", slug: "chair", thumbnailUrl: "/c.jpg", variants: [], landingPages: [] }] });
  auth.admin.permissions = ["MARKETING_VIEW_ALL", "MARKETING_VIEW_OWN"];
  vi.mocked(marketingApi.ownerOptions).mockResolvedValue([{ userId: "u1", aid: "OP-1", displayName: "Optimizer", status: "ACTIVE", userStatus: "ACTIVE" }]);
  vi.mocked(marketingApi.report).mockResolvedValue({ ...result, mode: "FLAT", rows: [] });
  mount();
  expect(await screen.findByLabelText("视图")).toHaveValue("TREE");
  fireEvent.change(screen.getByLabelText("视图"), { target: { value: "FLAT" } });
  await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "FLAT", sortBy: "NAME", sortDirection: "ASC" })));
  fireEvent.change(screen.getByLabelText("商品"), { target: { value: "p1" } });
  fireEvent.click(screen.getByRole("button", { name: "查询核算" }));
  await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ productId: "p1" })));
  fireEvent.change(screen.getByLabelText("投放师"), { target: { value: "u1" } });
  fireEvent.click(screen.getByRole("button", { name: "查询核算" }));
  await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ ownerUserId: "u1" })));
});

it("hides the optimizer filter for view-own accounts even if the API is called directly", async () => {
  mount({ productId: undefined });
  await screen.findByText(/共|links/); // any mode signal; keep loose on purpose
  expect(screen.queryByLabelText("投放师")).not.toBeInTheDocument();
});

it("sorts by a clicked column and toggles direction", async () => {
  mount();
  await screen.findByText("Ad A");
  fireEvent.click(screen.getByRole("button", { name: /有效订单/ }));
  await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: "VALID", sortDirection: "ASC" })));
  fireEvent.click(screen.getByRole("button", { name: /有效订单/ }));
  await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: "VALID", sortDirection: "DESC" })));
});

it("switches to the tree response and shows the funnel hint", async () => {
  vi.mocked(marketingApi.report).mockResolvedValue({
    ...result, mode: "TREE", linkCount: 1,
    tree: [{ product: { id: "p1", name: "Chair", productCode: "C1", thumbnailUrl: "/c.jpg" }, totals: row, sources: [{ sourceType: "META_AD", totals: row, links: [row] }] }],
  });
  mount();
  await screen.findByText("Chair");
  expect(screen.getByText("Meta 广告")).toBeInTheDocument();
  expect(screen.getByText("共 1 条链接")).toBeInTheDocument();
  expect(screen.getByText(/加购 \/ 发起购物为事件次数/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Chair" })).toHaveAttribute("src", "/c.jpg");
});

it("shows thumbnails in the flat table and warns over the 500-link tree cap", async () => {
  vi.mocked(marketingApi.report).mockResolvedValue({ ...result, mode: "TREE", linkCount: 600, tree: [] });
  mount();
  await screen.findByText(/链接超过 500 条/);
  vi.mocked(marketingApi.report).mockResolvedValue(result); // flat fixture
  fireEvent.change(screen.getByLabelText("视图"), { target: { value: "FLAT" } });
  await screen.findByText("Ad A");
  expect(screen.getByRole("img", { name: "Chair" })).toBeInTheDocument();
});
```
Adjust exact accessible names to the renderers you write (labels use `aria-label` so `getByLabelText` matches both selects).

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/components/admin/marketing/ReportTable.spec.tsx
```

- [ ] **Step 3: Implement `ReportTable.tsx`** (full replacement; imports `reportColumns`, `ReportMetricCells`, `ProductThumb`)

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { marketingApi, type MarketingReport, type MarketingReportSort, type MarketingReportTreeProduct } from "@/lib/marketing-api";
import { ReportColumns } from "./report-columns";
import { ReportTreeTable } from "./ReportTreeTable";

const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm";
const buttonClass = "rounded-lg border border-admin-border px-3 py-2 text-xs disabled:opacity-40";
const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });

type SortDirection = "ASC" | "DESC";

function ProductFilter({ options, value, onChange }: { options: { id: string; name: string; productCode: string | null }[]; value: string; onChange: (value: string) => void }) { /* thin <select> wrapper, aria-label 商品 */ }

export function ReportTable({ productId, landingPageId, linkId }: { productId?: string; landingPageId?: string; linkId?: string }) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const [inputs, setInputs] = useState(() => ({ from: dateFormat.format(new Date(Date.now() - 6 * 864e5)), to: dateFormat.format(new Date()), groupBy: "LINK" as MarketingReport["groupBy"], ownerUserId: "" }));
  const [filters, setFilters] = useState(inputs);
  const [productFilter, setProductFilter] = useState(productId ?? "");
  const [mode, setMode] = useState<"TREE" | "FLAT">("TREE");
  const [sortBy, setSortBy] = useState<MarketingReportSort>("NAME");
  const [sortDirection, setSortDirection] = useState<SortDirection>("ASC");
  const [products, setProducts] = useState<{ id: string; name: string; productCode: string | null }[]>([]);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const scopeKey = JSON.stringify([admin?.id, admin?.permissions, productId, landingPageId, linkId]);
  const queryKey = JSON.stringify([scopeKey, filters, productFilter, mode, sortBy, sortDirection, page, revision]);
  const [loaded, setLoaded] = useState<{ key: string; data: MarketingReport } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [owners, setOwners] = useState<{ key: string; items: Awaited<ReturnType<typeof marketingApi.ownerOptions>>; error?: string } | null>(null);
  const all = Boolean(admin?.permissions.includes("MARKETING_VIEW_ALL"));

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    marketingApi.report({ from: filters.from, to: filters.to, groupBy: filters.groupBy, ownerUserId: all ? filters.ownerUserId || undefined : undefined, productId: productFilter || undefined, landingPageId, linkIds: linkId ? [linkId] : undefined, page: mode === "TREE" ? 1 : page, pageSize: 20, mode, sortBy, sortDirection })
      .then(data => { if (alive) { setLoaded({ key: queryKey, data }); setError(null); } })
      .catch((reason: unknown) => { if (alive) setError({ key: queryKey, message: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, queryKey, filters, productFilter, mode, sortBy, sortDirection, all, landingPageId, linkId, page, revision]);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    marketingApi.linkContext().then(context => { if (alive) setProducts(context.products.map(({ id, name, productCode }) => ({ id, name, productCode }))); }).catch(() => { /* the dropdown is optional, the table is not */ });
    return () => { alive = false; };
  }, [admin]);

  useEffect(() => {
    if (!admin || !all) return;
    let alive = true;
    marketingApi.ownerOptions().then(items => { if (alive) setOwners({ key: scopeKey, items }); }).catch((reason: unknown) => { if (alive) setOwners({ key: scopeKey, items: [], error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { alive = false; };
  }, [admin, all, scopeKey]);

  const data = loaded?.key === queryKey ? loaded.data : null;
  const loadError = error?.key === queryKey ? error.message : null;
  const ownerData = owners?.key === scopeKey ? owners : null;

  function toggleSort(column: string | undefined, firstClickDesc: boolean) {
    if (!column) return;
    if (column === sortBy) setSortDirection(value => value === "ASC" ? "DESC" : "ASC");
    else { setSortBy(column as MarketingReportSort); setSortDirection(firstClickDesc ? "DESC" : "ASC"); }
  }

  ...filter form unchanged except: the 商品 select (aria-label 商品) with marketing_report_all_products, the 投放师 select only when `all`, and a 视图 select (TREE/FLAT)...
}
```
Full JSX: filter form keeps the existing date/level/owner grid, adds the product `<select>`, the view `<select>` (values `TREE`/`FLAT`, labels from i18n), and the query/reset buttons. Below it render:

```tsx
      <p className="text-xs text-admin-muted">{t("marketing_report_sort_hint")}</p>
      <p className="text-xs text-admin-muted">{t("marketing_report_funnel_hint")}</p>
```
then, when `data?.mode === "TREE"`:

```tsx
      {data.mode === "TREE" ? <ReportTreeTable tree={data.tree ?? []} sortBy={data.sortBy} sortDirection={data.sortDirection} onSort={toggleSort} /> : flatTable}
```
Flat table head uses `reportColumns`; each `<th>` renders a `<button type="button">` with `aria-label={\`${label}${active ? ` (${direction === "ASC" ? "升序" : "降序"})` : ""}\`}`; visual sort indicator `▲/▼`; `firstClickDesc` is `true` for numeric columns (biggest first), `false` for text columns. The identity cell is:

```tsx
      <td className="min-w-56 px-3 py-3"><div className="flex items-start gap-2">
        <ProductThumb url={row.productThumbnailUrl} label={row.productName ?? row.label} />
        <div>{identity(row)}</div>
      </div></td>
      <ReportMetricCells row={row} />
```
with `identity` unchanged from the current file. Pagination block renders only when `data?.mode === "FLAT"`; TREE renders `t("marketing_report_tree_total", { count })` and the cap warning (`linkCount > 500 && <p className="text-xs text-amber-800">{t("marketing_report_tree_too_many")}</p>`). Loading/error/other-sources blocks stay as-is.

Create `report-columns.ts` re-export exactly as Task 10 (fileName hyphenation per repo style: `frontend/src/components/admin/marketing/ReportColumns.tsx` — Task 10's file; adjust the import path here to `./ReportColumns`).

- [ ] **Step 4: Implement `ReportTreeTable.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { MarketingReportRow, MarketingReportTreeProduct } from "@/lib/marketing-api";
import { reportColumns, ReportMetricCells, ProductThumb } from "./ReportColumns";
import type { MarketingReportSort } from "@/lib/marketing-api";

const chevron = (open: boolean) => <span aria-hidden className="inline-block w-3 text-admin-muted">{open ? "▾" : "▸"}</span>;

/**
 * Product → source-type → link tree. Rows are real <tr>s at every level, so
 * the metric columns stay aligned with the flat table. Collapse state lives
 * in the component only; a reload re-expands everything.
 */
export function ReportTreeTable({ tree, sortBy, sortDirection, onSort }: { tree: MarketingReportTreeProduct[]; sortBy: string; sortDirection: "ASC" | "DESC"; onSort: (column?: string, firstClickDesc?: boolean) => void }) {
  const { t } = useAdminI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => setCollapsed(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const open = (key: string) => !collapsed.has(key);
  if (tree.length === 0) return <p className="text-sm text-admin-muted">{t("marketing_report_empty")}</p>;
  return <div className="overflow-x-auto rounded-xl border border-admin-border bg-white"><table className="w-full text-left text-sm">
    <thead className="bg-slate-50 text-xs text-admin-muted"><tr>
      <th className="min-w-56 px-3 py-2"><button type="button" onClick={() => onSort("NAME", false)}>{t("marketing_internal_name")}{sortBy === "NAME" ? (sortDirection === "ASC" ? " ▲" : " ▼") : ""}</button></th>
      {reportColumns.slice(1).map(column => <th key={column.key} className="whitespace-nowrap px-3 py-2">{column.sortBy
        ? <button type="button" aria-label={t("marketing_report_sort_hint")} onClick={() => onSort(column.sortBy, column.numeric)}>{t(column.key)}{sortBy === column.sortBy ? (sortDirection === "ASC" ? " ▲" : " ▼") : ""}</button>
        : t(column.key)}</th>)}
    </tr></thead>
    <tbody className="divide-y divide-admin-border">
      {tree.map(group => <>
        <tr key={group.product.id} className="bg-slate-50">
          <td className="px-3 py-3">
            <button type="button" aria-expanded={open(group.product.id)} className="flex items-start gap-2 text-left font-semibold" onClick={() => toggle(group.product.id)}>
              <span className="mt-0.5">{chevron(open(group.product.id))}</span>
              <ProductThumb url={group.product.thumbnailUrl} label={group.product.name} />
              <span>{group.product.name}</span>
            </button>
            <p className="mt-1 pl-5 text-xs text-admin-muted">{group.product.productCode ?? ""} · {t("marketing_report_tree_total", { count: group.totals.visits ?? 0 })}</p>
          </td>
          <ReportMetricCells row={group.totals} />
        </tr>
        {open(group.product.id) && group.sources.map(source => <>
          <tr key={`${group.product.id}:${source.sourceType}`}>
            <td className="px-3 py-3 pl-10">
              <button type="button" aria-expanded={open(`${group.product.id}:${source.sourceType}`)} className="flex items-center gap-2" onClick={() => toggle(`${group.product.id}:${source.sourceType}`)}>
                {chevron(open(`${group.product.id}:${source.sourceType}`))}
                <span className="font-medium">{t(`marketing_source_${source.sourceType}` as Parameters<typeof t>[0])}</span>
              </button>
            </td>
            <ReportMetricCells row={source.totals} />
          </tr>
          {open(`${group.product.id}:${source.sourceType}`) && source.links.map(link => (
            <tr key={link.id} className="text-admin-muted">
              <td className="px-3 py-3 pl-16"><p>{link.label}</p><p className="text-xs text-admin-muted">{link.productName ?? ""}</p></td>
              <ReportMetricCells row={link} />
            </tr>
          ))}
        </>)}
      </>)}
    </tbody>
  </table></div>;
}
```
(Adapt the pl-10/pl-16 indent classes to the repo's existing spacing vocabulary; keep source/link indents distinct and test identity by text, not by class.)

- [ ] **Step 5: Failing tests for the tree renderer** (`ReportTreeTable.spec.tsx`)

```tsx
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportTreeTable } from "@/components/admin/marketing/ReportTreeTable";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import type { MarketingReportRow, MarketingReportTreeProduct } from "@/lib/marketing-api";

const row: MarketingReportRow = { /* reuse Task 10's fixture shape, minimal fields as ReportMetricCells needs */ } as MarketingReportRow;
const tree: MarketingReportTreeProduct[] = [{ product: { id: "p1", name: "Chair", productCode: "C1", thumbnailUrl: "/c.jpg" }, totals: row, sources: [{ sourceType: "META_AD", totals: row, links: [row, { ...row, id: "l2", label: "Ad B" }] }, { sourceType: "FB_POST", totals: row, links: [] }] }];
const mount = () => render(<AdminI18nProvider><ReportTreeTable tree={tree} sortBy="NAME" sortDirection="ASC" onSort={vi.fn()} /></AdminI18nProvider>);

describe("report tree table", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the three levels with aligned metric columns", () => {
    mount();
    expect(screen.getByText("Chair")).toBeInTheDocument();
    expect(screen.getByText("Meta 广告")).toBeInTheDocument();
    expect(screen.getByText("Ad A")).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "PHP 12000.00" }).length).toBeGreaterThanOrEqual(3);
  });

  it("collapses a product and hides its sources but keeps other products", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Chair/ }));
    expect(screen.queryByText("Meta 广告")).not.toBeInTheDocument();
  });

  it("collapses only one source within an expanded product", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Meta 广告/ }));
    expect(screen.queryByText("Ad A")).not.toBeInTheDocument();
    // FB_POST still expanded (no links, header remains)
    expect(screen.getByText("Facebook 帖子")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Chair/ }));
    expect(screen.getByText("Meta 广告")).toBeInTheDocument(); // source collapse survives product re-expand
  });
});
```

- [ ] **Step 6: Run to verify pass**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/components/admin/marketing
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/admin/marketing/ReportTable.tsx frontend/src/components/admin/marketing/ReportTable.spec.tsx frontend/src/components/admin/marketing/ReportTreeTable.tsx frontend/src/components/admin/marketing/ReportTreeTable.spec.tsx
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(marketing): workbench report filters, sorting and product tree view"
```

---

### Task 12: CampaignLinksList — product/owner filters and thumbnail

**Files:**
- Modify: `frontend/src/components/admin/marketing/CampaignLinksList.tsx`, `frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx`

**Interfaces:**
- Consumes: `marketingApi.linkContext()` (product options incl. thumbnails), `marketingApi.ownerOptions()` (own-scope accounts get exactly themselves, so the select renders only for `MARKETING_VIEW_ALL`), `CampaignLinkRow.productThumbnailUrl` (Task 8).
- Produces: list query gains `productId`/`ownerUserId` from the new selects; pagination resets to page 1 on any filter change.

- [ ] **Step 1: Failing tests**

```tsx
it("filters by product and optimizer from dedicated selects", async () => {
  auth.admin.permissions = ["MARKETING_VIEW_ALL", "MARKETING_MANAGE_OWN"];
  vi.mocked(marketingApi.ownerOptions).mockResolvedValue([{ userId: "u1", aid: "OP-1", displayName: "Optimizer", status: "ACTIVE", userStatus: "ACTIVE" }]);
  mount({ productId: undefined, landingPageId: undefined });
  await screen.findByText("Ad A");
  fireEvent.change(screen.getByLabelText("商品"), { target: { value: "p1" } });
  await waitFor(() => expect(marketingApi.listLinks).toHaveBeenLastCalledWith(expect.objectContaining({ productId: "p1", page: 1 })));
  fireEvent.change(screen.getByLabelText("投放师"), { target: { value: "u2" } });
  await waitFor(() => expect(marketingApi.listLinks).toHaveBeenLastCalledWith(expect.objectContaining({ ownerUserId: "u2", page: 1 })));
});

it("hides the optimizer filter for own-scope users", async () => {
  auth.admin.permissions = ["MARKETING_VIEW_OWN", "MARKETING_MANAGE_OWN"];
  mount();
  await screen.findByText("Ad A");
  expect(screen.queryByLabelText("投放师")).not.toBeInTheDocument();
});

it("renders the product thumbnail before the product name", async () => {
  vi.mocked(marketingApi.listLinks).mockResolvedValue({ items: [{ ...row, productThumbnailUrl: "/uploads/chair.jpg" }], total: 1, page: 1, pageSize: 20 });
  mount();
  await screen.findByText("Ad A");
  expect(screen.getAllByRole("img", { name: /Chair/ })[0]).toHaveAttribute("src", "/uploads/chair.jpg");
});

it("keeps a placeholder when the product has no image", async () => {
  mount();
  await screen.findByText("Ad A");
  expect(screen.getByRole("img", { name: "商品暂无图片" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/components/admin/marketing/CampaignLinksList.spec.tsx
```

- [ ] **Step 3: Implement**

State additions: `productFilter`, `ownerFilter`, `products` (from `marketingApi.linkContext()`, mapped to `{id, name, productCode}`), owners via existing `marketingApi.ownerOptions` when `admin?.permissions.includes("MARKETING_VIEW_ALL")`. Extend `queryKey` with both filters; extend the `listLinks` call with `productId: productFilter || undefined, ownerUserId: (all ? ownerFilter : undefined) || undefined`. Both selects reset `setPage(1)`; the product select renders `marketing_report_all_products` as its empty option.

Product cell (thumbnail before name):

```tsx
<td className="px-3 py-3"><div className="flex items-start gap-2">
  <ProductThumb url={row.productThumbnailUrl} label={row.productName} />
  <div><p>{row.productName}</p><p className="text-xs text-admin-muted">{row.productCode}</p></div>
</div></td>
```
Import `ProductThumb` from `./ReportColumns`.

- [ ] **Step 4: Run to verify pass**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run src/components/admin/marketing
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/marketing/CampaignLinksList.tsx frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" commit -m "feat(marketing): product and optimizer filters plus thumbnails on campaign links"
```

---

### Task 13: Full verification and release checklist

**Files:** none (verification only).

- [ ] **Step 1: Whole suites + lint + typecheck**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm vitest run && pnpm lint
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm vitest run && pnpm lint && pnpm exec tsc --noEmit
```
Expected: green.Anything red here blocks the branch review.

- [ ] **Step 2: Build both sides**

```bash
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/backend && pnpm prisma generate && pnpm build
cd /private/tmp/luwag-marketing-20261029/small-house-commerce/frontend && pnpm build
```
Expected: exit 0 for all.

- [ ] **Step 3: Manual smoke (dev servers on localhost)**

Backend `pnpm start:dev` + frontend `pnpm dev` (Next 16: use `localhost`, not `127.0.0.1`).

Admin (`/admin/marketing/links`, `/admin/marketing/reports`):

1. With one seeded link: tree view shows product row (thumb), source row, link row; totals equal the link row.
2. Click 加购 header → request contains `sortBy=ADD_TO_CARTS&sortDirection=DESC`; click again toggles to ASC.
3. 商品 select filters both tables; 投放师 select exists only with `MARKETING_VIEW_ALL`.
4. Search + status + product filter combine; pagination resets to page 1.

Storefront (user at Playwright/Chromium):

5. Open a campaign link URL (`?cl=…`), add to cart on the PDP: `POST /api/v1/storefront/events` body contains `ADD_TO_CART` **and** `marketingCredential`.
6. Proceed to checkout: a `BEGIN_CHECKOUT` event with the credential flushes (1.5 s delay or pagehide).
7. In the admin report the same day: the link's 加购 = 1, 发起购物 = 1; a direct product-page visit without `?cl=` adds neither.
8. Clear `sh:marketing-touch` and add to cart again on the tribute page: the event still stores (accepted > 0) but no link count changes — verify in the DB: `SELECT event_name, campaign_link_id FROM analytics_events ORDER BY created_at DESC LIMIT 5;`

- [ ] **Step 4: Release notes for the handoff**

Write (and include in the PR description) the deploy order: migration → backend (`prisma generate` + `pnpm build`, `--env-file .env.deploy`) → frontend; note historical funnel counts are null; note the branch is based on `36269e6` + latest `origin/main` and must be re-verified against the server `main` at deploy time.

- [ ] **Step 5: Commit any leftover verification artifacts** (none expected):

```bash
git -c user.name="Luwag Ops" -c user.email="ops@luwag.shop" status --porcelain
```
Expected: empty. Push only when the user authorizes deploy.

---

## Self-Review Notes

- **Spec coverage:** §3 (Tasks 1–3), §4.1 (Tasks 5), §4.2 (Task 6), §4.3 (Task 4 + Task 6), §4.4–4.5 (Task 7), §5.1–5.2 (Tasks 10–12), §5.3 (Task 9), §5.4 (Tasks 10–12), §6 (Task 5's guard test + Task 6's scope test), §7 backend (Tasks 3–7) and frontend (Tasks 1–2, 10–12), §8 (Tasks 0, 13), §9 exclusions respected, §10 acceptance mapped to Task 13's smoke list.
- **Spec deviations introduced while writing the plan (accepted, will note in the PR):** `SPEND_PHP` added to the sort values so the PHP cost column is sortable like its USD twin.
- **Type consistency:** `MarketingReportSerializedRow` (Task 6) structurally satisfies the comparator's input (Task 4); `MarketingReportVisitRow` and the tree interfaces are defined once in Task 7 and consumed only there and in Task 9's mirrored frontend types (field names match: `productCode`, `thumbnailUrl`, `sourceType`, `links`).
- **Known plan-internal wrinkles the executor must resolve:** Task 3's placeholder first test (delete it, keep the three real ones); Task 4's transitional `SortableReportRow` (superseded by Task 6's structural type); Task 10's coverage-cell literal (must call `t()`, not hardcode); Task 11's `ReportColumns` import path (`./ReportColumns`, one file, no hyphen variant).
