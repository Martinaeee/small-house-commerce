# Notifications V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Admin Bell placeholder with a real RBAC-filtered current-issues panel and full page derived entirely from existing order/product facts.

**Architecture:** A new read-only Nest module loads one active-user permission snapshot, executes only authorized aggregate counts, and returns a deterministic allowlisted response with no timestamps or read state. A typed Admin client/hook feeds one reusable notification list in the header panel and hidden full-page route; the frontend validates every deep link while the backend remains the authorization authority.

**Tech Stack:** NestJS 12, Prisma 7, PostgreSQL, Next.js 16.3.4 App Router, React 19, TypeScript, Tailwind CSS 4, Vitest/RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-notifications-v1-design.md`

## Global Constraints

- Derived current facts only: no Notification table, unread/read history, fake count/time/problem, worker, or polling.
- No schema, migration, destructive SQL, production DB operation, dependency, or write-contract change.
- Only six audited categories: two order confirmation states and four canonical product-attention predicates.
- Order work requires `ORDER_CONFIRM`; product work requires `PRODUCT_MANAGE`; missing/inactive users fail 403.
- Reuse `attentionWhere()` exactly; never hard-code low-stock thresholds, campaign events, or landing schedules.
- Endpoint is JWT-protected and `Cache-Control: private, no-store`; domain failure fails the request.
- Deep links are six exact `/admin/` routes; no external/arbitrary href is rendered.
- Do not modify Global Search behavior, PDP, Product Media, `backend/uploads/`, schema, or dependencies.
- Do not merge, push, create a PR, or deploy.

## HARD STOP（用户原文）

出现以下任一情况立即停止，不得自行跨越：

- “需要 Prisma schema 修改”
- “需要 migration”
- “需要 destructive SQL”
- “需要 production DB 操作”
- “需要新的 npm dependency”
- “需要改变现有业务写入 contract”
- “需要改变 ProductForm / Catalog Graph / Media Resolver”
- “现有测试无法保持通过”
- “审计结果与实际代码严重不一致”

普通 UI / API 只读能力 / 派生逻辑不再次询问。本 Phase 必须完成 Implementation → Tests → Browser/E2E Verification → Screenshots → Review → Independent Commit 后，自动进入 Product Media UX。

## Review Focus

1. A user with `ORDER_VIEW_ALL` but not `ORDER_CONFIRM` (Warehouse/Finance) must not receive confirmation-work notifications; Task 1 tests this exact matrix.
2. A product matching more than one attention predicate must contribute to each distinct issue count without being mislabeled as unique products; Task 1 pins sum semantics and page copy says “active issues.”
3. A stale-draft count crossing the 30-day boundary during one request must use one captured `now`; Task 1 asserts the same Date reaches the canonical predicate.
4. A compromised/malformed API href must never become a navigable external or unsupported Admin link; Task 2 tests exact kind/href validation and rejection.
5. Header persistence across route changes must not show a stale count after opening the panel, and request races must not let an older response win; Task 2 adds request identity/abort tests and refresh-on-open.

---

### Task 1: Derived notification backend and audit lock

**Files:**
- Create: `small-house-commerce/backend/src/modules/notifications/notifications.types.ts`
- Create: `small-house-commerce/backend/src/modules/notifications/notifications.service.ts`
- Create: `small-house-commerce/backend/src/modules/notifications/notifications.service.spec.ts`
- Create: `small-house-commerce/backend/src/modules/notifications/admin/notifications.controller.ts`
- Create: `small-house-commerce/backend/src/modules/notifications/admin/notifications.controller.spec.ts`
- Create: `small-house-commerce/backend/src/modules/notifications/notifications.module.ts`
- Modify: `small-house-commerce/backend/src/app.module.ts`
- Test (unchanged production source): `small-house-commerce/backend/src/modules/catalog/admin-product-attention.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ADMIN_NOTIFICATION_HREFS = {
    ORDER_NEEDS_REVIEW: "/admin/orders?confirmation=NEEDS_REVIEW",
    ORDER_UNCONFIRMED: "/admin/orders?confirmation=UNCONFIRMED",
    PRODUCT_MISSING_MEDIA: "/admin/products?attention=missing_media",
    PRODUCT_NO_PRICED_SKU: "/admin/products?attention=no_priced_sku",
    PRODUCT_INCOMPLETE_SHIPPING: "/admin/products?attention=incomplete_shipping",
    PRODUCT_STALE_DRAFT: "/admin/products?attention=stale_draft",
  } as const;

  export type AdminNotificationKind = keyof typeof ADMIN_NOTIFICATION_HREFS;
  export interface AdminNotificationItem {
    kind: AdminNotificationKind;
    count: number;
    href: (typeof ADMIN_NOTIFICATION_HREFS)[AdminNotificationKind];
  }
  export interface AdminNotificationsResponse {
    totalCount: number;
    items: AdminNotificationItem[];
  }
  export class NotificationsService {
    notifications(userId: string): Promise<AdminNotificationsResponse>;
  }
  ```
- Controller: `GET /admin/notifications`, `JwtAuthGuard`, current `RequestUser.userId`, private/no-store.

- [ ] **Step 1: Write failing service tests**

Create Prisma mocks for one active-user role graph and six `count` calls. Add separate tests for:

- Super Admin/`ORDER_CONFIRM` + `PRODUCT_MANAGE`: exact deterministic item order and `totalCount === items.reduce((sum,item) => sum + item.count, 0)`;
- zero-count categories omitted;
- Warehouse (`ORDER_VIEW_ALL`, no `ORDER_CONFIRM`) runs no order confirmation counts;
- product-only user runs no order counts;
- no supported permission returns exact empty response and runs no domain queries;
- inactive/missing user rejects with `ForbiddenException`;
- one rejected domain count rejects the whole response;
- one request-level `now` is passed to `attentionWhere("stale_draft", now)`;
- Prisma product calls receive the exact exported `attentionWhere()` outputs.

Mock call expectations must identify order counts by `confirmationStatus` and product counts by canonical where values, not only call count.

- [ ] **Step 2: Run service RED**

```bash
pnpm --dir small-house-commerce/backend test -- \
  src/modules/notifications/notifications.service.spec.ts
