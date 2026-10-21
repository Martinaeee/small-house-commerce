# 商品卡 V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 保留用户已指定的 Native 主会话执行方式；不派发 implementer、reviewer 或 Workflow。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个真实变体独立设置卡片封面/悬停图片，在全站共享商品卡中使用紧凑、完整可选的变体控件和明显但稳定的悬浮反馈。

**Architecture:** 在 ProductVariant 上保存可空的结构化双图快照，图库继续承担 PDP 媒体职责；公共卡片从变体快照批量投影，不继承共享图库。卡片复用现有购买状态与 SKU 匹配规则，新增聚焦的紧凑选择控件，不改价格、购物车、库存及 Bundle 算法。

**Tech Stack:** Next.js 16.3.4、React 19.2.8、Tailwind 4、NestJS 12、Prisma 7.10.0 / adapter-pg、PostgreSQL、Zod 4、Vitest、RTL、Playwright、pnpm 12.3.4。

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-11-product-card-v2-design.md`

**状态:** 设计已审阅；本计划待用户审阅。当前只写计划，没有开始 V2 应用代码、迁移、数据配置或发布。

## Global Constraints

- 仅在当前 `feature/homepage-builder` worktree 工作；下文文件路径相对于 `small-house-commerce/`，命令从 worktree 根目录运行。
- 不提交、push、merge、创建 PR 或部署，除非用户另行授权；所有任务的检查点只记录证据，不运行 git add/commit。
- 不操作生产数据，不触碰 protected `backend/uploads/`，不重启 3000/3001；不停止或清理当前 3002/3005、原 dist/.next。
- 与营销线协调共享数据库/schema/generate 窗口；测试使用本轮独立数据库与运行副本，不向其他库自动应用待执行迁移。
- 不改变金额、库存、Bundle 组件计算、营销归因或费用逻辑；不恢复暂缓的首页完整外壳、Header/Footer 编辑或公告富文本倒计时任务。
- 前台全英文，后台使用既有 zh/en i18n，zh 默认；保留 LUWAG 当前字体、配色及各入口网格。
- 图片区域 1:1；封面 contain，悬停图 cover。桌面整卡上移约 6px，图片区域内才换图；触屏不浮起，reduced-motion 无位移/动画。
- 双图只接受 IMAGE；图库选择复制 URL/Alt 快照，不重排图库、不插入 PDP 精确图库、不继承共享图或选项值缩略图。
- 省略配置字段表示不修改；明确清空表示移除对应槽位。保持真实 variant/SKU 身份、目录版本锁与冲突保护。
- 多款默认展示由运营明确设置，不猜第一/最便宜 SKU；单个可选 SKU 沿用现有无歧义自动解析。
- 每组选项一行、按实际宽度收纳，超出用 +N；所有选项可访问，选中值始终可见；不展示套餐购买模块、数量控制或多行 PDP 表单。
- 独立 Bundle 商品及其真实变体仍可展示/购买，不用 bundle/set 等标签猜测并删除 SKU。
- Add to Cart 使用真实选中 SKU、数量 1；保留同步重复提交锁、确认顺序、请求快照、事件及 Save for Later。
- 选择/悬停不请求 PDP 或媒体 API；图片/标题 Next Link 保持 `prefetch={false}`，不把 dev 无预取当成 production 证据。
- 后台预览无购买、选款、导航或商业埋点副作用，且不要求 CartProvider。
- 当前树有尺寸、包装、Bundle、FAQ、首页和营销并行未提交改动；每次修改前 Read 最新内容并做窄 Edit，不能用旧快照覆盖共享文件。
- 最终为作者 inline self-review，明确弱于独立审查；保留本轮证据，不删除旧 V1 workspace，也不重做 V1 已完成任务。

## Review Focus

1. **只改价格/排序、重新组合、legacy→typed、同名重排时的身份错配**：双图应跟随真实 variant 身份，不能丢失、串给另一 SKU 或重建库存身份。由 Task 1/3 的保存与转换测试固定。
2. **legacy 自动默认与运营明确默认混淆**：兼容层推断第一款不能成为卡片默认；缺配置也不能从旧缓存/共享图补图。由 Task 2/6 的默认与缺图测试固定。
3. **上传迟到、删行/换商品、409 冲突**：旧结果不能写入新对象，原草稿仍可恢复；媒体忙时身份操作与保存不能继续。由 Task 4 的异步 UI 和真实保存冲突测试固定。
4. **窄屏、长标签、末尾选中值、稀疏两维组合**：卡片不溢出、不把唯一可选值藏掉，更多面板完整可选，购买锁一致。由 Task 5/8 的布局与选择测试固定。
5. **生产预取、触屏首击、悬停图迟到与版本替换**：没有额外 PDP 请求、旧悬停图闪回或重复加购；导航后的合法 PDP 图请求不误算卡片 hover。由 Task 6/8 的生产模式浏览器测试固定。

## 已核对的源码事实与文件边界

- `backend/prisma/schema/catalog.prisma` 的 ProductVariant 当前没有独立卡片配置；已有 `Product.defaultDisplayVariantId` 可以继续保存运营默认。
- `catalog-graph.service.ts` 的 `mutateProduct(tx)` 在变体持久化之前执行；最终快照在 persistPlan 末尾读取。上架检查必须放在最终快照阶段，不能在早期 callback 中检查旧 SKU。
- `products.service.ts` 的 legacy reconcile 先按 SKU code、再按名称寻找现有真实行，并采用两阶段名称交换；本轮不改这个既有匹配算法，只在最终匹配到的 variant 行上保存/保留配置。
- `catalog-compat.ts` 的 legacy presentation 会推断第一个可选款作为默认。卡片投影需携带独立的、由原始持久化字段验证出的 displayVariantId；不改 PDP 兼容默认行为。
- `admin-product-graph.ts` 的变体 diff 当前只比较位置、选项引用和 SKU；必须增加双图比较和完整 wire 透传。
- 新商品页实际路径为 `frontend/src/app/admin/(shell)/products/new/page.tsx`。typed 流程先创建空目录商品，再 PATCH 图，再写库存；请求 ACTIVE 时不能在空目录阶段先发布。
- 商品媒体实际由 `ProductMediaPanel.tsx` 组合共享/作用域/详情编辑器；ProductForm 保持完整表单的唯一状态所有者。
- `useMediaBatchUpload` 已支持 `kind: "image"`、`operation: "REPLACE"`、卸载检查和 `isTargetAvailable`。卡片槽位单选文件，不用多文件覆盖一个槽位。
- public `VariantPickerDialog` 包含完整 PDP 选择和购买按钮，不适合直接搬入卡片；admin Dialog 不作为 storefront primitive，也不改其全局初始焦点默认。
- 安装版 Next 文档的浏览器下限为 Chrome/Edge 111、Firefox 111、Safari 16.4；采用这些版本可用的原生 dialog，不引入新的 UI 依赖或较新 Popover API。

## 固定数据与接口契约

### 存储与写入

```ts
interface VariantCardImage {
  type: "IMAGE";
  url: string;
  altText: string | null;
}
interface VariantCardMedia {
  cover: VariantCardImage | null;
  hover: VariantCardImage | null;
}
```

新增 `ProductVariant.cardMedia Json? @map("card_media") @db.JsonB`；迁移只添加可空列，不 backfill 图片或默认款式。

- `VariantWrite.cardMedia?: VariantCardMedia | null`；legacy variant DTO 同形。
- omitted = 不写已有字段；null = SQL NULL/清空整对；object = 完整双槽快照，某槽 null 表示明确清空该槽。
- 非 null 图片严格要求 IMAGE、现有 `siteMediaUrl()`、Alt 最大 255；拒绝 VIDEO、非法 URL、额外图库作用域/ID 等字段。只校验声明与现有 URL 边界，不为检查远程图片而发起服务器外联。
- 两个槽位可以相同 URL；前台不重复切换。允许多个变体由运营分别明确选用同一张图，但没有动态共享继承。
- 使用 Prisma.DbNull 写 SQL NULL，不把 omitted 或 null 混为隐式清空。

### 公共卡片投影

保留现有 `cover/scene` 响应字段与图片结构，存储的 hover 映射到公共 scene；新增 `displayVariantId`。

```ts
interface ProductCardVariantInput {
  id: string;
  cardMedia?: VariantCardMedia | null;
}
interface ProductCardMedia {
  displayVariantId: string | null;
  unselected: ProductCardMediaPair;
  variants: Array<ProductCardMediaPair & { variantId: string }>;
}
function buildProductCardMedia(
  variants: readonly ProductCardVariantInput[],
  selectableVariantIds: readonly string[],
  storedDisplayVariantId: string | null,
): ProductCardMedia;
```

- displayVariantId 仅接受原始持久化默认且仍可选的真实 ID；不使用 legacy presentation 推断出的默认。
- unselected 仅取明确默认的独立双图；没有有效默认为 null pair。
- variant pair 仅来自自己的配置；缺 cover 时两个公共槽位均为 null，不能让 hover 掩盖缺封面。
- 对有 cover 的 pair，scene 可以为空；公共图片 id 为 `card:${variantId}:cover` / `card:${variantId}:hover`，sortOrder 为 0，URL/Alt 来自快照。
- 不再读取 isScene、图库第一张、选项缩略图或媒体 driver；PDP 的 media resolver、effectiveCoverMedia 和图库顺序继续原样。

### 后台与前端边界

```ts
function cardGraphFromLegacyForm(value: ProductFormValue): AdminCatalogGraphDraft;
function setVariantCardImage(
  draft: AdminCatalogGraphDraft,
  variantRef: EntityRef,
  slot: "cover" | "hover",
  image: VariantCardImage | null,
): void;
function buildProductCardPreview(
  value: ProductFormValue,
  draft: AdminCatalogGraphDraft,
  displayVariantRef: EntityRef | null,
): Product;
```

- legacy 表单行补充 `id?/clientKey?/cardMedia?`；legacy 模式以表单行拥有当前草稿，typed 模式以 graph 行拥有当前草稿，不建立第三份卡片状态。
- cardGraphFromLegacyForm 以真实 variant id、已有 SKU id 或明确的新 clientKey 对齐，不按数组位置/标签把图分配给另一个变体；复制当前未保存 SKU/规格/包装/库存输入，保留既有 graph 媒体与 default ref。
- legacy 用户首次编辑卡片图片或默认款时，原子地将最新完整 legacy 草稿转换为 typed 草稿；随后使用既有 graph 保存路径，保留真实 variant/SKU id。只读打开不转换、不写库。
- `setVariantCardImage` 只改匹配行的 cardMedia；图库、SKU、stock/default ref 均不改。
- 后台从图库选择仅复制 `{type:"IMAGE",url,altText}`，不保存图库 ID，不影响图库删除/排序后的卡片快照。

## 环境与预检

执行审批前不执行本节。用户审阅本计划后，以 Native 方式执行；下列本地 schema 操作属于需明确审阅的风险项，不是生产授权。

- [ ] 记录当前 HEAD、dirty paths 与本轮相关文件摘要；查询营销线当前 schema/generate 窗口。并行 RED 不据此判定商品卡失败，也不启动额外 reviewer。
- [ ] 使用新 workspace `.superpowers/sdd/2026-10-11-product-card-v2/`，首次按 executing-plans 创建 ledger；不重用/删除 V1 workspace。
- [ ] 验证 3216/3217 空闲，不杀占用进程。专库固定为 `small_house_product_card_v2_20261011_test`，本地 loopback PostgreSQL 5432、schema=public。
- [ ] 为新空目录使用 `/private/tmp/luwag-product-card-v2-XXXXXX`；owner marker `.product-card-v2-owner` 内容 `product-card-v2-20261011`。输出、截图、build、generated client、uploads 均属于此 root。
- [ ] 当前 3002 watch 服务使用主 worktree。新增 ORM 字段进入该服务前，需在已协调窗口、经用户审阅本地 schema 风险后，仅给 `small_house_homepage_rehearsal` 应用本轮自有的可空列迁移并记录为 applied，再生成主 worktree client；不运行其全量 migrate deploy、不追赶营销迁移、不写商品图片或状态、不重启服务。没有此授权或库身份不明时停在该闸，不让生成 client 查询一个尚不存在的列。
- [ ] 专库则应用当前完整迁移链并 seed 自有 fixtures。新迁移候选目录为 `20261014160000_add_variant_card_media`；执行前再确认无并行同名迁移，冲突只更换本轮尚未执行的新目录名。
- [ ] 运行 fresh baseline：BE/FE 完整 unit suite、完整 tsc、lint；记录实际计数/警告，不引用 V1 或营销线的历史计数。

所有命令使用明确环境；变量在该 shell 调用中设置，不依赖另一工具调用的 shell 状态：

```bash
PROJECT="$PWD/small-house-commerce"
CARD_V2_DB_URL='postgresql://postgres:postgres@localhost:5432/small_house_product_card_v2_20261011_test?schema=public'
```

每任务 gate 将完整输出写入本轮 ledger workspace，通过 context-mode 汇总并读失败；不得只看最后一个命令的退出码。串行运行 CPU/build/schema 操作，`set -e` 或逐项显式校验退出码。

---

### Task 1: 独立双图存储、DTO 与真实身份保存

**Files:**
- Create: `backend/src/modules/catalog/variant-card-media.ts`
- Create: `backend/src/modules/catalog/variant-card-media.spec.ts`
- Create: `backend/prisma/migrations/20261014160000_add_variant_card_media/migration.sql`
- Modify: `backend/prisma/schema/catalog.prisma`
- Modify: `backend/src/modules/catalog/dto/catalog-graph.dto.ts:90-99`
- Modify: `backend/src/modules/catalog/dto/product.dto.ts:37-42`
- Modify: `backend/src/modules/catalog/catalog-graph.service.ts`（PlannedVariant、planIncomingVariant、persistPlan）
- Modify: `backend/src/modules/catalog/products.service.ts`（legacy create/reconcile，仅变体字段）
- Modify: `backend/src/modules/catalog/catalog-compat.ts`（variant metadata 保留，不改默认推断）
- Test: 上述模块 specs、`dto/catalog-graph.dto.spec.ts`、`dto/product.dto.spec.ts`、`catalog-graph.service.spec.ts`、`products.service.spec.ts`、`catalog-compat.spec.ts`

**Interfaces:**
- Consumes: 现有 `siteMediaUrl()`、`EntityRef`、variantWriteSchema、create/updateProductSchema、目录版本锁与 Prisma.TransactionClient。
- Produces: `variantCardImageSchema`、`variantCardMediaSchema`；导出 `VariantCardImage`/`VariantCardMedia`；typed/legacy `cardMedia?: VariantCardMedia | null`；Admin 真实变体读回相同快照。

- [ ] **Step 1: 先写 DTO 行为 RED，而不是只检查新模块能 import。** 在现有 DTO spec 中加入：

```ts
const cardMedia = {
  cover: { type: 'IMAGE', url: '/uploads/cover-a.png', altText: 'A cover' },
  hover: { type: 'IMAGE', url: '/uploads/hover-a.png', altText: null },
};
it('preserves an explicit variant card pair', () => {
  const parsed = catalogGraphPatchSchema.parse({
    variants: [{ clientKey: 'variant-a', position: 0, optionValueRefs: [], cardMedia }],
  });
  expect(parsed.variants[0]?.cardMedia).toEqual(cardMedia);
});
it('rejects video in a card slot', () => {
  const result = catalogGraphPatchSchema.safeParse({
    variants: [{ clientKey: 'variant-a', position: 0, optionValueRefs: [],
      cardMedia: { cover: { type: 'VIDEO', url: '/uploads/a.mp4', altText: null }, hover: null } }],
  });
  expect(result.success).toBe(false);
});
```

再独立覆盖 omitted 无 key、null 保留、单槽 null、非法 URL、Alt 超长、额外 scope/id 字段；legacy create/update 同样保留，不默认填配置。继续接受现有 PostgreSQL 合法的非 RFC version-bit EntityRef，不换掉 uuidSchema。

- [ ] **Step 2: 运行并确认真实 RED。**

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/catalog/dto/catalog-graph.dto.spec.ts src/modules/catalog/dto/product.dto.spec.ts`

