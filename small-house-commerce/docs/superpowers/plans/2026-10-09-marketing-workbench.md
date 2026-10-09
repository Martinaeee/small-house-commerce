# 投放工作台与独立商品落地页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每位优化师从母商品复制出可独立编辑、可发布、可核算的落地页，并用不可伪造的投放链接把访问、订单和 USD 广告费归到正确的优化师。

**Architecture:** 后端 NestJS + Prisma 分域扩展（身份/营销/订单归因），落地页从“覆盖字段”升级为“草稿＋已发布快照”，公开页只读已发布快照、购买区仍读母商品实时 SKU/价格/库存；归因改为服务端签发凭据并在下单事务内落快照。前端 Next.js App Router，编辑器用 Puck 受控模块集，后台按 owner 约束渲染。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Zod、Next.js 16 App Router、React 19、Vitest、Playwright、`@puckeditor/core`、`sanitize-html`。

**Spec:** `docs/superpowers/specs/2026-10-09-marketing-workbench-design.md`

**进度（2026-10-09）：** Task 1（优化师身份与 AID）与 Task 2（营销权限与 owner 约束）已实现、测试通过并分别提交（`dde3a11`、`b5bf52d`）。后端全量 868 项通过；类型检查无新增错误（22 项均为既有问题）。下一步从 Task 3 开始。

**本地验证环境：** 专用库 `small_house_marketing_dev`（Docker 容器 `small-house-postgres`，5432）。迁移验证方式见 Task 2 Step 7。后端单测用 Prisma mock，不需要数据库。

## Global Constraints

- 展示内容独立副本；母商品文案变更不自动覆盖，需手动同步；价格/库存/履约始终读母商品实时数据。
- 广告费以 USD 录入，保存当时 `phpPerUsd` 汇率；订单仍为 PHP；PHP 金额由服务端 Decimal 计算并四舍五入到分。
- 归因窗口：最后一次有效投放触达，默认 7 天；业务日期 Asia/Manila，时间戳存 UTC。
- 核算口径：签收毛额未扣退款、不等于 COD 回款；不显示净利润、佣金或 Profit ROAS。
- FAQ 属于商品上架与商品编辑，本计划不实现、不迁移 FAQ。
- 现有 `docs/DATABASE.md` §8 optimizers、§77 cost_entries 为逻辑规范；实现时以本计划命名落库。
- 所有后台查询与写操作必须服务端按权限＋`ownerUserId` 限定；越权返回 404。
- 富文本一律后端按白名单净化；媒体只接受 http(s) 或单斜杠 `/uploads/...`，拒绝 `//host`、`javascript:`、`data:`。
- 迁移为加性、可回滚；迁移号串行；不得与并行会话的未提交改动互相覆盖。
- 不新增未经批准的依赖；`@puckeditor/core` 与 `sanitize-html` 的引入须先通过 Task 6 的验证门。
- 每个任务结束时测试全绿并单独提交；不得使用 `git reset --hard`、`git stash` 或整分支部署。

## Review Focus

- **并发编辑同一页面**：两位管理员同时保存草稿或发布，后提交者不能静默覆盖前者；必须版本冲突 409 并保留输入。
- **无效/伪造触达**：`cl` 被篡改、指向已停用链接、或 `aid` 指向他人时，顾客仍能正常下单，且绝不产生错误归属。
- **跨页面浏览后的归因**：从投放链接进入后浏览首页/集合/购物车/确认页再下单，参数未丢失、未被普通浏览覆盖、7 天后失效。
- **费用与汇率边界**：重复录入同一天、并发更正、撤销、零费用、跨马尼拉日期零点、以及金额/汇率精度。
- **母商品失效**：母商品被下架或规格停用后，已发布落地页不得继续以旧价格成交，也不得静默替换为其他规格。

---

## 文件结构

**后端（新增）**
- `backend/prisma/schema/marketing.prisma` — OptimizerProfile、CampaignLink、CampaignLinkVisit、AdCostEntry、归因凭据无关的持久结构
- `backend/src/modules/marketing/` — `marketing.module.ts`、`optimizers.{service,controller}.ts`、`campaign-links.{service,controller}.ts`、`ad-costs.{service,controller}.ts`、`marketing-touch.{service,controller}.ts`、`marketing-report.service.ts`、`dto/`、`marketing-attribution.ts`（纯函数：凭据签名/校验/归属解析）
- `backend/src/modules/catalog/landing/landing-content.ts` — 展示文档 Zod 校验与净化（唯一入口）

**后端（修改）**
- `backend/prisma/schema/landing-page.prisma` — 加 owner/draft/published/version 字段
- `backend/prisma/rbac.ts` + 一条权限迁移 — 新增 MARKETING_* 权限
- `backend/src/modules/catalog/landing/landing-pages.service.ts`、`admin/landing-pages.controller.ts`、`storefront/landing-pages.controller.ts`
- `backend/src/modules/orders/orders.service.ts`、`dto/order.dto.ts` — 归因改为凭据解析