```

Expected: module/import missing.

- [ ] **Step 3: Implement service/types minimally**

Load the user with `status` and role→permission codes once, fail closed, create one `now`, and build authorized Promise arrays. Run independent authorized counts in parallel, but only produce a response after all resolve. Omit count-zero items; do not add generated/item timestamps.

- [ ] **Step 4: Run service GREEN**

Run Step 2 command. Expected: all service cases pass.

- [ ] **Step 5: Write controller/module RED**

Mirror Search controller metadata tests and assert JWT guard, route, GET method, `Cache-Control: private, no-store`, and delegation using `RequestUser.userId`. Add an AppModule metadata assertion or existing bootstrap test that `NotificationsModule` is imported.

- [ ] **Step 6: Run controller RED**

```bash
pnpm --dir small-house-commerce/backend test -- \
  src/modules/notifications/admin/notifications.controller.spec.ts
```

Expected: controller/module missing.

- [ ] **Step 7: Implement controller/module registration**

Use `AuthModule`, `AdminNotificationsController`, and `NotificationsService`; import the module in `AppModule`. Do not import/modify SearchModule or expose write methods.

- [ ] **Step 8: Run backend GREEN and audit predicates**

```bash
pnpm --dir small-house-commerce/backend test -- \
  src/modules/notifications/notifications.service.spec.ts \
  src/modules/notifications/admin/notifications.controller.spec.ts \
  src/modules/catalog/admin-product-attention.spec.ts
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add \
  small-house-commerce/backend/src/modules/notifications \
  small-house-commerce/backend/src/app.module.ts
git commit -m "feat(admin): add derived notification service"
```

---

### Task 2: Typed client, stale-safe hook, and Bell panel

**Files:**
- Create: `small-house-commerce/frontend/src/lib/admin-notifications.ts`
- Create: `small-house-commerce/frontend/src/lib/admin-notifications.spec.ts`
- Create: `small-house-commerce/frontend/src/components/admin/useAdminNotifications.ts`
- Create: `small-house-commerce/frontend/src/components/admin/useAdminNotifications.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/AdminNotificationList.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/AdminNotifications.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/AdminNotifications.spec.tsx`
- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminShell.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminGlobalHeader.tsx`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Produces frontend equivalents of `AdminNotificationKind`, `AdminNotificationItem`, and `AdminNotificationsResponse`.
- Produces:
  ```ts
  export function parseAdminNotificationsResponse(value: unknown): AdminNotificationsResponse;
  export function adminNotificationHref(item: AdminNotificationItem): string | null;
  export function useAdminNotifications(): {
    status: "loading" | "ready" | "empty" | "error";
    response: AdminNotificationsResponse | null;
    retry(): void;
    refresh(): void;
  };
  ```
- Adds `adminApi.notifications(signal?: AbortSignal): Promise<unknown>`; parsing happens before rendering.
- `AdminNotificationList` is shared by header panel and full page in Task 3.

- [ ] **Step 1: Write failing parser/allowlist tests**

Require exact known kinds, integer non-negative counts, exact href for each kind, correct recomputed total, and reject/throw on unknown kinds, mismatched href, external URLs, negative/fractional counts, duplicate kinds, or total mismatch.

