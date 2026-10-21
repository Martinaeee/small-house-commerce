# 有货通知与客服渠道（B 块）实施计划

> **执行方式：** Native 主会话连续执行，逐任务 TDD（RED → GREEN）。用户已明确要求拆解后直接执行，不在任务间等待确认。

**Goal:** 为缺货 SKU 提供商品卡/PDP 邮件到货提醒，在真实 `available` 从 `≤0` 跃迁到 `>0` 时可靠认领并发送；同时把现有 Messenger 浮动入口扩为 Messenger / Email / Phone 多渠道客服，并在后台提供配置、通知列表和重发。

**Architecture:** `BackInStockService` 归属现有 `NewsletterModule`，负责订阅、HMAC 退订、可用量快照、事务内认领、提交后发送、失败回退和后台查询/重发。`InventoryService` 只在后台库存写入与明确的订单终止释放路径调用该服务；库存流水、预留、订单金额和 A 块优惠语义不变。前端复用一个无障碍 `BackInStockDialog`，由商品卡、PDP 主购买区和 sticky buy 传入当前解析出的真实 SKU。

**Tech Stack:** NestJS 12、Prisma 7.10、PostgreSQL 18、Zod 4、Next.js 16 App Router、React 19、Tailwind CSS 4、Vitest、Playwright、pnpm。

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-12-back-in-stock-and-contact-channels-design.md`

## Global Constraints

- A 块已冻结：不得改变 Newsletter 优惠、checkout 金额、核销或取消释放规则。
- 不 commit、push、merge、PR 或 deploy；不修改生产数据；不触碰 `small-house-commerce/backend/uploads/`。
- 不重启用户 3000/3001 或其他会话服务；仅可停启本会话 3240/3241。
- 共享 PostgreSQL 5432 migration 串行执行；只迁移 `small_house_variant_test`，先核验 localhost + 精确库名。
- 部署门禁仍要求 `prisma generate`，本轮只在本地执行，不部署。
- 邮箱归一化严格为 `trim().toLowerCase()`；有货通知与 NewsletterSubscriber 完全独立。
- 库存口径严格为聚合 `available = on_hand - reserved`；虚拟 Bundle 采用现有 component availability。
- 只有 `before <= 0 && after > 0` 才认领；认领和库存写入同事务，邮件只在提交后发送。
- 通知邮箱/SKU 不进入订单、归因快照或 Meta Pixel/commerce event。
- 不新增短信、WhatsApp 出站、Messenger 出站、补偿扫描或新队列依赖。
- 前台文案英文；后台 zh/en 字典同步。
- 所有行为改动先写失败测试并确认失败原因，再写最小实现。

## Rulings

1. **补齐 scanner-safe 退订链路。** 规格已有 `CANCELLED` 和邮件 `unsubscribeUrl`，却未列 B 块退订端点；新增独立域分隔 HMAC token、GET 确认页 + POST 变更，绝不复用 Newsletter 退订以免误退 Newsletter。成本：多一个窄 public route 与 token helper；若不做则邮件里的退订链接无法履约。
2. **覆盖虚拟 Bundle SKU。** Bundle 也是顾客可选择的真实 SKU；component 补货/订单释放会重算依赖 Bundle 的 before/after，确保 Bundle 订阅不会永久搁置。成本：跃迁快照需包含一层 `SkuBundleComponent` 依赖；嵌套 Bundle 仍由既有限制禁止。
3. **用事务级 advisory lock 关闭订阅/补货竞态。** 订阅与库存跃迁均按排序后的 SKU id 获取 `back-in-stock:<skuId>` 锁；先订阅则本次补货认领，先补货则订阅返回“已有库存”。成本：同 SKU 的极短串行化，不改变库存语义。
4. **订单编辑不触发通知。** `edit()` 暂时释放后立即重建 reservations，不能在中间态认领；仅 dedicated cancel 与 `updateStatus` 的 `CANCELLED` / `DENIED` 最终释放启用通知。
5. **提交后发送采用有限并发。** 每批最多 10 封，单封沿用 Resend 5 秒 timeout；失败逐条回退 PENDING，避免一个地址阻塞其他地址，也避免无界并发。

## Review Focus

- 同一 SKU 的 subscribe 与 restock 并发：不能漏通知，也不能给已在库商品新建 PENDING。
- component SKU 补货导致 Bundle 从 0→可售：Bundle 订阅必须被认领；非跃迁不得误发。
- 订单编辑 release→reserve 中间态、未确认取消中间态：不得发通知。
- 发送中重订阅/取消或 provider 失败：条件更新不能覆盖更新一轮状态，失败必须可重试。
- 375px 下通知弹层和多渠道客服堆叠：无横向溢出、可键盘关闭、拖拽/滚动/45s nudge 不回归。

---

### Task 1: Prisma 模型、迁移与设置字段

**Files:**
- Modify: `small-house-commerce/backend/prisma/schema/newsletter.prisma`
- Modify: `small-house-commerce/backend/prisma/schema/catalog.prisma`
- Modify: `small-house-commerce/backend/prisma/schema/settings.prisma`
- Create: `small-house-commerce/backend/prisma/migrations/20261014200000_add_back_in_stock_subscriptions/migration.sql`
- Modify/Test: `small-house-commerce/backend/prisma/newsletter-schema.spec.ts`
- Modify/Test: `small-house-commerce/backend/src/modules/settings/dto/settings.dto.spec.ts`

**Produces:**
- Prisma enum `BackInStockStatus = PENDING | SENT | CANCELLED`.
- Model `BackInStockSubscription` with unique `(email, skuId)`, status/error/notified timestamps, product name/slug snapshots, and `Sku.backInStockSubscriptions` relation.
- `SiteSetting.supportPhone: string @default("")`.
- Migration with `SET lock_timeout = '5s'`, enum/table/indexes/FK, and `support_phone` column.

**TDD steps:**
1. Add failing schema tests that use `prisma.backInStockSubscription`, prove duplicate `(email, skuId)` is rejected, cascade delete works, and `supportPhone` defaults empty.
2. Add failing DTO tests: empty phone accepted; `+63 917 123 4567`, spaces, parentheses and hyphens accepted; letters, `<script>`, too short/long rejected.
3. Run focused specs and record expected RED (missing generated delegate/field and missing validation).
4. Add Prisma schema and migration; add `supportPhone` to `updateSettingsSchema` as optional/trimmed with `^[0-9+()\- ]{7,20}$` when nonempty.
5. Stop only 3240/3241, validate exact local DB URL, run `pnpm exec prisma generate` then `prisma migrate deploy` against `small_house_variant_test` serially.
6. Rerun focused specs and `prisma validate`; require GREEN.

### Task 2: Back-in-stock service, public/admin endpoints, and safe unsubscribe

**Files:**
- Create: `backend/src/modules/newsletter/back-in-stock.service.ts`
- Create: `backend/src/modules/newsletter/back-in-stock-token.ts`
- Create: `backend/src/modules/newsletter/dto/back-in-stock.dto.ts`
- Create: `backend/src/modules/newsletter/storefront/back-in-stock.controller.ts`
- Create: `backend/src/modules/newsletter/admin/back-in-stock.controller.ts`
- Modify: `backend/src/modules/newsletter/newsletter.module.ts`
- Test: colocated token/DTO/controller/service specs

**Interfaces:**
- `subscribe({ email, skuId }): Promise<{ ok: true }>`.
- `cancelByToken(token): Promise<boolean>`.
- `list(query): Promise<PagedBackInStock>`.
- `resend(id): Promise<BackInStockAdminRow>`.
- `snapshotForChangedSkusWithin(tx, changedSkuIds): Promise<Map<string, number>>` includes direct and dependent Bundle SKUs.
- `claimTransitionsWithin(tx, before, after): Promise<BackInStockClaim[]>`.
- `deliverClaims(claims): Promise<void>` runs after transaction commit.

**TDD steps:**
1. RED DTO/token tests for email/SKU/query validation, distinct HMAC domain, tampering, and round trip.
2. RED service tests with dedicated PostgreSQL for OOS-only subscribe, normalization, idempotent upsert, SENT/CANCELLED→PENDING reset, product snapshots, Newsletter independence, direct and Bundle availability.
3. RED concurrency test: subscribe and stock-side advisory lock serialize to either claimed subscription or readable in-stock rejection, never stranded PENDING.
4. RED controller tests: throttle on subscribe; scanner-safe GET only renders confirmation; POST changes status; admin list requires `NEWSLETTER_READ`, resend requires `NEWSLETTER_WRITE`.
5. Implement service, DTOs, token, controllers and module providers/exports. Use conditional updates (`status=SENT AND notifiedAt IS NULL`) for success/failure so stale deliveries cannot overwrite a newer cycle.
6. Send product URL and B-specific unsubscribe URL through existing `EmailGateway.sendBackInStock`; process claims in chunks of ten; truncate persisted provider errors to a bounded length.
7. GREEN focused unit + real-PG suite.

### Task 3: Transaction-safe manual inventory transition hooks

**Files:**
- Modify: `backend/src/modules/inventory/inventory.service.ts`
- Modify: `backend/src/modules/inventory/inventory.module.ts`
- Modify/Test: `backend/src/modules/inventory/inventory.service.spec.ts`
- Create/Test: `backend/src/modules/newsletter/back-in-stock.inventory.spec.ts`

**Interfaces:**
- Private shared manual mutation handles absolute (`setOnHand`) and delta (`adjust`) writes in one transaction.
- Inventory transaction returns `{ stock, claims }`; public method calls `deliverClaims(claims)` only after `$transaction` resolves.

**TDD steps:**
1. RED unit tests: first-row create and existing-row adjust claim only 0→positive; positive→positive, zero→zero, negative direction and failed writes do not claim/send; send is after transaction resolution.
2. RED tests preserve absolute idempotency, reserved floor, Bundle write rejection, exact MANUAL_ADJUSTMENT movement and batch per-row settle/retry order.
3. RED real-PG Bundle test: component transition restores virtual Bundle and claims Bundle subscription exactly once.
4. Refactor `adjust`/`setOnHand` through one locked transaction; capture affected direct+Bundle availability before and after; claim in transaction; deliver after commit.
5. Import/export `NewsletterModule`/`BackInStockService` without changing controller permissions or batch semantics.
6. GREEN all inventory, Bundle and notification-focused specs.

### Task 4: Order cancellation/denial release hooks

**Files:**
- Modify: `backend/src/modules/inventory/inventory.service.ts`
- Modify: `backend/src/modules/orders/orders.service.ts`
- Modify: affected `OrdersService` test constructors
- Create/Test: `backend/src/modules/orders/orders.service.back-in-stock.spec.ts`
- Modify: `backend/vitest.config.ts` singleton DB list if needed

**Interfaces:**
- `releaseForOrder(tx, orderId, { claimBackInStock?: boolean } = {}): Promise<BackInStockClaim[]>`.
- `cancel` and terminal `updateStatus(CANCELLED|DENIED)` return from DB transaction with claims, then invoke `deliverClaims`.
- `edit()` calls the default no-claim path.

**TDD steps:**
1. RED real-PG tests: cancellation and DENIED that release the final reservation produce one SENT notification; release that remains unavailable does not; repeated terminal operation does not duplicate.
2. RED boundaries: SHIPPING→CANCELLED remains rejected/delivers none; order edit release/re-reserve emits none; transaction rollback emits none; no active reservations emits none.
3. Modify release path to lock affected SKU notification keys, snapshot before/after around reservation release, and conditionally claim only for final terminal callers.
4. Deliver after outer order transaction; preserve promo revalidation and return values.
5. GREEN new tests plus existing order, promo, inventory and customer-risk suites.

### Task 5: Shared storefront Notify dialog and real SKU wiring

**Files:**
- Create: `frontend/src/components/back-in-stock/BackInStockDialog.tsx`
- Create: `frontend/src/components/back-in-stock/BackInStockTrigger.tsx`
- Create: colocated specs
- Modify: `frontend/src/components/product/ProductCard.tsx`
- Modify: `frontend/src/components/product/PdpClient.tsx`
- Modify: `frontend/src/components/product/PdpStickyBuy.tsx`
- Modify: relevant ProductCard/PdpSticky specs

**Behavior:**
- Trigger is rendered only for a resolved OOS SKU.
- Dialog submits `{ email, skuId }` to `/api/v1/storefront/back-in-stock`, locks duplicate submits, preserves email on error, and shows `We'll email you when it's back in stock.` on success.
- Dialog has `role=dialog`, focus trap, Esc/backdrop/X close, scroll lock and focus restore.
- Product card keeps `Save for Later` and real add-to-cart behavior; Notify is a secondary text action below it.
- PDP main OOS card and sticky OOS action share the same current resolved SKU; variant changes close/reset stale success so one SKU can never be mislabeled as another.
- Preview mode never mounts a live notify trigger or performs a fetch.

**TDD steps:**
1. RED component tests for validation, exact SKU body, duplicate lock, success/error, focus and dismissal.
2. RED ProductCard test selects an OOS variant, opens Notify, submits its exact SKU, and asserts no commerce event; Save for Later remains unchanged.
3. RED PDP/sticky tests for current SKU, variant change, unresolved selection and preview no-side-effect behavior.
4. Implement shared components and three integrations with English copy and responsive width.
5. GREEN focused frontend tests and TypeScript.

### Task 6: Support phone contract, admin settings, and footer

**Files:**
- Modify: backend settings service/DTO specs/controller specs
- Modify: `frontend/src/lib/site-settings.ts`
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/app/admin/(shell)/settings/page.tsx` and spec
- Modify: `frontend/src/components/layout/Footer.tsx` and spec
- Modify: storefront layout props

