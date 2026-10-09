# 商品 FAQ 管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把目前写死在 PDP 里的配送/退货/FAQ 内容变成可配置数据，支持一份全品共享问题库加每个商品的专属问题，并在母商品详情页与关联落地页一致呈现。

**Architecture:** 后端新增两个数据边界——全品共享单例 `SharedFaqSet` 与商品一对一 `ProductFaq`；解析只有一份纯函数，商品保存与 FAQ 更新在同一事务内完成并带乐观锁；前台由 `PdpInfoSections` 改为数据驱动，空内容隐藏整块并同步隐藏导航项。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Zod、Next.js 16 App Router、React 19、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-09-product-faq-design.md`

## Global Constraints

- FAQ 属于商品上架与商品编辑，不得放进投放工作台或优化师落地页编辑器。
- 三种模式：`SHARED`（共享）、`EXTEND`（共享＋专属）、`CUSTOM`（仅专属）；切换模式不删除另一种模式的已保存内容。
- 缺失 `ProductFaq` 行一律解析为 `SHARED`，不能解释为隐藏。
- 编辑商品专属 FAQ 沿用 `PRODUCT_MANAGE`；修改全品共享 FAQ 需新的 `PRODUCT_FAQ_SHARED_MANAGE`（默认 SUPER_ADMIN/ADMIN）。
- 回答为受控结构化内容（段落/列表/链接），不接受可执行 HTML、脚本、iframe、任意 CSS。
- 标题最多 200 字符；单个回答最多 8,000 字符；共享与专属各最多 30 条。
- 顾客可见内容为英文；后台控件中英双语。
- 保留 `#shipping-faq` 锚点与原生 `<details>/<summary>` 折叠交互。
- 迁移为加性、幂等，只在单例不存在时写入默认内容，不覆盖后台已编辑内容。
- 不新增未批准依赖；不修改商品库存、SKU、图片、订单或评论数据。
- **并行冲突**：`ProductForm.tsx` 与 `i18n/*.ts` 正被另一会话的“商品工作台”改造占用，Task 8 必须在该改造合并后再做，其余任务不得改动这两个文件。

## Review Focus

- **模式切换**：SHARED ↔ CUSTOM 往返后，被隐藏那一侧的内容必须仍在，不能被清空。
- **共享内容为空**：全部共享条目停用或删除后，使用 SHARED 的商品不能出现空卡片或失效锚点。
- **部分填写的新条目**：只填标题或只填回答就保存，必须报错并定位，不能静默丢弃或写入半条数据。
- **恶意与超长输入**：脚本、事件属性、`javascript:` 链接、超长标题/回答必须被后端拒绝或净化。
- **并发保存**：两个人同时保存共享 FAQ 或同一商品，后提交者不能静默覆盖前者。

---

## 文件结构

**后端（新增）**
- `backend/prisma/schema/faq.prisma` — `SharedFaqSet`、`ProductFaq`
- `backend/src/modules/catalog/faq/` — `faq.module.ts`、`faq-content.ts`（Zod 与净化）、`faq-resolver.ts`（唯一解析纯函数）、`shared-faq.service.ts`、`product-faq.service.ts`、`admin/shared-faq.controller.ts`
- `backend/src/modules/catalog/faq/*.spec.ts`

**后端（修改）**
- `backend/src/modules/catalog/catalog.service.ts`（或商品创建/更新所在服务）— 商品保存事务内并入 FAQ 更新
- `backend/src/modules/catalog/dto/*` — 商品写 DTO 增加 `faq` 段
- `backend/src/modules/catalog/storefront/products.controller.ts` — 公开投影增加 `effectiveFaq`
- `backend/prisma/rbac.ts` + 权限迁移

**前端（新增）**
- `frontend/src/components/product/ProductFaqSection.tsx` — 前台渲染（替代 `PdpInfoSections` 中的写死内容）
- `frontend/src/components/admin/product-form/ProductFaqPanel.tsx` — 商品编辑区内的 FAQ 面板
- `frontend/src/app/admin/(shell)/faq/page.tsx` — 共享 FAQ 管理页
- `frontend/src/lib/faq-api.ts`

