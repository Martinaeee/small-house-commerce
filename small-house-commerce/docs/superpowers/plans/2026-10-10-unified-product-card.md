# Unified Product Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户已选 Native：主会话 inline 实施与自审，不启动子代理、Workflow 或独立 reviewer；用户审阅本计划后才能开始。

**Goal:** 首页、类目、搜索及已有共享商品卡入口支持行内选款、对应图片/售价/划线价、真实加购和手动场景图悬停。

**Architecture:** 给已有 ProductImage 增加独立场景标记，沿用版本化 catalog graph 与旧 images 保存边界；在公共产品服务里批量生成每款式最多两张卡片图片。ProductCard 统一展示与购买入口，复用 PdpPurchaseProvider、ProductOptionSelector、价格工具和 CartContext；preview 分支不挂载购物车动作。

**Tech Stack:** Next.js 16.3.4、React 19.2.8、Tailwind 4、Vitest/RTL、Playwright；NestJS 12、Prisma 7.10.0/adapter-pg、Zod 4、PostgreSQL、pnpm 12。

**Spec:** [2026-10-10-unified-product-card-design.md](../specs/2026-10-10-unified-product-card-design.md)。执行者必须同时阅读规格和本计划。

## Global Constraints

- 只在当前 `homepage-builder` worktree 本地实施；所有命令从 worktree 根运行，不 `cd` 回主 checkout。
- 不提交、不推送、不合并、不建 PR、不部署；本计划也不提交。每个任务的 checkpoint 是局部 diff/测试证据，不是 git commit。
- 不进行生产写入；不读取、猜测或输出生产秘密。
- 不触碰 `small-house-commerce/backend/uploads/`；临时测试应用自己的 uploads 在 `/private/tmp` 内。
- 不重启或占用用户的 3000/3001；既有 rehearsal frontend `localhost:3005`、backend `127.0.0.1:3002` 不由测试 runner 停止或清构建目录。
- 共享 PostgreSQL 5432 的迁移串行；执行前与营销线协调 Prisma、公开投影、api/i18n 文件的编辑及迁移窗口。
- 保留尺寸/包装、Bundle、FAQ、营销与首页工作线的未提交改动；不整文件覆盖、宽格式化、宽暂存、裸 stash 或清理其他会话输出。
- 场景图每作用域最多一张 IMAGE；不自动第二张，不改变封面或 PDP 图集排序。
- 后台长×宽×高口径及前台 Width/Height/Depth 口径不变；不交换历史值。
- 卡片默认数量1；缺货继续允许 Save for Later，checkout 仍阻止库存不足；Bundle 提交虚拟 SKU ID，不展开/预留组件。
- 前台全英文；后台 zh 默认并补 en 文案。保留真实评论、运营徽标和各入口原网格/排序。
- 不新增产品依赖，不重做 CartService、PDP、Quick Add、checkout、订单、营销工作台或暂缓的首页外壳。
- 开始前端代码前阅读安装版 `frontend/node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` 与 `01-app/01-getting-started/05-server-and-client-components.md`；公共 client props 必须可序列化，不传 server 回调。
- RED 必须是行为断言失败，不能把模块缺失、类型错误或数据库初始化失败记作有效 RED。新文件可先给类型完整的空实现以让断言运行，再记录行为失败。
- 主会话完整读取测试退出码/失败摘要；不把 peer 报告或以前的绿色结果当本轮完成证据。

## Review Focus

1. 共享图库重复 URL、重排、设封面再编辑 URL：场景标记随稳定媒体身份，不随数组下标；Task 3 钉住 round-trip。
2. legacy 请求在 graph-v0 读取后，另一事务已 materialize：旧写必须在事务内重新检查版本并拒绝，不能删掉新图库；Task 2 钉住锁后校验。
3. provider 的同步锁先于 confirmLine：会把确认 action 拦掉；Task 6 验证显式确认发生在锁前且同任务双击只提交一次。
4. 触屏点图片带来 focus：不能因此加载/显示 hover scene 或吞掉第一次导航；Task 5/8 用真实触屏及 focus-visible 钉住。
5. 加购 pending 时商品/图版本被替换：真实 cart mutation/事件仍使用请求快照，新卡不能收到旧反馈；Task 6 钉住卸载/版本替换。

---

## 文件与执行单元

所有下面的路径都相对 `small-house-commerce/`。只创建确实承载新职责的文件，不将大型 ProductForm/ProductsService 整体拆分。

| 单元 | 文件 | 职责 |
|---|---|---|
| Scene policy | `backend/src/modules/catalog/product-scene-policy.ts` + spec | 省略字段继承、作用域唯一、legacy 元数据匹配 |
| 持久化 | catalog schema、独立 migration、两个 DTO、catalog graph/products services | 字段、事务交换、旧请求、版本/权限边界 |
| 真实数据库验收 | `backend/test/product-scene.e2e-spec.ts` | 原数据库约束、换图、事务回滚，不用内存 mock 替代 |
| 后台 | admin-api、admin-product-graph、ProductForm、new/edit pages、两类图库编辑器 | 父草稿、稳定媒体身份、scene 操作、保存闭环 |
| 卡片公开投影 | `backend/src/modules/catalog/product-card-media.ts` + spec、products.service、frontend api | 复用 scope resolver、批量读取、公开白名单 |
| 展示派生 | 现有 `frontend/src/lib/product-card-presentation.ts` + spec | 有效初始款式、选定/未完整选择媒体回退 |
| 图片交互 | `frontend/src/components/product/ProductCardImage.tsx` + spec | 按需 scene、加载/失败/触屏/键盘 |
| 公共卡片 | ProductCard、`ProductCardView.tsx`、PlpProductCard、ProductOptionSelector | 一个视觉实现、隔离 purchase state、真实 CartContext |
| 首页接线 | ProductGridSection、sectionRegistry、HomepageLivePreview、HomeTracking 相关 tests | preview 分支及只在详情导航时 ProductClick |
| 隔离浏览器 | `frontend/playwright.product-card.config.ts`、`frontend/e2e/product-card-prepare.ts`、`frontend/e2e/product-card.spec.ts`、`frontend/src/test/product-card-test-target.ts` + spec | 临时应用、独立测试库、真实浏览器，不清原 `.next` |

**当前源码核对：** ProductCard 实际调用点是 ProductGridSection、RecentlyViewed、PdpView、搜索和集合；类目通过 PlpProductCard。RoomInspirationSection 是独立链接/场景组件，不是 ProductCard；保留原链接捕获，不顺便重写它。商品编辑页真实路径是 `frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx`，不是 `/admin/products/[id]/page.tsx`。

### 前置 checkpoint

- [ ] 记录当前 git status 与涉及文件的局部 diff；确认没有现成 scene flag/migration 或同名 helper。
- [ ] 通知营销会话所需共享文件窗口；预留迁移名 `20261014110000_add_product_image_scene_flag`，检查与现有 `20261014100000_add_landing_page_ownership_drafts` 不冲突。
- [ ] 在营销线确认临时探针目录清理后，记录前后端 bare test、frontend tsc、lint 的 fresh baseline；失败按文件记录，不以“基线”名义忽略，也不修改无关 tests/ignore。build 在 Task 8 的独立副本执行，不写正在运行的原dist/.next。
- [ ] 核对 3002/3005、3000/3001 和测试预备 3214/3215 监听；测试端口已被占用则先协调，不杀未知进程。
- [ ] 只在新独立数据库 `small_house_product_card_20261010_test` 执行测试迁移；需要让 rehearsal 采用新字段时，与营销线确认该库已应用的迁移链，禁止顺手应用未经核对的整批 pending migrations。

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend lint
```

## Task 1: Scene 字段、DTO、策略与 PostgreSQL 约束

**Files:**
- Modify: `backend/prisma/schema/catalog.prisma:171-189`
- Create: `backend/prisma/migrations/20261014110000_add_product_image_scene_flag/migration.sql`
- Modify: `backend/src/modules/catalog/dto/catalog-graph.dto.ts:101-145`
- Modify: `backend/src/modules/catalog/dto/product.dto.ts:44-50`
- Create: `backend/src/modules/catalog/product-scene-policy.ts`
- Create: `backend/src/modules/catalog/product-scene-policy.spec.ts`
- Create: `backend/test/product-scene.e2e-spec.ts`

**Interfaces:**

```ts
export interface SceneMediaRow {
  id?: string;
  productId: string;
  optionValueId: string | null;
  variantId: string | null;
  url: string;
  type: 'IMAGE' | 'VIDEO';
  isScene?: boolean;
}
export interface LegacySceneImageWrite {
  url: string;
  type: 'IMAGE' | 'VIDEO';
  altText?: string;
  sortOrder: number;
  isScene?: boolean;
}
export function resolveSceneFlag(
  previous: SceneMediaRow | undefined,
  next: SceneMediaRow,
): boolean;
export function assertSceneMedia(rows: readonly SceneMediaRow[]): void;
export function prepareLegacySceneImages(
  existing: readonly SceneMediaRow[],
  incoming: readonly LegacySceneImageWrite[],
): Array<LegacySceneImageWrite & { isScene: boolean }>;
```

- [ ] **Step 1: 写 DTO 与策略 RED。** `mediaWriteSchema` 当前会丢掉未知 isScene；第一条直接调用真实 schema。策略测试期望用下列手算值，不调用同一 helper 生成 expected。

```ts
const shared: SceneMediaRow = {
  id: 'old', productId: 'product', optionValueId: null, variantId: null,
  url: '/uploads/shared.webp', type: 'IMAGE', isScene: true,
};
it('keeps an explicit scene flag in the media write schema', () => {
  expect(mediaWriteSchema.parse({
    clientKey: 'new-image', url: '/uploads/shared.webp', isScene: true,
  }).isScene).toBe(true);
});
it.each([
  [{ ...shared, isScene: undefined }, true],
  [{ ...shared, isScene: false }, false],
  [{ ...shared, isScene: undefined, variantId: 'variant' }, false],
  [{ ...shared, isScene: undefined, type: 'VIDEO' }, false],
] as const)('resolves omission against media identity and scope', (next, want) => {
  expect(resolveSceneFlag(shared, next)).toBe(want);
});
it('does not infer a scene for a new row', () => {
  expect(resolveSceneFlag(undefined, { ...shared, isScene: undefined })).toBe(false);
});
it('rejects scene on video', () => {
  expect(() => resolveSceneFlag(shared, { ...shared, type: 'VIDEO' })).toThrow(/scene.*image/i);
});
it('allows one scene in each distinct scope but not two in one scope', () => {
  expect(() => assertSceneMedia([
    shared, { ...shared, id: 'other', variantId: 'variant' },
  ])).not.toThrow();
  expect(() => assertSceneMedia([
    shared, { ...shared, id: 'other', url: '/uploads/other.webp' },
  ])).toThrow(/scene/i);
});
it('preserves old omitted metadata by unique URL/type, not position', () => {
  expect(prepareLegacySceneImages([shared], [
    { url: '/uploads/new.webp', type: 'IMAGE', sortOrder: 0 },
    { url: '/uploads/shared.webp', type: 'IMAGE', sortOrder: 1 },
  ]).map(row => row.isScene)).toEqual([false, true]);
});
it('refuses ambiguous inheritance from duplicate URLs', () => {
  expect(() => prepareLegacySceneImages([shared], [
    { url: shared.url, type: 'IMAGE', sortOrder: 0 },
    { url: shared.url, type: 'IMAGE', sortOrder: 1 },
  ])).toThrow(/uniquely|ambiguous/i);
});
```

另用实际 schema 断言 boolean 非法值拒绝、IMAGE true 接受、VIDEO true 拒绝、原 XOR 仍拒绝。legacy 全部显式 false 的重复 URL 合法；旧 URL 消失视为删除，不映射到新 URL。

- [ ] **Step 2: 运行并记录真实行为 RED。** 新策略空导出只能用于让 imports 收敛；不把加载错误计入 RED。

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/catalog/product-scene-policy.spec.ts
```