**TDD steps:**
1. RED backend tests: admin echo/update and public payload include trimmed `supportPhone`; invalid phone returns validation error; cache revalidation remains best effort.
2. RED frontend settings tests: field loads/saves, matches backend validation and preserves all Newsletter/contact fields.
3. RED footer/site-settings tests: nonempty phone renders a readable `tel:` link; empty hides it; fallback is empty.
4. Implement service/public payload, API types, form field and footer/layout wiring.
5. GREEN focused backend/frontend tests.

### Task 7: Multi-channel floating support control

**Files:**
- Modify: `frontend/src/components/chat/MessengerChat.tsx`
- Create: `frontend/src/components/chat/MessengerChat.spec.tsx`

**Behavior:**
- Build visible channels from nonempty Messenger, email and phone settings.
- Zero channels: render nothing. One channel: main FAB directly performs that action. Two or more: FAB toggles vertical stack; Messenger opens new tab, email uses `mailto:`, phone uses `tel:`; explicit X/Escape collapses.
- Keep draggable bounds, >5px click suppression, scroll hide/show, resize clamp, 45s one-shot nudge and sessionStorage behavior.
- Multi-channel nudge CTA opens the channel stack instead of assuming Messenger.

**TDD steps:**
1. RED tests for zero/single/multiple channels, href/action correctness, X/Escape and `aria-expanded`.
2. RED regression tests for drag suppression, scroll visibility, resize clamp, nudge timing/storage and open-dialog suppression.
3. Refactor data-driven channels while leaving movement/timer primitives intact.
4. GREEN suite; check 375px stack geometry and keyboard access in browser.