```ts
expect(adminNotificationHref({
  kind: "ORDER_UNCONFIRMED",
  count: 2,
  href: "/admin/orders?confirmation=UNCONFIRMED",
})).toBe("/admin/orders?confirmation=UNCONFIRMED");
```

- [ ] **Step 2: Run parser RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/lib/admin-notifications.spec.ts
```

Expected: module missing.

- [ ] **Step 3: Implement typed parser and API method**

Define one frontend `ADMIN_NOTIFICATION_HREFS` constant, validate response with ordinary TypeScript guards (no new dependency), and derive navigation from the kind map after verifying the wire href matches. Add the authenticated GET method.

- [ ] **Step 4: Run parser GREEN**

Run Step 2 command. Expected: all cases pass.

- [ ] **Step 5: Write failing hook race tests**

With deferred promises, assert initial fetch, error/retry, refresh aborts prior request, stale completion cannot replace newer data, unmount aborts, and `refresh()` from panel opening fetches current counts. Follow the existing `useAdminSearch` request-identity style without importing/modifying Global Search.

- [ ] **Step 6: Run hook RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/admin/useAdminNotifications.spec.tsx
```

Expected: hook missing.

- [ ] **Step 7: Implement hook minimally**

Use `AbortController` plus monotonically increasing request identity. Keep no resolved-response cache and no polling. Parse before state update; report malformed payload as error.

- [ ] **Step 8: Write Bell panel RED**

Add RTL cases for loading, exact badge/accessibility count (`99+` only visual), populated rows, honest empty, retry error, open-trigger refresh, exact deep-link hrefs, View all, outside click, Escape, focus return, and language switching. Assert no “unread,” fake timestamps, or unsupported category copy. Assert the header renders one interactive Bell and removes the pending placeholder.

- [ ] **Step 9: Run Bell RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/components/admin/AdminNotifications.spec.tsx \
  src/components/admin/AdminShell.spec.tsx
```

Expected: components/integration missing or placeholder assertion fails.

- [ ] **Step 10: Implement panel and shell integration**

Build a non-modal anchored panel with native links/buttons, document outside-pointer/Escape cleanup, trigger focus restoration, and responsive width. Pass `<AdminNotifications />` through `AdminGlobalHeader.notificationControl`. Remove only the now-unused `NotificationBoundary`; keep `notificationControl` as an injectable test/composition slot. Add complete zh/en keys.

- [ ] **Step 11: Run Task 2 GREEN**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  src/lib/admin-notifications.spec.ts \
  src/components/admin/useAdminNotifications.spec.tsx \
  src/components/admin/AdminNotifications.spec.tsx \
  src/components/admin/AdminShell.spec.tsx
```

Expected: all pass with no act/hydration warnings.

- [ ] **Step 12: Commit**

```bash
git add \
  small-house-commerce/frontend/src/lib/admin-notifications.ts \
  small-house-commerce/frontend/src/lib/admin-notifications.spec.ts \
  small-house-commerce/frontend/src/lib/admin-api.ts \
  small-house-commerce/frontend/src/components/admin/useAdminNotifications.ts \
  small-house-commerce/frontend/src/components/admin/useAdminNotifications.spec.tsx \
  small-house-commerce/frontend/src/components/admin/AdminNotificationList.tsx \
  small-house-commerce/frontend/src/components/admin/AdminNotifications.tsx \
  small-house-commerce/frontend/src/components/admin/AdminNotifications.spec.tsx \
  small-house-commerce/frontend/src/components/admin/AdminShell.tsx \
  small-house-commerce/frontend/src/components/admin/AdminShell.spec.tsx \
  small-house-commerce/frontend/src/components/admin/AdminGlobalHeader.tsx \
  small-house-commerce/frontend/src/i18n/zh.ts \
  small-house-commerce/frontend/src/i18n/en.ts
git commit -m "feat(admin): add notification center bell"
```

---

### Task 3: Full notifications page and hidden-route authorization

**Files:**
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/notifications/page.tsx`
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/notifications/page.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminShell.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminShell.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminNotificationList.tsx`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Route consumes `useAdminNotifications()` and `AdminNotificationList mode="page"`.
- Hidden-route gate: `pathname === "/admin/notifications" && (hasPermission("ORDER_CONFIRM") || hasPermission("PRODUCT_MANAGE"))`.

- [ ] **Step 1: Read the installed Next page/client boundary guide**

Read `frontend/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`; use the repo’s current client-page pattern rather than a training-era Next convention.

- [ ] **Step 2: Write page and shell RED**

Page tests assert title/current-state explanation, loading/results/empty/error/retry, all exact deep links, and no unread/time language. Shell tests assert an `ORDER_CONFIRM`-only or `PRODUCT_MANAGE`-only account can render the hidden route when sidebar nav is empty, while an unsupported account still sees No modules available.