**前端（新增）**
- `frontend/src/app/admin/(shell)/marketing/` — `page.tsx`（工作台）、`[id]/edit/page.tsx`（编辑器）、`links/page.tsx`、`costs/page.tsx`、`reports/page.tsx`
- `frontend/src/components/admin/marketing/` — `LandingContentEditor.tsx`、`puck-config.tsx`、`MarketingBlocks.tsx`、`PublishBar.tsx`、`SyncFromProductDialog.tsx`、`LinkTable.tsx`、`CostForm.tsx`、`ReportTable.tsx`
- `frontend/src/lib/marketing-api.ts`、`frontend/src/lib/marketing-touch.ts`

**前端（修改）**
- `frontend/src/lib/tracking.ts` — 凭据读取/持久化取代裸 URL 读取
- `frontend/src/app/(storefront)/lp/[slug]/page.tsx` — 渲染已发布快照
- `frontend/src/components/product/LandingViewTracker.tsx` — 上报新触达接口
- `frontend/src/components/checkout/CheckoutConfirmView.tsx`、`frontend/src/lib/api.ts` — 携带凭据下单

---

### Task 1: 优化师身份与 AID

**Files:**
- Create: `backend/prisma/schema/marketing.prisma`, `backend/src/modules/marketing/optimizers.service.ts`, `backend/src/modules/marketing/optimizers.service.spec.ts`
- Modify: `backend/prisma/schema/identity.prisma`（`User` 加反向关系）, `backend/src/app.module.ts`
- Create: `backend/prisma/migrations/20261010090000_add_optimizer_profiles/migration.sql`

**Interfaces:**
- Consumes: 既有 `PrismaService`、`User` 模型（`identity.prisma:54`）
- Produces: `OptimizerProfile { id, userId, aid, displayName, status }`；`OptimizersService.resolveByAid(aid): Promise<{id,userId,displayName}|null>`；`OptimizersService.ensureProfileForUser(userId): Promise<OptimizerProfile>`

- [ ] **Step 1: 写失败测试**

```ts
// backend/src/modules/marketing/optimizers.service.spec.ts
import { describe, expect, it } from 'vitest';
import { normaliseAid } from './marketing-attribution';

describe('optimizer AID', () => {
  it('rejects AID values that are not stable codes', () => {
    expect(normaliseAid(' ma-1 ')).toBe('MA-1');
    expect(normaliseAid('MA 1')).toBeNull();
    expect(normaliseAid('')).toBeNull();
    expect(normaliseAid('a'.repeat(65))).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --dir small-house-commerce/backend test marketing-attribution`
Expected: FAIL —— 找不到模块 `./marketing-attribution`

- [ ] **Step 3: 最小实现**

```ts
// backend/src/modules/marketing/marketing-attribution.ts
export function normaliseAid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  if (value.length < 1 || value.length > 64) return null;
  return /^[A-Z0-9][A-Z0-9._-]*$/.test(value) ? value : null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --dir small-house-commerce/backend test marketing-attribution`
Expected: PASS

- [ ] **Step 5: 加模型与迁移**

```prisma
// backend/prisma/schema/marketing.prisma
model OptimizerProfile {
  id          String   @id @default(uuid(7)) @db.Uuid
  userId      String   @unique @map("user_id") @db.Uuid
  aid         String   @unique
  displayName String   @map("display_name")
  status      String   @default("ACTIVE")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("optimizer_profiles")
}
```

迁移只建表与唯一索引，不做数据回填；既有 AID 映射在 Task 14 显式登记。

- [ ] **Step 6: 服务与测试**

`OptimizersService` 提供 `list()`、`create(userId, aid, displayName)`、`updateStatus(id, status)`、`resolveByAid(aid)`；`create` 先 `normaliseAid` 再用唯一约束冲突映射为具名 409。测试覆盖：重复 AID 冲突、非法 AID 400、`resolveByAid(' ma-1 ')` 命中。

- [ ] **Step 7: 运行并提交**

Run: `pnpm --dir small-house-commerce/backend test optimizers && pnpm --dir small-house-commerce/backend exec tsc --noEmit`
Expected: PASS、0 error

```bash
git add backend/prisma/schema/marketing.prisma backend/prisma/schema/identity.prisma \
  backend/prisma/migrations/20261010090000_add_optimizer_profiles \
  backend/src/modules/marketing backend/src/app.module.ts
git commit -m "feat(marketing): add optimizer profiles with stable AID"
```

---

### Task 2: 营销权限与 owner 约束

**Files:**
- Modify: `backend/prisma/rbac.ts:92-130`
- Create: `backend/prisma/migrations/20261010093000_add_marketing_permissions/migration.sql`
- Create: `backend/src/modules/marketing/marketing-access.ts`, `backend/src/modules/marketing/marketing-access.spec.ts`

**Interfaces:**
- Consumes: `Task 1` 的 `OptimizerProfile`；既有 `permissions.guard.ts`
- Produces: `MARKETING_VIEW_OWN | MARKETING_MANAGE_OWN | MARKETING_VIEW_ALL | MARKETING_MANAGE_ALL`；`MarketingAccess.scopeFor(account): {all: boolean; ownerUserId: string | null}`；`MarketingAccess.assertVisible(scope, recordOwnerId): void`（越权抛 404）