Expected: 新图片对象被旧 schema 丢弃、VIDEO 被旧未知字段处理接受，导致上述行为断言 FAIL；不是 typo/import 失败。已有测试结果同时记录。

- [ ] **Step 3: 最小存储与 DTO 实现。**

```ts
export const variantCardImageSchema = z.object({
  type: z.literal('IMAGE'),
  url: siteMediaUrl(),
  altText: z.string().max(255).nullable(),
}).strict();
export const variantCardMediaSchema = z.object({
  cover: variantCardImageSchema.nullable(),
  hover: variantCardImageSchema.nullable(),
}).strict();
export type VariantCardImage = z.infer<typeof variantCardImageSchema>;
export type VariantCardMedia = z.infer<typeof variantCardMediaSchema>;
```

```sql
ALTER TABLE "product_variants" ADD COLUMN "card_media" JSONB;
```

两个 variant schema 加 `cardMedia: variantCardMediaSchema.nullable().optional()`，不使用 default。schema/client/本地服务的采用按环境预检的串行闸执行。

- [ ] **Step 4: 持久化 RED→GREEN。** 扩展现有 graph in-memory fixture 的 VariantRow，但不让 fake 自动补图；先加入对真实读回对象的断言：A/B 双图不同、只改价格/排序不清空、明确 null 清空、默认换款不改双图、rename/选项重排不串图、new identity 没有继承。legacy rename 交换沿用现有 helper：读回 variant id/SKU id 保持，cardMedia 仍对应原行；materialization 后同样成立。

