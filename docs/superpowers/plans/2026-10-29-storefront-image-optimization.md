# Storefront Image Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把全店图片从「原始 PNG/JPG 直出（单张 1–2.6MB，首页冷加载 ≈40–60MB）」切到 Next 内置按需缩放转 WebP，图片字节降 ~95%。

**Architecture:** 保留所有现有 `<img>` 标签与样式（零设计改动），只把 `src` 通过一个集中 helper 改写为 `/_next/image?url=…&w=…&q=75`。Next 16 图片优化器按需把原图缩放/转 WebP（上游 immutable 缓存 1 年 → 优化结果同样缓存 1 年）。需要：`images.localPatterns` 白名单、`sharp` 依赖、以及修复一个**部署陷阱**——Docker 镜像里烘焙的 `/uploads` rewrite 目标是 `http://localhost:3000`（build 时 API_TARGET 未传），优化器容器内取原图会 404，必须显式传 API_TARGET 构建参数。

**Tech Stack:** Next 16.3.4 (App Router, output: standalone, pnpm 12.3.4, Docker)。

**Spec:** 本计划基于 2026-10-29 生产实测诊断（本会话）：curl HEAD 探测首页 45 张 PNG 计 ~30MB+（top 50），PDP 图集更大；HEAD 中位 TTFB ~0.77s；fbevents.js 在国内网络 8.8s（异步，不阻塞渲染，本次不处理）。

## Global Constraints

- 全英文店面文案、视觉与交互**零改动**（`[no-design-changes-without-asking]`）：只改 `<img src>` 与配置；不动 className/布局/组件结构。
- 改动只限 frontend 目录 + docker 构建 args；backend 完全不动。
- 生产部署属「可视化全站风险」→ 按 `[deploy-direct-with-risk-gate]` 部署前必须先向用户确认。
- 现有 worktree（homepage-builder）脏文件属于其他会话工作 → **不得提交**；执行须新建 worktree（`superpowers:using-git-worktrees`，基线 origin/main）。
- 测试一律 `pnpm --dir small-house-commerce/frontend vitest run <file>`（vitest 3）。
- 本地 dev 验证须用 `localhost`（Next16 memorized 坑）；图片走 dev 优化器无需 sharp。
- 提交信息遵循现有 style（`feat(frontend): …` 风格）。

## Review Focus

- 원시 URL 不是 `/uploads/` 前缀（外链/R2 未启用但代码允许绝对 URL）→ helper 必须原样返回原 URL，不能包 `/_next/image`。测试在 Task 1。
- `null/undefined` URL → helper 直接透传，组件已有 `media.cover ? … : PlaceholderImage` 分支，不得因 helper 引入运行时 TypeError。测试在 Task 1。
- 优化器 404 → **容器内**烘焙 rewrite 指向 localhost（Task 2 修复）；若部署后 `/_next/image` 返回 400/500，先查 `/_next/image?url=/uploads/...` 源站取数，而不是回滚代码。
- sharp 缺失（standalone trace 未带上）→ 运行时报 "Cannot find module sharp"。Task 2 加构建期 sanity check；部署 smoke 不绿则按 Task 5 contingency。
- Spec 断言图片 src 的 4 个文件（HomepageContentImage/ProductCard 相关等 67 个 spec 提到媒体）——改完后跑受影响组件的 spec，按新 src 断言修补，不得删除断言绕过。

---

### Task 1: helper + next.config images 白名单

**Files:**
- Create: `small-house-commerce/frontend/src/lib/image-url.ts`
- Create: `small-house-commerce/frontend/src/lib/image-url.spec.ts`
- Modify: `small-house-commerce/frontend/next.config.ts`（`images` 配置）
- Modify: `small-house-commerce/frontend/package.json`（新增 sharp 依赖，`pnpm add sharp --dir`）

**Interfaces:**
- Produces: `optimizedUploadImage(url: string, width: number): string` — `/uploads/**` → `/_next/image?url=…&w=…&q=75`；其他（含外链、空 iCS？string 入参）原样返回。

- [ ] **Step 1: 写失败测试** `image-url.spec.ts`：