- [ ] **Step 3: 最小策略及 schema 实现。** `isScene` 在两个 DTO 是 `z.boolean().optional()`，不在更新 DTO 默认 false；VIDEO+true 在 superRefine 返回对应 isScene issue。`resolveSceneFlag` 明确值优先，否则只有同 product/scope 且 IMAGE 才继承；`assertSceneMedia` 用 `[productId, optionValueId, variantId]` 的 JSON key 分组，报具体 scope/媒体。

`prepareLegacySceneImages` 对旧、新列表建立 `(url,type)` 计数。显式值直接使用；省略且旧匹配行有 scene 时必须旧/新均恰好一行，否则 BadRequest。无旧场景则 false；返回明确 boolean，再校验共享 scope 唯一性。此逻辑仅兼容旧系统边界，不创建另一套保存协议。

```prisma
isScene Boolean @default(false) @map("is_scene")
```

```sql
ALTER TABLE "product_images"
  ADD COLUMN "is_scene" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_scene_image_check"
  CHECK (NOT "is_scene" OR "type" = 'IMAGE');
CREATE UNIQUE INDEX "product_images_scene_shared_key"
  ON "product_images" ("product_id")
  WHERE "is_scene" AND "option_value_id" IS NULL AND "variant_id" IS NULL;
CREATE UNIQUE INDEX "product_images_scene_option_value_key"
  ON "product_images" ("product_id", "option_value_id")
  WHERE "is_scene" AND "option_value_id" IS NOT NULL AND "variant_id" IS NULL;
CREATE UNIQUE INDEX "product_images_scene_variant_key"
  ON "product_images" ("product_id", "variant_id")
  WHERE "is_scene" AND "variant_id" IS NOT NULL AND "option_value_id" IS NULL;
```

不以 Prisma 普通 unique 模拟部分唯一；不改已有外键/XOR。不更新存量 sortOrder 或为旧图挑场景。

- [ ] **Step 4: 在专属测试库验证实际约束。** 新 e2e-spec 用 PrismaService/ConfigService，如已有 bundle.e2e-spec；但只允许这个确切库和 loopback 5432，不能使用 Bundle/FAQ 的数据库变量。测试缺初始化时明确报告，不能伪称是功能 RED。

```ts
const raw = process.env.PRODUCT_CARD_TEST_DATABASE_URL;
if (!raw) throw new Error('PRODUCT_CARD_TEST_DATABASE_URL is required');
const target = new URL(raw);
if (target.protocol !== 'postgresql:' ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    (target.port || '5432') !== '5432' ||
    target.pathname !== '/small_house_product_card_20261010_test' ||
    (target.searchParams.get('schema') ?? 'public') !== 'public') {
  throw new Error('Refused product-card test database');
}
const prisma = new PrismaService(new ConfigService({ database: { url: raw } }));
let productId: string;
beforeAll(async () => {
  await prisma.$connect();
  const category = await prisma.category.create({
    data: { name: 'Scene test', slug: `scene-test-${randomUUID()}` },
  });
  const product = await prisma.product.create({
    data: { name: 'Scene test', slug: `scene-test-${randomUUID()}`, categoryId: category.id },
  });
  productId = product.id;
});
afterAll(async () => { await prisma.$disconnect(); });
it('enforces the shared-scope unique index in PostgreSQL', async () => {
  await prisma.productImage.create({ data: {
    productId, url: '/uploads/a.webp', type: 'IMAGE', isScene: true,
  } });
  await expect(prisma.productImage.create({ data: {
    productId, url: '/uploads/b.webp', type: 'IMAGE', isScene: true,
  } })).rejects.toThrow();
  expect(await prisma.productImage.count({ where: { productId, isScene: true } })).toBe(1);
});
```

按同样真实模型为 OPTION_VALUE/VARIANT 用各自产品建立 fixture；分别断言第二 scene 拒绝、两个不同 scope 可各有一张、false 多图允许、VIDEO true 拒绝、同 sortOrder 不影响唯一性。每个测试拥有自己的产品，避免依赖前一测试留下的 scene。

先与营销线取得迁移窗口，在新库运行 migrate deploy + generate；缺库只创建指定新库，不 drop/force-recreate 任何已有库。若已存在且无法确认归属则停止协调。

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/small_house_product_card_20261010_test?schema=public' pnpm --dir small-house-commerce/backend exec prisma migrate deploy
pnpm --dir small-house-commerce/backend exec prisma generate
PRODUCT_CARD_TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/small_house_product_card_20261010_test?schema=public' pnpm --dir small-house-commerce/backend exec vitest run --config vitest.config.e2e.ts test/product-scene.e2e-spec.ts
```

- [ ] **Step 5: checkpoint。** DTO/策略 GREEN、实际 DB 约束结果、migration 局部 diff；不 commit，不发布。

## Task 2: Typed graph 与 legacy 保存的原子闭环

**Files:**
- Modify: `backend/src/modules/catalog/catalog-graph.service.ts:167-179,864-891,959-1054`
- Modify: `backend/src/modules/catalog/products.service.ts:642-839,1658` 附近 create/update/error mapper
- Modify: `backend/src/modules/catalog/catalog-graph.service.spec.ts`
- Modify: `backend/src/modules/catalog/products.service.update.spec.ts`
- Modify: `backend/src/modules/catalog/products.service.admin-get.spec.ts`
- Extend: `backend/test/product-scene.e2e-spec.ts`

**Interfaces:** 消费 Task 1 三个策略函数；现有 `applyPatch(productId, expectedVersion, patch)`、`applyPatchWithProductMutation(...)` 和 `ProductsService.update(id,input)` 不改签名。Admin snapshot 的 images/media 行返回 isScene；原公共媒体白名单仍不返回编辑标记。

- [ ] **Step 1: 在现有 graph harness 写 RED。** 为测试 MediaRow 加可选 isScene；不能 mock CatalogGraphService 自身。

```ts
it('preserves a scene when an existing graph media write omits the field', async () => {
  const state = baseState();
  const row = state.media[0];
  row.isScene = true;
  const harness = createGraphHarness(state);
  await harness.service.applyPatch(PRODUCT_ID, 1, parsePatch({ media: [{
    id: row.id, url: row.url, type: row.type, sortOrder: row.sortOrder + 1,
    ...(row.optionValueId ? { optionValueId: row.optionValueId } : {}),
    ...(row.variantId ? { variantId: row.variantId } : {}),
  }] }));
  expect(harness.state.media.find(item => item.id === row.id)?.isScene).toBe(true);
});
it('rolls back scene changes after a late graph write failure', async () => {
  const state = baseState();
  const row = state.media[0];
  const harness = createGraphHarness(state, 'default');
  const before = structuredClone(harness.state);
  await expect(harness.service.applyPatch(PRODUCT_ID, 1, parsePatch({
    media: [{ id: row.id, url: row.url, type: row.type, sortOrder: row.sortOrder,
      isScene: true,
      ...(row.optionValueId ? { optionValueId: row.optionValueId } : {}),
      ...(row.variantId ? { variantId: row.variantId } : {}),
    }], defaultDisplayVariant: { id: RED_VARIANT_ID },
  }))).rejects.toThrow();
  expect(harness.state).toEqual(before);
});
```

最终快照重复校验必须有“只更新新 scene，旧 scene 没出现在 patch”这一反例；不能只检测 patch 内重复。另覆盖移 scope/VIDEO omission 清标记、retirement 删除旧 scene、new clientKey scene、409 不改媒体、保存只 revalidate 一次。legacy harness 的真实事务版本读取返回 graph-v1 时，更新必须抛 CatalogGraphVersionRequiredError，旧媒体完全不变。

- [ ] **Step 2: 运行 RED。**

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/catalog/catalog-graph.service.spec.ts src/modules/catalog/products.service.update.spec.ts src/modules/catalog/products.service.admin-get.spec.ts
```