实现时将 cardMedia 的 omitted 与 null 区分一路带入 PlannedVariant：

```ts
const cardMediaWrite = incoming.cardMedia === undefined
  ? {}
  : { cardMedia: incoming.cardMedia === null ? Prisma.DbNull : incoming.cardMedia };
```

该结构只展开到匹配的 variant create/update data；不展开到 sku data，不重建 SKU，不改 disabled 行未触及的元数据。使用当前 Prisma 7 的 InputJsonValue 类型正确表示对象，不能用 any 或 JSON 字符串绕过类型。legacy create 与 reconcile 更新同样采用 undefined/null 分支。

- [ ] **Step 5: 完整 gate 与记录。**

```bash
set -e
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
git diff --check
```

Expected: 全套 backend unit tests 与完整类型检查 EXIT=0；lint 0 errors，既有 warning 明确记录。数据库最终回读将在 Task 8 进行，不将 in-memory 测试宣称为真实 PostgreSQL 证明。不 commit。

### Task 2: 批量公共投影与明确默认，不借图库

**Files:**
- Modify: `backend/src/modules/catalog/product-card-media.ts`
- Modify: `backend/src/modules/catalog/products.service.ts`（storefront select、compat 之前的原始默认/快照保留、storefrontMediaPresentation）
- Test: `backend/src/modules/catalog/product-card-media.spec.ts`
- Test: `backend/src/modules/catalog/products.service.spec.ts`
- Test: `backend/src/modules/catalog/catalog-compat.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 VariantCardMedia 与真实 variant 读回；原始 `Product.defaultDisplayVariantId`、现有可选 variant IDs。
- Produces: 固定契约中的 `buildProductCardMedia(variants, selectableVariantIds, storedDisplayVariantId): ProductCardMedia`，包含明确 displayVariantId，继续使用现有 cover/scene 图片形状。

- [ ] **Step 1: 投影 RED。** 先修改现有投影测试，直接给 gallery 与 card config 不同的 URL，禁止测试假数据让两者碰巧一致。

```ts
const image = (url: string) => ({ type: 'IMAGE' as const, url, altText: null });
const variants = [
  { id: 'a', cardMedia: { cover: image('/uploads/a-cover.png'), hover: image('/uploads/a-hover.png') } },
  { id: 'b', cardMedia: { cover: image('/uploads/b-cover.png'), hover: null } },
];
it('projects only the selected variant snapshot', () => {
  const media = buildProductCardMedia(variants, ['a', 'b'], 'b');
  expect(media.displayVariantId).toBe('b');
  expect(media.unselected.cover?.url).toBe('/uploads/b-cover.png');
  expect(media.variants.find(row => row.variantId === 'a')?.scene?.url).toBe('/uploads/a-hover.png');
});
it('does not infer an absent operator default', () => {
  const media = buildProductCardMedia(variants, ['a', 'b'], null);
  expect(media.displayVariantId).toBeNull();
  expect(media.unselected).toEqual({ cover: null, scene: null });
});
```

另写缺 cover 但有 hover 的 null pair、无配置、无效/disabled 默认、不同价格、price=0、缺货 SKU、同 URL、同 URL 不同 Alt、已删除图库行不影响快照。legacy presentation 仍推断默认但卡片 displayVariantId 为 null 的 service 场景必须存在。

- [ ] **Step 2: 运行 RED。**

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/catalog/product-card-media.spec.ts src/modules/catalog/products.service.spec.ts src/modules/catalog/catalog-compat.spec.ts`

Expected: 旧 gallery-driven helper 不能满足新投影契约；在接上新签名后，行为断言继续 RED 直到不再借图库。记录签名阶段与行为阶段，不能把 TypeError 当全部 RED 证明。

- [ ] **Step 3: 最小纯投影。** 使用快照形成 public image，保留 URL/Alt，不查询图片表：

```ts
function pair(variant: ProductCardVariantInput): ProductCardMediaPair {
  const cover = variant.cardMedia?.cover;
  if (!cover) return { cover: null, scene: null };
  const scene = variant.cardMedia?.hover;
  return {
    cover: { id: `card:${variant.id}:cover`, ...cover, sortOrder: 0 },
    scene: scene ? { id: `card:${variant.id}:hover`, ...scene, sortOrder: 0 } : null,
  };
}
```

selectableVariantIds 控制输出范围；stored 默认必须同时在真实 variants 与 selectable IDs 中。无默认不取第一个。旧 isScene、effectiveCoverMedia 及 scoped gallery 均不参与此函数。

- [ ] **Step 4: 列表/详情 service 接线与回归。** storefront 基础变体 select 加 cardMedia；在 compat 改写默认之前，以原始持久化默认与真实 variant 快照计算/保留卡片投影，不能把推断默认重新传进 helper。目录、search、by-ids、collection、home hydration 和 related 都返回同形 cardMedia，不增加按产品/变体单独查询。公共响应仅保留轻量投影，不再在 public variants 重复附带裸 cardMedia JSON；admin 回读仍保留配置。PDP 图库与详情响应语义不变，最近浏览实际只存商品 ID，并由已有 by-ids 批量获取独立图片，不新增详情快照缓存。图库相关旧查询继续用于 PDP，不因卡片改版删除它们。

service 测试同时断言：public 快照不泄漏供应商成本等私有字段；PDP images/effectiveCoverMedia/选项图库响应在相同数据下不变；列表 20 个变体不产生 20 次 card media fetch。真实 SQL 查询预算留给 Task 8。

- [ ] **Step 5: 完整 gate 与记录。**

```bash
set -e
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
git diff --check
```

Expected: 全套 backend unit tests、tsc EXIT=0，lint 0 errors。新接口没有图库 fallback；不 commit。

### Task 3: 后台草稿、wire、legacy 转换与无副作用预览数据

**Files:**
- Modify: `frontend/src/lib/admin-api.ts`（AdminVariant、AdminGraphVariant、legacy write variant、WireVariantWrite）
- Modify: `frontend/src/lib/api.ts`（ProductCardMedia.displayVariantId）
- Modify: `frontend/src/lib/admin-product-graph.ts`（deserialize、graphFromAdminProduct、diff、wire、buildSavedPreview、新增两个聚焦 helper）
- Modify: `frontend/src/components/admin/ProductForm.tsx`（legacy 行身份/配置、serializeFormValue）
- Modify: `frontend/src/components/admin/VariantMatrix.tsx`（existing 行保留配置，新行不复制其他行）
- Modify: `frontend/src/test/product-card-fixtures.ts`（明确可选配置，不自动给未配置 fixture 补图）
- Modify/Test: `frontend/src/lib/product-card-presentation.spec.ts`、`frontend/src/components/product/ProductCard.spec.tsx`、`frontend/src/components/product/ProductCardImage.spec.tsx`（现有 cardMedia 字面量补明确 displayVariantId，不提前改变 Task 6 的行为预期）
- Create: `frontend/src/lib/admin-product-card-preview.ts`
- Create: `frontend/src/lib/admin-product-card-preview.spec.ts`
- Test: `frontend/src/lib/admin-product-graph.spec.ts`
- Test: `frontend/src/components/admin/ProductForm.spec.tsx`
- Test: `frontend/src/components/admin/VariantMatrix.spec.tsx`

**Interfaces:**
- Consumes: Task 1/2 的 cardMedia 写入与公共投影形状；现有 EntityRef、entityRowKey、ProductFormValue、AdminCatalogGraphDraft。
- Produces: 所有 admin variant/draft/upsert/wire 的 `cardMedia?: VariantCardMedia | null`；Global 固定契约中的 cardGraphFromLegacyForm、setVariantCardImage、buildProductCardPreview。

- [ ] **Step 1: codec RED。** 在已有 admin graph spec 内使用其真实 `serverGraph()`、`productFor()` 与 VARIANT_RED_ID fixture，不另造平行假保存器：

```ts
it('emits a card-only change without changing SKU identity or gallery', () => {
  const original = serverGraph();
  const draft = deserializeAdminProduct(productFor(original));
  const row = draft.variants.find(row => row.id === VARIANT_RED_ID)!;
  row.cardMedia = {
    cover: { type: 'IMAGE', url: '/uploads/new-card.png', altText: null },
    hover: null,
  };
  const patch = buildCatalogGraphPatch(original, draft);
  const wire = toWireCatalogGraphPatch(patch, original.catalogGraphVersion);
  expect(wire.catalogGraph.variants.find(row => row.id === VARIANT_RED_ID)?.cardMedia).toEqual(row.cardMedia);
  expect(patch.mediaUpserts).toEqual([]);
  expect(patch.retirements.variantIds).toEqual([]);
});
```