```ts
import { describe, expect, it } from "vitest";
import { optimizedUploadImage } from "./image-url";

describe("optimizedUploadImage", () => {
  it("rewrites local upload paths to the Next image optimizer", () => {
    expect(optimizedUploadImage("/uploads/catalog/2026/abc.png", 640))
      .toBe(`/_next/image?url=${encodeURIComponent("/uploads/catalog/2026/abc.png")}&w=640&q=75`);
  });
  it("passes through absolute/external URLs untouched", () => {
    expect(optimizedUploadImage("https://cdn.example.com/x.png", 640)).toBe("https://cdn.example.com/x.png");
  });
  it("passes through non-upload local paths untouched", () => {
    expect(optimizedUploadImage("/brand-mark", 64)).toBe("/brand-mark");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**：`pnpm --dir frontend vitest run src/lib/image-url.spec.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现 helper**：

```ts
// /uploads 只在生产由后端直出（原图 1–2.6MB PNG），统一走 Next 内置
// 优化器按需缩放并转 WebP；其余 URL 原样返回，不做任何包装。
export function optimizedUploadImage(url: string, width: number): string {
  if (!url.startsWith("/uploads/")) return url;
  const params = new URLSearchParams({ url, w: String(width), q: "75" });
  return `/_next/image?${params.toString()}`;
}
```

- [ ] **Step 4: 测试通过**。
- [ ] **Step 5: next.config.ts** 顶层 nextConfig 增加（`qualities` 默认即允许 75，不重复配）：

```ts
  images: {
    // 只放行上传目录；search:"" 禁止恶意 query 构造优化 URL。
    localPatterns: [{ pathname: "/uploads/**", search: "" }],
    // AVIF 编码在容器 CPU 上太慢，只用 WebP。
    formats: ["image/webp"],
  },
```

- [ ] **Step 6: `pnpm add sharp`（frontend 目录，更新 package.json + pnpm-lock.yaml）。**
- [ ] **Step 7: Commit** `feat(image): add upload-image optimizer helper, localPatterns and sharp dep`。

### Task 2: 生产容器取原图链路修复（API_TARGET 烘焙）

**Files:**
- Modify: `small-house-commerce/frontend/Dockerfile`（build stage 加 ARG）
- Modify: `small-house-commerce/docker-compose.prod.yml`（frontend build.args 加 API_TARGET）

**Context:** 前端镜像内烘焙的 rewrite `/uploads/→API_TARGET`（build 时未设 = `http://localhost:3000`）。图片优化器在容器内通过自身端口取源图 → 会打到不存在的东西。浏览器路径不受影响（Caddy 仍直连后端）。

- [ ] **Step 1:** Dockerfile build stage（`COPY package.json` 之前）加：

```dockerfile
ARG API_TARGET=""
ENV API_TARGET=$API_TARGET
```

且 `next.config.ts` 的默认值改为 `process.env.API_TARGET || "http://localhost:3000"`（空串也回退 dev）。

- [ ] **Step 2:** docker-compose.prod.yml frontend build.args 增加：

```yaml
        # Baked into the /api/v1 & /uploads rewrites (routes-manifest).
        # In-container the Next image optimizer fetches /uploads/* source
        # files through the frontend itself, which must reach the backend.
        API_TARGET: ${API_TARGET:-http://backend:3000}
```

- [ ] **Step 3:** 构建期 sanity（Dockerfile build stage，`pnpm run build` 之后）：`RUN node -e "require('sharp')"`（standalone trace 是否带上在 Task 5 部署 smoke 验证）。
- [ ] **Step 4: Commit** `build(image): pass API_TARGET at frontend image build so the optimizer can reach /uploads, add sharp sanity check`。

### Task 3: 店面组件按上下文替换 src（唯一例外的图片流：BootSplash、BrandAssetImage 不动）

替换规则（机械、统一）：`src={X}` → `src={optimizedUploadImage(X, W)}`，文件头部加 import。W 取值表：