### Task 8: Admin Back-in-stock tab and retry workflow

**Files:**
- Create: `frontend/src/components/admin/newsletter/BackInStockTable.tsx` and spec
- Modify: `frontend/src/app/admin/(shell)/newsletter/page.tsx` and spec
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/i18n/zh.ts`, `frontend/src/i18n/en.ts`

**TDD steps:**
1. RED API/table tests for paged load, status filter, PENDING/SENT/CANCELLED, error display, time fields, SKU/product details, write-permission gating and retry lock.
2. RED page test: three tabs; promotions remains SUPER_ADMIN-only; Back-in-stock is visible with NEWSLETTER_READ and gets `canWrite` from NEWSLETTER_WRITE.
3. Add typed API contracts/methods, i18n keys, table and tab wiring.
4. GREEN focused admin tests and TypeScript.

### Task 9: Real-stack E2E, docs, and final gates

**Files:**
- Create: `frontend/e2e/back-in-stock-contact.spec.ts`
- Reuse/extend E2E origins/global setup only where required
- Update B spec if implementation rulings reveal concrete contract details
- Create/update `.superpowers/sdd/2026-10-12-back-in-stock-and-contact-channels/progress.md`

**Browser scenarios:**
1. Set a real SKU OOS → ProductCard Notify with email → admin Back-in-stock tab shows PENDING and exact SKU.
2. Admin stock `0→>0` → log gateway runs → row becomes SENT/notified; no duplicate on later positive adjustment.
3. PDP second OOS SKU subscribes and binds current variant; cancellation/denial release crossing 0→positive sends once.
4. Settings UI saves phone; storefront cache revalidates; footer phone appears; support FAB exposes Messenger/email/phone and correct links.
5. 375/768/1440: notify dialog + support stack have no horizontal overflow; zero console/page/hydration errors.
6. Verify notification email/SKU never appears in Pixel or order attribution network payloads.

**Final verification:**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/small_house_variant_test?schema=public' \
NEWSLETTER_TEST_DATABASE_URL="$DATABASE_URL" \
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/backend build
pnpm --dir small-house-commerce/backend exec prisma validate

pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/frontend build

E2E_BACKEND_PORT=<free> E2E_FRONTEND_PORT=<free> \
pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/back-in-stock-contact.spec.ts --project=chromium

git diff --check
```

Then run an author self-review (Agent/Workflow prohibited), fix Critical/Important findings in one RED→GREEN pass, record deferred Minor findings, restart only the isolated 3240/3241 preview, and leave the storefront/admin tabs open. Do not commit, push or deploy.
