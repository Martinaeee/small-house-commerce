# 后台商品编辑器重构（已上线）

> 状态：**已实施并部署生产**（merge commit `2ec667e`，2026-09-24）
> 上游设计：[2026-09-20-variant-options-media-design.md](../specs/2026-09-20-variant-options-media-design.md)（领域模型、媒体解析规则、API 合约）
> 前序计划：[2026-09-21-product-variant-options-media.md](2026-09-21-product-variant-options-media.md)（Phase 1，已完成）

## 背景

生产排查发现：一个 `DRAFT` 商品的前台页面 404，被误读为“保存失败/图片没关联上”。实际原因是公开查询只返回 `ACTIVE` 商品，而当时后台对草稿也展示可打开的“Preview Product”，并且把选项缩略图、共享图库、按选项值图库、精确款式图库分散在不同位置，运营无法判断图片到底关联到了哪一层。

同时编辑器存在结构性问题：中英混杂（`COLOR — 颜色`、`Option groups 选项组`）、同一选项值同时出现“启用”与 `Deactivate`、四种编辑模式（新建 typed / 已保存 typed / legacy graph-v0 / graphLocked）视觉上不可区分、预览把草稿也当成线上页面。

本次只重构后台商品编辑体验，**不改数据库、后端 API 与前台媒体解析优先级**，也不自动把任何生产商品改为 `ACTIVE`。

## 设计契约（不要违反）

1. **单一状态与保存控制器。** `ProductForm` 是唯一的 `ProductFormValue`、校验、`updateGraph()` 与提交持有者；抽出的面板全部是受控展示组件，不维护第二份商品草稿。new/edit 页面继续负责服务端基线、catalog graph PATCH、库存批量写入与失败重试。
2. **保留四种兼容模式。** 新建 typed、已持久化 typed、legacy graph-v0、graphLocked 的判断与写入边界不变；不改 `id ?? clientKey`、`combinationKey`、乐观 `catalogGraphVersion` 或 wire payload。
3. **媒体三条数据线不合并。** 共享图库是 `value.images`；按选项值/精确款式媒体是 `value.graph.media`；详情长图/视频是 `detailBlocks`。保存顺序固定为 `stripUnsavableMedia()` → `syncSharedMediaDraft()` → `buildCatalogGraphPatch()`。
4. **媒体优先级与 replace 语义不变。** 精确款式 → 当前媒体驱动选项值 → 共享图库；每一级**整组替换，不与下一级合并**。
5. **统一使用已有后台 i18n。** 通过 `useAdminI18n()` 与 `zh.ts`/`en.ts` 新增商品编辑键；默认中文界面不拼接中英双语，切英文时整块界面完整切换。商品名、SKU、URL 和英文前台内容不翻译。
6. **预览依据已保存事实。** 实时预览展示当前未保存内容；公开页面预览只使用服务器已保存 slug，且仅在服务器状态为 `ACTIVE` 时可用。表单状态与服务器状态不同时明确提示“尚未保存，线上状态未改变”。不为草稿放宽 storefront 的 `ACTIVE` 查询。
7. **旧媒体不静默删除。** 切换“按哪个选项更换商品图”只改唯一的 `isMediaDriver`，保留旧作用域数据；不再生效的旧按值媒体在高级区显示并允许人工清理。

## 当前编辑器结构（as-built）

### 页面骨架

- 区块（内部 key → 界面标签）：`basic` 基本信息 / `media` 商品媒体 / `variants` 选项、价格与库存 / `specs` 商品规格 / `shipping` 包装与物流 / `seo` 搜索与链接 / `preview` 预览。
- sticky 头部：**唯一状态选择器** + **唯一主保存按钮**，按钮文案随所选状态变化——`保存草稿` / `保存并上架` / `保存更改`（已上架未改状态）/ `保存并下架`。没有独立的 Save Draft 旁路。
- 导航可键盘操作：roving tabindex、方向键、Home/End、Enter/Space；窄屏为单行横向滚动。
- 错误按区块路由：媒体 URL 错误进“商品媒体”，选项结构与 SKU 错误进“选项、价格与库存”，不再一律跳变体区。

### 组件职责