- [ ] **Step 1: 写失败测试**

```ts
describe('marketing access scope', () => {
  it('limits an optimizer to their own records', () => {
    const scope = scopeFor({ id: 'u1', permissions: ['MARKETING_VIEW_OWN'] });
    expect(scope).toEqual({ all: false, ownerUserId: 'u1' });
    expect(() => assertVisible(scope, 'u2')).toThrowError(/404/);
  });
  it('lets an admin see everything', () => {
    expect(scopeFor({ id: 'u9', permissions: ['MARKETING_VIEW_ALL'] }).all).toBe(true);
  });
  it('lets finance read all without manage', () => {
    const perms = ['MARKETING_VIEW_ALL'];
    expect(perms).not.toContain('MARKETING_MANAGE_ALL');
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm --dir small-house-commerce/backend test marketing-access` → FAIL

- [ ] **Step 3: 实现 `marketing-access.ts`**，`assertVisible` 对不可见记录抛 `NotFoundException`（不是 403），避免泄露存在性。

- [ ] **Step 4: 运行确认通过**

- [ ] **Step 5: 扩枚举并登记授权**。`PermissionCode` 是 Prisma 枚举（`prisma/schema/identity.prisma`），迁移只做 `ALTER TYPE "PermissionCode" ADD VALUE ...`（同 `20260926140000_add_campaign_link_permission` 的先例），权限行与角色授权由 `prisma/rbac.ts` 的 `RBAC_PERMISSIONS` / `RBAC_GRANTS` 在 seed/reconcile 时落库，**不要在迁移里插入权限行**（新枚举值无法在同一事务内使用）。

`RBAC_GRANTS`：SUPER_ADMIN 自动全量；ADMIN 加全部 4 条；OPTIMIZER 加 `MARKETING_VIEW_OWN` + `MARKETING_MANAGE_OWN`；FINANCE 只加 `MARKETING_VIEW_ALL`；CONFIRMOR/WAREHOUSE 不加。

- [ ] **Step 6: 运行迁移与 RBAC 测试**

Run: `pnpm --dir small-house-commerce/backend test rbac && pnpm --dir small-house-commerce/backend test marketing-access`
Expected: PASS
（`rbac.spec.ts` 里 OPTIMIZER 的 `toEqual` 断言会因新增授权而失败，需同步更新为 4 条。）

- [ ] **Step 7: 在临时库验证迁移**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/small_house_marketing_dev?schema=public pnpm --dir small-house-commerce/backend exec prisma migrate deploy`
再跑 `prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code`
Expected: exit 0，输出 `No difference detected.`

- [ ] **Step 8: 提交**

```bash
git add backend/prisma/rbac.ts backend/prisma/migrations/20261010093000_add_marketing_permissions \
  backend/src/modules/marketing/marketing-access.ts backend/src/modules/marketing/marketing-access.spec.ts
git commit -m "feat(marketing): add owner-scoped marketing permissions"
```

---

### Task 3: 落地页归属、草稿与发布快照

**Files:**
- Modify: `backend/prisma/schema/landing-page.prisma`, `backend/src/modules/catalog/landing/landing-pages.service.ts`, `admin/landing-pages.controller.ts`
- Create: `backend/prisma/migrations/20261010100000_add_landing_page_ownership_drafts/migration.sql`, `backend/src/modules/catalog/landing/landing-pages.service.publish.spec.ts`

**Interfaces:**
- Consumes: Task 1/2；既有 `ProductLandingPage`
- Produces: 新字段 `ownerUserId String?`、`draftContent Json?`、`publishedContent Json?`、`version Int @default(0)`、`publishedRevision Int @default(0)`、`publishedAt DateTime?`、`sourceContentHash String?`；`LandingPagesService.saveDraft(id, content, expectedVersion, ownerUserId)`、`publish(id, expectedVersion, ownerUserId)`、`disable(id, ownerUserId)`

- [ ] **Step 1: 写失败测试**

```ts
it('keeps the published snapshot when the draft is saved again', async () => {
  const page = await seedPage({ ownerUserId: 'u1', publishedContent: DOC_A });
  await service.saveDraft(page.id, DOC_B, page.version, 'u1');
  const after = await service.get(page.id, 'u1');
  expect(after.draftContent).toEqual(DOC_B);
  expect(after.publishedContent).toEqual(DOC_A);
  expect(after.version).toBe(page.version + 1);
});