- [ ] **Step 3: Run RED**

```bash
pnpm --dir small-house-commerce/frontend vitest run \
  'src/app/admin/(shell)/notifications/page.spec.tsx' \
  src/components/admin/AdminShell.spec.tsx
```

Expected: page missing and hidden route not authorized.

- [ ] **Step 4: Implement full page**

Follow the existing Search full-page spacing/header/error patterns. Reuse the same list and hook; do not add a second fetch/parser or page-only count truth. Add the exact hidden-route gate.

- [ ] **Step 5: Run GREEN**

Run Step 3 command. Expected: all page/shell cases pass.

- [ ] **Step 6: Commit**

```bash
git add \
  'small-house-commerce/frontend/src/app/admin/(shell)/notifications/page.tsx' \
  'small-house-commerce/frontend/src/app/admin/(shell)/notifications/page.spec.tsx' \
  small-house-commerce/frontend/src/components/admin/AdminShell.tsx \
  small-house-commerce/frontend/src/components/admin/AdminShell.spec.tsx \
  small-house-commerce/frontend/src/components/admin/AdminNotificationList.tsx \
  small-house-commerce/frontend/src/i18n/zh.ts \
  small-house-commerce/frontend/src/i18n/en.ts
git commit -m "feat(admin): add notifications workspace"
```

---

### Task 4: Real-stack RBAC, screenshots, and phase review

**Files:**
- Create: `small-house-commerce/frontend/e2e/admin-notifications.spec.ts`
- Modify: `small-house-commerce/backend/prisma/seed-e2e.ts` to add deterministic current-issue fixtures
- Create/update: phase ledger in this plan’s `.superpowers/sdd/` workspace (gitignored)

**Interfaces:**
- Reuses Super Admin, Warehouse, and Optimizer E2E accounts; API `127.0.0.1:3210`, frontend `localhost:3211`.
- Cross-checks notification product counts against `/admin/products/counts` and order counts against filtered `/admin/orders` results rather than hard-coding mutable seed totals.
- Produces gitignored screenshots under `frontend/screenshots/phase-notifications-v1-*.png`.

- [ ] **Step 1: Write failing real-stack acceptance**

Cover:

- Super Admin response contains only positive real categories in deterministic order and exact total sum;
- each product notification count equals the canonical Products counts response;
- each order notification count equals the corresponding filtered Orders total;
- Warehouse (`ORDER_VIEW_ALL` without `ORDER_CONFIRM`) and Optimizer receive no order/product items;
- endpoint has `private, no-store`; unauthenticated request is 401;
- Bell exact badge, opening refresh, keyboard Escape/focus return, deep-link navigation applies real list filter;
- full page populated and empty/permission-filtered behavior;
- 375 and 1440 header/page have no horizontal overflow;
- no console error, pageerror, hydration warning, 4xx/5xx for successful authenticated UI flows.

Run once before implementation adjustments. Expected: fail on missing endpoint/UI selectors, not server setup.

- [ ] **Step 2: Complete deterministic fixtures and screenshots**

If existing guarded seed data cannot exercise all six kinds, add disposable E2E fixtures with fixed IDs/slugs/order numbers and idempotent upserts. Add screenshots:

```text
phase-notifications-v1-panel-1440.png
phase-notifications-v1-page-1440.png
phase-notifications-v1-page-1920.png
phase-notifications-v1-mobile-375.png
```

Do not use or modify production data or `backend/uploads/`.

- [ ] **Step 3: Run focused E2E**

```bash
pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/admin-notifications.spec.ts \
  --project=chromium
```

Expected: all tests pass.

- [ ] **Step 4: Inspect screenshots and browser state**

Read all four images and use Chrome DevTools on the isolated server to inspect open/close/focus/deep-link behavior. Any visual/interaction defect becomes a failing test before a fix.

- [ ] **Step 5: Run phase-wide verification**

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/backend build
pnpm --dir small-house-commerce/frontend build
pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/admin-notifications.spec.ts \
  --project=chromium
```

Expected: zero tests/type/build errors; only ledgered pre-existing lint warnings.

- [ ] **Step 6: Review the isolated Notifications diff**

Check all five Review Focus entries, API output against the audit table, and exact no-schema/no-migration/no-dependency/no-write boundary. Fix Critical/Important findings RED→GREEN; list Minors for final report.

- [ ] **Step 7: Commit acceptance**

```bash
git add \
  small-house-commerce/frontend/e2e/admin-notifications.spec.ts \
  small-house-commerce/backend/prisma/seed-e2e.ts
git commit -m "test(admin): verify notifications v1 end to end"
```

Mark the Notifications ledger complete, then automatically start the Product Media UX plan.