| 文件 | 职责 |
| --- | --- |
| `frontend/src/components/admin/ProductForm.tsx` | 唯一草稿状态、校验、错误路由、提交编排 |
| `frontend/src/components/admin/product-form/ProductFormHeader.tsx` | 状态 + 单一保存动作 + 区块导航（键盘/响应式） |
| `frontend/src/components/admin/product-form/ProductMediaPanel.tsx` | 媒体面板组合（共享图库为唯一编辑入口） |
| `frontend/src/components/admin/product-form/ProductPreviewPanel.tsx` | 未保存实时预览 vs 已保存线上版本（门禁 + slug 真值） |
| `frontend/src/components/admin/ProductOptionsEditor.tsx` | 选项组/值：单一启用-停用控件、未保存行可移除、缩略图回退说明 |
| `frontend/src/components/admin/ProductMediaScopesEditor.tsx` | 媒体驱动选项选择器、按值整组替换、精确款式高级区、未启用作用域清理 |
| `frontend/src/components/admin/VariantMatrix.tsx` | 30 行/页矩阵、批量编辑、库存护栏、持久化行保护 |
| `frontend/src/components/admin/DecimalInput.tsx` | 小数输入：保留逐字原文、外部值变化丢弃陈旧文本、尾随小数点即时提交 |
| `frontend/src/components/admin/PreviewPane.tsx` | 设备框按容器宽度缩放，内部视口保持真实设备尺寸 |
| `frontend/src/lib/admin-product-graph.ts` | graph 结构校验（类型化 issue code + 可选翻译） |

### 行为要点

- **选项状态**：选项组和选项值各只有一个启用/停用控件；已持久化行只能停用/重新启用，未保存行只能移除；移除未保存选项时**原子清理**受影响的草稿变体、对应媒体行和默认展示引用。
- **精确款式媒体身份**：选择目标款式用**语义键**（选项位置/类型/名称 + 选项值位置/标签），因此 option value 与 variant 从 clientKey 采纳服务器 ID 后仍保持原选择；写入时仍解析当前行的真实 `id ?? clientKey`。
- **保存编排**：POST（新建）→ graph PATCH → 库存批量；无变更不发请求；graph PATCH 失败不写库存；库存部分失败只重试失败行，且失败队列先于服务器刷新提交（刷新失败也不丢）；创建成功后不再重复 POST。
- **数值输入**：矩阵售价/划线价与物流重量/尺寸使用 `DecimalInput`，逐字输入 `19.95` 不被吞成 `1995`，`25.` 按 Enter 即提交 `25`。

## 测试与验收

- 单元测试：`pnpm --dir small-house-commerce/frontend test` —— 重构前 288 → 现在 **378**（32 个文件）。
- 类型/构建/格式：`tsc --noEmit`、`next build`、`git diff --check` 通过；`lint` 0 error（仅一个既有 `readStored` warning）。
- 浏览器门禁：`pnpm --dir small-house-commerce/frontend e2e` —— **26/26**（8 个后台场景 + 18 个前台回归）。
- E2E 安全边界（`src/lib/e2e-guard.ts` + `e2e/bootstrap.ts` + `playwright.config.ts`）：fail-closed 要求 loopback + 5432 + 库名恰为 `small_house_variant_test`；`bootstrap.ts` 在 Nest 启动前完成 migrate/seed（修 Playwright `webServer` 早于 `globalSetup` 的生命周期竞态）；前端 3211 / 后端 3210；`reuseExistingServer: false`。指向其他数据库的 URL 会在配置加载阶段被拒绝。

## 明确不做

- 不改 backend、Prisma schema、migration 或 storefront 媒体解析优先级。
- 不为草稿新增公开预览路由，不绕过 storefront 的 `ACTIVE` 条件。
- 不发布或修改任何生产商品状态（生产 `Stainless Steel Movable Double Layer Clothes Rack` 仍为 `DRAFT`）。
- 不做 Phase 2（PDP 内联 COD 下单）与 Phase 3（视口自动播放媒体）。

## 已知遗留（非本次引入）

- `src/lib/admin-i18n.tsx` 的 `readStored` 未使用 ESLint warning。
- `/admin/login` 表单 input 缺 `id`/`name` 的无障碍提示与一条 CSS preload 未使用警告。
- 若干测试深度类 minor（契约级断言、后端批次顺序未固定为契约测试等）记录在执行账本中。