另覆盖 no-op、仅 price、null/单槽清空、new clientKey、JSON 属性顺序不导致虚假变更、buildSavedPreview 回读快照。legacy SKU 已被重排/重命名、还有未保存包装与 stock 时转换后字段与真实 id 保留；同名不同 clientKey 新行不继承图片。

- [ ] **Step 2: 运行 RED。**

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/lib/admin-product-graph.spec.ts src/components/admin/ProductForm.spec.tsx src/components/admin/VariantMatrix.spec.tsx`

Expected: 当前 diff 忽略卡片字段、wire 丢字段，导致行为 FAIL；不是只依赖 TS 对新字段报错。

- [ ] **Step 3: 完整 adapter 透传。** deserializer 复制结构化快照；变体 diff 增加按 cover/hover 的 type/url/altText 字段比较，不使用属性顺序敏感的 JSON 字符串比较。SKU-only 变更不发送 cardMedia，卡片-only 变更不要求 SKU 再创建。

```ts
const cardFields = draftVariant.cardMedia === undefined
  ? {}
  : { cardMedia: draftVariant.cardMedia };
```

new/changed upsert 以及 wire 只在存在该字段时展开；null 不被 `??` 改成 omitted。VariantMatrix 的 findOrCreateRow 对 existing 返回/复制整行，仅真正新 ref 使用未配置的双图。

legacy 表单新增 id/clientKey/cardMedia 的保存与复制；添加新行即生成新的稳定 clientKey。cardGraphFromLegacyForm 以当前 legacy 行生成单个 Style 维度、保留真实 variant/SKU id、原共享媒体/草稿和运营 default ref。先对齐真实 id，再处理明确的新 clientKey；不以名字/index 配对图片。上传期间不允许删行、重建组合或模式切换，避免 key 重用。

setVariantCardImage 先按 entityRowKey 找行，再只更新 `{cover,hover}` 的一个槽位，保留另一槽；找不到目标由上传 target guard 丢弃迟到结果，普通同步 UI 不调用无效 ref。

- [ ] **Step 4: 预览数据测试先 RED，再实现 focused mapper。** buildProductCardPreview 把 draft 的真实/临时 ref 统一映射为 preview id、选项与 SKU，price/compareAt 保持原值，availableInventory 使用当前 onHand/reserved；空价格仍为 null，0 仍有效。输入基本文案来自 ProductFormValue，不用商品池另一个商品的内容。

```ts
it('keeps card images out of the PDP gallery in a draft preview', () => {
  const value = emptyProductFormValue();
  value.name = 'Preview table';
  value.slug = 'preview-table';
  value.images = [{ url: '/uploads/pdp.png', type: 'IMAGE', altText: '', sortOrder: '0' }];
  const draft: AdminCatalogGraphDraft = {
    catalogGraphVersion: 0, defaultDisplayVariantRef: null, options: [], media: [],
    variants: [{ clientKey: 'v1', name: 'Single', position: 0, combinationKey: '',
      optionValueRefs: [], sku: null,
      cardMedia: { cover: { type: 'IMAGE', url: '/uploads/card.png', altText: null }, hover: null } }],
  };
  const preview = buildProductCardPreview(value, draft, { clientKey: 'v1' });
  expect(preview.images.map(image => image.url)).toEqual(['/uploads/pdp.png']);
  expect(preview.cardMedia?.variants.find(row => row.variantId === 'v1')?.cover?.url).toBe('/uploads/card.png');
  expect(value.images).toHaveLength(1);
});
```

mapper 的 Product scalar/dimension 字段按现有 Product 接口逐项映射；options/variants 从同一 draft 出发，cardMedia.displayVariantId 仅来自明确 preview ref，不能修改保存用 default ref。预览 projection 保留全部草稿行的配置，明确 preview ref 的 unselected pair 可展示尚无价格/SKU 的草稿图片；这只用于 disabled 的后台预览，不改变 public 可售过滤。无购买作用不依靠这个 mapper 猜测，而由 Task 7 的组件行为测试证明。

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/lib/admin-product-card-preview.spec.ts src/lib/admin-product-graph.spec.ts src/components/admin/ProductForm.spec.tsx src/components/admin/VariantMatrix.spec.tsx`

Expected: 先见行为 RED，随后所有命名测试 GREEN，保存/库存 mapping 回归不丢字段。

- [ ] **Step 5: 完整 gate 与记录。**

```bash
set -e
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
git diff --check
```

Expected: 全套 frontend unit tests、tsc EXIT=0，lint 0 errors，既有 warning 单列。不 commit。

### Task 4: 紧凑后台双图设置、草稿/上架检查与新建恢复

**Files:**
- Create: `frontend/src/components/admin/product-form/ProductCardMediaEditor.tsx`
- Create: `frontend/src/components/admin/product-form/ProductCardMediaEditor.spec.tsx`
- Modify: `frontend/src/components/admin/product-form/ProductMediaPanel.tsx`
- Modify: `frontend/src/components/admin/product-form/SharedMediaWorkspace.tsx`
- Modify: `frontend/src/components/admin/ProductMediaScopesEditor.tsx`
- Modify: `frontend/src/components/admin/ProductForm.tsx`
- Modify: `frontend/src/lib/admin-product-readiness.ts`
- Modify: `frontend/src/app/admin/(shell)/products/new/page.tsx`
- Modify: `frontend/src/app/admin/(shell)/products/[id]/edit/page.tsx`（仅必要的错误显示/最终草稿保持）
- Modify: `frontend/src/i18n/zh.ts`、`frontend/src/i18n/en.ts`（只新增商品卡键，不改营销文案）
- Create: `backend/src/modules/catalog/product-card-readiness.ts`
- Create: `backend/src/modules/catalog/product-card-readiness.spec.ts`
- Create: `backend/scripts/product-card-audit.ts`
- Modify: `backend/src/modules/catalog/catalog-graph.service.ts`（最终 ACTIVE 快照检查）
- Modify: `backend/src/modules/catalog/products.service.ts`（create/legacy update/bulk ACTIVE 事务检查）
- Test: `frontend/src/lib/admin-product-readiness.spec.ts`、`ProductForm.spec.tsx`、`SharedMediaWorkspace.spec.tsx`、`ProductMediaScopesEditor.spec.tsx`、new/edit page specs、backend services specs

**Interfaces:**
- Consumes: Task 3 的草稿、两个 mutation/conversion helper、preview mapper；已有 `MediaBatchUpload`、`MediaUploadTarget`、admin Dialog、i18n。
- Produces: `ProductCardMediaEditor({draft,onChange,batchUpload,pending,onPreviewVariant})`，onChange 为 `(mutate:(draft:AdminCatalogGraphDraft)=>void)=>void`，onPreviewVariant 为 `(ref:EntityRef)=>void`；显示每真实变体两槽、缺封面状态、明确默认款选择。
- Produces: `ReadinessCheckKey` 新增 `card_media`，映射到媒体 Tab；不替换原 PDP shared_media/option_media 检查。
- Produces: `findProductCardReadinessIssues(products:readonly CardReadinessProduct[]):ProductCardReadinessIssue[]` 与 `validateProductCardReadiness(tx:Prisma.TransactionClient,productIds:readonly string[]):Promise<void>`。
- CardReadinessProduct 为 `{id,name,defaultDisplayVariantId,variants:[{id,name,cardMedia,sku:{status,price}|null}]}`；price 只判断数据库非空，不重算金额。issue 为 `{productId,productName,missingCoverVariants:[{variantId,name}],defaultDisplayVariantMissing:boolean}`。

- [ ] **Step 1: 上架 policy 与 UI RED。**

```ts
it('reports every active priced variant missing an independent cover', () => {
  const issues = findProductCardReadinessIssues([{
    id: 'p', name: 'Table', defaultDisplayVariantId: null,
    variants: [
      { id: 'a', name: 'Small', cardMedia: null, sku: { status: 'ACTIVE', price: 0 } },
      { id: 'b', name: 'Large', cardMedia: null, sku: { status: 'ACTIVE', price: 100 } },
      { id: 'c', name: 'Disabled', cardMedia: null, sku: { status: 'DISABLED', price: 100 } },
    ],
  }]);
  expect(issues[0]?.missingCoverVariants.map(row => row.variantId)).toEqual(['a', 'b']);
  expect(issues[0]?.defaultDisplayVariantMissing).toBe(true);
});
```

UI 通过真实 ProductForm + AdminI18nProvider 渲染并观察当前表单结果：A 从图库选择 cover 后 B 不变；两图只接受 IMAGE；图库顺序/长度不变；悬停可清空；选项缩略图不充当封面；单款界面只有一组；默认只在用户动作时改变。旧“设为场景图”按钮不再显示，但已有 isScene 值经过普通保存仍保留。

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/catalog/product-card-readiness.spec.ts src/modules/catalog/products.service.spec.ts src/modules/catalog/catalog-graph.service.spec.ts`

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/admin/product-form/ProductCardMediaEditor.spec.tsx src/components/admin/ProductForm.spec.tsx src/lib/admin-product-readiness.spec.ts`