**前端（修改，Task 8 之前不动）**
- `frontend/src/components/admin/ProductForm.tsx` — 挂载 FAQ 面板
- `frontend/src/i18n/zh.ts`、`frontend/src/i18n/en.ts` — FAQ 文案
- `frontend/src/components/product/PdpInfoSections.tsx` — 改为数据驱动
- `frontend/src/components/product/PdpSectionNav.tsx` — 空内容隐藏导航项

---

### Task 1: FAQ 数据结构与迁移

**Files:**
- Create: `backend/prisma/schema/faq.prisma`, `backend/prisma/migrations/20261012090000_add_product_faq/migration.sql`
- Modify: `backend/prisma/schema/catalog.prisma`（`Product` 加反向关系）
- Test: `backend/src/modules/catalog/faq/faq-schema.spec.ts`

**Interfaces:**
- Produces: `SharedFaqSet { id, items Json, version Int, updatedByUserId String?, updatedAt }`、`ProductFaq { productId @unique, mode FaqMode, items Json, version Int, updatedAt }`、`enum FaqMode { SHARED, EXTEND, CUSTOM }`

- [ ] **Step 1: 写失败测试**

```ts
// backend/src/modules/catalog/faq/faq-schema.spec.ts
import { describe, expect, it } from 'vitest';
import { FAQ_MODES } from './faq-content';

describe('faq data boundary', () => {
  it('exposes exactly the three agreed modes', () => {
    expect(FAQ_MODES).toEqual(['SHARED', 'EXTEND', 'CUSTOM']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --dir small-house-commerce/backend test faq-schema`
Expected: FAIL —— 找不到模块 `./faq-content`

- [ ] **Step 3: 建模型与迁移**

```prisma
// backend/prisma/schema/faq.prisma
enum FaqMode {
  SHARED
  EXTEND
  CUSTOM
}

model SharedFaqSet {
  id              String   @id @default(uuid(7)) @db.Uuid
  items           Json
  version         Int      @default(0)
  updatedByUserId String?  @map("updated_by_user_id") @db.Uuid
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("shared_faq_sets")
}

model ProductFaq {
  productId String   @id @map("product_id") @db.Uuid
  mode      FaqMode  @default(SHARED)
  items     Json     @default("[]")
  version   Int      @default(0)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@map("product_faqs")
}
```

- [ ] **Step 4: 运行确认通过并提交**

Run: `pnpm --dir small-house-commerce/backend test faq-schema && pnpm --dir small-house-commerce/backend exec prisma generate`
Expected: PASS

```bash
git add backend/prisma/schema/faq.prisma backend/prisma/schema/catalog.prisma \
  backend/prisma/migrations/20261012090000_add_product_faq backend/src/modules/catalog/faq/faq-schema.spec.ts
git commit -m "feat(faq): add shared and per-product faq tables"
```

---

### Task 2: 内容校验、净化与解析

**Files:**
- Create: `backend/src/modules/catalog/faq/faq-content.ts`, `faq-content.spec.ts`, `backend/src/modules/catalog/faq/faq-resolver.ts`, `faq-resolver.spec.ts`

**Interfaces:**
- Produces: `FAQ_MODES`、`MAX_FAQ_ITEMS = 30`、`faqItemsSchema`、`sanitizeFaqAnswer(html): string`、`resolveEffectiveFaq({ mode, productItems, sharedItems, contact }): EffectiveFaqItem[]`、`FaqContact { supportEmail, supportHours }`

- [ ] **Step 1: 写失败测试**

