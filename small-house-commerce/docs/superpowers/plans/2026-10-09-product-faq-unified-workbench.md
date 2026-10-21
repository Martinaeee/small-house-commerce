# 统一 FAQ 工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有共享 FAQ 与商品专属 FAQ 已可保存的基础上，把两者统一到左侧 `/admin/faq` 工作台，并按“全品共享问题 / 商品”分组展示和编辑。

**Architecture:** 新增只读的商品 FAQ 汇总接口，返回轻量商品身份信息、FAQ 模式、专属条目和版本；写入继续复用现有共享 `PUT` 与商品 `PATCH`，不复制版本锁或事务逻辑。FAQ 页面拆成共享编辑区和商品分组区，商品编辑页保留为同一 `ProductFaq` 数据的快捷入口；左侧导航用任一相关权限显示，页面按权限分别启用两个分组。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Zod、Next.js 16 App Router、React 19、Vitest、Testing Library、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-09-product-faq-design.md`

## Global Constraints

- FAQ 仍属于商品上架与商品编辑，不进入投放工作台或优化师落地页编辑器。
- `SHARED` 只展示共享条目，`EXTEND` 展示共享后商品专属，`CUSTOM` 只展示商品专属；切换模式不能删除隐藏侧的已保存条目。
- 共享 FAQ 写入只使用 `PUT /api/v1/admin/faq/shared`；商品专属 FAQ 写入只使用现有 `PATCH /api/v1/admin/products/:id`，两个按钮不能调用对方接口。
- 共享版本使用 `SharedFaqSet.version`，每个商品使用自己的 `ProductFaq.version`；409 冲突只影响发生冲突的分组。
- 管理工作台读取原始共享/商品配置，不能使用已经合并来源的 storefront `effectiveFaq`。
- 汇总接口只返回 FAQ 工作台所需的商品身份字段和 FAQ 字段，不把图库、款式、SKU、库存带进页面。
- 编辑商品专属 FAQ 继续使用 `PRODUCT_MANAGE`；编辑共享 FAQ 继续使用 `PRODUCT_FAQ_SHARED_MANAGE`。
- 页面和后台控件沿用现有中英国际化；顾客可见 FAQ 内容仍为英文，不引入自动翻译或 HTML。
- 不新增依赖，不改动库存、SKU、媒体、订单、评论和既有 PDP 解析逻辑。
- 本计划不创建 Git commit；只有用户明确要求时才提交改动。

## Review Focus

- **跨入口一致性：** 从统一 FAQ 工作台保存商品专属问题后，商品编辑页重新加载必须得到相同的模式、条目和版本；反向操作同样成立。
- **写入边界：** 共享区的新增/删除/编辑不能改变任何 `ProductFaq`；商品组的操作不能改变 `SharedFaqSet`。
- **多个商品同时展示：** 同页渲染多个商品组不能生成重复 DOM `id`、错误的 `aria-labelledby` 或把一个商品的输入更新到另一个商品。
- **权限组合：** 只有共享权限、只有商品权限、两者都有、两者都没有时，左侧入口、页面分组和保存按钮都符合授权边界。
- **分页与筛选：** 商品 FAQ 分组列表分页或搜索后，保存仍使用真实商品 ID 和当前版本，不能因为数组位置变化写错商品。

---

## 文件结构

**后端新增**

- `backend/src/modules/catalog/faq/admin/product-faq.controller.ts` — `GET /admin/faq/products`，使用 `PRODUCT_MANAGE`。
- `backend/src/modules/catalog/faq/admin/product-faq.controller.spec.ts` — 汇总接口的响应与权限测试。
- `backend/src/modules/catalog/dto/product-faq.dto.ts` — FAQ 工作台的搜索、模式、分页 query schema。

**后端修改**

- `backend/src/modules/catalog/products.service.ts` — 新增 `listFaqProducts(query)`，以单次 FAQ 关系查询返回分组数据，不调用每个商品的完整详情读取。
- `backend/src/modules/catalog/catalog.module.ts` — 注册商品 FAQ 汇总 controller。
- `backend/src/modules/catalog/products.service.faq.spec.ts` — 覆盖商品 FAQ 汇总读取、分页、模式筛选和原始版本保留。

**前端新增**

- `frontend/src/components/admin/SharedFaqEditor.tsx` — 从当前路由页抽出共享 FAQ 编辑状态、保存和冲突反馈。
- `frontend/src/components/admin/ProductFaqGroups.tsx` — 商品搜索、商品分组、分组展开编辑、商品 FAQ 保存和冲突反馈。
- `frontend/src/components/admin/FaqWorkspace.tsx` — 组合共享区与商品分组区，并统一处理无权限状态。
- `frontend/src/components/admin/FaqWorkspace.spec.tsx` — 统一工作台的分组和写入边界测试。

**前端修改**

- `frontend/src/app/admin/(shell)/faq/page.tsx` — 组合共享区和商品分组区，并执行页面级权限分区。
- `frontend/src/components/admin/ProductFaqPanel.tsx` — 增加实例 ID 前缀和隐藏共享链接的受控 props，保持商品编辑页默认行为不变。
- `frontend/src/components/admin/ProductFaqPanel.spec.tsx` — 覆盖多个实例的 DOM ID 隔离和专属新增行为。
- `frontend/src/components/admin/AdminShell.tsx` — FAQ 导航支持共享权限或商品权限任一满足。
- `frontend/src/components/admin/AdminShell.spec.tsx` — 覆盖两种单独权限都能看到 FAQ 入口。
- `frontend/src/lib/admin-api.ts` — 增加商品 FAQ 分组响应类型和 `listFaqProducts`。
- `frontend/src/lib/faq-api.ts` — 增加 FAQ 商品分组读取 wrapper。
- `frontend/src/i18n/en.ts`、`frontend/src/i18n/zh.ts` — 增加工作台标题、分组、搜索、保存、权限和冲突文案。
- `frontend/e2e/product-faq.spec.ts` — 从统一 FAQ 页面验证共享/商品专属的真实 API 边界。

---

### Task 1: 商品 FAQ 汇总读取接口

**Files:**
- Create: `backend/src/modules/catalog/dto/product-faq.dto.ts`
- Create: `backend/src/modules/catalog/faq/admin/product-faq.controller.ts`
- Create: `backend/src/modules/catalog/faq/admin/product-faq.controller.spec.ts`
- Modify: `backend/src/modules/catalog/products.service.ts`
- Modify: `backend/src/modules/catalog/catalog.module.ts`
- Test: `backend/src/modules/catalog/products.service.faq.spec.ts`

**Interfaces:**
- Consumes: 现有 `ProductFaq`、`Product` 关系和 `FaqMode` / `FaqItem` schema。
- Produces: `AdminFaqProductQuery`、`ProductsService.listFaqProducts(query)`、`GET /api/v1/admin/faq/products`。

```ts
// backend/src/modules/catalog/dto/product-faq.dto.ts
export const adminFaqProductQuerySchema = z.object({
  search: z.string().max(255).optional(),
  mode: z.enum(FAQ_MODES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type AdminFaqProductQuery = z.infer<
  typeof adminFaqProductQuerySchema
>;
```

- [ ] **Step 1: 写失败测试**

```ts
it('returns product groups with raw faq mode, items, and version', async () => {
  const result = await service.listFaqProducts({ page: 1, pageSize: 20 });

  expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1 });
  expect(result.items[0]).toMatchObject({
    product: {
      id: 'product-1',
      name: 'Narrow Storage Cart',
      slug: 'narrow-storage-cart',
      status: 'ACTIVE',
    },
    faq: {
      mode: 'EXTEND',
      version: 2,
      items: [{ id: 'product-faq-1', title: 'Does it fit?' }],
    },
  });
});

it('applies search, mode, and pagination without loading full product details', async () => {
  const result = await service.listFaqProducts({
    search: 'narrow',
    mode: 'CUSTOM',
    page: 2,
    pageSize: 1,
  });

  expect(result.items).toHaveLength(1);
  expect(result.page).toBe(2);
  expect(prisma.product.findUnique).not.toHaveBeenCalled();
});
```

```ts
it('requires PRODUCT_MANAGE for the product FAQ overview', async () => {
  await request(app)
    .get('/api/v1/admin/faq/products')
    .set(optimizerToken)
    .expect(403);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/modules/catalog/products.service.faq.spec.ts src/modules/catalog/faq/admin/product-faq.controller.spec.ts`

Expected: FAIL because `listFaqProducts` and the controller route do not exist.

- [ ] **Step 3: 实现最小读取链路**

在 `ProductsService` 增加 `listFaqProducts(query)`：

1. 查询 `productFaq` 关系并只 select `product.id/name/slug/status` 与 `mode/items/version`。
2. 默认只保留有专属条目或 mode 为 `EXTEND` / `CUSTOM` 的已配置行；不要为没有 `ProductFaq` 行的商品生成空分组。
3. 对商品 name/slug 应用 `search`，对 FAQ mode 应用 `mode`，按商品 name 再按 ID 稳定排序。
4. 在同一查询条件下返回 `items`、`total`、`page`、`pageSize`。
5. 不调用 `get()`、`withTypedGraph()`、`withStock()` 或完整 `ADMIN_PRODUCT_INCLUDE`，防止 FAQ 页面产生 N+1 和大响应。

新增 controller：

```ts
@Controller('admin/faq/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminProductFaqController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(adminFaqProductQuerySchema))
    query: AdminFaqProductQuery,
  ) {
    return this.products.listFaqProducts(query);
  }
}
```

在 `CatalogModule.controllers` 注册 `AdminProductFaqController`；不新增写入 controller，商品写入继续走现有 `AdminProductsController`。

- [ ] **Step 4: 运行接口与服务测试**

Run: `pnpm exec vitest run src/modules/catalog/products.service.faq.spec.ts src/modules/catalog/faq/admin/product-faq.controller.spec.ts`

Expected: all overview, filter, pagination, raw-version, and permission tests pass.

- [ ] **Step 5: 运行 backend typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: PASS with the new DTO, controller, and module registration typed.

---

### Task 2: 前端 API 类型与 FAQ 左侧导航权限

**Files:**
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/lib/faq-api.ts`
- Modify: `frontend/src/components/admin/AdminShell.tsx`
- Modify: `frontend/src/components/admin/AdminShell.spec.tsx`

**Interfaces:**
- Produces: `AdminFaqProductGroup`、`AdminFaqProductPage`、`adminApi.listFaqProducts(query)`、`faqApi.getProductGroups(query)`。
- Consumes: Task 1 response and existing `hasPermission(permission: string)` function.

```ts
export interface AdminFaqProductGroup {
  product: Pick<AdminProduct, 'id' | 'name' | 'slug' | 'status'>;
  faq: AdminProductFaq;
}

export interface AdminFaqProductPage {
  items: AdminFaqProductGroup[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminFaqProductQuery {
  search?: string;
  mode?: AdminFaqMode;
  page?: number;
  pageSize?: number;
}
```

- [ ] **Step 1: 写失败测试**

在 `AdminShell.spec.tsx` 增加：

```tsx
it.each([
  ['PRODUCT_FAQ_SHARED_MANAGE'],
  ['PRODUCT_MANAGE'],
])('shows the FAQ nav item for %s', (permission) => {
  shellState.permissions = [permission];
  renderShell();

  expect(
    within(desktopNav()).getByRole('link', { name: 'nav_faq' }),
  ).toHaveAttribute('href', '/admin/faq');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/components/admin/AdminShell.spec.tsx`

Expected: the `PRODUCT_MANAGE` case fails because the current FAQ nav requires only `PRODUCT_FAQ_SHARED_MANAGE`.

- [ ] **Step 3: 实现 API wrapper 与任一权限判断**

在 `admin-api.ts` 增加：

```ts
listFaqProducts: (query: AdminFaqProductQuery = {}): Promise<AdminFaqProductPage> =>
  adminAuthedFetch<AdminFaqProductPage>(
    `/api/v1/admin/faq/products${buildQuery(query)}`,
  ),
```

在 `faq-api.ts` 导出 `getProductGroups(query)`，只委托给 `adminApi.listFaqProducts(query)`；商品写入不新增 FAQ 专用协议，工作台调用既有 `adminApi.updateProduct`。

在 `AdminShell.tsx` 增加 `NavPermission = string | readonly string[]` 和统一 helper：字符串按原逻辑判断，数组使用 `some(hasPermission)`。将 FAQ 导航项的权限改为：

```ts
permission: ['PRODUCT_FAQ_SHARED_MANAGE', 'PRODUCT_MANAGE'],
```

其他导航项保持现有行为和顺序。

- [ ] **Step 4: 运行测试与类型检查**

Run: `pnpm exec vitest run src/components/admin/AdminShell.spec.tsx && pnpm exec tsc --noEmit`

Expected: all existing navigation tests and both new permission cases pass.

---

### Task 3: 让商品 FAQ 编辑器支持多商品实例

**Files:**
- Modify: `frontend/src/components/admin/ProductFaqPanel.tsx`
- Modify: `frontend/src/components/admin/ProductFaqPanel.spec.tsx`

**Interfaces:**
- Preserves: existing `<ProductFaqPanel value={faq} onChange={setFaq} />` behavior in `ProductForm`.
- Produces: optional `idPrefix?: string` and `showManageSharedLink?: boolean` props.

```ts
export function ProductFaqPanel({
  value,
  onChange,
  idPrefix = 'product-faq',
  showManageSharedLink = true,
}: {
  value?: AdminProductFaq;
  onChange: (value: AdminProductFaq) => void;
  idPrefix?: string;
  showManageSharedLink?: boolean;
}): ReactNode
```

- [ ] **Step 1: 写失败测试**

```tsx
it('isolates ids and hides the shared shortcut when embedded in the FAQ workspace', () => {
  render(
    <>
      <ProductFaqPanel value={faq} onChange={vi.fn()} idPrefix="product-a" showManageSharedLink={false} />
      <ProductFaqPanel value={faq} onChange={vi.fn()} idPrefix="product-b" showManageSharedLink={false} />
    </>,
  );

  expect(document.querySelectorAll('#product-faq-mode')).toHaveLength(0);
  expect(document.querySelector('#product-a-mode')).toBeInTheDocument();
  expect(document.querySelector('#product-b-mode')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Manage shared FAQ' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/components/admin/ProductFaqPanel.spec.tsx`

Expected: FAIL because the current component uses fixed IDs and always renders the shared shortcut.

- [ ] **Step 3: 实现实例化 props**

把组件中的固定 IDs 改为 `${idPrefix}-mode`、`${idPrefix}-title-${item.id}`、`${idPrefix}-answer-${item.id}`、`${idPrefix}-items-title`，并把 `aria-labelledby` 指向对应实例 ID。只在 `showManageSharedLink` 为 `true` 时渲染 `/admin/faq` 链接；默认值保持现有商品编辑页效果。

商品专属新增按钮继续使用 `setItems([...faq.items, newItem(...)])`，不得引入 shared FAQ API。

- [ ] **Step 4: 运行现有与新增测试**

Run: `pnpm exec vitest run src/components/admin/ProductFaqPanel.spec.tsx`

Expected: existing mode/answer/remove tests plus the multi-instance test pass.

---

### Task 4: 抽出共享编辑器并构建商品分组工作台

**Files:**
- Create: `frontend/src/components/admin/SharedFaqEditor.tsx`
- Create: `frontend/src/components/admin/ProductFaqGroups.tsx`
- Create: `frontend/src/components/admin/FaqWorkspace.tsx`
- Create: `frontend/src/components/admin/FaqWorkspace.spec.tsx`
- Modify: `frontend/src/app/admin/(shell)/faq/page.tsx`
- Modify: `frontend/src/i18n/en.ts`
- Modify: `frontend/src/i18n/zh.ts`

**Interfaces:**
- `SharedFaqEditor({ canEdit }: { canEdit: boolean })` owns shared FAQ loading, edit state, save, and `FAQ_VERSION_MISMATCH` reload.
- `ProductFaqGroups({ canEdit }: { canEdit: boolean })` owns product group loading, search/pagination, local group drafts, product picker, product PATCH, and per-group conflict state.
- `FaqWorkspace` composes both sections and renders an explicit no-permission state when both `canEditShared` and `canEditProducts` are false.

- [ ] **Step 1: 写失败测试**

```tsx
it('renders shared and product-specific questions in separate groups', async () => {
  vi.mocked(faqApi.getShared).mockResolvedValue({
    id: 'shared', version: 3, items: [sharedItem],
  });
  vi.mocked(faqApi.getProductGroups).mockResolvedValue({
    items: [{
      product: { id: 'product-1', name: 'Narrow Storage Cart', slug: 'narrow-cart', status: 'ACTIVE' },
      faq: { mode: 'EXTEND', version: 2, items: [productItem] },
    }],
    total: 1, page: 1, pageSize: 20,
  });

  render(<FaqWorkspace canEditShared canEditProducts />);

  expect(await screen.findByText('Shared product FAQ')).toBeInTheDocument();
  expect(screen.getByText('Narrow Storage Cart')).toBeInTheDocument();
  expect(screen.getByDisplayValue(sharedItem.title)).toBeInTheDocument();
  expect(screen.getByDisplayValue(productItem.title)).toBeInTheDocument();
});

it('routes shared and product saves to different APIs', async () => {
  const user = userEvent.setup();
  render(<FaqWorkspace canEditShared canEditProducts />);

  await user.click(screen.getByRole('button', { name: 'Save shared FAQ' }));
  expect(vi.mocked(faqApi.updateShared)).toHaveBeenCalledWith(
    expect.any(Array),
    3,
  );

  await user.click(screen.getByRole('button', { name: 'Save product FAQ' }));
  expect(vi.mocked(adminApi.updateProduct)).toHaveBeenCalledWith(
    'product-1',
    { faq: expect.objectContaining({ mode: 'EXTEND', expectedVersion: 2 }) },
  );
});
```

```tsx
it('shows the product picker for a product without a configured FAQ row', async () => {
  const user = userEvent.setup();
  vi.mocked(adminApi.listProducts).mockResolvedValue({ items: [productWithoutFaq], total: 1, page: 1, pageSize: 20 });
  render(<FaqWorkspace canEditShared={false} canEditProducts />);

  await user.click(screen.getByRole('button', { name: 'Add product FAQ' }));
  await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'Desk');

  expect(await screen.findByText('Compact Desk')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/components/admin/FaqWorkspace.spec.tsx`

Expected: FAIL because the route currently renders only the shared editor and no product overview API/UI exists.

- [ ] **Step 3: 抽出共享编辑器**

从现有 `faq/page.tsx` 原样迁移共享 FAQ 的 `items/version/loading/pending/error/saved` 状态与 `load/save/updateItem` 逻辑到 `SharedFaqEditor`。保留：

- `faq_shared_add` 作为共享新增按钮文案。
- `faq_shared_save`、`faq_shared_saving`、`faq_shared_saved` 和 409 重新加载行为。
- 共享条目现有的回答文本转换、启用和默认展开字段。
- `canEdit=false` 时字段、添加、删除和保存按钮只读或禁用，但仍可读取共享内容。

- [ ] **Step 4: 实现商品分组读取和编辑**

`ProductFaqGroups` 按 `AdminFaqProductPage` 渲染商品分组；每个分组显示商品名称、slug、mode、专属问题数量，并使用 `ProductFaqPanel`：

```tsx
<ProductFaqPanel
  value={draft.faq}
  onChange={(faq) => updateDraft(draft.product.id, faq)}
  idPrefix={`faq-product-${draft.product.id}`}
  showManageSharedLink={false}
/>
```

每个分组保存只发送：

```ts
await adminApi.updateProduct(product.id, {
  faq: {
    mode: draft.faq.mode,
    items: draft.faq.items,
    expectedVersion: draft.faq.version,
  },
});
```

保存成功后只更新该分组的版本和 saved 状态；409 保留该分组输入并提供该分组重新加载。商品搜索选择器使用现有 `adminApi.listProducts` 找到商品，再用 `adminApi.getProduct` 读取默认 FAQ 后插入本地分组；保存仍通过商品 PATCH，成功后刷新汇总列表。

- [ ] **Step 5: 组合路由与权限状态**

`faq/page.tsx` 从 `useAdminAuth()` 计算：

```ts
const canEditShared = hasPermission('PRODUCT_FAQ_SHARED_MANAGE');
const canEditProducts = hasPermission('PRODUCT_MANAGE');
```

渲染顺序固定为：页面标题 → 共享问题区 → 商品专属问题区。两种权限都没有时显示无权访问状态；只有一种权限时隐藏另一分组的编辑与读取请求，不发起未授权 API 请求。

- [ ] **Step 6: 增加中英文文案并运行组件测试**

新增并在 `en.ts` / `zh.ts` 同步的 key 至少包括：

```ts
faq_workspace_title
faq_workspace_description
faq_shared_section_title
faq_product_section_title
faq_product_search
faq_product_add
faq_product_empty
faq_product_group_mode
faq_product_group_count
faq_product_save
faq_product_saving
faq_product_saved
faq_product_conflict
faq_product_reload
faq_product_open_editor
faq_permission_denied
```

Run: `pnpm exec vitest run src/components/admin/FaqWorkspace.spec.tsx src/components/admin/ProductFaqPanel.spec.tsx`

Expected: shared/product groups render separately, product picker loads a real product, save calls remain isolated, and both language dictionaries type-check.

---

### Task 5: 工作台集成、端到端边界与回归验证

**Files:**
- Modify: `frontend/e2e/product-faq.spec.ts`
- Test: `backend/src/modules/catalog/faq/admin/product-faq.controller.spec.ts`
- Test: `frontend/src/components/admin/AdminShell.spec.tsx`
- Test: `frontend/src/components/admin/FaqWorkspace.spec.tsx`

**Interfaces:**
- Consumes: Task 1 overview endpoint, Task 2 API/navigation types, Task 4 unified page.
- Produces: browser-proven proof that shared and product-specific FAQ can be managed from the same left-nav page without crossing data boundaries.

- [ ] **Step 1: 增加真实 E2E 场景**

在现有隔离数据库测试中保存一条商品专属 FAQ和一条共享 FAQ，然后打开 `/admin/faq`：

1. 断言页面同时出现共享区和该商品名称分组。
2. 从共享区新增/编辑后，`GET /admin/faq/shared` 的 items 改变，而商品 FAQ items 不变。
3. 从商品分组新增/编辑后，`GET /admin/products/:id` 的 FAQ 改变，而共享 FAQ items 不变。
4. 刷新页面，断言两个分组仍按商品/共享来源显示，并保留各自版本。
5. 打开 `/admin/products/:id/edit`，断言商品编辑页看到统一工作台刚保存的商品专属问题。

- [ ] **Step 2: 覆盖空组、搜索和权限组合**

增加以下断言：

- 没有已配置 ProductFaq 行的商品不会在默认商品分组中出现。
- 商品搜索可以找到该商品，并且首次保存使用 `expectedVersion: 0`。
- `PRODUCT_FAQ_SHARED_MANAGE`-only 账户只看到共享区。
- `PRODUCT_MANAGE`-only 账户只看到商品区。
- 无两种权限的账户不能通过直接访问 `/admin/faq` 获得编辑器。

- [ ] **Step 3: 运行完整验证**

Backend：

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
```

Frontend：

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm build
```

E2E（使用项目已有隔离数据库守卫）：

```bash
pnpm exec playwright test e2e/product-faq.spec.ts
```

Expected: backend and frontend suites have zero failures; production build includes `/admin/faq`; E2E confirms shared/product writes remain separate.

- [ ] **Step 4: 浏览器手动验收**

使用 worktree 的非 3000/3001 端口打开 `/admin/faq`，验证：

- 左侧 FAQ 与商品同等级显示。
- 页面先显示共享问题，再显示商品分组。
- 共享按钮文案是“添加共享问题”，商品按钮文案是“添加商品专属问题”。
- 修改商品组后回到商品编辑页，内容一致。
- 观察浏览器控制台没有本次页面产生的新错误。

---

## Verification Checklist

- [ ] 汇总 endpoint 的查询、筛选、分页、权限和轻量响应测试通过。
- [ ] 左侧 FAQ 对 `PRODUCT_FAQ_SHARED_MANAGE` / `PRODUCT_MANAGE` 任一权限可见。
- [ ] 共享和商品分组按授权分别读取，不调用未授权接口。
- [ ] 多商品编辑器的 DOM IDs、aria 关联和状态互不冲突。
- [ ] 共享 PUT 与商品 PATCH 的 payload、版本锁和 409 处理互不串线。
- [ ] 后端全量测试、前端全量测试、两端类型检查、前端生产构建和 FAQ E2E 均通过。
- [ ] 不重启用户正在使用的 3000/3001 服务；使用 worktree 端口完成浏览器验收。
