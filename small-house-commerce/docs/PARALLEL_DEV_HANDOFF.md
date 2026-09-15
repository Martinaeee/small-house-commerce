# 并行开发交接说明（首页+PDP / checkout+类目页）

Date: 2026-09-15
Base commit: `ec858c8`（review feedback 已上线并 push；品牌 LUWAG 改名 `01348c9` 已上线）

## 两条工作线

| 线 | 分支 | worktree 路径 | 前端端口 |
|---|---|---|---|
| A：首页 + 商品详情页(PDP) | `feat/home-pdp` | `.claude/worktrees/home-pdp`（相对仓库根） | 3002 |
| B：checkout + 类目页(PLP) | `feat/checkout-category` | `.claude/worktrees/checkout-category` | 3003 |

后端 dev server（127.0.0.1:3000）与主目录前端（localhost:3001）由用户持有，**绝不重启**。
两条线的前端都通过 Next rewrite 把 `/api/v1/*` 代理到 `http://localhost:3000`，共用用户的后端实例：

```bash
cd <worktree>/small-house-commerce/frontend
PORT=3002 npm run dev   # 线 A
PORT=3003 npm run dev   # 线 B
```

默认不需要起后端。只有当某条线必须改后端时，才在该 worktree 用独立端口起：

```bash
cd <worktree>/small-house-commerce/backend
PORT=3010 npm run start:dev          # 线 B 如需要；线 A 用 3011
# 该前端另开终端：API_TARGET=http://localhost:3010 PORT=3003 npm run dev
```

## 数据库规则（最重要）

- 两条线与用户后端**共享同一个本地库** `localhost:5432/small_house`（docker compose 已在跑）。
- **migration 串行**：任何一条线要动 schema / `prisma migrate dev` 前，必须先在会话间打招呼，确认另一条线没有未提交的 migration；禁止 `prisma migrate reset`，提示 drift/reset 立即 STOP 报告。
- 不留测试数据（订单/评论/落地页等验证完即清）。

## 文件归属（减少合并冲突）

线 A 独占：
- `frontend/src/app/(storefront)/page.tsx`（首页）
- `frontend/src/app/(storefront)/products/[slug]/`、`lp/[slug]/`
- `frontend/src/components/product/*`（PdpClient/PdpView/ProductGallery/ReviewCard/ReviewSection 等）

线 B 独占：
- `frontend/src/app/(storefront)/checkout/`、`cart/`、`order-success/`、`categories/[slug]/`、`search/`
- `frontend/src/components/checkout/*`、`category/*`、`cart/*`、`tracking/PurchaseTracking.tsx`
- `backend/src/modules/orders/`（如需要）

**共享文件，改前先在会话间通报，尽量只加不改：**
- `components/layout/*`（Header/MainNav/Footer/AnnouncementBar）、`components/ui/*`
- `components/product/ProductCard.tsx`、`PlpProductCard.tsx`（A 拥有组件本身，B 只用 props；要改先协商）
- `lib/api.ts`、`lib/tracking.ts`、`(storefront)/layout.tsx`

合并顺序：先合 A 再合 B（或先完成的先合），后合者 rebase 解决共享文件冲突并跑 `tsc --noEmit && eslint`（前端）/ `vitest run`（后端）。

## 两条线各自必读的规格

- 全局品牌：[BRAND_FOUNDATION_V1.md](BRAND_FOUNDATION_V1.md)、`frontend/DESIGN_SYSTEM.md`、`frontend/AGENTS.md`（若存在）
- 线 A：[HOMEPAGE_SPEC.md](frontend/HOMEPAGE_SPEC.md)（新版草稿，配合 `docs/frontend/home.jpeg` 参考图）、[plans/2026-09-11-pdp-refinement.md](superpowers/plans/2026-09-11-pdp-refinement.md)
- 线 B：[MVP_SCOPE.md](../MVP_SCOPE.md) 的 COD 结账约束；类目逻辑 `backend/.../catalog/category-tree.ts`、`frontend/src/lib/plp.ts`
- 研究背景：[research/](research/)（选品/定价，仅供文案与区块决策）

## 沿用的硬约束

- 价格只显示 PHP；COD 与配送既有文案一字不改；Meta Pixel 的 ViewContent/AddToCart/InitiateCheckout/Purchase 必须继续触发；不做 wishlist/心形图标。
- 零新 npm 依赖；样式只用 Tailwind 设计 token（既有例外：`text-sale/border-sale/bg-sale`）；新后台字段配中文操作提示。
- 前端验证靠 `tsc --noEmit` + `eslint` + `next build` + 浏览器手动验证；后端改动先写 vitest（纯 `new Service(prismaMock)` 风格）。
- Next.js 16 动手前先读 `frontend/node_modules/next/dist/docs/` 相关文档。
- 提交只在各自 feature 分支进行，`git add <显式路径>`，禁止 `git add -A`。

## 完工/清理

worktree 合并删除后：`git worktree remove .claude/worktrees/<name>` 并删分支。