```ts
// faq-resolver.spec.ts
const shared = [
  { id: 's1', title: 'How does COD work?', answerHtml: '<p>Pay the rider.</p>', enabled: true, position: 0, defaultOpen: true },
  { id: 's2', title: 'Returns', answerHtml: '<p>48 hours.</p>', enabled: false, position: 1, defaultOpen: false },
];
const own = [
  { id: 'p1', title: 'Does it fit a 60cm gap?', answerHtml: '<p>Yes.</p>', enabled: true, position: 0, defaultOpen: false },
];

it('SHARED returns only enabled shared items', () => {
  expect(resolveEffectiveFaq({ mode: 'SHARED', productItems: own, sharedItems: shared, contact })
    .map((i) => i.id)).toEqual(['s1']);
});
it('EXTEND puts shared first then the product items', () => {
  expect(resolveEffectiveFaq({ mode: 'EXTEND', productItems: own, sharedItems: shared, contact })
    .map((i) => i.id)).toEqual(['s1', 'p1']);
});
it('CUSTOM ignores shared entirely and may be empty', () => {
  expect(resolveEffectiveFaq({ mode: 'CUSTOM', productItems: [], sharedItems: shared, contact })).toEqual([]);
});
it('treats a missing row as SHARED', () => {
  expect(resolveEffectiveFaq({ mode: undefined, productItems: [], sharedItems: shared, contact })
    .map((i) => i.id)).toEqual(['s1']);
});
it('resolves the support email placeholder from settings', () => {
  const out = resolveEffectiveFaq({ mode: 'SHARED', productItems: [], contact,
    sharedItems: [{ id: 's3', title: 'Contact', answerHtml: '<p>Email {{supportEmail}}</p>', enabled: true, position: 0, defaultOpen: false }] });
  expect(out[0].answerHtml).toContain('support@luwag.ph');
});
```

```ts
// faq-content.spec.ts
it('strips scripts, event handlers and javascript: links', () => {
  const out = sanitizeFaqAnswer('<p onclick="x()">hi</p><script>bad()</script><a href="javascript:bad()">l</a>');
  expect(out).not.toMatch(/script|onclick|javascript:/i);
});
it('rejects a half-filled item', () => {
  expect(faqItemsSchema.safeParse([{ id: 'a', title: 'Only a title', answerHtml: '', enabled: true, position: 0, defaultOpen: false }]).success).toBe(false);
});
it('caps items at 30 and titles at 200 characters', () => {
  expect(faqItemsSchema.safeParse(Array(31).fill(VALID_ITEM)).success).toBe(false);
  expect(faqItemsSchema.safeParse([{ ...VALID_ITEM, title: 'x'.repeat(201) }]).success).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm --dir small-house-commerce/backend test faq-` → FAIL

- [ ] **Step 3: 实现**：复用 Task 4（投放计划）同款 `sanitize-html` 白名单；`{{supportEmail}}` / `{{supportHours}}` 只作为固定字段占位，用文本/链接节点替换，不做任意模板求值。

- [ ] **Step 4: 运行确认通过并提交**

```bash
git add backend/src/modules/catalog/faq
git commit -m "feat(faq): validate, sanitize and resolve faq content"
```

---

### Task 3: 共享 FAQ 服务与权限

**Files:**
- Create: `backend/src/modules/catalog/faq/shared-faq.service.ts`, `shared-faq.service.spec.ts`, `backend/src/modules/catalog/faq/admin/shared-faq.controller.ts`, `backend/prisma/migrations/20261012093000_add_product_faq_permission/migration.sql`
- Modify: `backend/prisma/rbac.ts`

**Interfaces:**
- Produces: `SharedFaqService.get()`、`update(items, expectedVersion, userId)`；`GET/PUT /api/v1/admin/faq/shared`；权限 `PRODUCT_FAQ_SHARED_MANAGE`

- [ ] **Step 1: 写失败测试**