- [ ] **Step 3: 最小 typed persistence。** PlannedMedia.data 加明确 boolean；planMedia 调 resolveSceneFlag。合成最终快照时排除退休媒体、级联删除的 option-value/variant 图，再覆盖 changed rows，调用 assertSceneMedia。不要把暂时中间态当最终冲突。

在已有 revision compare-and-increment 成功后的同一事务，先删除 retirements，再将本计划已有媒体中原 scene 需要取消/移动的行置 false，之后 creates/updates 写最终 isScene；不能 Promise.all 同时先设新 true 后清旧 true。

```ts
const existingWrites = plan.media.filter(row => !row.isNew);
if (existingWrites.length > 0) {
  await tx.productImage.updateMany({
    where: { productId, id: { in: existingWrites.map(row => row.id) }, isScene: true },
    data: { isScene: false },
  });
}
// 随后的 existing updates 和 creates 都写 plan 中明确的 data.isScene。
```

可以临时清本计划所有已有 scene，因为最终快照已验证、事务未提交、全部恢复最终值；任何失败整体回滚。未被 patch 触及的 scope 不清除。

- [ ] **Step 4: 最小 legacy persistence。** 去掉事务外构建 `data.images` 的代码，改在 legacy 事务内部：只有 images/variants whole-list 请求才锁 products 行并重新读取 catalog_graph_version；已 materialize 则拒绝。images 存在才读取旧共享元数据并执行 prepareLegacySceneImages，再原样 nested deleteMany/create。scalar/FAQ-only 更新不新增媒体替换或 graph version 要求。

```ts
const locked = await tx.$queryRaw<Array<{ catalog_graph_version: number }>>`
  SELECT catalog_graph_version FROM products WHERE id = ${id}::uuid FOR UPDATE
`;
if (locked[0]?.catalog_graph_version > 0) {
  throw new CatalogGraphVersionRequiredError();
}
const oldImages = await tx.productImage.findMany({
  where: { productId: id, optionValueId: null, variantId: null },
});
data.images = {
  deleteMany: {}, create: prepareLegacySceneImages(oldImages, input.images),
};
```

以上段落仅放在对应 whole-list 分支；不对 input.images 未定义时调用 helper。create 也在写入前校验显式多 scene/VIDEO；新省略值 false。数据库 scene 约束异常只在确认是 ProductImage 场景约束时转可读 BadRequest/冲突，不把 SKU/slug 唯一异常误改成 scene 错误；用 Task 1 实际 adapter 错误验证 mapper，不猜 meta 结构。

- [ ] **Step 5: 实库换图、回滚与 GREEN。** e2e-spec 创建同 scope A=true/B=false；调用真实 CatalogGraphService 改 A=false/B=true，回读仅 B=true、sortOrder 不变。再提交重复或 stale expectedVersion，回读 version/flags 全部不变。使用真实 ProductsService 的 legacy update 回读旧标记、显式取消和 images=[] 删除。保留已有 Bundle/FAQ transaction callback，不修改保存锁/stock batch。

```bash
pnpm --dir small-house-commerce/backend test
PRODUCT_CARD_TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/small_house_product_card_20261010_test?schema=public' pnpm --dir small-house-commerce/backend exec vitest run --config vitest.config.e2e.ts test/product-scene.e2e-spec.ts
```

## Task 3: 后台 scene 草稿、稳定身份与三个图库操作

**Files:**
- Modify: `frontend/src/lib/admin-api.ts:480-486,693-701`、CreateProductInput/WireCatalogGraphPatch media
- Modify: `frontend/src/lib/admin-product-graph.ts:98-106,149-156,263-407,494-502,981-995,1135-1151,1257-1309,1356-1378`
- Modify: `frontend/src/components/admin/ProductForm.tsx` 共享 image 类型、append/setImage、serializer、media workspace props
- Modify: `frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx:111-141` 和 `frontend/src/app/admin/(shell)/products/new/page.tsx`
- Modify: `frontend/src/components/admin/product-form/SharedMediaWorkspace.tsx`
- Modify: `frontend/src/components/admin/product-form/MediaGallery.tsx`
- Modify: `frontend/src/components/admin/ProductMediaScopesEditor.tsx`
- Modify: `frontend/src/i18n/en.ts`、`frontend/src/i18n/zh.ts`
- Test: admin-product-graph.spec、ProductForm.spec、SharedMediaWorkspace.spec、ProductMediaScopesEditor.spec、现有 new/edit page specs

**Interfaces:** AdminProductImage/AdminGraphMedia/AdminMediaDraft/CatalogMediaUpsert/Wire media 加 `isScene?: boolean`；读旧响应用 `?? false`。ImageFormValue 与 `admin-product-graph.ts:1243` 的内部 SharedMediaInput 均增 `id?: string; clientKey?: string; isScene?: boolean`。共享新操作 `onSetScene(index: number, selected: boolean): void`；MediaGalleryItem 加 `isScene?: boolean`，MediaGallery 仅在提供 `onSetScene(key: string, selected: boolean): void` 时渲染操作，因此详情积木不会得到场景按钮；其 onPatch 的 Pick 同时包含 isScene。

- [ ] **Step 1: 写纯适配器 RED。** 使用 admin-product-graph.spec 现有 `graphFromAdminProduct/deserializeAdminProduct` fixture。为新增 identity 测试直接给两个 shared input 稳定 id，避免靠数组顺序暗示身份。

```ts
it('retains scene identity after a shared gallery reorder and URL edit', () => {
  const draft: AdminCatalogGraphDraft = {
    catalogGraphVersion: 1, options: [], variants: [], media: [
      { id: 'a', url: '/a.webp', type: 'IMAGE', altText: null, sortOrder: 0,
        optionValueRef: null, variantRef: null, isScene: true },
      { id: 'b', url: '/b.webp', type: 'IMAGE', altText: null, sortOrder: 1,
        optionValueRef: null, variantRef: null, isScene: false },
    ],
  };
  syncSharedMediaDraft(draft, [
    { id: 'b', url: '/b.webp', type: 'IMAGE', altText: '', isScene: false },
    { id: 'a', url: '/a-edited.webp', type: 'IMAGE', altText: '', isScene: true },
  ]);
  expect(draft.media.map(row => [row.id, row.url, row.isScene, row.sortOrder]))
    .toEqual([['b', '/b.webp', false, 0], ['a', '/a-edited.webp', true, 1]]);
});
```

hydrate→标记 alone→minimal diff→wire 必须带明确 boolean；无变更不得出现 upsert。相同 URL 的两张不同 id 图重排后，场景仍跟原 id。legacy 无身份输入只允许唯一 URL/type 识别，不能按位置继承 true；重复且有旧 scene 的歧义拒绝。旧测试中表示“编辑同一张图”的 fixture 给它真实 id，不降低身份断言。

- [ ] **Step 2: 写真实受控 UI RED。** SharedMediaWorkspace 用拥有 useState 的父 harness 更新 images，不只断言 callback 存在；Scoped 用已有 GraphDraftHarness/draftJson。选 scene 后直接检查草稿与徽标，再切其他 scope，确认旧 scope 不串标记。

```tsx
function SharedHarness() {
  const [rows, setRows] = useState<ImageFormValue[]>([
    { id: 'a', url: '/a.webp', type: 'IMAGE', altText: '', sortOrder: '0' },
    { id: 'b', url: '/b.webp', type: 'IMAGE', altText: '', sortOrder: '1' },
  ]);
  return <AdminI18nProvider><SharedMediaWorkspace
    images={rows} pending={false}
    onPatch={(index, patch) => setRows(old => old.map((row, i) => i === index ? { ...row, ...patch } : row))}
    onSetScene={(index, selected) => setRows(old => old.map((row, i) => ({
      ...row, isScene: selected ? i === index : i === index ? false : row.isScene,
    })))}
    onMove={() => {}} onReorder={() => {}} onSetCover={() => {}}
    onRemove={() => {}} onAdd={() => {}} onAddMedia={() => {}}
  /><pre data-testid="shared-state">{JSON.stringify(rows)}</pre></AdminI18nProvider>;
}
it('switches the scene without changing the cover or order', async () => {
  setAdminLang('en');
  render(<SharedHarness />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Media 2' }));
  await user.click(screen.getByRole('button', { name: 'Set as scene image' }));
  const rows = JSON.parse(screen.getByTestId('shared-state').textContent!);
  expect(rows.map((row: ImageFormValue) => [row.id, row.sortOrder, !!row.isScene]))
    .toEqual([['a', '0', false], ['b', '1', true]]);
});
```