Expected: 首先出现新行为 RED；初次新组件/函数缺失后须再运行行为断言，不能把 import 错误当验收。

- [ ] **Step 2: 实现两槽矩阵与图库选择。** 每槽一个小缩略图、上传/图库/清空按钮与紧凑 Alt 编辑；无需一长排 URL 字段。图库 picker 复用 admin Dialog，只列当前共享/选项值/精确变体图库里的 IMAGE；选中后按快照复制。视频不能进入候选。

```ts
const target: MediaUploadTarget = {
  key: `card:${entityRowKey(variant)}:${slot}`,
  kind: "image",
  operation: "REPLACE",
  onAddMedia: media => onChange(draft => {
    setVariantCardImage(draft, variant, slot, {
      type: "IMAGE", url: media.url, altText: null,
    });
  }),
};
await batchUpload.upload([file], target);
```

ProductForm 扩充 card target availability，目标从当前 cardDraft 的真实/临时 ref 生成，而非仅初次加载的 graph；复用同一个 batchUpload，继续保存/上传总锁，不创建并行上传器。hook 的 disabled 仍仅接外部 pending/只读，不能接自身 uploading 导致成功结果被阻止；上传成功回调允许写入其仍有效的目标，普通清空/选择等 UI 动作继续禁用。输入只允许一个文件；清空/图库选择在 pending 或 uploading 时禁用。矩阵/legacy 身份重建、删除、模式切换也在媒体忙时锁住；切换商品/卸载后的 callback 由既有 mounted/target guard 丢弃。复用已有折叠上传结果，不新增大面积上传行。

只读打开 legacy 区域使用 cardGraphFromLegacyForm；首次修改时从最新 prev 创建完整 graph，再做 mutation 并设置 graphTyped=true。没有编辑动作不 materialize。使用局部 previewVariantRef 渲染 ProductCard preview，预览此款不修改保存的默认款。

移除两个旧图库 editor 的 scene 设置控件与仅为它们存在的 callback；保留 image.isScene 的数据透传、backend 约束与事务代码，不批量清零旧标记。

- [ ] **Step 3: 在最终事务内实现上架检查。**

```ts
if (saved.status === 'ACTIVE') {
  await validateProductCardReadiness(tx, [productId]);
}
```

graph 检查放在 persistPlan 最终保存/readback 阶段；原 Bundle 验证仍保留。legacy create/update 在所有变体写完后、事务返回前检查。bulk ACTIVE 在同一事务更新后验证全部 foundIds；任何一个缺配置整批回滚，不留下半批发布。DRAFT 保存允许缺图，不自动复制共享图，不自动下架现有 ACTIVE。

只有两个及以上可选 SKU 时要求有效明确 default；单 SKU 不额外要求用户选一次默认。可选按现有 ACTIVE + price 非空判断，price=0 和缺货均纳入；无定价/disabled SKU 不算缺图。

失败返回 BadRequestException，code=`PRODUCT_CARD_MEDIA_INCOMPLETE`，message 明确列出商品/款式缺封面或默认，products 为上述 issues。只读审计 CLI 复用同一 policy，查询 ACTIVE 商品并输出问题，不 UPDATE、不自动 backfill、不触发状态变更。

- [ ] **Step 4: typed 新建发布与恢复 RED→GREEN。** 在现有 new page spec 复用其 API 边界 stub，观察实际页面可恢复状态，并在 Task 8 回读 DB：typed 请求 ACTIVE 时 POST 必须是 DRAFT + empty images/variants，随后 graph PATCH 带原请求 status。该 PATCH 的最终快照通过检查后才能 ACTIVE；失败时创建行仍 DRAFT、createdId 保留、继续编辑可用，再提交不会第二次 POST。原库存 batch/失败行重试保持，不新增自动库存或状态回滚。

```ts
createPayload = { ...result.value, status: "DRAFT", images: [], variants: [] };
saved = await adminApi.updateProduct(created.id, {
  ...toWireCatalogGraphPatch(graphPatch, created.catalogGraphVersion),
  status: result.value.status,
});
```

针对只读草稿、上传 Promise 迟到、卸载、同 ref 删除再创建的禁止操作、409 目录冲突加入可观察 UI 测试；冲突后双图、SKU/包装、stock 草稿都保留，不能重新提交成功的 POST 或静默重载丢草稿。

- [ ] **Step 5: 完整双端 gate 与记录。**

```bash
set -e
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
git diff --check
```

Expected: 全套双端 tests/tsc EXIT=0，lint 0 errors。已有 ACTIVE fixture 需由测试作者显式配置独立图，不能在生产代码/fake 中增加 fallback 让 gate 变绿。不 commit。

### Task 5: 一行变体选择与完整可选面板

**Files:**
- Create: `frontend/src/components/product/ProductCardVariantSelector.tsx`
- Create: `frontend/src/components/product/ProductCardVariantSelector.spec.tsx`
- Create: `frontend/src/components/product/ProductCardOptionPanel.tsx`
- Create: `frontend/src/components/product/ProductCardOptionPanel.spec.tsx`
- Create: `frontend/src/lib/product-card-options.ts`
- Create: `frontend/src/lib/product-card-options.spec.ts`
- Modify: `frontend/src/lib/product-selection.ts`（移入/导出既有两个兼容 helper，规则不变）
- Modify: `frontend/src/components/product/ProductOptionSelector.tsx`（使用同一 helper，regular 布局不改）
- Modify: `frontend/src/components/product/ProductCardView.tsx`（替换卡片 selector）
- Test: `frontend/src/components/product/ProductOptionSelector.spec.tsx`、`product-selection.spec.ts`、`ProductCard.spec.tsx`

**Interfaces:**
- Consumes: usePdpPurchase 的 line/derived/selectOption/purchaseLocked 与真实 Product 选项/可选 variants。
- Produces: `ProductCardVariantSelector({lineId,disabled,preview})`，只渲染商品选项；保留 data-option-id，供未选完整时的错误焦点定位。
- Produces: `collapseCardOptions(values:readonly StorefrontOptionValue[],selectedValueId:string|undefined,widths:Readonly<Record<string,number>>,availableWidth:number,moreWidth:number,gap:number):{visibleValues:StorefrontOptionValue[];hiddenCount:number}`。
- Produces: 将既有 `isCompatibleValue` / `isOutOfStockOnly` 移入 product-selection，参数保持 `(productOptions,variants,selectedValueIds,optionId,valueId):boolean`；前后两种 selector 共用，避免循环 import。
- Produces: `ProductCardOptionPanel({open,option,variants,productOptions,selectedValueIds,disabled,triggerRef,onSelect,onClose})`；onSelect=`(valueId:string)=>void`，关闭后恢复 trigger 焦点。

- [ ] **Step 1: 容量、末尾选中值与选择行为 RED。**

```ts
it('keeps a selected value visible when it was beyond the initial prefix', () => {
  const values = Array.from({ length: 8 }, (_, i) => ({
    id: `v${i}`, label: `Size ${i}`, position: i,
    swatchHex: null, thumbnailUrl: null, thumbnailAlt: null,
  }));
  const widths = Object.fromEntries(values.map(value => [value.id, 44]));
  const result = collapseCardOptions(values, 'v7', widths, 144, 44, 4);
  expect(result.visibleValues.map(value => value.id)).toContain('v7');
  expect(result.hiddenCount + result.visibleValues.length).toBe(8);
  expect(result.visibleValues.length).toBeLessThan(3);
});
```