```ts
it('creates the singleton on first read when it does not exist', async () => {
  const set = await service.get();
  expect(set.version).toBe(0);
  expect(set.items).toEqual([]);
});
it('rejects a stale version with a named conflict', async () => {
  await service.update([VALID_ITEM], 0, 'u1');
  await expect(service.update([VALID_ITEM], 0, 'u2')).rejects.toMatchObject({ status: 409 });
});
it('does not let an optimizer edit the shared library', async () => {
  await request(app).put('/api/v1/admin/faq/shared').set(optimizerToken).send({ items: [], expectedVersion: 0 }).expect(403);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现服务与控制器**，写操作在同一事务内比对 `version` 后自增。
- [ ] **Step 4: 扩枚举并登记授权**。`PermissionCode` 是 Prisma 枚举（`prisma/schema/identity.prisma`）；迁移只做 `ALTER TYPE "PermissionCode" ADD VALUE 'PRODUCT_FAQ_SHARED_MANAGE';`，**不要在迁移里插入权限行**（新枚举值无法在同一事务内使用）。权限行与授权由 `prisma/rbac.ts` 的 `RBAC_PERMISSIONS`（约 L8）与 `RBAC_GRANTS`（约 L72）登记，seed/reconcile（`prisma/seed.ts` 约 L89-125，模板 `prisma/reconcile-campaign-link-permission.ts`）落库。只授予 SUPER_ADMIN/ADMIN。

- [ ] **Step 5: 在临时库验证迁移**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/small_house_marketing_dev?schema=public pnpm --dir small-house-commerce/backend exec prisma migrate deploy`
再跑 `prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code`
Expected: exit 0，`No difference detected.`

- [ ] **Step 6: 运行确认通过并提交**

```bash
git add backend/prisma/rbac.ts backend/prisma/migrations/20261012093000_add_product_faq_permission backend/src/modules/catalog/faq
git commit -m "feat(faq): shared faq library with its own permission"
```

---

### Task 4: 商品保存并入 FAQ 更新

**Files:**
- Modify: `backend/src/modules/catalog/products.service.ts`、`backend/src/modules/catalog/dto/product.dto.ts`
- Create: `backend/src/modules/catalog/faq/product-faq.spec.ts`

**已确认的接入点（执行前重新核对行号，文件正被并行会话改动）：**
- `products.service.ts` `create()` 约 L344，事务 L348，`tx.product.create` L355 —— FAQ 写在同一事务内。
- `update()` 约 L420，**有两条事务分支**：标量分支约 L500-509，图分支约 L485 走 `catalogGraph.applyPatchWithProductMutation(id, version, patch, async (tx) => ...)` —— 两条都要写，否则图商品保存时 FAQ 不生效。
- `withTypedGraph()` 约 L335 会把后台返回值换成 `catalogGraph.adminSnapshot`，必须把 FAQ 合并回去，否则后台表单读不到 FAQ。
- DTO：`dto/product.dto.ts` 的 `productBaseSchema` L65、`createProductSchema` L93、`updateProductSchema` L104（partial）。
- 乐观锁模板：`backend/src/modules/cms/homepage-document.service.ts` `saveDraft()` L130-181（先抛具名 ConflictException，再用带条件的 `updateMany`，`count===0` 即冲突）。

**Interfaces:**
- Produces: 商品写 payload 增加 `faq: { mode, items, expectedVersion }`；服务端在既有商品事务内 upsert `ProductFaq`；`catalog.module.ts` 注册 FAQ provider

- [ ] **Step 1: 写失败测试**