另覆盖取消、IMAGE→VIDEO 清标记、URL 编辑保留、删除不转移、详情无按钮、pending/上传中禁用、空 URL 不允许、跨 Tab 草稿不丢失与上传目标固定。

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/lib/admin-product-graph.spec.ts src/components/admin/ProductForm.spec.tsx src/components/admin/product-form/SharedMediaWorkspace.spec.tsx src/components/admin/ProductMediaScopesEditor.spec.tsx
```

- [ ] **Step 3: 最小草稿/serializer 实现。** edit deserializeProduct 复制 image.id/isScene；append 与上传成功新行给 freshClientKey 和 false。syncSharedMediaDraft 以 id/clientKey 优先匹配 shared row，新图没有身份时才尝试唯一 URL/type；重建 shared 的有序行，保留其他 scope 行、未删身份与 retirements。URL 编辑带 id，所以不依赖旧 URL 匹配。

isScene 进入 hydrate、baseline、mediaChanged、upsert、toWire；比较时 `?? false`。legacy serializer 每行输出明确 isScene、不输出草稿 id/clientKey；typed serializer 明确 flag 与稳定 identity。scene-only 改动必须让 images changed-group/graph dirty 检测成立；普通字段/FAQ save 不误触图库替换。

- [ ] **Step 4: 最小 UI 接线。** Shared parent 在一个 setValue 更新内清该 scope 旧 flag/设目标；Scoped parent 在一个 updateGraph 更新内只更改同 optionValueRef 或 variantRef 的行。MediaGallery 的 scene 操作是具名按钮、小徽标，外层 thumbnail 编辑按钮内不嵌套按钮。media 转 VIDEO/移 scope 的 mutation 明确 isScene=false。

新增四个 i18n key：`product_media_scene_badge`（场景图/Scene image）、`product_media_set_scene`（设为场景图/Set as scene image）、`product_media_clear_scene`（取消场景图/Clear scene image）、`product_media_scene_action_aria`（包含 scope/number/action 的具名文本）。不覆盖 FAQ、尺寸、包装已追加的 keys。

- [ ] **Step 5: GREEN 与 round-trip。** new/edit 保存响应水合及 409 保留 draft；全量 frontend test，局部 eslint/tsc 检查，不把现有108px缩略图扩成大配置区。

```bash
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
```

## Task 4: 共用产品服务的批量卡片媒体投影

**Files:**
- Modify: `backend/src/modules/catalog/product-media.resolver.ts:26-46` 仅内部 image row optional isScene
- Create: `backend/src/modules/catalog/product-card-media.ts`、`.spec.ts`
- Modify: `backend/src/modules/catalog/products.service.ts:136-147,1189-1351`
- Test: `backend/src/modules/catalog/product-media.resolver.spec.ts`、`products.service.spec.ts`
- Modify: `frontend/src/lib/api.ts` Product/媒体类型

**Interfaces:**

```ts
export type ProductCardImage = ProductMediaItem & { type: 'IMAGE' };
export interface ProductCardMediaPair {
  cover: ProductCardImage | null;
  scene: ProductCardImage | null;
}
export interface ProductCardMedia {
  unselected: ProductCardMediaPair;
  variants: Array<ProductCardMediaPair & { variantId: string }>;
}
export function buildProductCardMedia(
  graph: ProductMediaGraph,
  selectableVariantIds: readonly string[],
  displayVariantId: string | null,
): ProductCardMedia;
```

前端复制相同公开结构，用 ProductMedia 替代后端 ProductMediaItem，`Product.cardMedia?: ProductCardMedia`。不让前端引用后端模块。

- [ ] **Step 1: 写 pure scope RED。** fixture 直接是完整 ProductMediaGraph，literal expected 不调用 resolver 算期望。

```ts
const graph: ProductMediaGraph = {
  id: 'p', catalogGraphVersion: 1,
  options: [{ id: 'color', isActive: true, isMediaDriver: true,
    values: [{ id: 'red', isActive: true }, { id: 'blue', isActive: true }] }],
  variants: [
    { id: 'vr', sku: { status: 'ACTIVE' }, optionValues: [{ optionId: 'color', optionValueId: 'red' }] },
    { id: 'vb', sku: { status: 'ACTIVE' }, optionValues: [{ optionId: 'color', optionValueId: 'blue' }] },
  ],
  images: [
    { id: 'shared', url: '/shared.webp', type: 'IMAGE', altText: null, sortOrder: 0,
      optionValueId: null, variantId: null, isScene: true },
    { id: 'red', url: '/red.webp', type: 'IMAGE', altText: null, sortOrder: 0,
      optionValueId: 'red', variantId: null, isScene: true },
    { id: 'exact', url: '/exact.webp', type: 'IMAGE', altText: null, sortOrder: 0,
      optionValueId: null, variantId: 'vr' },
  ],
};
it('does not borrow an option scene when an exact gallery wins', () => {
  const result = buildProductCardMedia(graph, ['vr', 'vb'], 'vr');
  expect(result.variants.map(row => [row.variantId, row.cover?.id, row.scene?.id ?? null]))
    .toEqual([['vr', 'exact', null], ['vb', 'shared', 'shared']]);
});
it('uses a placeholder pair when the winning exact scope is video-only', () => {
  const input = structuredClone(graph);
  input.images.find(row => row.id === 'exact')!.type = 'VIDEO';
  const result = buildProductCardMedia(input, ['vr', 'vb'], 'vr');
  expect(result.variants[0]).toEqual({ variantId: 'vr', cover: null, scene: null });
});
```

参数化补：exact 不存在→option、option 不存在→shared、无 scene、scene=cover、equal sortOrder 由 id 稳定、未定价/disabled 不在 selectable IDs、legacy 无 options。JSON 输出不能包含 isScene/optionValueId/variant scope FK 或 supplier/bundle internals。

- [ ] **Step 2: 运行 RED。**

```bash
pnpm --dir small-house-commerce/backend exec vitest run src/modules/catalog/product-card-media.spec.ts src/modules/catalog/product-media.resolver.spec.ts
```

- [ ] **Step 3: 最小 pair builder。** 用 resolveProductMedia 得到有效 set；scene 通过已返回 set 的媒体 id 查原 graph flag，不能扩大到其他 scope。默认展示 ID 校验属于当前 active graph；无展示 ID 用纯 resolver 的空 request 得到 shared。公开 pair 只用 resolver 白名单结果。

```ts
function pair(request: MediaScopeRequest): ProductCardMediaPair {
  const set = resolveProductMedia(graph, request);
  const cover = set.media.find((row): row is ProductCardImage => row.type === 'IMAGE') ?? null;
  const marked = new Set(graph.images.filter(row => row.isScene).map(row => row.id));
  const scene = set.media.find((row): row is ProductCardImage =>
    row.type === 'IMAGE' && marked.has(row.id)) ?? null;
  return { cover, scene };
}
```

此 pair 是 buildProductCardMedia 内局部函数，不导出新 service。默认 display 内部 fallback 沿用现有 mediaDisplayVariant，不等同于前端预选。

- [ ] **Step 4: 改同一 batch query，不另加每 SKU 请求。** STOREFRONT_SELECT 共享图片内部 select 增 isScene；scoped query 将现有 defaultVariantIds 扩成全部本页 variant IDs，继续单次 productImage.findMany，select isScene。按 productId 分桶复用给原 effectiveCover/thumbnails 和新 builder；presentStorefront 在原白名单输出上追加 cardMedia。旧 images/publicStorefrontMedia 保持原键集。

服务测试分别喂1与20个产品：断言 scene 对应每款式、调用 batch media reader最多一次、where 含本页全部真实 IDs，不能仅检查 mock 被构建。CMS 首页/Collection 的现有 storefrontByIds hydration 用真实返回形状回归，不额外打 PDP API。列表无 detailBlocks/effectiveFaq/full scoped galleries；PDP 原 mediaSet/视频/排序测试必须全绿。

- [ ] **Step 5: 全后端 GREEN，frontend types 收敛。** 实际build留到Task 8的隔离副本，避免原backend watch运行时覆盖dist。

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
```

## Task 5: 卡片选款派生与图片 hover/键盘/触屏

**Files:**
- Modify: `frontend/src/lib/product-card-presentation.ts`、`.spec.ts`
- Create: `frontend/src/components/product/ProductCardImage.tsx`、`.spec.tsx`

**Interfaces:**

```ts
export function cardInitialVariantId(product: Product): string | null;
export function cardMediaForSelection(
  product: Product,
  resolvedVariantId: string | null,
  selectedValueIds: Readonly<Record<string, string>>,
): ProductCardMediaPair;
export interface ProductCardImageProps {
  productName: string;
  media: ProductCardMediaPair;
  href: string | null;
  navigationTrackAttrs?: Readonly<Record<string, string>>;
  children?: ReactNode;
}
```

- [ ] **Step 1: 派生函数 RED。** 在现有 presentation.spec fixture 中测试：有效 default 返回其真实 ID；default 缺失/disabled/unpriced 返回 null；只有一个候选由既有 provider自动解析，不用此函数偷选。

已解析且投影存在时原样取 pair，即使 cover=null 也不跨 scope 回退。完整投影暂缺时，所选媒体驱动选项缩略图→共享 IMAGE，scene=null。尚未完整选择但已触及选项时，也用所选驱动值/共享 IMAGE 且不显示默认另一颜色 scene；真正未选任何值才使用 cardMedia.unselected。测试 partial Color=Blue/Size 未选，不能显示 Red 默认场景。售价0仍为可选择 SKU，不用 truthiness 判断 price。

- [ ] **Step 2: 图片控件 RED。** 给真实 ProductCardImage 渲染 literal pair，使用 fireEvent load/error 验证加载前保持 cover；不依赖 jsdom 自动加载资源。