| 上下文 | W |
|---|---|
| 小缩略图（搜索建议、订单/购物车行内、评论头像、MainNav leaf、变体选择/选项面板小图） | 96 |
| 商品卡 cover / hover scene / 集合卡 / 分类瓦片 | 640 |
| PDP 图集 / 详情正文 / 光箱（lightbox 收起态与全屏%） | 1280 |
| hero / 首页大图 / 场景大图 / UGC / 品牌故事 | 1440 |

**Files（按组逐个 commit）:**
- 组A 首页: `components/home/{HeroSlider.tsx,HeroSection.tsx,BrandStorySection.tsx,CategoryTilesSection.tsx,HomepageContentImage.tsx,ProductStorySection.tsx,RoomInspirationSection.tsx,RoomSceneGallery.tsx,RoomSceneStack.tsx,UgcSection.tsx}`
- 组B 商品/PDP: `components/product/{ProductCardImage.tsx,ProductCardOptionPanel.tsx,ProductCardVariantSelector.tsx,ProductGallery.tsx,ProductDetailBody.tsx,ProductLightbox.tsx,ProductOptionSelector.tsx,PdpQuickCodOrder.tsx,PdpStickyBuy.tsx,ReviewCard.tsx}`
- 组C 交易流: `components/cart/{CartDrawer.tsx,CartOptionPicker.tsx,CartRecommendations.tsx,QuickAddView.tsx}`、`components/checkout/OrderPreview.tsx`、`components/track-order/OrderList.tsx`、`components/collection/CollectionCard.tsx`、`components/layout/{MainNav.tsx,SiteSearch.tsx}`
- 组D 页面: `app/(storefront)/about/page.tsx`、`app/(storefront)/categories/[slug]/page.tsx`

**Interfaces:** Consumes `optimizedUploadImage`（Task 1）。

- [ ] 每组：改文件 → 跑该目录相关 spec（`vitest run src/components/<dir>`）→ 修断言（新 src）→ commit（一组一个 commit）。
- [ ] HeroSlider：首屏第一张可见图加 `fetchPriority="high"`（提高 LCP）。
- [ ] 注意保留每处既有 `loading="lazy"` / `object-*` / alt 与 eslint-disable 注释中已失效者删除。

### Task 4: 本地全量验证

- [ ] `pnpm --dir frontend vitest run`（全套）。
- [ ] `pnpm --dir frontend dev`（localhost:3000，backend 同起）+ 浏览器过一遍：首页、列表/分类、PDP、购物车、结账 OrderPreview、track-order、about；确认所有图 `/_next/image` 200 且为 WebP，界面与改前一致（截图对照）。
- [ ] 点击变体/悬停换图路径验证 scene/hover 图也走优化器。

### Task 5: 生产部署（先获得用户确认，再执行）

- [ ] push 分支到远端，merge 到 main（GitHub 走代理 `-c http.proxy=…`，memorized）。
- [ ] 服务器拉取、`docker compose -f docker-compose.prod.yml --env-file .env.deploy build frontend && up -d frontend`（backend 不动、无迁移）。
- [ ] Smoke：`curl -sI https://luwag.shop/_next/image?url=<一张已知原图>&w=640&q=75` → content-type `image/webp`、体积 <300KB；`sharp` 缺失 contingency：runner 阶段补 `COPY --from=build /app/node_modules/.pnpm/sharp@* /app/node_modules/sharp`（路径按实际调整）。
- [ ] 部署报告含「无关附带改动」清单（应为零）+ 回滚方式（回退镜像）。

---

## Self-Review

- Spec coverage：诊断三因——图片字节（Task1-3 ✓）、优化器/容器链路（Task2 ✓）、sharp（Task1/2 + 同存活检查 ✓）；国网 RTT 与 Meta 像素慢域**不属代码可解**，已在交付说明中告知用户（PH 受众不受影响）。
- Placeholder scan：无 TBD；Task 3 为机械模式 + 显式宽度表，测试语句全部给出精确值。
- Type consistency：唯一公开接口 `optimizedUploadImage(string, number): string` 全计划一致。
- Review Focus 已逐条落到 Task（见各步）。