```ts
it('writes the product faq in the same transaction as the product', async () => {
  await service.update('prod-1', { name: 'Renamed', faq: { mode: 'CUSTOM', items: own, expectedVersion: 0 } });
  expect((await getFaq('prod-1')).mode).toBe('CUSTOM');
});
it('rolls the faq back when the product update fails', async () => {
  await expect(service.update('prod-1', { slug: 'taken', faq: { mode: 'CUSTOM', items: own, expectedVersion: 0 } }))
    .rejects.toBeDefined();
  expect((await getFaq('prod-1')).mode).toBe('SHARED');
});
it('does not touch faq when the payload omits it', async () => {
  await service.update('prod-1', { name: 'Renamed' });
  expect((await getFaq('prod-1')).version).toBe(0);
});
it('switching mode keeps the other side content', async () => {
  await service.update('prod-1', { faq: { mode: 'CUSTOM', items: own, expectedVersion: 0 } });
  await service.update('prod-1', { faq: { mode: 'SHARED', items: own, expectedVersion: 1 } });
  expect((await getFaq('prod-1')).items).toEqual(own);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**，省略 `faq` 段时不改动 FAQ；提交 `expectedVersion` 冲突返回具名 409。
- [ ] **Step 4: 运行确认通过并提交**

```bash
git add backend/src/modules/catalog
git commit -m "feat(catalog): persist product faq atomically with the product"
```

---

### Task 5: 公开投影与再验证

**Files:**
- Modify: `backend/src/modules/catalog/storefront/products.controller.ts`（约 L33）、`backend/src/modules/catalog/products.service.ts` 的投影常量
- Create: `backend/src/modules/catalog/faq/public-faq.spec.ts`

**已确认的投影常量（执行前重新核对行号）：** `ADMIN_PRODUCT_INCLUDE` 约 L58、`STOREFRONT_SELECT` 约 L76（列表接口，**不要加**，避免拖着整套 FAQ）、`STOREFRONT_PDP_SELECT` 约 L168（PDP，**加这里**）；读取点 `get()` 约 L311、`storefrontGetBySlug()` 约 L1135。

**Interfaces:**
- Produces: 公开 PDP payload 增加 `effectiveFaq: EffectiveFaqItem[]`，不含后台操作者或版本锁；共享 FAQ 与联系设置变更后触发 `revalidateCache([CACHE_TAGS.STOREFRONT])`

- [ ] **Step 1: 写失败测试**

```ts
it('serves only the effective faq and no editor metadata', async () => {
  const res = await request(app).get('/api/v1/storefront/products/mobile-storage-cart').expect(200);
  expect(res.body.product.effectiveFaq.map((i: { id: string }) => i.id)).toEqual(['s1']);
  expect(JSON.stringify(res.body)).not.toMatch(/updatedByUserId|expectedVersion/);
});
it('returns an empty array rather than hiding the field', async () => {
  const res = await request(app).get('/api/v1/storefront/products/no-faq-item').expect(200);
  expect(res.body.product.effectiveFaq).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现投影**，共享 FAQ 与联系设置变更后触发前台再验证。
- [ ] **Step 4: 运行确认通过并提交**

```bash
git add backend/src/modules/catalog
git commit -m "feat(storefront): expose effective product faq"
```

---

### Task 6: 前台数据驱动渲染

**Files:**
- Create: `frontend/src/components/product/ProductFaqSection.tsx`, `ProductFaqSection.spec.tsx`
- Modify: `frontend/src/components/product/PdpInfoSections.tsx`, `frontend/src/components/product/PdpSectionNav.tsx`

**Interfaces:**
- Consumes: Task 5 的 `effectiveFaq`
- Produces: `<ProductFaqSection items={effectiveFaq} />`；`hasFaqContent(items): boolean`

- [ ] **Step 1: 写失败测试**

```tsx
it('renders items in order and keeps the shipping-faq anchor', () => {
  render(<ProductFaqSection items={TWO_ITEMS} />);
  expect(document.querySelector('#shipping-faq')).not.toBeNull();
  expect(screen.getAllByRole('group').map((g) => g.textContent?.[0])).toEqual(['H', 'R']);
});
it('opens only the items marked defaultOpen', () => {
  render(<ProductFaqSection items={TWO_ITEMS} />);
  expect(screen.getByText('How does COD work?').closest('details')).toHaveAttribute('open');
  expect(screen.getByText('Returns').closest('details')).not.toHaveAttribute('open');
});
it('renders nothing when there is no content', () => {
  const { container } = render(<ProductFaqSection items={[]} />);
  expect(container).toBeEmptyDOMElement();
});
it('hides the nav entry when there is no content', () => {
  expect(buildPdpSections({ hasFaq: false }).find((s) => s.href === '#shipping-faq')).toBeUndefined();
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm --dir small-house-commerce/frontend test ProductFaqSection` → FAIL

- [ ] **Step 3: 实现渲染组件**，保留原生 `<details>/<summary>` 与 `Chevron` 交互；从 `PdpInfoSections.tsx` 删除写死的七项内容，改为渲染 `effectiveFaq`；空内容整块不渲染。

- [ ] **Step 4: 运行确认通过并提交**

```bash
git add frontend/src/components/product
git commit -m "feat(pdp): render product faq from data"
```

---

### Task 7: 共享 FAQ 管理页与商品 FAQ 面板

**Files:**
- Create: `frontend/src/app/admin/(shell)/faq/page.tsx`, `frontend/src/components/admin/product-form/ProductFaqPanel.tsx`, `frontend/src/lib/faq-api.ts` 及对应 `*.spec.tsx`

**Interfaces:**
- Consumes: Task 3 的共享接口、Task 4 的商品写 payload
- Produces: `faqApi.getShared()`、`updateShared(items, expectedVersion)`；`<ProductFaqPanel value={faqDraft} onChange={...} contact={...} canEditShared={boolean} />`

- [ ] **Step 1: 写失败测试**

```tsx
it('reorders with buttons as well as drag', async () => {
  render(<ProductFaqPanel value={{ mode: 'CUSTOM', items: TWO_ITEMS }} onChange={onChange} contact={CONTACT} canEditShared />);
  await user.click(screen.getAllByRole('button', { name: '下移' })[0]);
  expect(onChange.mock.calls.at(-1)?.[0].items.map((i) => i.id)).toEqual(['p2', 'p1']);
});
it('warns that a shared edit affects every product before saving', async () => {
  render(<SharedFaqPage />);
  await user.click(screen.getByRole('button', { name: '保存共享 FAQ' }));
  expect(await screen.findByText(/将更新所有使用共享 FAQ 的商品/)).toBeInTheDocument();
});
it('keeps the form and offers a reload on a version conflict', async () => {
  api.updateShared.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
  render(<SharedFaqPage />);
  await user.click(screen.getByRole('button', { name: '保存共享 FAQ' }));
  await user.click(screen.getByRole('button', { name: '确认保存' }));
  expect(await screen.findByRole('button', { name: '重新加载' })).toBeInTheDocument();
});
it('points at the half-filled row instead of dropping it', async () => {
  render(<ProductFaqPanel value={{ mode: 'CUSTOM', items: [HALF_FILLED] }} onChange={onChange} contact={CONTACT} canEditShared />);
  await user.click(screen.getByRole('button', { name: '校验' }));
  expect(await screen.findByText(/请填写回答/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现两个界面**，共享页含“复制共享问题到商品专属”入口；无 `PRODUCT_FAQ_SHARED_MANAGE` 时共享页只读。
- [ ] **Step 4: 运行确认通过并提交**

```bash
git add frontend/src/app/admin/\(shell\)/faq frontend/src/components/admin/product-form/ProductFaqPanel.tsx frontend/src/lib/faq-api.ts
git commit -m "feat(admin): shared faq library page and product faq panel"
```

---

### Task 8: 挂载到商品编辑页（依赖并行会话）

**Files:**
- Modify: `frontend/src/components/admin/ProductForm.tsx`、`frontend/src/i18n/zh.ts`、`frontend/src/i18n/en.ts`

**阻塞条件：** 另一会话的“商品工作台”改造必须先合并；执行前重新读取当时 `ProductForm.tsx` 结构再定位插入点。

- [ ] **Step 1: 确认并行改动已合并**

Run: `git status --short -- frontend/src/components/admin/ProductForm.tsx frontend/src/i18n`
Expected: 无未提交改动；否则停止并回报，不强行插入

- [ ] **Step 2: 写失败测试**

```tsx
it('mounts the faq panel and saves it with the product', async () => {
  render(<ProductForm product={PRODUCT_WITH_FAQ} />);
  await user.click(screen.getByRole('button', { name: 'FAQ 与购买说明' }));
  await user.click(screen.getByRole('button', { name: '保存' }));
  expect(api.updateProduct.mock.calls.at(-1)?.[1].faq.mode).toBe('SHARED');
});
```

- [ ] **Step 3: 运行确认失败**
- [ ] **Step 4: 挂载面板并补 i18n 键**（zh 默认，en 等价文案），保存路径把 `faq` 段并入既有商品保存 payload。
- [ ] **Step 5: 运行确认通过并提交**

```bash
git add frontend/src/components/admin/ProductForm.tsx frontend/src/i18n
git commit -m "feat(admin): mount product faq section in the product editor"
```

---

### Task 9: 初始化默认内容

**Files:**
- Create: `backend/prisma/migrations/20261012100000_seed_shared_faq/migration.sql`
- Test: `backend/src/modules/catalog/faq/seed-shared-faq.spec.ts`

**Interfaces:**
- Produces: 单例 `SharedFaqSet` 初始行，内容为当前写死的七项英文问答

- [ ] **Step 1: 写失败测试**

```ts
it('seeds the current seven answers once', async () => {
  const set = await sharedFaq.get();
  expect(set.items).toHaveLength(7);
  expect(set.items[0]).toMatchObject({ title: 'Delivery & Cash on Delivery', defaultOpen: true });
  expect(set.items[0].answerHtml).toContain('{{supportEmail}}');
});
it('does not overwrite an edited library', async () => {
  await sharedFaq.update([VALID_ITEM], 0, 'u1');
  await runMigration();
  expect((await sharedFaq.get()).items).toHaveLength(1);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 迁移只在单例不存在时插入**，客服邮箱与服务时间写成固定占位符。
- [ ] **Step 4: 运行确认通过并提交**

```bash
git add backend/prisma/migrations/20261012100000_seed_shared_faq backend/src/modules/catalog/faq
git commit -m "feat(faq): seed the shared library from the current pdp copy"
```

---

### Task 10: 端到端验收

**Files:**
- Create: `frontend/e2e/product-faq.spec.ts`

- [ ] **Step 1: 写 E2E**（隔离数据库，沿用 `frontend/e2e/bootstrap.ts` 的 loopback＋库名守卫）
- [ ] **Step 2: 运行**

Run: `pnpm --dir small-house-commerce/frontend e2e product-faq`
Expected: PASS

覆盖场景：
1. 商品编辑页切 SHARED → 保存 → PDP 显示共享问题，`#shipping-faq` 锚点在。
2. 切 CUSTOM → 保存 → PDP 只显示专属问题。
3. 切回 SHARED → 保存 → 专属内容仍在（重新切回 CUSTOM 可见）。
4. 停用全部共享问题 → 使用 SHARED 的商品 PDP 无空卡片、导航无 FAQ 项。
5. 两个商品分别配置专属 FAQ → 互不影响。
6. 修改共享 FAQ → 关联落地页同步更新；CUSTOM 商品不受影响。
7. 只填标题的新条目 → 保存报错并定位，数据库无半条数据。
8. 顾客页面无中文后台文案、无控制台报错；既有商品媒体上传与库存操作无回归。

- [ ] **Step 3: 提交**

```bash
git add frontend/e2e/product-faq.spec.ts
git commit -m "test(faq): verify product faq end to end"
```

---

## 验证

**每个任务**：`pnpm --dir small-house-commerce/backend test`、`pnpm --dir small-house-commerce/frontend test`、两端 `exec tsc --noEmit`、`lint`、`build`，全绿后单独提交。

**部署**：加性迁移，但会冻结旧 PDP 写死文案并新增权限；部署前须确认并行会话改动已合并，且迁移在生产上只执行一次种子。