```tsx
const pair: ProductCardMediaPair = {
  cover: { id: 'cover', url: '/cover.webp', type: 'IMAGE', altText: 'Cover', sortOrder: 0 },
  scene: { id: 'scene', url: '/scene.webp', type: 'IMAGE', altText: 'Scene', sortOrder: 1 },
};
it('shows a scene only after image-region hover and successful load', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const view = render(<ProductCardImage productName="Chair" media={pair} href="/products/chair" />);
  const link = screen.getByRole('link');
  expect(view.container.querySelector('[data-card-scene]')).toBeNull();
  fireEvent.pointerEnter(link, { pointerType: 'mouse' });
  const scene = view.container.querySelector<HTMLImageElement>('[data-card-scene]')!;
  expect(scene).toHaveAttribute('src', '/scene.webp');
  expect(scene).toHaveAttribute('data-visible', 'false');
  fireEvent.load(scene);
  expect(scene).toHaveAttribute('data-visible', 'true');
  fireEvent.pointerLeave(link, { pointerType: 'mouse' });
  expect(scene).toHaveAttribute('data-visible', 'false');
});
```

对以下每条给真实事件和输出断言：pointer coarse/none 不创建 scene；error 保留 cover；leave 后晚到 load 不重新激活；换 pair 后旧 load 不显示旧图；Tab focus-visible 可预览但 pointer 产生 focus 不激活；scene=null/同 URL 无无意义请求；href=null 无可导航 link；cover=null 有稳定占位。

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/lib/product-card-presentation.spec.ts src/components/product/ProductCardImage.spec.tsx
```

- [ ] **Step 3: 最小实现。** cardInitialVariantId 用现有 isSelectableVariant 判定 backend default。媒体回退只返回 IMAGE，绝不把 effectiveCoverMedia 的 VIDEO URL放 img；selection 完整但 pair 空时保留占位规则。

图片为4:5稳定占位、cover常驻、scene覆盖层。scene 在 fine mouse hover 或 keyboard focus-visible 首次实际需要时才创建；loaded/error 以 scene URL 身份隔离，换 URL remount内部状态。是否可见同时要求“当前意图仍 active + 当前 URL已loaded + 未失败”，不能 onLoad 直接置 active。pointer enter 检查 pointerType，focus 检查 `:focus-visible`；不阻止默认 link 点击。

- [ ] **Step 4: CSS 与 GREEN。** 淡入使用 motion-reduce 关闭过渡；hover浮起在 Task 6 article，只绑定 `(hover:hover) and (pointer:fine)`，不以全卡 group-hover 控制图片。jsdom不能证明 touch/focus-visible 真机行为，Task 8 真实浏览器补证。

## Task 6: 共用卡片、行内选项与真实 Add to Cart

**Files:**
- Modify: `frontend/src/components/product/ProductCard.tsx`
- Create: `frontend/src/components/product/ProductCardView.tsx`
- Modify: `frontend/src/components/product/PlpProductCard.tsx`
- Modify: `frontend/src/components/product/ProductOptionSelector.tsx`
- Test: ProductCard.spec、PlpProductCard.spec、ProductOptionSelector.spec、PdpPurchaseProvider.spec、QuickAddView.spec

**Interfaces:**

```ts
export type ProductCardInteractionMode = 'storefront' | 'preview';
export interface ProductCardProps {
  product: Product;
  badge?: string;
  badges?: readonly CardBadge[];
  interactionMode?: ProductCardInteractionMode;
  navigationTrackAttrs?: Readonly<Record<string, string>>;
}
// ProductOptionSelector 保持原 lineId/instanceId，新增：
// density?: 'regular' | 'compact'; disabled?: boolean;
// 默认 regular/false，既有 PDP/Quick Add 外观和行为不变。
```

ProductCardView 在 client 子树内消费派生选择、primaryLine、selector ref 和 action ReactNode；没有 useCart。公共 ProductCard props 全是可序列化数据。PlpProductCard 只传 product/badges 到共用卡片，不再 openPicker、计算价格或维护另一个 busy 状态。

```ts
export interface ProductCardViewProps extends ProductCardProps {
  primaryLine: PurchaseLineState;
  derived: ProductSelectionDerived;
  selectorRoot: RefObject<HTMLDivElement | null>;
  action: ReactNode;
}
```

新增测试工具 `frontend/src/test/product-card-fixtures.ts`，供新的入口/追踪测试使用，避免引用另一个 spec 的私有 fixture。它不是生产 factory，已有 PLP 两组选项 fixture 保留。

```ts
import type { Product } from '@/lib/api';
export function cardTestProduct(overrides: Partial<Product> = {}): Product {
  const cover = { id: 'cover', url: '/cover.webp', type: 'IMAGE' as const,
    altText: 'Cover', sortOrder: 0 };
  return {
    id: 'product-1', name: 'Oak Side Table', slug: 'oak-side-table',
    categoryId: 'category-1', description: null, tagline: null,
    ratingAverage: null, reviewCount: 0, room: null, internalRole: null, solutions: [],
    width: null, height: null, depth: null,
    foldedWidth: null, foldedHeight: null, foldedDepth: null,
    catalogGraphVersion: 1, defaultDisplayVariantId: null,
    effectiveCoverMedia: cover, images: [cover],
    options: [{ id: 'color', kind: 'COLOR', name: 'Color', position: 0,
      presentation: 'TEXT', isMediaDriver: true,
      values: [
        { id: 'red', label: 'Red', position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
        { id: 'blue', label: 'Blue', position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
      ],
    }],
    variants: [
      { id: 'red-variant', name: 'Red', position: 0,
        combinationKey: 'color:red', optionValueIds: ['red'],
        sku: { id: 'red-sku', skuCode: 'RED', status: 'ACTIVE', price: 100,
          compareAtPrice: 130, availableInventory: 4 } },
      { id: 'blue-variant', name: 'Blue', position: 1,
        combinationKey: 'color:blue', optionValueIds: ['blue'],
        sku: { id: 'blue-sku', skuCode: 'BLUE', status: 'ACTIVE', price: 120,
          compareAtPrice: 150, availableInventory: 4 } },
    ],
    ...overrides,
  };
}
```

- [ ] **Step 1: 行内选款 RED。** 在现有 PLP spec 的完整 multiSkuProduct fixture 中将旧“opens picker”测试替换为用户批准的新行为；为 From case显式 default=null，不通过降低断言藏起新默认预选。

```tsx
it('selects the real variant inline and adds it without opening the picker', async () => {
  cart.addItem.mockResolvedValue({ cartId: 'cart', items: [], subtotal: 120,
    discount: 0, shipping: 0, total: 120, expiresAt: '2030-01-01T00:00:00Z' });
  const user = userEvent.setup();
  render(<PlpProductCard product={{ ...multiSkuProduct, defaultDisplayVariantId: null }} badges={[]} />);
  await user.click(screen.getByRole('button', { name: 'Blue', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Large', exact: true }));
  expect(screen.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Large', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'Add to Cart', exact: true }));
  expect(cart.addItem).toHaveBeenCalledWith({ skuId: 'sku-blue-large', quantity: 1 });
  expect(cart.openPicker).not.toHaveBeenCalled();
  expect(tracking.track).toHaveBeenCalledWith('AddToCart',
    expect.objectContaining({ content_ids: ['sku-blue-large'], value: 120 }));
});
```

Cart/tracking 仅替身外部上下文边界；真实 provider、selector、价格工具、卡片均不 mock。新增 Deferred Promise：两次同任务 fireEvent.click 后只一次 addItem；等待中所有选项和 CTA 禁用，完成后有 Added。reject 显示 role=alert，不发转化事件，选择保留，retry 成功。多款无默认 CTA 点击聚焦第一个缺失组，不发请求；有效默认直接显示该 SKU 的价格/compare-at/媒体。

另给 literal 场景：单 SKU、0库存可Save for Later、price=0、disabled/unpriced详情、legacyStyle、两独立卡与父PDP隔离、商品替换pending、long labels/100 candidates。原 RatingStars、左右角徽标、价格测试保持，不新增假评分。

- [ ] **Step 2: 运行 RED。** ProductCard 静态 tests 改为在真实 CartProvider 或明确的完整 cart 边界替身中渲染 storefront；preview 专门不提供 CartProvider，不能全测试一律 mock useCart 掩盖崩溃。

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/product/ProductCard.spec.tsx src/components/product/PlpProductCard.spec.tsx src/components/product/ProductOptionSelector.spec.tsx src/components/product/PdpPurchaseProvider.spec.tsx src/components/cart/QuickAddView.spec.tsx
```

- [ ] **Step 3: 共用组件结构。** ProductCard 顶部 use client。每卡挂独立 PdpPurchaseProvider，initialVariantId只传 Task 5 的有效后台默认，initialQuantity=1；外层 key 包含 product.id/catalogGraphVersion，使换商品/图修订 remount，普通同身份 rerender 保留用户选择。不要改全局 createInitialSelection。

```tsx
<PdpPurchaseProvider
  key={JSON.stringify([product.id, product.catalogGraphVersion])}
  product={product} initialVariantId={cardInitialVariantId(product)} initialQuantity={1}
>
  <CardBody {...props} />
</PdpPurchaseProvider>
```

CardBody 只 usePdpPurchase，构建同一 view；action 在 storefront 才是 ProductCardActions（本文件内私有组件），preview 是 disabled Button。只有 ProductCardActions 调 useCart，不能先无条件 useCart 再检查 mode。

ProductOptionSelector 新增 compact/disabled：compact仅改间距、字号和宽度；两组值完整换行、保留可触达44px高度。disabled进入真实按钮disabled及click早返回，preview无option_select。用 data-option-id 标识组供缺失聚焦，避免把 UUID 拼成未转义 CSS selector。

```tsx
function CardBody(props: ProductCardProps) {
  const { primaryLine, primaryDerived } = usePdpPurchase();
  const selectorRoot = useRef<HTMLDivElement | null>(null);
  const mode = props.interactionMode ?? 'storefront';
  return <ProductCardView {...props} interactionMode={mode}
    primaryLine={primaryLine} derived={primaryDerived} selectorRoot={selectorRoot}
    action={mode === 'preview'
      ? <Button disabled className="w-full">Add to Cart</Button>
      : <ProductCardActions product={props.product} selectorRoot={selectorRoot} />} />;
}
```

- [ ] **Step 4: 同步锁与确认次序。** ProductCardActions 消费 useCart 与 usePdpPurchase。不能用 purchaseConfirmed=false 拒绝尚未点击 Add 的有效解析 SKU；Add 本身确认。确认在 provider lock 之前。私有 actions 的状态与生命周期如下，不给生产 Context 添加测试清理方法。

```ts
type CardFeedback =
  | { revision: number; kind: 'added' }
  | { revision: number; kind: 'error'; message: string };
const requestLocked = useRef(false);
const alive = useRef(true);
const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const [busy, setBusy] = useState(false);
const [feedback, setFeedback] = useState<CardFeedback | null>(null);
useEffect(() => {
  alive.current = true;
  return () => { alive.current = false; };
}, []);
useEffect(() => () => {
  if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
}, [primaryLine.selectionRevision]);
const visibleFeedback = feedback?.revision === primaryLine.selectionRevision ? feedback : null;
```

成功设置 added 后启动2000ms timeout；callback同样检查alive，再清反馈。每次启动前清旧timeout。actions的selectorRoot参数与ProductCardView一致。

```ts
async function addSelected() {
  if (requestLocked.current) return;
  const variant = primaryDerived.resolvedVariant;
  const sku = variant?.sku;
  if (!variant || !sku || sku.price === null) {
    setFeedback({ revision: primaryLine.selectionRevision, kind: 'error',
      message: 'Choose your options before adding to cart.' });
    const missingId = primaryDerived.missingOptionIds[0];
    const group = [...(selectorRoot.current?.querySelectorAll<HTMLElement>('[data-option-id]') ?? [])]
      .find(node => node.dataset.optionId === missingId);
    group?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return;
  }
  const snapshot = { productId: product.id, productName: product.name,
    variantId: variant.id, skuId: sku.id, price: sku.price,
    revision: primaryLine.selectionRevision,
    multiple: primaryDerived.selectableVariants.length > 1 };
  requestLocked.current = true;
  confirmLine(primaryLine.clientLineId);
  setPurchaseLocked(true);
  setBusy(true);
  setFeedback(null);
  try {
    await addItem({ skuId: snapshot.skuId, quantity: 1 });
    if (snapshot.multiple) emitCommerceEvent(variantConfirmEvent({
      productId: snapshot.productId, variantId: snapshot.variantId,
      skuId: snapshot.skuId, source: 'QUICK_ADD',
    }));
    emitCommerceEvent(addToCartEvent({ ...snapshot, quantity: 1 }));
    if (alive.current) setFeedback({ revision: snapshot.revision, kind: 'added' });
  } catch (error) {
    if (alive.current) setFeedback({ revision: snapshot.revision, kind: 'error',
      message: error instanceof Error ? error.message : 'Could not add this item. Try again.' });
  } finally {
    requestLocked.current = false;
    if (alive.current) { setBusy(false); setPurchaseLocked(false); }
  }
}
```

上述 refs/states 都在 ProductCardActions 声明；alive effect 挂载true、卸载false。反馈只展示当前 selectionRevision 的值，避免 effect 同步 setState lint；成功2秒恢复普通 CTA，timeout 在选择变化/卸载清理，失败不自动抹掉。真实成功事件即便旧卡已卸载仍用 snapshot，不能误记新卡/新价格；只有本卡 feedback忽略旧响应。锁不扩到其他卡或全站购物车。

- [ ] **Step 5: 视图、薄适配与 GREEN。** ProductCardView保留 rating、PriceBox/From、运营badge/derived discount、4:5比例和原网格容器。选定SKU库存决定Out of Stock/Only n left；缺货button是Save for Later且可用，无sellable只是View Details。标题/图片独立link；沿用实际PDP的 `?variant=` 参数，不是媒体API的variantId参数，也不写当前列表URL。

```ts
const href = interactionMode === 'preview' ? null
  : derived.resolvedVariant
    ? `/products/${product.slug}?variant=${encodeURIComponent(derived.resolvedVariant.id)}`
    : `/products/${product.slug}`;
```

article加 fine hover 2px/reduced-motion禁动画，不把hover行为绑到整张图层。

统一行为selector/test定位采用 role 与 article `data-product-id`；现有 PLP test id 若随旧组件删除，在调用tests中同步迁移，不加只为旧测试服务的兼容prop。

```bash
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
```

## Task 7: 所有公共入口、纯预览与首页追踪

**Files:**
- Modify: `frontend/src/components/home/ProductGridSection.tsx:7,31-37`
- Modify: `frontend/src/components/home/sectionRegistry.tsx:18-21`
- Modify: `frontend/src/components/admin/homepage/HomepageLivePreview.tsx:509-545`
- Modify/Test: `frontend/src/components/admin/homepage/HomepageLivePreview.spec.tsx`
- Create: `frontend/src/components/home/ProductGridSection.spec.tsx`
- Create: `frontend/src/components/home/HomeTracking.spec.tsx`
- Read/verify only: RecentlyViewed、PdpView、搜索page、集合page、CategoryPlpClient、RoomInspirationSection

**Interfaces:** `SectionProps.interactionMode?: ProductCardInteractionMode`；ProductGrid传同mode；HomepageLivePreview明确preview。首页通过 `ProductCard.navigationTrackAttrs` 给真实图片/标题links传数据属性，属性值全为string、RSC可序列化。

- [ ] **Step 1: preview/追踪 RED。** 在真实 HomepageLivePreview现有 catalog fixture里渲染有多SKU的PRODUCT_GRID，不提供CartProvider。用真实公共卡而非空mock renderer；选择/CTA禁用，链接无实际导航/购物车API/商业事件。

对真实 HomeTracking用spy隔离外部tracking：先验证选项和CTA不带ProductClick属性，再点击标题/图片确认section_id、position正确。

```tsx
import { cardTestProduct } from '@/test/product-card-fixtures';
const sectionWithMultiProduct: HomepageSection = {
  id: '10000000-0000-7000-8000-000000000001', type: 'PRODUCT_GRID',
  title: 'Product card test', subtitle: null, sortOrder: 0, payload: {},
  products: [{ ...cardTestProduct(), badge: 'New' }],
};
const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
const cart = vi.hoisted(() => ({ addItem: vi.fn().mockResolvedValue({
  cartId: 'cart', expiresAt: '2030-01-01T00:00:00Z', items: [],
  subtotal: 120, discount: 0, shipping: 0, total: 120,
}), openPicker: vi.fn() }));
vi.mock('@/lib/tracking', () => tracking);
vi.mock('@/components/cart/CartContext', () => ({ useCart: () => cart }));
it('counts navigation but not inline option or add clicks as ProductClick', async () => {
  render(<><HomeTracking /><ProductGridSection section={sectionWithMultiProduct} /></>);
  tracking.trackCustom.mockClear();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Blue', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Add to Cart', exact: true }));
  expect(tracking.trackCustom.mock.calls.filter(([name]) => name === 'ProductClick')).toHaveLength(0);
  const title = screen.getByRole('link', { name: 'Oak Side Table', exact: true });
  title.addEventListener('click', event => event.preventDefault());
  await user.click(title);
  expect(tracking.trackCustom).toHaveBeenCalledWith('ProductClick',
    expect.objectContaining({ section_id: sectionWithMultiProduct.id, position: 1 }));
});
```

这是HomeTracking独立spec中的外部cart/tracking替身，不能把它移成全局mock。HomepageLivePreview.spec使用真实公共卡与真实useCart模块、且不提供CartProvider，以便实际发现错误分支调用购物车hook。两处均不 mock ProductCard/PdpPurchaseProvider/HomeTracking。浏览器另验证标题真实导航。

- [ ] **Step 2: 运行 RED。**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/homepage/HomepageLivePreview.spec.tsx src/components/home/ProductGridSection.spec.tsx src/components/home/HomeTracking.spec.tsx
```

- [ ] **Step 3: 最小接线。** 从PRODUCT_GRID外层contents div移走trackAttrs。其返回值只作为navigationTrackAttrs传给ProductCard，在两条详情link应用；preview不应用。HomepageLivePreview的Renderer加interactionMode="preview"，保留原link capture、previewDevice和scroll画布。

```tsx
<ProductCard
  product={product} badge={product.badge ?? undefined}
  interactionMode={interactionMode}
  navigationTrackAttrs={interactionMode === 'preview'
    ? undefined : trackAttrs('ProductClick', section, index + 1)}
/>
```

不修改HomeTracking的全局closest规则去猜CTA，这会影响其他section。RoomInspiration保持原独立链接/场景交互。搜索/集合是Server Component，公共卡props仍只传序列化Product；不把页面整体改成client。RecentlyViewed/PdpView继续同一公共卡，自然得到新行为。

- [ ] **Step 4: GREEN 与回归。** 覆盖真实PDP外层purchase provider里related card选款，确认主商品状态/URL不变；后台无CartProvider模式没有throw，禁用按钮不发option_select/add事件。三种固定设备画布不变；不重启已暂缓首页外壳任务。

```bash
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
```

## Task 8: 独立真实浏览器验收与完整收口

**Files:**
- Create: `frontend/src/test/product-card-test-target.ts`、`.spec.ts`
- Create: `frontend/e2e/product-card-prepare.ts`
- Create: `frontend/playwright.product-card.config.ts`
- Create: `frontend/e2e/product-card.spec.ts`
- No change: 现有 playwright.config、e2e-guard、bootstrap、seed-e2e、原 `.next`、protected uploads

**Interfaces:**

```ts
export function assertProductCardTestTarget(
  databaseUrl: string | undefined,
  root: string | undefined,
): { databaseUrl: string; root: string };
```

这个测试工具只接受 `postgresql://`、loopback host、5432、数据库 `small_house_product_card_20261010_test`、public schema以及绝对 `/private/tmp/luwag-product-card-*`根。不得扩大已有 small_house_variant_test guard。Playwright config只连3215，workers=1、只匹配本轮spec，不自动启动/migrate/seed。prepare先guard，再复制、seed；应用启动用主会话后台任务跟踪，完成通知而非轮询。

- [ ] **Step 1: 安全guard RED。** 参数化拒绝 rehearsal、small_house_variant_test、prod、非loopback、不同port、不同schema、root=worktree/backend或相对目录；只允许精确目标。guard必须先于任何fs/数据库写调用。

```ts
it.each([
  ['postgresql://postgres:postgres@localhost:5432/small_house_homepage_rehearsal', '/private/tmp/luwag-product-card-abc'],
  ['postgresql://postgres:postgres@example.invalid:5432/small_house_product_card_20261010_test', '/private/tmp/luwag-product-card-abc'],
  ['postgresql://postgres:postgres@localhost:5432/small_house_product_card_20261010_test', '/Users/Admin1/project'],
])('refuses a non-owned test target', (url, root) => {
  expect(() => assertProductCardTestTarget(url, root)).toThrow();
});
```

- [ ] **Step 2: 最小guard与临时应用准备。** guard实现在测试工具模块，无文件/网络写副作用。

```ts
export function assertProductCardTestTarget(databaseUrl: string | undefined, root: string | undefined) {
  if (!databaseUrl || !root) throw new Error('Explicit product-card test target required');
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgresql:' ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      (url.port || '5432') !== '5432' ||
      url.pathname !== '/small_house_product_card_20261010_test' ||
      (url.searchParams.get('schema') ?? 'public') !== 'public' ||
      !/^\/private\/tmp\/luwag-product-card-[A-Za-z0-9_-]+$/.test(root)) {
    throw new Error('Refused product-card test target');
  }
  return { databaseUrl, root };
}
```

先运行 `pnpm --dir small-house-commerce/frontend exec vitest run src/test/product-card-test-target.spec.ts`，拒绝/允许目标行为均GREEN才准备应用。

prepare从当前源码复制必要文件，不复制 `.env`、uploads、`.next`、dist、node_modules实体或用户文件；依赖用directory symlink，临时源码/构建/上传独立。先验证root新建为空、realpath不指回worktree，写本会话owner marker；脚本只操作此root。不自动清理未知已有目录。

```ts
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync,
  symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertProductCardTestTarget } from '../src/test/product-card-test-target';
const source = resolve(__dirname, '../..');
const target = assertProductCardTestTarget(
  process.env.PRODUCT_CARD_TEST_DATABASE_URL, process.env.PRODUCT_CARD_TEST_ROOT);
if (!statSync(target.root).isDirectory() || realpathSync(target.root) !== target.root)
  throw new Error('Test root must be a real, newly created temporary directory');
if (readdirSync(target.root).length !== 0) throw new Error('Test root must be new and empty');
const copies = {
  backend: ['src', 'prisma', 'prisma.config.ts', 'package.json', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json'],
  frontend: ['src', 'public', 'package.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'next-env.d.ts'],
};
for (const [app, entries] of Object.entries(copies)) {
  mkdirSync(join(target.root, app));
  for (const entry of entries) {
    const from = join(source, app, entry);
    if (existsSync(from)) cpSync(from, join(target.root, app, entry), { recursive: true });
  }
  symlinkSync(join(source, app, 'node_modules'), join(target.root, app, 'node_modules'), 'dir');
}
writeFileSync(join(target.root, '.product-card-owner'), 'unified-product-card-20261010');
const env = { ...process.env, DATABASE_URL: target.databaseUrl };
for (const args of [
  ['exec', 'prisma', 'migrate', 'deploy'],
  ['exec', 'prisma', 'generate'],
  ['exec', 'tsx', 'prisma/seed.ts'],
  ['exec', 'tsx', 'prisma/seed-e2e.ts'],
]) execFileSync('pnpm', args, { cwd: join(target.root, 'backend'), env, stdio: 'inherit' });
```

复用 seed-e2e 的真实商品/变体/SVG/库存；该script硬编码相对uploads路径，但现在执行于复制后的临时 backend/prisma，写入的是临时backend/uploads，不是protected目录。copy之前只读源码，不复制原uploads。migrate仍需要营销协调窗口。浏览器演示数据仅在此库，不能把现有rehearsal商品改ACTIVE。

- [ ] **Step 3: 独立配置与启动。** 以下变量只在实际执行时设；计划编写阶段不运行。

```ts
// playwright.product-card.config.ts
assertProductCardTestTarget(process.env.PRODUCT_CARD_TEST_DATABASE_URL,
  process.env.PRODUCT_CARD_TEST_ROOT);
export default defineConfig({
  testDir: './e2e', testMatch: 'product-card.spec.ts',
  workers: 1, fullyParallel: false, retries: 0, timeout: 90_000,
  use: { baseURL: 'http://localhost:3215', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

创建根目录前检查 `/private/tmp`；mktemp返回的新目录记录到本会话证据。依次prepare、后台任务启动backend、确认真实API可达、后台任务启动frontend。webpack避免临时应用的跨目录node_modules symlink与Turbopack root推断冲突；若安装版Next CLI不支持该选项，先查安装版docs，不改业务next.config来掩盖。

```bash
PRODUCT_CARD_TEST_ROOT="$(mktemp -d /private/tmp/luwag-product-card-XXXXXX)"
PRODUCT_CARD_TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/small_house_product_card_20261010_test?schema=public'
# 变量须在各独立 tool 调用显式传递，shell state 不会跨调用保存。
PRODUCT_CARD_TEST_ROOT="$PRODUCT_CARD_TEST_ROOT" PRODUCT_CARD_TEST_DATABASE_URL="$PRODUCT_CARD_TEST_DATABASE_URL" pnpm --dir small-house-commerce/backend exec tsx ../frontend/e2e/product-card-prepare.ts
DATABASE_URL="$PRODUCT_CARD_TEST_DATABASE_URL" PORT=3214 HOST=127.0.0.1 JWT_SECRET='product-card-local-test-secret-20261010-abcdef' HOMEPAGE_PREVIEW_SECRET='product-card-local-preview-secret-20261010-abcdef' UPLOAD_DIR="$PRODUCT_CARD_TEST_ROOT/backend/uploads" pnpm --dir "$PRODUCT_CARD_TEST_ROOT/backend" start:dev
API_TARGET='http://127.0.0.1:3214' NEXT_TELEMETRY_DISABLED=1 pnpm --dir "$PRODUCT_CARD_TEST_ROOT/frontend" exec next dev --webpack --hostname localhost --port 3215
```

每个server是独立后台任务，不在同一前台shell依次等待无限期server。原3002/3005的watch可能因源码更新自然重新编译，这不允许测试runner清它们的output或重启它们。

- [ ] **Step 4: Browser fixture与RED/GREEN。** E2E admin凭据复用源seed常量 `e2e-admin@smallhouse.test / E2eAdminPass123!`（仅此测试库）；一轮只login一次，在fixture保存token。调用真实admin GET/PATCH带expected graph version，给共享、颜色值、精确款式各新增不同SVG IMAGE并指定scene；价格/compareAt测试使用独立fixture或仅改本轮数据库seed商品。

用真实homepage API GET draft→PUT draft(expectedRev)→POST publish创建临时首页grid，复用emptyDocument/defaultSection并填完整join。HERO结构保留但disabled，避免空Hero阻止此商品卡fixture发布；只有新测试库的首页改变，不影响其他主页。

```ts
const headers = { Authorization: `Bearer ${adminToken}` };
const draftResponse = await api.get('/api/v1/admin/homepage/draft', { headers });
expect(draftResponse.ok()).toBe(true);
const snapshot = await draftResponse.json();
const productResponse = await api.get('/api/v1/storefront/products/e2e-color-size');
expect(productResponse.ok()).toBe(true);
const seededProduct: Product = await productResponse.json();
const doc = emptyDocument();
doc.sections[0].enabled = false;
const grid = defaultSection('PRODUCT_GRID', crypto.randomUUID(), 10);
grid.title = 'Product card acceptance';
grid.products = [{ productId: seededProduct.id, sortOrder: 0, badge: 'Card test' }];
doc.sections.push(grid);
const saved = await api.put('/api/v1/admin/homepage/draft', {
  headers, data: { draft: doc, expectedRev: snapshot.draftRev },
});
expect(saved.ok()).toBe(true);
const published = await api.post('/api/v1/admin/homepage/publish', {
  headers, data: { note: 'Product card local acceptance', publishAt: null,
    unpublishAt: null, confirmWarnings: true },
});
expect(published.ok()).toBe(true);
```

fixture先从公共homepage接口回读，确认grid中包含seededProduct.id，不能空grid让测试跳过。真实collection通过已有admin collection API在新库创建，related由已有seed同category商品验证，RecentlyViewed先访问对应PDP再回首页。无需修改homepage/collection生产service。

核心浏览器case使用源码已确认的`e2e-color-size` Blue/Medium组合，skuCode=`E2E-CS-BLUE-M`、price=1199、onHand=1000；该seed没有Large。用独立SKU code定位expected，不按variants数组位置选expected。各test通过beforeEach取得APIRequestContext与共享adminToken，只在新测试库登录一次。

```ts
test('category selects a SKU inline and sends it once to the real cart', async ({ page, request }) => {
  const productResponse = await request.get('/api/v1/storefront/products/e2e-color-size');
  expect(productResponse.ok()).toBe(true);
  const product: Product = await productResponse.json();
  const expected = product.variants.find(row => row.sku?.skuCode === 'E2E-CS-BLUE-M')?.sku;
  expect(expected?.price).toBe(1199);
  const writes: string[] = [];
  page.on('request', req => {
    if (req.method() === 'POST' && /\/storefront\/cart\/items$/.test(req.url()))
      writes.push(req.postData() ?? '');
  });
  await page.goto('/categories/e2e-catalog');
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'E2E Color x Size Cabinet' }) });
  await card.getByRole('button', { name: 'Blue', exact: true }).click();
  await card.getByRole('button', { name: 'Medium', exact: true }).click();
  const responsePromise = page.waitForResponse(res =>
    res.request().method() === 'POST' && /\/storefront\/cart\/items$/.test(res.url()));
  await card.getByRole('button', { name: 'Add to Cart', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  await expect.poll(() => writes.length).toBe(1);
  expect(JSON.parse(writes[0]).quantity).toBe(1);
  expect(JSON.parse(writes[0]).skuId).toBe(expected!.id);
  const added: CartSummary = await response.json();
  const read = await request.get(`/api/v1/storefront/cart/${added.cartId}/summary`);
  expect(read.ok()).toBe(true);
  const cart: CartSummary = await read.json();
  expect(cart.items.some(item => item.skuId === expected!.id && item.quantity === 1)).toBe(true);
  await expect(page.getByRole('dialog')).toBeVisible();
});
```

该case必须在为每case新建的browser context运行，不能沿用此前已加同SKU的cart。响应、数据库服务回读及最终SKU共同证明成功，dialog可见本身不能作为加购成功。

- [ ] **Step 5: 完整浏览器矩阵。**

| 环境/动作 | 明确断言 |
|---|---|
| 首页、类目、搜索 | 选款→当前首图/compare-at→真实SKU数量1；无Order Now；原网格/运营badge保留 |
| 集合、PDP相关推荐、RecentlyViewed | 同一行内控件/加购；related卡不能改主PDP选择/URL |
| Shared/Option/Variant | 保存回读flag；精确scope优先，无scene不借其他颜色；取消后恢复首图 |
| hover | 图片区域进/出，先保留cover再scene，价格/选项hover不切，晚load/失败不串旧款 |
| no-hover触屏 | 新browser context isMobile/hasTouch，第一次tap详情不被吞、不生成scene资源请求 |
| keyboard/reduced-motion | Tab选项/图片/CTA、focus-visible、失焦恢复、明确checked/busy、关闭动画 |
| 375双列、768、1440 | 无横向溢出/裁切；长标签、两个组选项、CTA可触达 |
| 后台首页装修 | 无CartProvider崩溃；preview禁用购买/选项，不导航、不商业埋点；固定设备画布/scroll保持 |
| 失败/重复 | route仅在失败case返回一次500；错误可读、retry成功；真实golden path不route mock；双击请求一次 |
| 网络/console | 选款/hover不新增PDP/媒体API；允许按需图片；无本轮console/page/hydration错误 |

涉及fresh服务数据的导航发送`Cache-Control: no-cache`，对照backend回读，不把Next16 dev fetch粘连当保存失败。Pixel缺配置时不声称验证生产Pixel；事件确切次数由Task 6真实组件+tracking边界测试证明。

```bash
PRODUCT_CARD_TEST_ROOT="$PRODUCT_CARD_TEST_ROOT" PRODUCT_CARD_TEST_DATABASE_URL="$PRODUCT_CARD_TEST_DATABASE_URL" pnpm --dir small-house-commerce/frontend exec playwright test --config playwright.product-card.config.ts --project chromium
```

- [ ] **Step 6: 整树 fresh gates + inline自审。** 完整tsc/lint前等待营销线自己的临时探针目录清理/收口；不能加ignore或删peer目录让门禁虚假通过。unit/tsc/lint在当前worktree运行，全部失败按名字报告。后端完整tsc历史18条不是免责，重新记录分布。

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
git diff --check
```

前后端build都在临时副本，避免原3002的dist及3005的.next被build覆盖。先用TaskStop停止本会话测试dev任务；核对临时root的owner marker和realpath。源树有修改时更新副本：移动旧src到临时root的兄弟目录，再复制当前src，不以overlay保留已删源码。

```bash
mv "$PRODUCT_CARD_TEST_ROOT/backend/src" "$PRODUCT_CARD_TEST_ROOT/backend-browser-src"
mv "$PRODUCT_CARD_TEST_ROOT/frontend/src" "$PRODUCT_CARD_TEST_ROOT/frontend-browser-src"
cp -R small-house-commerce/backend/src "$PRODUCT_CARD_TEST_ROOT/backend/src"
cp -R small-house-commerce/frontend/src "$PRODUCT_CARD_TEST_ROOT/frontend/src"
cp small-house-commerce/frontend/next.config.ts "$PRODUCT_CARD_TEST_ROOT/frontend/next.config.ts"
cp small-house-commerce/frontend/tsconfig.json "$PRODUCT_CARD_TEST_ROOT/frontend/tsconfig.json"
pnpm --dir "$PRODUCT_CARD_TEST_ROOT/backend" build
```

如果prisma/package/config也变动，先复制其当前确切文件到已核验的副本并在迁移窗口更新专属库，再generate；不读/复制.env。backend build后以同样明确本地env在3214启动本会话临时 `start:prod` 任务，API可达后运行frontend build，保证构建读到的是当前真实测试API。

```bash
DATABASE_URL="$PRODUCT_CARD_TEST_DATABASE_URL" PORT=3214 HOST=127.0.0.1 JWT_SECRET='product-card-local-test-secret-20261010-abcdef' HOMEPAGE_PREVIEW_SECRET='product-card-local-preview-secret-20261010-abcdef' UPLOAD_DIR="$PRODUCT_CARD_TEST_ROOT/backend/uploads" pnpm --dir "$PRODUCT_CARD_TEST_ROOT/backend" start:prod
API_TARGET='http://127.0.0.1:3214' NEXT_TELEMETRY_DISABLED=1 pnpm --dir "$PRODUCT_CARD_TEST_ROOT/frontend" build
```

两个命令分开调用，start:prod为后台任务。出现修复后的重验时，建立新的临时验证副本或给旧src备份唯一名字，不覆盖已存在的browser-src；不因一次build成功省略受影响浏览器矩阵的重跑。

inline审查只看本轮精确diff和规格逐项覆盖，确认没把别人的内容回退。Critical/Important有可复现证据就补RED→GREEN；不启动广泛多代理review，不把API/stream工具故障当代码失败。截图与console/network证据写入本会话临时目录，截图必须实际查看，不仅保存文件名。

- [ ] **Step 7: 只清自己的测试资源，停止在本地验收。** 用TaskStop停止本会话3214/3215任务，确认端口释放；删除临时root前核对owner marker和realpath，先移除自己的node_modules symlink，不递归跟随到真实依赖。可保留有用screenshots/logs；不drop测试库、不清原uploads/.next/peer临时目录、不停止3002/3005。向用户报告已实现项、实际通过/失败的门禁与可打开的rehearsal页面，不以本地验收推导发布授权。

## 规格覆盖与计划自审

| 规格 | 任务 |
|---|---|
| §1/2 原A6与入口统一 | Task 6、7、8 |
| §3 字段/唯一/旧请求/事务 | Task 1、2 |
| §4 后台图库与上传/草稿保护 | Task 3 |
| §5 同scope轻量批量投影/无N+1 | Task 4、5、8 |
| §6 默认款式、两组选项、价格/库存、深链 | Task 5、6 |
| §7真实加购/同步锁/事件 | Task 6、7、8 |
| §8 hover、触屏、键盘、reduced-motion/双列 | Task 5、6、8 |
| §9无副作用预览 | Task 6、7、8 |
| §10并行协调/旧功能保护 | 前置checkpoint、Task 1/2/3/4 |
| §11/12完整门禁和发布边界 | 各任务GREEN、Task 8最终gate |

- 每个新接口在其所属Task列出完整签名，后续使用相同名称；没有发明confirmIfResolved、runWithPurchaseLock等不存在API。
- 场景字段省略/false/true、scope变化、VIDEO、legacy整表替换与typed最终快照已分开处理。
- 卡片完整投影为空与旧缓存无投影是不同分支；不会让视频only精确图库借别scope图片。
- Native执行方式已保留，checkpoint不commit；用户读完本计划后才调用executing-plans。

**下一闸：** 用户审阅本计划。当前只有规格与计划文档，所有任务checkbox均为未执行；无产品代码、迁移、fixture或测试server由本计划编写阶段创建。