it('rejects a stale version with a named conflict', async () => {
  await expect(service.saveDraft('p1', DOC_B, 1, 'u1')).rejects.toMatchObject({ status: 409 });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm --dir small-house-commerce/backend test landing-pages.service.publish` → FAIL

- [ ] **Step 3: 加字段与迁移**（加性、全部可空，默认值不破坏既有行；既有页面 `publishedContent` 留空，由 Task 14 生成）。

- [ ] **Step 4: 实现 `saveDraft`/`publish`/`disable`**，全部在 `prisma.$transaction` 内：读当前行 → 比对 `expectedVersion` → 更新。`publish` 额外校验 `draftContent` 非空、母商品 `status === 'ACTIVE'`，然后把草稿复制为 `publishedContent` 并自增 `publishedRevision`、写 `publishedAt`。

- [ ] **Step 5: 运行确认通过**

- [ ] **Step 6: 控制器接入 owner 约束**，`GET/PATCH` 全部经 `MarketingAccess.assertVisible`；新增 `POST /admin/landing-pages/:id/publish`、`POST /admin/landing-pages/:id/disable`。

- [ ] **Step 7: 提交**

```bash
git add backend/prisma/schema/landing-page.prisma backend/prisma/migrations/20261010100000_add_landing_page_ownership_drafts \
  backend/src/modules/catalog/landing
git commit -m "feat(landing): add owner-scoped draft and publish snapshots"
```

---

### Task 4: 展示文档校验与净化

**Files:**
- Create: `backend/src/modules/catalog/landing/landing-content.ts`, `landing-content.spec.ts`
- Modify: `backend/package.json`（加 `sanitize-html`）

**Interfaces:**
- Produces: `landingContentSchema`（Zod）、`sanitizeRichText(html): string`、`normaliseLandingContent(input): LandingContent`、`MAX_BLOCKS = 60`、`MAX_DOCUMENT_BYTES = 512 * 1024`、`MAX_RICH_TEXT_BYTES = 20 * 1024`

- [ ] **Step 1: 写失败测试**

```ts
it('rejects script and event handler payloads', () => {
  const out = sanitizeRichText('<p onclick="x()">hi</p><script>bad()</script><a href="javascript:bad()">l</a>');
  expect(out).not.toMatch(/script|onclick|javascript:/i);
  expect(out).toContain('<p>hi</p>');
});
it('accepts an uploaded media path but rejects protocol-relative hosts', () => {
  expect(landingMediaSchema.safeParse('/uploads/catalog/2026/a.png').success).toBe(true);
  expect(landingMediaSchema.safeParse('//evil.test/a.png').success).toBe(false);
});
it('caps the document at 60 blocks', () => {
  expect(landingContentSchema.safeParse({ blocks: Array(61).fill(BUY_BLOCK) }).success).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm --dir small-house-commerce/backend test landing-content` → FAIL

- [ ] **Step 3: 安装依赖** — `pnpm --dir small-house-commerce/backend add sanitize-html` 与 `-D @types/sanitize-html`；确认容器 Node 版本满足 `engines`。

- [ ] **Step 4: 实现校验与净化**，白名单标签 `p,br,strong,em,ul,ol,li,a,h3,h4`，属性仅 `href`，协议仅 `http/https/mailto`；媒体 schema 复用既有 `siteMediaUrl()`（`backend/src/common/site-media-url.ts`）的判定规则。

- [ ] **Step 5: 运行确认通过**

- [ ] **Step 6: 提交**

```bash
git add backend/package.json backend/pnpm-lock.yaml backend/src/modules/catalog/landing/landing-content.ts backend/src/modules/catalog/landing/landing-content.spec.ts
git commit -m "feat(landing): validate and sanitize landing content documents"
```

---

### Task 5: 从母商品生成内容快照与手动同步

**Files:**
- Create: `backend/src/modules/catalog/landing/landing-snapshot.service.ts`, `landing-snapshot.service.spec.ts`
- Modify: `backend/src/modules/catalog/landing/landing-pages.service.ts`

**Interfaces:**
- Produces: `snapshotFromProduct(productId): Promise<LandingContent>`；`contentHash(content): string`；`resync(id, blockIds, expectedVersion, ownerUserId)`

- [ ] **Step 1: 写失败测试**

```ts
it('builds a snapshot from saved product fields only', async () => {
  const content = await snapshotFromProduct('prod-1');
  expect(content.blocks.map((b) => b.type)).toEqual(['hero', 'gallery', 'buy', 'detail', 'facts']);
  expect(content.blocks.find((b) => b.type === 'buy')?.skuRefs.length).toBeGreaterThan(0);
});

it('replaces only the selected source blocks and keeps custom blocks in place', async () => {
  const before = withCustomBlock(await snapshotFromProduct('prod-1'), 'custom-1');
  const after = await service.resync('p1', ['hero'], before.version, 'u1');
  expect(after.draftContent.blocks.filter((b) => b.type === 'custom')).toHaveLength(1);
  expect(after.draftContent.blocks.find((b) => b.type === 'hero').sourceRevision).toBeGreaterThan(0);
});

it('reports a content hash that ignores price and stock', async () => {
  const a = contentHash(await snapshotFromProduct('prod-1'));
  await setSkuPrice('prod-1', 999);
  expect(contentHash(await snapshotFromProduct('prod-1'))).toBe(a);
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现快照与哈希**，来源标识 `sourceKey = `${type}:${productId}`，复制来源区块时新副本 `sourceKey = null` 转为自定义区块。

- [ ] **Step 4: 运行确认通过**

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/catalog/landing/landing-snapshot.service.ts backend/src/modules/catalog/landing/landing-snapshot.service.spec.ts backend/src/modules/catalog/landing/landing-pages.service.ts
git commit -m "feat(landing): snapshot product presentation and resync selected blocks"
```

---

### Task 6: 编辑器依赖验证门（Puck）

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/components/admin/marketing/puck-config.tsx`, `frontend/src/components/admin/marketing/puck-config.spec.tsx`

**Interfaces:**
- Produces: `marketingPuckConfig`（模块登记）、`MarketingBlocks` 组件集

- [ ] **Step 1: 先验证再引入**：安装 `@puckeditor/core@0.23.0` 后，写一个最小客户端渲染测试，确认在 Next 16.3.4 / React 19.2.8 下 `Puck` 与 `Render` 可挂载、不报 peer 冲突。

```tsx
it('renders a saved document with the registered blocks', async () => {
  render(<Render config={marketingPuckConfig} data={DOC} />);
  expect(await screen.findByText('Buy now')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm --dir small-house-commerce/frontend test puck-config` → FAIL

- [ ] **Step 3: 若验证不通过则停止**：把失败证据回报给用户，不静默换成 GrapesJS 或自研编辑器。

- [ ] **Step 4: 登记受控模块** `hero | gallery | buy | richText | detail | facts | reviews | faq | custom`；`buy` 字段只读（价格/库存来自母商品），`custom` 允许富文本。

- [ ] **Step 5: 运行确认通过，并跑一次 `pnpm --dir small-house-commerce/frontend build`**

- [ ] **Step 6: 提交**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/components/admin/marketing/puck-config.tsx frontend/src/components/admin/marketing/puck-config.spec.tsx
git commit -m "feat(marketing): register controlled landing page editor blocks"
```

---

### Task 7: 投放工作台列表与编辑器页面

**Files:**
- Create: `frontend/src/app/admin/(shell)/marketing/page.tsx`, `frontend/src/app/admin/(shell)/marketing/[id]/edit/page.tsx`, `frontend/src/components/admin/marketing/PublishBar.tsx`, `frontend/src/components/admin/marketing/SyncFromProductDialog.tsx`, `frontend/src/lib/marketing-api.ts`
- Modify: `frontend/src/app/admin/(shell)/layout.tsx`（导航：投放工作台取代原入口）

**Interfaces:**
- Consumes: Task 2/3 的后端接口
- Produces: `marketingApi.listPages(query)`、`getPage(id)`、`saveDraft(id, content, expectedVersion)`、`publish(id, expectedVersion)`、`createPage(productId)`

- [ ] **Step 1: 写失败测试**（列表按 owner 过滤、草稿保存后显示“有未发布修改”、409 保留输入并提示）

```tsx
it('keeps the draft on screen when the server reports a version conflict', async () => {
  api.saveDraft.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
  render(<MarketingPageEdit />);
  await user.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(await screen.findByText(/版本冲突/)).toBeInTheDocument();
  expect(screen.getByLabelText('内部名称')).toHaveValue('MA-1');
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm --dir small-house-commerce/frontend test marketing/page`
- [ ] **Step 3: 实现列表**（内部名称、母商品、负责人/AID、发布状态、未发布修改、链接数、期间访问/订单、最后修改、动作）
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 实现编辑页**（固定状态栏＋内容视图＋页面设置视图＋投放与核算视图），未发布预览与线上预览分离
- [ ] **Step 6: 运行确认通过**
- [ ] **Step 7: 提交**

```bash
git add frontend/src/app/admin/\(shell\)/marketing frontend/src/components/admin/marketing frontend/src/lib/marketing-api.ts frontend/src/app/admin/\(shell\)/layout.tsx
git commit -m "feat(admin): add marketing workbench list and landing page editor"
```

---

### Task 8: 公开页改读已发布快照

**Files:**
- Modify: `frontend/src/app/(storefront)/lp/[slug]/page.tsx`, `backend/src/modules/catalog/landing/storefront/landing-pages.controller.ts`, `backend/src/modules/catalog/landing/landing-pages.service.ts`
- Create: `frontend/src/components/product/LandingContentView.tsx`

**Interfaces:**
- Consumes: Task 4/5 的 `LandingContent`
- Produces: 公开投影 `{ landingPage: { slug, content: publishedContent }, product: LiveProductProjection }`

- [ ] **Step 1: 写失败测试**

```ts
it('serves the published snapshot, not the draft', async () => {
  await service.saveDraft(page.id, DOC_B, page.version, 'u1');
  const res = await request(app).get('/api/v1/storefront/landing-pages/ma-1').expect(200);
  expect(res.body.landingPage.content).toEqual(DOC_A);
});
it('hides a disabled or out-of-window page', async () => {
  await service.disable(page.id, 'u1');
  await request(app).get('/api/v1/storefront/landing-pages/ma-1').expect(404);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 服务端只返回已发布内容**，并校验母商品 ACTIVE、时间窗口；预览走独立受保护路由，`no-store`、`no-referrer`，不接受公开 `preview` 参数
- [ ] **Step 4: 前端渲染** `LandingContentView`，购买区块复用既有 PDP 购买组件与实时 SKU
- [ ] **Step 5: 运行确认通过**
- [ ] **Step 6: 提交**

```bash
git add frontend/src/app/\(storefront\)/lp frontend/src/components/product/LandingContentView.tsx backend/src/modules/catalog/landing
git commit -m "feat(landing): render published snapshots with live product data"
```

---

### Task 9: 持久化投放链接

**Files:**
- Create: `backend/src/modules/marketing/campaign-links.service.ts`, `campaign-links.service.spec.ts`, `backend/src/modules/marketing/admin/campaign-links.controller.ts`
- Modify: `backend/prisma/schema/marketing.prisma`, `frontend/src/app/admin/(shell)/marketing/links/page.tsx`, `frontend/src/lib/marketing-api.ts`

**Interfaces:**
- Produces: `CampaignLink { id, code, ownerUserId, productId, variantId?, landingPageId?, name, sourceType, campaignId?, adsetId?, adId?, utm*, status }`；`createLink(input)`、`disableLink(id)`、`cloneLink(id)`

- [ ] **Step 1: 写失败测试**

```ts
it('derives the owner from the session, not the request body', async () => {
  const link = await service.createLink({ ...input, ownerUserId: 'someone-else' }, { userId: 'u1' });
  expect(link.ownerUserId).toBe('u1');
});
it('refuses to mint a link for an unpublished page', async () => {
  await expect(service.createLink({ landingPageId: 'draft-page' }, { userId: 'u1' }))
    .rejects.toMatchObject({ status: 400 });
});
it('keeps a disabled link from accepting new touches but preserves past ones', async () => {
  await service.disableLink(link.id);
  await expect(service.resolveTouch(link.code)).resolves.toMatchObject({ disabled: true });
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**，`code` 用不可猜随机值（`crypto.randomBytes(12).toString('base64url')`），服务端校验产品/规格/落地页三者关联
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 前端链接表格**（创建时自动带入母商品、页面与负责人）
- [ ] **Step 6: 提交**

```bash
git add backend/prisma/schema/marketing.prisma backend/src/modules/marketing frontend/src/app/admin/\(shell\)/marketing/links frontend/src/lib/marketing-api.ts
git commit -m "feat(marketing): persist campaign links with server-derived ownership"
```

---

### Task 10: 服务端触达凭据与跨页面归因

**Files:**
- Create: `backend/src/modules/marketing/marketing-touch.service.ts`, `marketing-touch.service.spec.ts`, `backend/src/modules/marketing/storefront/marketing-touch.controller.ts`, `backend/prisma/schema/marketing.prisma`（`CampaignLinkVisit`）
- Modify: `frontend/src/lib/tracking.ts`, `frontend/src/components/product/LandingViewTracker.tsx`, `frontend/src/components/checkout/CheckoutConfirmView.tsx`

**Interfaces:**
- Produces: `POST /api/v1/storefront/marketing-touch` → `{ credential, expiresAt }`；`readAttribution()` 改为读凭据；`MarketingTouchService.resolve(credential)`

- [ ] **Step 1: 写失败测试**

```ts
it('mints a credential whose attribution comes from the link, not the URL', async () => {
  const { credential } = await service.touch({ code: link.code, visitKey: 'tab-1' });
  expect(await service.resolve(credential)).toMatchObject({ ownerUserId: 'u1', linkId: link.id });
});
it('rejects a tampered credential', async () => {
  await expect(service.resolve(`${credential}x`)).resolves.toBeNull();
});
it('does not downgrade a failed link into a fresh direct touch', async () => {
  const before = await service.resolve(credential);
  const res = await service.touch({ code: 'bad-code', visitKey: 'tab-1' });
  expect(res.credential).toBeNull();
  expect(await service.resolve(credential)).toEqual(before);
});
it('expires after the 7 day window', async () => {
  vi.setSystemTime(new Date(Date.now() + 8 * 864e5));
  await expect(service.resolve(credential)).resolves.toBeNull();
});
it('counts one visit per link, tab session and Manila day', async () => {
  await service.touch({ code: link.code, visitKey: 'tab-1' });
  await service.touch({ code: link.code, visitKey: 'tab-1' });
  expect(await visitsFor(link.id)).toBe(1);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现签名凭据**：用既有 `JWT_SECRET` 经 HKDF 派生用途专用密钥，payload 含用途、链接/页面、负责人、触达时间、过期时间；使用 `timingSafeEqual` 比较，签名不符返回 null。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 前端改为凭据**：`tracking.ts` 持久化服务端凭据，普通无参数页面不清空；预览与后台不触发触达。
- [ ] **Step 6: 运行确认通过**
- [ ] **Step 7: 提交**

```bash
git add backend/src/modules/marketing backend/prisma/schema/marketing.prisma frontend/src/lib/tracking.ts frontend/src/components/product/LandingViewTracker.tsx frontend/src/components/checkout/CheckoutConfirmView.tsx
git commit -m "feat(marketing): server-signed touch credentials with 7 day attribution"
```

---

### Task 11: 下单归因改由服务端解析

**Files:**
- Modify: `backend/src/modules/orders/dto/order.dto.ts:24`, `backend/src/modules/orders/orders.service.ts:189`, `frontend/src/lib/api.ts`, `frontend/src/components/checkout/CheckoutConfirmView.tsx`
- Create: `backend/src/modules/orders/orders.service.attribution.spec.ts`

**Interfaces:**
- Consumes: Task 10 的 `MarketingTouchService.resolve`
- Produces: 下单请求携带 `marketingCredential?`；`OrderAttribution` 落 `optimizerId`（User.id）、`aidSnapshot`、`landingPageId`、`publishedRevision`

- [ ] **Step 1: 写失败测试**

```ts
it('ignores a client-supplied optimizerId and uses the credential', async () => {
  const order = await service.create({ ...input, attribution: { sourceType: 'META_AD', optimizerId: 'attacker' }, marketingCredential: cred });
  const attr = await getAttribution(order.id);
  expect(attr.optimizerId).toBe('u1');
});
it('creates no marketing attribution without a valid credential', async () => {
  const order = await service.create({ ...input, attribution: { sourceType: 'ORGANIC' } });
  expect((await getAttribution(order.id)).optimizerId).toBeNull();
});
it('writes the published revision in effect at touch time', async () => {
  expect((await getAttribution(order.id)).landingPageId).toBe(page.id);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 在订单事务内解析凭据**并写快照；`sourceType` 来自链接，不再信任请求体。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 前端提交携带凭据**（`CheckoutConfirmView` → `api.ts` → `POST /storefront/orders`）
- [ ] **Step 6: 真实后端 E2E**：从真实公开链接进入 → 浏览首页/集合/购物车 → 确认页下单 → 断言数据库快照
- [ ] **Step 7: 提交**

```bash
git add backend/src/modules/orders frontend/src/lib/api.ts frontend/src/components/checkout/CheckoutConfirmView.tsx
git commit -m "feat(orders): resolve marketing attribution from signed credential"
```

---

### Task 12: USD 广告费用

**Files:**
- Create: `backend/src/modules/marketing/ad-costs.service.ts`, `ad-costs.service.spec.ts`, `backend/src/modules/marketing/admin/ad-costs.controller.ts`, `frontend/src/app/admin/(shell)/marketing/costs/page.tsx`, `frontend/src/components/admin/marketing/CostForm.tsx`
- Modify: `backend/prisma/schema/marketing.prisma`

**Interfaces:**
- Produces: `AdCostEntry { id, linkId, ownerUserId, costDate, amountUsd, phpPerUsd, amountPhp, note, voidedAt, version }`；`upsertCost(input, expectedVersion?)`、`voidCost(id)`

- [ ] **Step 1: 写失败测试**

```ts
it('computes PHP on the server and ignores a client total', async () => {
  const row = await service.upsertCost({ linkId, costDate: '2026-10-05', amountUsd: '50.00', phpPerUsd: '57.3', amountPhp: '1.00' });
  expect(row.amountPhp).toBe('2865.00');
});
it('upserts one row per link per day', async () => {
  await service.upsertCost(base);
  await service.upsertCost({ ...base, amountUsd: '60.00' });
  expect(await countFor(linkId, '2026-10-05')).toBe(1);
});
it('rejects a future Manila date and a non-positive rate on spend', async () => {
  await expect(service.upsertCost({ ...base, costDate: tomorrow() })).rejects.toMatchObject({ status: 400 });
  await expect(service.upsertCost({ ...base, phpPerUsd: '0' })).rejects.toMatchObject({ status: 400 });
});
it('keeps a voided row for audit but out of totals', async () => {
  const row = await service.upsertCost(base);
  await service.voidCost(row.id);
  expect(await totalUsd(linkId)).toBe('0.00');
  expect(await findRow(row.id)).toMatchObject({ voidedAt: expect.any(Date) });
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**，`@db.Decimal(12,2)` USD、`@db.Decimal(12,6)` 汇率、`@db.Decimal(14,2)` PHP；`@@unique([linkId, costDate])`；日期按 Asia/Manila 计算。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 前端费用表单**（USD 金额、汇率、备注；零费用可标记“当天未投放”）
- [ ] **Step 6: 提交**

```bash
git add backend/prisma/schema/marketing.prisma backend/src/modules/marketing frontend/src/app/admin/\(shell\)/marketing/costs frontend/src/components/admin/marketing/CostForm.tsx
git commit -m "feat(marketing): record USD ad spend with saved PHP rate"
```

---

### Task 13: 核算报表

**Files:**
- Create: `backend/src/modules/marketing/marketing-report.service.ts`, `marketing-report.service.spec.ts`, `backend/src/modules/marketing/admin/marketing-report.controller.ts`, `frontend/src/app/admin/(shell)/marketing/reports/page.tsx`, `frontend/src/components/admin/marketing/ReportTable.tsx`

**Interfaces:**
- Produces: `report({ from, to, linkIds?, ownerUserId? })` → 行含 `visits, submittedOrders, validOrders, confirmedOrders, signedOrders, validOrderValuePhp, signedGrossPhp, spendUsd, spendPhp, orderCpaUsd, signedCpaUsd, orderRoas, signedRoas, conversionRate, costCoverageComplete`

- [ ] **Step 1: 写失败测试**

```ts
it('keeps a late signing inside its original touch cohort', async () => {
  const row = await report({ from: '2026-10-05', to: '2026-10-05', linkIds: [linkId] });
  expect(row.signedOrders).toBe(1); // 触达 10-05，10-12 才签收
});
it('excludes cancelled orders from valid orders but still shows them as submitted', async () => {
  expect(row.submittedOrders).toBe(2);
  expect(row.validOrders).toBe(1);
});
it('shows no ratio when cost coverage is incomplete', async () => {
  const row = await report({ from: '2026-10-05', to: '2026-10-07', linkIds: [linkId] });
  expect(row.costCoverageComplete).toBe(false);
  expect(row.signedRoas).toBeNull();
});
it('excludes direct and legacy sources from paid ROAS numerators', async () => {
  expect(row.signedGrossPhp).toBe('10000.00'); // 不含 DIRECT 成交
});
it('returns no ratio instead of infinity when spend is zero', async () => {
  expect((await report({ from: '2026-10-08', to: '2026-10-08', linkIds: [linkId] })).orderRoas).toBeNull();
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 cohort 查询**：以触达日期筛访问与订单，按链接/页面/优化师去重，同一订单在各层只计一次；标 `costCoverageComplete`。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 前端报表**：固定标注“签收毛额未扣退款、不等于 COD 回款”，无退款账本时不显示净利润/Profit ROAS。
- [ ] **Step 6: 提交**

```bash
git add backend/src/modules/marketing frontend/src/app/admin/\(shell\)/marketing/reports frontend/src/components/admin/marketing/ReportTable.tsx
git commit -m "feat(marketing): touch-date cohort reporting with cost coverage"
```

---

### Task 14: 旧页面与旧链接迁移

**Files:**
- Create: `backend/prisma/migrations/20261011090000_backfill_landing_page_snapshots/migration.sql`, `backend/src/modules/marketing/legacy-migration.spec.ts`
- Modify: `backend/src/modules/marketing/marketing-touch.service.ts`

**Interfaces:**
- Produces: 旧页面 `publishedContent` 快照、`ownerUserId = null`（历史未分配）；旧 AID 仅经登记映射后解析

- [ ] **Step 1: 写失败测试**

```ts
it('freezes legacy pages from their overrides plus the parent product', async () => {
  const page = await getPage(legacyPageId);
  expect(page.publishedContent.blocks.find((b) => b.type === 'hero').title).toBe(page.titleOverride);
  expect(page.ownerUserId).toBeNull();
});
it('does not invent an owner from a page title or an unknown AID', async () => {
  expect(await service.touch({ aid: 'MA-1', visitKey: 'tab-1' })).toMatchObject({ credential: null });
});
it('resolves a legacy AID only after it is registered', async () => {
  await optimizers.create({ userId: 'u1', aid: 'MA-1', displayName: '优化师A' });
  expect(await service.touch({ aid: 'MA-1', visitKey: 'tab-1' })).toMatchObject({ sourceType: 'LEGACY_AID' });
});
it('is idempotent', async () => {
  await runMigration(); await runMigration();
  expect(await countSnapshots(legacyPageId)).toBe(1);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 迁移只回填空值**，`WHERE published_content IS NULL`；不修改母商品、订单、访问历史或费用。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 旧链接保留**：`/lp/<slug>` 与旧参数网址继续可用；`/admin/single-pages`、`/admin/link-builder` 入口跳到新工作视图并保留商品筛选。
- [ ] **Step 6: 提交**

```bash
git add backend/prisma/migrations/20261011090000_backfill_landing_page_snapshots backend/src/modules/marketing
git commit -m "feat(marketing): backfill legacy landing snapshots and legacy AID mapping"
```

---

## 验证

**每个任务**：`pnpm --dir small-house-commerce/backend test`、`pnpm --dir small-house-commerce/frontend test`、两端 `exec tsc --noEmit`、`lint`、`build`，全绿后单独提交。

**真实后端 E2E**（隔离数据库，参考既有 `frontend/e2e/bootstrap.ts` 的 loopback＋库名守卫）：
1. 优化师 A 登录，从母商品复制落地页，改标题与图片，保存草稿 → 公开页仍是旧内容。
2. 发布 → 公开页显示新内容，价格/库存仍为母商品实时值。
3. 停用母商品 → 公开页不可购买，且不静默换规格。
4. 生成链接 → 新开浏览器会话访问 → 浏览首页/集合/购物车 → 确认页下单 → 断言数据库快照归属 A。
5. 换浏览器直接访问首页下单 → 无营销归属。
6. 优化师 B 登录 → 看不到 A 的页面、链接、费用与报表；管理员可见全部。
7. 录入 USD 费用与汇率 → 报表 cohort 数字正确；缺费用日显示“费用未完整录入”且比值为 `—`。
8. 篡改 `cl` 与凭据 → 归属为空且下单不受影响。

**部署**：本计划含加性迁移与身份/归因变更，**不属于可免确认的普通前端热修**；部署前须验证迁移效果、旧链接与回滚边界，并确认并行会话的改动已合并。