组件在真实 PdpPurchaseProvider 下验证两维联动：第一组选值可使后组失效并按原 reducer 清理；不兼容禁用、缺货仍可选且显示状态；只有一个可选 SKU 不展示 selector。有多个 SKU 时不能隐藏一个仍需选择的单值维度，否则会出现无法完成组合的卡片。

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/lib/product-card-options.spec.ts src/components/product/ProductCardVariantSelector.spec.tsx src/components/product/ProductOptionSelector.spec.tsx src/lib/product-selection.spec.ts`

Expected: 先见容量/末尾选中/一行行为 RED，后 GREEN；不修改 reducer 规则让 UI 测试迁就错误组合。

- [ ] **Step 2: 一行收纳最小实现。** ResizeObserver 测量实际可用宽度与非交互测量 span 的 chip 宽；测量元素 aria-hidden、不可聚焦、无事件。首屏保守数量不改变行高，客户端测量后补可见值；保留 +N 宽度，visible 与 hidden 精确覆盖全部值。

选中值超出 prefix 时置于可见区并剔除末尾未选值；仍不够容纳时显示窄的选中摘要与 +N，不让 group 横向溢出。Color 为色点，IMAGE 为缩略图，TEXT 为短 chip；选中摘要 truncate，完整名字在 aria-label 与面板中保留。按钮至少 44px 可操作尺寸；每组一行，不使用 flex-wrap 把文字撑高。

与原 selector 一样，仅在真实 changed selectOption 时发 option_select；打开/搜索/关闭面板没有商业事件。preview、disabled、purchaseLocked 三种条件同时约束行内与面板按钮。

- [ ] **Step 3: 面板可访问性 RED。**

```tsx
it('restores the more trigger focus after Escape', async () => {
  const user = userEvent.setup();
  const product = cardTestProduct();
  const option = product.options[0]!;
  const sourceVariant = product.variants[0]!;
  option.values = Array.from({ length: 12 }, (_, i) => ({
    id: `long-${i}`, label: `Performance Multi Twill, Cream with finish ${i}`,
    position: i, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null,
  }));
  product.variants = option.values.map((value, i) => ({
    ...sourceVariant, id: `long-variant-${i}`, name: value.label,
    combinationKey: `${option.id}:${value.id}`, optionValueIds: [value.id],
    sku: { ...sourceVariant.sku!, id: `long-sku-${i}`, skuCode: `LONG-${i}` },
  }));
  renderCard(<ProductCard product={product} />);
  const more = await screen.findByRole('button', { name: /more .*options/i });
  await user.click(more);
  expect(screen.getByRole('dialog')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(more).toHaveFocus();
});
```

此例放在已有 ProductCard.spec.tsx，复用其中 renderCard；12 个长值已配齐相应真实 variants，不依赖 jsdom 自动量出 CSS 宽度。geometry stub 只模拟浏览器测量边界，选择、状态、DOM 和 focus 使用真实代码。

另外固定：>=12 值显示 Search options，少于 12 不添搜索框；搜索不清已有选择、无结果可清搜索；全文标签换行；Tab 不跑出打开的 modal、关闭按钮/Escape/外部点击正常、购买忙时选项禁用。

- [ ] **Step 4: 聚焦原生 dialog。** 使用一个 dialog + showModal/close：desktop 为靠近触发控件的窄面板，left/top 夹在 viewport 内；mobile 为底部 sheet，max-height 80dvh、可滚动。桌面 backdrop 透明，移动 backdrop 柔和遮罩；关闭后回到触发按钮。使用原生 modal focus/inert 与明确取消处理，打开期间锁 body scroll 并在 cleanup 恢复原值；不重用 admin Dialog 或全 PDP VariantPickerDialog，不改它们默认行为。

```tsx
<button type="button" aria-haspopup="dialog" aria-expanded={open}
  aria-label={`More ${option.name} options`} onClick={() => setOpen(true)}>
  +{hiddenCount}
</button>
```

选择按钮调用现有 selectOption 后关闭面板；不添加数量/套餐/确认购买按钮。resize 时重新夹取位置；关窗/卸载清理 observer/scroll lock/事件。jsdom 仅为 showModal/close 的浏览器 API 提供测试 adapter，focus trap/实际移动 sheet 在 Task 8 真浏览器验证。

- [ ] **Step 5: 完整 gate 与记录。**

```bash
set -e
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
git diff --check
```

Expected: 全套 frontend tests/tsc EXIT=0；完整 PDP selector 与数量/套餐购买回归不变，lint 0 errors。不 commit。

### Task 6: 严格按变体双图、方图与明显浮起

**Files:**
- Modify: `frontend/src/lib/product-card-presentation.ts`
- Modify: `frontend/src/components/product/ProductCard.tsx`
- Modify: `frontend/src/components/product/ProductCardView.tsx`
- Modify: `frontend/src/components/product/ProductCardImage.tsx`
- Test: `frontend/src/lib/product-card-presentation.spec.ts`
- Test: `frontend/src/components/product/ProductCardImage.spec.tsx`
- Test: `frontend/src/components/product/ProductCard.spec.tsx`

**Interfaces:**
- Consumes: Task 2 公共 ProductCardMedia.displayVariantId/pairs、Task 5 selector；既有 CardPricePresentation 与请求锁。
- Produces: 现有 `cardInitialVariantId(product):string|null` 只读取有效 cardMedia.displayVariantId；`cardMediaForSelection(product,resolvedVariantId,selectedValueIds):ProductCardMediaPair` 无图库 fallback。
- Produces: 原 ProductCardProps 不变；preview/storefront 行为边界不变。

- [ ] **Step 1: 缺图与明确默认 RED。**

```ts
it('never borrows shared media for a selected variant lacking card config', () => {
  const product = cardTestProduct();
  product.cardMedia = { displayVariantId: null,
    unselected: { cover: null, scene: null }, variants: [] };
  expect(cardMediaForSelection(product, 'blue-variant', { color: 'blue' }))
    .toEqual({ cover: null, scene: null });
});
it('does not treat a legacy inferred default as an operator card default', () => {
  const product = cardTestProduct({ defaultDisplayVariantId: 'blue-variant' });
  product.cardMedia = { displayVariantId: null,
    unselected: { cover: null, scene: null }, variants: [] };
  expect(cardInitialVariantId(product)).toBeNull();
});
```

再覆盖 old cached payload 无 cardMedia、不完整选项、专属 cover null、默认 disabled、换款时悬停图未加载、返回旧款 URL 的迟到 load/error、同图、同价/不同价划线价、0 元。新规则改变 V1 图片 fallback 测试预期，但不得放宽真实购买锁/事件断言。

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/lib/product-card-presentation.spec.ts src/components/product/ProductCardImage.spec.tsx src/components/product/ProductCard.spec.tsx`

Expected: 旧 fallback 和旧默认行为产生可观察 RED，再最小改造为 GREEN。

- [ ] **Step 2: 严格双图与卡片专属默认。**

```ts
if (resolvedVariantId !== null) {
  const pair = product.cardMedia?.variants.find(row => row.variantId === resolvedVariantId);
  return pair ? { cover: pair.cover, scene: pair.scene } : { cover: null, scene: null };
}
return Object.keys(selectedValueIds).length === 0
  ? product.cardMedia?.unselected ?? { cover: null, scene: null }
  : { cover: null, scene: null };
```

ProductCard 的 provider 使用局部 productForCard，将 defaultDisplayVariantId 设置为 cardInitialVariantId 的结果；CardBody 使用同一个对象，避免 unresolved 价格通过 derived.displayVariant 偷用 legacy 推断默认。不要修改实际 PDP provider/default 行为。key 继续 `[product.id,product.catalogGraphVersion]`，保留实际 addSelected 实现和确认/lock 顺序。

- [ ] **Step 3: 视觉与媒体状态 RED→GREEN。** 保留 cover 常驻；hover/focus-visible 仅在有有效且不同 scene URL 时挂载 ScenePreview。URL 改变重置 loaded/failed，scene 加载完且仍 active 才显示；移出立即隐藏，不以 fade-out 延迟维持旧图。

```tsx
<article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card transition-[transform,box-shadow] duration-200 motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[0_8px_24px_rgba(0,0,0,0.14)] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:hover:-translate-y-1.5">
```

图片框改 aspect-square；cover 为 object-contain，scene 为 object-cover，opacity transition 200ms + motion-reduce:transition-none。占位状态稳定占满同样方框。删除只为重复折扣存在的图片折扣角标，保留 PriceBox 的真实折扣表达与其他必要运营徽标。不得引入 scale、轮播、整卡大链接或 hover API fetch。

两个 Next Link 都继续 prefetch=false；ButtonLink 是原生 a，不添加无效 prop。hover 类媒体条件不作用触屏；focus-visible 有清晰 ring，键盘切图不触发导航。

- [ ] **Step 4: 购买/版本回归。** 单个请求快照在等待时不能被新选择覆盖；换 product/graphVersion 后旧 feedback 不污染新卡；快速双击只一个 addItem；reject 后可重试；Bundle 只提交虚拟 SKU。单卡控制不影响相邻卡/PDP state。测试失败时修复根因，不移动 confirmLine 到 purchase lock 后面。

- [ ] **Step 5: 完整 gate 与记录。**

```bash
set -e
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
git diff --check
```

Expected: 全套 frontend tests/tsc EXIT=0，lint 0 errors。CSS 位移、真实测量、生产预取仍待 Task 8，不能只凭 className 测试宣布视觉通过。不 commit。

### Task 7: 全入口一致、预览隔离与真实购买事件

**Files:**
- Test: `frontend/src/components/home/HomeTracking.spec.tsx`
- Test: `frontend/src/components/home/ProductGridSection.spec.tsx`
- Test: `frontend/src/components/admin/homepage/HomepageLivePreview.spec.tsx`
- Test: `frontend/src/components/home/RecentlyViewed.spec.tsx`
- Test: `frontend/src/components/product/ProductCard.spec.tsx`
- Modify only if a verified contract gap exists: `frontend/src/components/home/HomeTracking.tsx`、`frontend/src/components/home/ProductGridSection.tsx`、`frontend/src/components/home/RecentlyViewed.tsx`、`frontend/src/components/admin/homepage/HomepageLivePreview.tsx`；最近浏览的 ID-only storage 不改形状。
- Modify: `frontend/src/components/admin/product-form/ProductCardMediaEditor.tsx`（Task 4 新增，本任务完成预览行为接线）
- Test: `frontend/src/components/admin/product-form/ProductCardMediaEditor.spec.tsx`（Task 4 新增）

**Interfaces:**
- Consumes: ProductCard 不变 props、Task 3 preview Product 与 Task 4 preview ref、Task 6 strict pairs。
- Produces: 所有入口使用同一 ProductCard；最近浏览使用既有 by-ids 批量回读的新 pairs，不增设产品快照缓存；预览模式不渲染可执行链接/面板/商业动作。

- [ ] **Step 1: 集成行为 RED/characterization 分类。** 现有正确行为通过的测试标为 characterization，不冒称 RED；只有实际缺失的新行为才 RED→GREEN。直接使用真实 preview 卡片且不包 CartProvider：

```tsx
it('renders preview without navigation, option mutation or purchase effects', () => {
  const { container } = render(
    <ProductCard product={cardTestProduct()} interactionMode="preview" />,
  );
  expect(container.querySelectorAll('a')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled();
  expect(container.querySelector('[data-track-event]')).toBeNull();
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
});
```

StrictMode 下初次 mount、resize、hover、图 load 和 previewVariantRef 更新都不能发 cart API/commerce events；preview 的 +N disabled，不能因打开面板产生购买副作用。Home ProductClick attrs 只在真实图片/标题导航，option/+N/CTA 不能继承导航埋点。

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/components/product/ProductCard.spec.tsx src/components/home/RecentlyViewed.spec.tsx src/components/admin/homepage/HomepageLivePreview.spec.tsx src/components/admin/product-form/ProductCardMediaEditor.spec.tsx src/components/home/HomeTracking.spec.tsx src/components/home/ProductGridSection.spec.tsx`

Expected: 命名测试全绿；来自旧列表响应的 payload 若缺配置应缺图而非共享补图；最近浏览的真实 by-ids 响应显示独立图片。

- [ ] **Step 2: 最小修复集成缺口。** 保持各入口排序/网格/filter，不新增另一套 Card。RecentlyViewed 保持仅存 ID、一次批量 by-ids 加载；确认回读保留公共 cardMedia（含 displayVariantId），不新增单产品请求来补 hover 图或另一套缓存。完整 PDP 预览继续用原 images，卡片预览使用独立映射。

```tsx
<ProductCard product={previewProduct} interactionMode="preview" />
```

卡片设置区的“预览此款”按钮更新局部预览 ref，不调用 selectOption、不写 defaultDisplayVariant，不发 RPC；运营默认选择为另一明确持久化操作。只改已被测试证明存在的接线缺口，避免顺带改首页装修。

- [ ] **Step 3: 真实动作事件与 Bundle 测试。** 选择产生一次 option_select；仅成功 addItem 后发既有 variant_confirm/add_to_cart；hover/+N/search/close 无这些事件；失败不发成功事件。price/compare-at 来自选中 SKU，quantity 1，Bundle SKU 不拆分；行内按钮区域不触发 ProductClick。

- [ ] **Step 4: 完整 gate 与记录。**

```bash
set -e
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
git diff --check
```

Expected: 全套 frontend tests/tsc EXIT=0，lint 0 errors；不把 mocks 断言当真实 Cart POST/库存证明，Task 8 回读真实后端。不 commit。

### Task 8: 专库、真实 PostgreSQL、production browser 与收口

**Files:**
- Create: `frontend/src/test/product-card-v2-test-target.ts`
- Create: `frontend/src/test/product-card-v2-test-target.spec.ts`
- Create: `frontend/e2e/product-card-v2-prepare.ts`
- Create: `frontend/e2e/product-card-v2.spec.ts`
- Create: `frontend/playwright.product-card-v2.config.ts`
- Create: `backend/test/product-card-v2.e2e-spec.ts`
- Test retained: V1 unit/image/购买回归 specs；不自动修改其严格专库 guard 或重跑旧 task-start/task-done。
- Artifacts: 本轮 sdd ledger、owned root 的 logs、截图、trace、source manifest、test-results。

**Interfaces:**
- Consumes: Task 1–7 全部接口与行为。
- Produces: `assertProductCardV2TestTarget(databaseUrl:string|undefined,root:string|undefined):{databaseUrl:string;root:string}`；精确允许新专库和本轮 root，不接受生产/rehearsal/V1 库。
- Produces: production frontend 3217/backend 3216 的真实 HTTP 验收；只停止本轮启动任务，保留证据。

- [ ] **Step 1: 安全 guard 先 RED→GREEN。**

```ts
it.each([
  'small_house_homepage_rehearsal',
  'small_house_product_card_20261010_test',
  'small_house',
])('rejects the non-owned database %s', database => {
  expect(() => assertProductCardV2TestTarget(
    `postgresql://postgres:postgres@localhost:5432/${database}?schema=public`,
    '/private/tmp/luwag-product-card-v2-ABC123',
  )).toThrow();
});
```

另覆盖空值、非 loopback、错误端口/数据库/schema、额外 query options、带路径逃逸或指向 protected uploads 的 root、symlink、不匹配 owner。新 guard 不拓宽旧 V1 guard。新空目录在 prepare 阶段检查 realpath 与空内容后写 marker；已有目录仅在后续验证 marker 时读，不重新覆盖。

Run: `pnpm --dir small-house-commerce/frontend exec vitest run src/test/product-card-v2-test-target.spec.ts`

Expected: 不安全目标拒绝、安全目标接受；任何破坏性 seed/migration/build-copy 前已成功运行 guard。

- [ ] **Step 2: 新运行副本与明确 fixtures。** prepare 复用 V1 已验证的复制规则但使用本轮 guard/marker；复制 backend 的 src、test、prisma、scripts、prisma7.config.ts、package/workspace/tsconfig/Nest/Vitest 配置，frontend 的 src/public/package/workspace/tsconfig/Next/PostCSS/next-env 与 V2 Playwright 配置/e2e。排除 generated、dist、.next、uploads、.env、日志/测试输出，依赖仅目录 symlink，不生成到原路径。

专库不存在时只创建精确固定库；存在时先确认本轮 owner，不自动 DROP。专库完整 migrate deploy、generate、seed/seed-e2e 在复制的 backend 内执行，使用 `--config prisma7.config.ts`。所有 build/上传文件均位于 owned root。

```bash
PROJECT="$PWD/small-house-commerce"
CARD_V2_DB_URL='postgresql://postgres:postgres@localhost:5432/small_house_product_card_v2_20261011_test?schema=public'
ls -d /private/tmp
CARD_V2_ROOT="$(mktemp -d /private/tmp/luwag-product-card-v2-XXXXXX)"
CARD_V2_DB_URL="$CARD_V2_DB_URL" CARD_V2_ROOT="$CARD_V2_ROOT" \
  pnpm --dir "$PROJECT/backend" exec tsx "$PROJECT/frontend/e2e/product-card-v2-prepare.ts"
```

prepare 输出并记录实际 root/库身份/迁移计数与源文件 manifest；后续工具调用从本轮 ledger 取实际 root，不能假定前一次 shell export 仍存在。数据库存在时核对本轮 owner comment，不符合则停止；新建专库时设置 comment `product-card-v2-20261011`，不创建额外业务表。

后续刷新副本必须验证相同 owner marker，采用 prepare 的 `--refresh` 路径：仅刷新自有源码/配置，不再 seed/migrate、不覆盖 node_modules symlink、不清运行中的 dist/.next。native build 前先停止本轮自有服务；重建成功再启动本轮端口，不干预原 3002/3005。

Fixtures 显式创建：两色两尺寸且每个可售 SKU 自己的不同 cover/hover；只有封面；同图；price=0；缺货；legacy 未配置草稿；明确默认与没有默认；12/100 个长款式；稀疏组合；独立 Bundle 虚拟 SKU。设置图片完全由测试 fixture 明确指定，不修改 rehearsal 商品，也不通过 helper 给缺配置商品自动继承共享图。

- [ ] **Step 3: PostgreSQL/HTTP 保存、回滚与 query 预算。** 新 backend e2e 先验证专库身份再连接。使用真实 Prisma/事务和 service/API，外部缓存回调可 stub，不能 mock 数据库存储。

```ts
const before = await prisma.productImage.findMany({
  where: { productId }, orderBy: { id: 'asc' },
});
await service.applyPatch(productId, version, {
  options: [], media: [],
  variants: [{ id: variantId, position: 0, optionValueRefs: refs,
    cardMedia: { cover: { type: 'IMAGE', url: '/uploads/card-only.png', altText: null }, hover: null } }],
  retirements: { optionIds: [], optionValueIds: [], variantIds: [], mediaIds: [] },
});
const stored = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
expect(stored.cardMedia).toEqual({
  cover: { type: 'IMAGE', url: '/uploads/card-only.png', altText: null }, hover: null,
});
expect(await prisma.productImage.findMany({ where: { productId }, orderBy: { id: 'asc' } }))
  .toEqual(before);
```

这里的 service/productId/version/refs 来自本 e2e beforeEach 建立的真实 product、option/value/variant/SKU，不用空引用破坏既有 option 契约。分别测试 card-only、price-only、null、槽位清空、materialization、409 并发、A/B 不串图、SKU/stock id不变、图删/重排后快照不变；draft 缺图可存、ACTIVE 缺图/默认拒绝并回滚；bulk 一错整批不发布。

用 Prisma query event 记录实际 SQL，对 1 与 20 商品的 storefront list/by-ids 比较 card/variant 查询预算，不能随商品数量变成 N 次；仅计算相关 SELECT，不混入 seed、FAQ 等不同职责查询。

Run: `CARD_V2_DB_URL="$CARD_V2_DB_URL" DATABASE_URL="$CARD_V2_DB_URL" pnpm --dir "$CARD_V2_ROOT/backend" exec vitest run --config vitest.config.e2e.ts test/product-card-v2.e2e-spec.ts`

Expected: 所有命名 real PostgreSQL tests PASS，回读证明保存/事务行为；不冒称旧 V1 19 项 PG 测试在新库自动跑过。

- [ ] **Step 4: 最新 production builds 与自有服务器。** 先刷新运行副本源文件并校验 manifest 与当前相关源码一致，生成 client 后 build；不复用修改前的 .next/dist。

```bash
set -e
DATABASE_URL="$CARD_V2_DB_URL" pnpm --dir "$CARD_V2_ROOT/backend" exec prisma generate --config prisma7.config.ts
DATABASE_URL="$CARD_V2_DB_URL" pnpm --dir "$CARD_V2_ROOT/backend" build
API_TARGET='http://127.0.0.1:3216' NEXT_TELEMETRY_DISABLED=1 \
  pnpm --dir "$CARD_V2_ROOT/frontend" build
```

Expected: 两个 native production build EXIT=0；保留 route checker，不设置 ignoreBuildErrors、不删 checker，不将普通 helper 导出到 Next route module。

启动 backend PORT=3216、DATABASE_URL 专库、UPLOAD_DIR=`$CARD_V2_ROOT/uploads`，JWT/preview secret 使用明确的 local test-only 值；frontend 用 production start 3217 + API_TARGET=3216。记录实际后台任务 ID，不能复用/停止 3002/3005。完整命令在 Task 8 ledger 记录，不保存生产凭证。

- [ ] **Step 5: 浏览器矩阵 RED→GREEN。** 新 Playwright config baseURL 为 3217、只匹配 V2 spec，reuseExistingServer=false；通过已启动的自有 production 服务验证，不依赖 dev 行为。

核心用例必须包括：

1. 从隔离后台配置 A/B 各自不同双图，保存/重载再前台来回选，读回 variant 与 gallery 两套数据；图库不被替换。
2. 首页、类目、search、collection、related、recently viewed 都一致；filter/sort/grid 不变。
3. 375/768/1440、移动双列、12/100 长值，两组选项无横溢/换行撑高；末尾选中值可见，+N 全选项可用、搜索/清搜索/无结果、稀疏组合与缺货准确。
4. desktop 整卡最终位移约 -6px、阴影可辨；只 hover 图片才换图。截图审阅家具封面完整、不裁主体；相邻网格 bounding boxes 不发生重排。
5. 无 hover/同图/失败/延迟/移出后 load/换款旧图迟到都保持正确 cover；URL 变更不会闪回旧 scene。故意资源失败仅允许准确的预期一次 console resource error。
6. keyboard 打开/Tab/选择/Escape/关闭恢复焦点；mobile 真正底部 sheet且可滚动；reduced-motion 无位移/动画；触屏图片第一击即导航，不先挂 hover overlay。
7. request listener 从选款前开始，匹配 `/api/v1/(storefront|admin)/(products|media)` 和该产品 `/products/${slug}`（包括 _rsc），直到实际导航前无这些请求；不误算 Navbar collection 请求。
8. 触屏测试同时 DOM observer 检测 data-card-scene：卡片阶段 0 次；导航后 PDP 合法图库请求不算 card hover，页面/console error 另行严格检查。
9. 实际 Add to Cart POST 与 summary 回读 selected skuId/quantity=1；同任务快速双击仅一个请求；失败可重试；price/compare-at不借另一款；Bundle 只虚拟 SKU，无组件多行。
10. 未配置卡片缺图，不共享补图；legacy推断第一款不初始化卡片；独立单 SKU可购买；其他卡/PDP状态不受影响。
11. 后台 preview 无 CartProvider 可渲染，更多/选款/CTA disabled，无 links/购买/导航/埋点；在 StrictMode/resize/hover/previewRef变化下仍然成立。
12. 真实 409 与 new typed ACTIVE phase failure 的页面恢复：草稿未丢，不重复 POST；上传迟到不污染新行/新商品。

Run: `CARD_V2_DB_URL="$CARD_V2_DB_URL" CARD_V2_ROOT="$CARD_V2_ROOT" pnpm --dir "$CARD_V2_ROOT/frontend" exec playwright test --config playwright.product-card-v2.config.ts`

Expected: 全部实际浏览器用例 PASS；保存 trace/screenshots，并用 Chrome DevTools 实际操作黄金路径与边界，读取截图和零非预期 console/page error。若环境无法浏览器验证，明确未完成 UI 验收，不以 tsc/测试替代。

- [ ] **Step 6: 最终 fresh gate、只读审计与作者自审。**

```bash
set -e
DATABASE_URL="$CARD_V2_DB_URL" pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint
git diff --check
```

Expected: 全套双端 tests/tsc EXIT=0、lint 0 errors；若并行树发生改变，重新采集当前 source manifest并重建需要的副本，不沿用旧通过计数。

在专库跑只读 `product-card-audit.ts`，对故意缺配置 fixture 得到精确问题列表；脚本无 UPDATE。生产现有商品盘点与补图不在本地验收授权内：本轮交付审计能力与发布阻断说明，未来经单独授权读取/补齐后才能发布，不能假称生产全配置。

Native author self-review 检查整轮数据流与五项 Review Focus，尤其 snapshot身份、旧默认、最终事务检查、legacy dirty字段、可访问性、preview隔离和Cart锁；Critical/Important 用一次 RED→GREEN 修复并重跑完整 suite，minor记录，不启新 reviewer。记录这是作者自审、不是独立审查。

只停止本轮 Task 8 启动任务；保留独立 DB/root/ledger/trace 供审阅。不 commit/push/merge/PR/deploy，不操作已有商品数据，不删除旧 workspace。

## 完成与发布边界

- 本计划审阅后才进入应用实现；“视觉 A 已选择”不能替代本计划审批。
- 本轮新增 1 个可空 variant 字段；当前本地 watch 服务需要采用同一列的动作单独列入预检风险闸，绝不顺带 migrate 营销链路或改 rehearsal 商品。
- 发布前需运营明确补齐现有可售变体专属 cover 与多款 default；不允许自动共享继承、批量复制或未经授权下架。已有 ACTIVE 商品若缺配置，保存/发布检查会阻止继续保持不完整状态，需提前准备，而非上线后让日常编辑突然受阻。
- 最终报告区分：代码/本地 gate、真实浏览器、旧商品准备、独立审查、生产发布五个状态。历史 V1/营销通过计数不作为 V2 fresh evidence。
- 用户授权的下一步仍是审阅本计划；当前未实现、未配置商品、未发布。

## 计划自审记录

- Spec §2 视觉/触屏/键盘/reduced-motion → Task 6/8；§3 独立双图/身份/保存 → Task 1/2/3；§4 后台/默认/草稿上架 → Task 4；§5 紧凑选择/全选项/无套餐 → Task 5/7/8；§6 所有入口/购买锁/事件/preview → Task 2/6/7/8；§7 安全/旧商品 → Global Constraints、环境闸、Task 8；§8 验收 → 各 task gate 与 Task 8。
- 五项 Review Focus 均有明确任务与测试落点；新增字段/DTO/wire 命名为 cardMedia，存储 hover 映射公共 scene，运营默认仅通过公共 displayVariantId 供卡片消费。
- 已核对当前 Modify/Test 完整路径存在；Create 路径无已有文件冲突；8 个任务各有接口、代码示例、运行与 Expected。
- 已纠正最近浏览只存 ID、实际 i18n 目录、首页测试文件与 12 值面板 fixture；不创建假缓存或不存在的测试入口。
- 占位词/代码 fence 与 git diff --check 均已检查；此记录只证明计划自审，不代表应用测试、迁移或浏览器验收已经执行。
