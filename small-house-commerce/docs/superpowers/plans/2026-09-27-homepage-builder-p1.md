# Homepage V2 / Visual Homepage Builder — P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有首页业务之上落地版本化文档模型与 Draft→Publish→Version 工作流，把 `/admin/homepage` 重做为三栏可视化编辑器（Hero 幻灯完整可视化 + Announcement Bar），前台切换为从生效版本文档渲染。

**Architecture:** 新增 `homepage_documents`（DB 级单例草稿）+ `homepage_versions`（发布快照）两张加性表；旧 `homepage_sections` 一次性回填为 version 1 后只读冻结、旧写接口删除。前台 `GET /storefront/homepage` 保持响应契约、数据源换成"读取时求值"的生效版本；Hero 升级为 `HeroSlider`（多张、元素百分比定位、逐设备 CSS 变量、复用 `ViewportVideo` HERO 模式）；后台编辑器为客户端真实组件预览 + `dnd-kit` 列表排序 + 自研画布拖拽。

**Tech Stack:** NestJS + Prisma 7 + PostgreSQL（backend）；Next.js 16 App Router + React 19 + Tailwind v4 + Vitest + Playwright（frontend）；新依赖仅 `@dnd-kit/core`、`@dnd-kit/sortable`（仅后台 bundle）。

**Spec:** `docs/superpowers/specs/2026-09-27-homepage-visual-builder-design.md`（commit c8c2ce8）— 执行者必须先读 spec 再读本计划。

## Global Constraints

- 迁移**仅加性**：不删除/修改任何旧表与列；`homepage_sections` / `homepage_section_products` 迁移后只读冻结。
- **唯一写入链路**：新 Document API 是唯一可写接口；旧 admin `PATCH /homepage/sections`、`PUT /homepage/sections/:id/products` 连同 service 写方法**删除**（旧 `GET` 保留只读）。
- `homepage_documents` **DB 级单例**：固定 ID `00000000-0000-0000-0000-000000000001` + `CHECK (id = '…0001')`。
- RBAC 沿用 `PRODUCT_MANAGE`，不新增权限码。
- 图片继续原生 `<img>`（带既有 eslint-disable 注释）；不引入 `next/image`；不做图片/视频转码与 codec 解析。
- 视频兼容性=浏览器实测（`loadedmetadata` + `seek` + canvas 抽帧三步全过才接受上传）；时长 ≤ 30s、分辨率 ≥ 1280×720、体积 ≤ 100MB；Poster 强制。
- 预览 token：HMAC-SHA256、TTL 30 分钟、scope `homepage-draft-preview`、过期/篡改/scope 不符**统一 404**、`private, no-store` + `noindex, nofollow` + `Referrer-Policy: no-referrer`、预览页**零追踪**（不挂 Meta Pixel/HomeTracking、不触发 data-track-*）、token 不落 localStorage/sessionStorage/cookie。
- 前台区块组件与业务规则不重写：可售过滤、分类/集合水合、ISR 120s + `revalidateCache(STOREFRONT)`、`data-track-*` 追踪属性全部保留。
- 样式值白名单：数字/百分比/枚举/`#rrggbb` 才可进入生成的 CSS（防注入）；文本一律作为 HTML 叠加，不烧录进媒体。
- 所有写操作成功后必须 `revalidateCache([CACHE_TAGS.STOREFRONT])`。
- 测试命令前缀（worktree 根执行）：
  - backend：`pnpm --dir small-house-commerce/backend test`、`… exec tsc --noEmit`
  - frontend：`pnpm --dir small-house-commerce/frontend test`、`… exec tsc --noEmit`、`… lint`、`… build`
  - E2E：`pnpm --dir small-house-commerce/frontend exec playwright test --project=chromium`（隔离库，禁止连生产）
- 部署前检查：`git log --oneline ac4db0e..HEAD` 只能出现已在生产部署的提交（b11595e/c8c2ce8/d252108/1f62c08）与本次新提交；E2E 只在隔离库执行。

## Spec Corrections（实现前须知，2 处 spec 遗漏）

1. **section 保留 `title`/`subtitle`**：spec §3.2 的 section schema 遗漏了这两个字段，但 §4.2 要求响应契约不变、且现有区块组件用 `section.title` 渲染标题 → 文档 schema 必须包含 `title: string|null`、`subtitle: string|null`。
2. **旧 HERO payload 不写进回填 SQL**：回填只做结构搬运（jsonb 原样复制）；旧版 HERO payload（`desktopImage/videoUrl/ctaPrimary*`）由 `normalizeLegacyDocument()` 在读取时转成 v2 单幻灯（TS 实现，可测试），避免在 SQL 里做复杂变换。

## Review Focus（spec 暗示但任务测试未必覆盖、最容易伤到真实使用者的 5 类输入）

1. **双编辑器并发保存**：两个标签页同时编辑，后保存者 rev 过期 → 必须 409 且 UI 给"载入最新/保留我的"选择，绝不静默覆盖（Task 3 服务测试 + Task 12 UI 测试）。
2. **排期边界与自动回退**：`publishAt == now` 生效、`unpublishAt == now` 失效、节日版本到期后自动回退次新有效版本（Task 3 边界测试，含无任何有效版本 → 旧表回退）。
3. **预览 token 被篡改/过期/跨用途**：统一 404、无 `Cache-Control` 泄漏、预览页零追踪（Task 5 + Task 21 测试）。
4. **拖拽坐标越界/异常**：画布拖拽产生负数、>100、NaN 时必须钳制在 0–100 且不破坏文档（Task 16 测试）。
5. **不可解码视频**：`loadedmetadata`/`seek`/抽帧任一失败必须拒绝上传并给出可读原因，绝不产生无 Poster 的幻灯（Task 15 逻辑测试 + Task 22 E2E）。

---

## File Structure（创建/修改清单）

**Backend（`small-house-commerce/backend/`）**
- `prisma/schema/homepage.prisma` — 追加 `HomepageDocument` / `HomepageVersion` 模型（保留旧模型）。
- `prisma/migrations/<ts>_add_homepage_document_versions/migration.sql` — 建表 + 单例 CHECK + 回填 v1。
- `src/modules/cms/homepage-document.ts` — 文档 zod schema v1 + 类型 + `emptyDocument()` + `normalizeLegacyDocument()`。
- `src/modules/cms/homepage-document.service.ts` — 草稿/版本/生效/发布/恢复/下线。
- `src/modules/cms/homepage-validation.ts` — 发布前检查（errors/warnings）。
- `src/modules/cms/homepage-preview-token.ts` — 签发/校验。
- `src/modules/cms/dto/homepage-document.dto.ts` — 请求 DTO（保存草稿/发布/恢复等）。
- `src/modules/cms/admin/homepage.controller.ts` — 改：新路由，删旧写路由。
- `src/modules/cms/homepage.service.ts` — 改：`storefrontGet` 改源 + 链接解析 + 排期过滤 + announcement 读取；删 `saveSections`/`setSectionProducts`。
- `src/modules/cms/storefront/homepage.controller.ts` — 改：新增 announcement 端点 + previewToken 参数。
- `src/config/configuration.ts` / `env.validation.ts` — 新增 `HOMEPAGE_PREVIEW_SECRET`。
- `docker-compose.prod.yml` — backend environment 增 `HOMEPAGE_PREVIEW_SECRET: ${HOMEPAGE_PREVIEW_SECRET:-}`。
- 测试：`homepage-document.spec.ts`、`homepage-document.service.spec.ts`、`homepage-validation.spec.ts`、`homepage-preview-token.spec.ts`、更新 `homepage.service.spec.ts`、`dto/homepage-section.dto.spec.ts`（删除被删写接口的用例）。

**Frontend（`small-house-commerce/frontend/`）**
- `src/lib/homepage-document.ts` — 文档 TS 类型（backend zod 的镜像）+ 默认值 + 全部纯变更函数（`updateHeroSlide` 等）。
- `src/lib/homepage-editor-state.ts` — reducer（undo/redo/dirty/saveState）。
- `src/lib/homepage-styles.ts` — CSS 变量编译器（`heroCssVars()`，白名单校验）。
- `src/lib/video-probe.ts` — 视频三步探测 + Poster 抽帧。
- `src/lib/admin-api.ts` — 新增 9 个客户端方法。
- `src/components/admin/homepage/` — `HomepageEditor.tsx`、`ModuleTree.tsx`、`SlideList.tsx`、`HeroCanvas.tsx`、`SettingsPanel.tsx`、`HeroMediaSettings.tsx`、`HeroStyleSettings.tsx`、`AnnouncementSettings.tsx`、`LinkPicker.tsx`、`PublishPanel.tsx`。
- `src/app/admin/(shell)/homepage/page.tsx` — 替换为编辑器挂载。
- `src/app/admin/(shell)/homepage/versions/page.tsx` — 版本历史。
- `src/components/admin/AdminShell.tsx` — 导航分组（Website → Homepage）。
- `src/components/home/HeroSlider.tsx`、`HeroSlideCountdown.tsx` — 新前台 Hero。
- `src/components/home/sectionRegistry.tsx` — HERO → HeroSlider。
- `src/components/layout/AnnouncementBar.tsx` — v2（props 驱动 + 轮播）。
- `src/app/(storefront)/layout.tsx` — 拉取 announcement 传入。
- `src/app/preview/homepage/page.tsx` — 草稿预览路由（独立于 storefront 布局，零追踪）。
- `src/i18n/zh.ts` / `en.ts` — 新增 `homepage_builder_*` 等键。
- 测试：`homepage-document.spec.ts`、`homepage-editor-state.spec.ts`、`homepage-styles.spec.ts`、`video-probe.spec.ts`（纯逻辑部分）、各组件 spec、`e2e/homepage-builder.spec.ts`。

---

### Task 0: 隔离 worktree + Homepage BEFORE baseline

**Files:**
- Create: `docs/superpowers/acceptance/2026-09-27-homepage-before/`（截图 + `legacy-homepage-snapshot.json` + `README.md` 记录 HEAD 与采集时间）

**Interfaces:**
- Consumes: 生产基线 `1f62c08`（= ac4db0e + 设计文档 + 批量删除/批量状态两批已部署功能）。
- Produces: 独立分支 `feature/homepage-builder` 的 worktree（后续全部任务在此执行）；baseline 证据供 Task 22 对照。

- [ ] **Step 1: 建 worktree 并验证内容**

```bash
cd "/Users/Admin1/Desktop/菲律宾家居/建站/codex建站"
git worktree add -b feature/homepage-builder .claude/worktrees/homepage-builder 1f62c08
cd .claude/worktrees/homepage-builder
git log --oneline ac4db0e..HEAD   # 必须只输出：1f62c08, d252108, c8c2ce8, b11595e（全部已部署）
git status --short                 # 只允许出现 ?? small-house-commerce/backend/uploads/
```

- [ ] **Step 2: 前台 BEFORE 截图（生产，只读）**

用 Chrome DevTools MCP 打开 `http://43.135.75.99/`，分别以 1440 / 768 / 390 宽截整页图，存 `docs/superpowers/acceptance/2026-09-27-homepage-before/storefront-{1440,768,390}.png`。

- [ ] **Step 3: Admin Homepage BEFORE 截图（本地隔离环境）**

生产无可用 Admin 会话（且不为采集创建登录态），改为本地 dev + 隔离库截图：`pnpm --dir small-house-commerce/frontend dev`（本 worktree，隔离库端口按既有 E2E 基建），登录本地 admin（devpass1234 或隔离库管理员），截 `/admin/homepage` 列表态 + 一个区块编辑态，存 `admin-homepage-list.png` / `admin-homepage-edit.png`。在 README.md 注明"admin 截图来自本地隔离环境（与生产同代码）"。

- [ ] **Step 4: 旧表只读 JSON snapshot（生产只读查询）**

```bash
ssh smallhouse-prod 'docker exec small-house-prod-db-1 psql -U smallhouse -d small_house -tA -c "SELECT jsonb_pretty(jsonb_build_object(''sections'', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order) FROM homepage_sections s), ''products'', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.section_id, p.sort_order) FROM homepage_section_products p)))"' > docs/superpowers/acceptance/2026-09-27-homepage-before/legacy-homepage-snapshot.json
```

校验：文件是合法 JSON、sections 数量与生产一致（当前 5 商品环境约 12 个区块；以实际为准并记入 README）。

- [ ] **Step 5: README.md 记录**

写入：采集时间（Asia/Manila）、`git rev-parse HEAD`、生产 HEAD、截图清单、snapshot 的 sections 数量、admin 截图环境说明。

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/acceptance/2026-09-27-homepage-before
git commit -m "docs(homepage): capture before baseline for builder P1"
```

---

### Task 1: Prisma 模型 + 迁移（建表 / 单例约束 / 回填 v1）

**Files:**
- Modify: `small-house-commerce/backend/prisma/schema/homepage.prisma`
- Create: `small-house-commerce/backend/prisma/migrations/20260928120000_add_homepage_document_versions/migration.sql`

**Interfaces:**
- Consumes: 现有 `homepage_sections` / `homepage_section_products`（列名见 spec §2 盘点）。
- Produces: 表 `homepage_documents`（单例行）、`homepage_versions`；Prisma 客户端类型 `HomepageDocument` / `HomepageVersion`。后续 Task 3/7 依赖这两张表。

- [ ] **Step 1: schema 追加模型**

```prisma
model HomepageDocument {
  id                 String   @id @db.Uuid
  draft              Json
  draftRev           Int      @default(1)
  draftUpdatedById   String?  @db.Uuid
  publishedVersionId String?  @db.Uuid
  createdAt          DateTime @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime @updatedAt @db.Timestamptz(3)

  @@map("homepage_documents")
}

model HomepageVersion {
  id          String    @id @default(uuid(7)) @db.Uuid
  versionNo   Int       @unique
  document    Json
  note        String?
  createdById String?   @db.Uuid
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)
  publishAt   DateTime  @db.Timestamptz(3)
  unpublishAt DateTime? @db.Timestamptz(3)

  @@index([publishAt])
  @@map("homepage_versions")
}
```

- [ ] **Step 2: 手写迁移 SQL**

`migration.sql`（节选核心，完整写出）：

```sql
CREATE TABLE "homepage_documents" (
  "id" UUID NOT NULL,
  "draft" JSONB NOT NULL,
  "draftRev" INTEGER NOT NULL DEFAULT 1,
  "draftUpdatedById" UUID,
  "publishedVersionId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "homepage_documents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "homepage_documents"
  ADD CONSTRAINT "homepage_documents_singleton"
  CHECK ("id" = '00000000-0000-0000-0000-000000000001');

CREATE TABLE "homepage_versions" (
  "id" UUID NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "document" JSONB NOT NULL,
  "note" TEXT,
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishAt" TIMESTAMPTZ(3) NOT NULL,
  "unpublishAt" TIMESTAMPTZ(3),
  CONSTRAINT "homepage_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "homepage_versions_versionNo_key" ON "homepage_versions"("versionNo");
CREATE INDEX "homepage_versions_publishAt_idx" ON "homepage_versions"("publishAt");

-- 回填：旧区块 → 文档 v1（结构搬运，payload 原样；HERO 旧 payload 由 TS normalize 处理）
WITH sections AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'type', s."type"::text,
      'title', s.title,
      'subtitle', s.subtitle,
      'enabled', s.enabled,
      'sortOrder', s."sort_order",
      'schedule', jsonb_build_object('publishAt', NULL, 'unpublishAt', NULL),
      'payload', COALESCE(s.payload, '{}'::jsonb),
      'products', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'productId', p."product_id",
          'sortOrder', p."sort_order",
          'badge', p.badge
        ) ORDER BY p."sort_order")
        FROM "homepage_section_products" p WHERE p."section_id" = s.id
      ), '[]'::jsonb)
    ) ORDER BY s."sort_order", s."created_at"), '[]'::jsonb) AS list
  FROM "homepage_sections" s
), doc AS (
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'sections', sections.list,
    'announcement', jsonb_build_object(
      'enabled', true,
      'rotationMs', 5000,
      'items', jsonb_build_array(jsonb_build_object(
        'id', '00000000-0000-7000-8000-0000000000a1',
        'text', 'Free Metro Manila delivery on orders ₱3,000+ · Cash on Delivery nationwide',
        'link', NULL, 'linkLabel', NULL,
        'textColor', '#292724', 'backgroundColor', '#F2EFE9',
        'schedule', jsonb_build_object('publishAt', NULL, 'unpublishAt', NULL),
        'enabled', true, 'sortOrder', 0
      ))
    )
  ) AS document
  FROM sections
)
INSERT INTO "homepage_documents" ("id", "draft", "draftRev", "updatedAt")
SELECT '00000000-0000-0000-0000-000000000001', doc.document, 1, CURRENT_TIMESTAMP FROM doc;

INSERT INTO "homepage_versions" ("id", "versionNo", "document", "note", "publishAt")
SELECT gen_random_uuid(), 1, d."draft", 'Migrated from homepage_sections', CURRENT_TIMESTAMP
FROM "homepage_documents" d WHERE d."id" = '00000000-0000-0000-0000-000000000001';
-- publishAt=迁移时刻使 v1 立即生效（PostgreSQL 13+ 内置 gen_random_uuid()）。
```

- [ ] **Step 3: 本地隔离库演练 + 等价性验证**

克隆库应用迁移（沿用既有流程：`createdb` 克隆 + `prisma migrate deploy`），然后：
```bash
# 文档 sections 与旧表 sections 的 (type, sort_order, title, payload) 深比较
psql "$CLONE_URL" -tA -c "SELECT count(*) FROM homepage_sections"   # 旧表行数不变
psql "$CLONE_URL" -tA -c "SELECT jsonb_array_length(draft->'sections') FROM homepage_documents"  # 数量一致
# 单例约束验证：插入第二行必须失败
psql "$CLONE_URL" -c "INSERT INTO homepage_documents (id, draft, \"updatedAt\") VALUES ('00000000-0000-0000-0000-000000000002','{}',now())"
# 期望：ERROR: new row ... violates check constraint "homepage_documents_singleton"
```
把等价性比对写成一个一次性脚本输出 PASS/FAIL（区块数、顺序、每区块 type/payload 深比较）。

- [ ] **Step 4: Commit**

```bash
git add small-house-commerce/backend/prisma
git commit -m "feat(homepage): add versioned homepage document tables with backfill"
```

---

### Task 2: 文档 schema v1 + 旧版 HERO 归一化（backend）

**Files:**
- Create: `small-house-commerce/backend/src/modules/cms/homepage-document.ts`
- Test: `small-house-commerce/backend/src/modules/cms/homepage-document.spec.ts`

**Interfaces:**
- Consumes: 无（纯模块）。
- Produces（后续任务全部依赖，签名固定）：
  - `export const SCHEMA_VERSION = 1`
  - `export const homepageDocumentSchema: z.ZodType<HomepageDocument>`
  - `export type HomepageDocument`、`HomepageSection`、`HeroPayload`、`HeroSlide`、`HeroElement`、`HeroElementKey`（`"eyebrow"|"heading"|"subheading"|"offer"|"ctaPrimary"|"ctaSecondary"|"countdown"`）、`AnnouncementBlock`、`AnnouncementItem`、`LinkValue`、`Schedule`
  - `export function emptyDocument(): HomepageDocument`
  - `export function normalizeLegacyDocument(input: unknown): HomepageDocument` — 旧 HERO payload（`desktopImage/mobileImage/videoUrl/posterImage/ctaPrimaryText/Link/ctaSecondary*`）→ v2 单幻灯；其余区块原样透传；已是 v2 的幂等返回。

- [ ] **Step 1: 写失败测试（关键契约）**

```ts
import { describe, expect, it } from "vitest";
import {
  emptyDocument,
  homepageDocumentSchema,
  normalizeLegacyDocument,
} from "./homepage-document.js";

describe("homepage document schema v1", () => {
  it("accepts a minimal document and rejects unknown schema versions", () => {
    const doc = emptyDocument();
    expect(homepageDocumentSchema.parse(doc)).toMatchObject({ schemaVersion: 1 });
    expect(
      homepageDocumentSchema.safeParse({ ...doc, schemaVersion: 2 }).success,
    ).toBe(false);
  });

  it("rejects hero slides without media on publish-shape validation", () => {
    const doc = emptyDocument();
    const hero = doc.sections.find((s) => s.type === "HERO")!;
    (hero.payload as Record<string, unknown>).slides = [
      { id: "00000000-0000-7000-8000-000000000010", name: "s", enabled: true,
        sortOrder: 0, schedule: { publishAt: null, unpublishAt: null },
        media: { type: "IMAGE", image: null, video: null }, /* … */ },
    ];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false); // image 必填于 IMAGE 类型
  });

  it("rejects non-https external links and non-hex colors", () => {
    const doc = emptyDocument();
    const hero = doc.sections.find((s) => s.type === "HERO")!;
    const slide = (hero.payload as any).slides[0];
    slide.elements.ctaPrimary.link = { type: "EXTERNAL", url: "http://insecure.example" };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
    slide.elements.ctaPrimary.link = null;
    slide.elements.heading.style.textColor = "red; background:url(x)";
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });
});

describe("normalizeLegacyDocument", () => {
  it("converts a legacy hero payload into a single v2 slide", () => {
    const legacy = {
      schemaVersion: 1,
      announcement: emptyDocument().announcement,
      sections: [
        {
          id: "00000000-0000-7000-8000-000000000001",
          type: "HERO",
          title: null, subtitle: null, enabled: true, sortOrder: 0,
          schedule: { publishAt: null, unpublishAt: null },
          products: [],
          payload: {
            desktopImage: "/uploads/catalog/2026/a.jpg",
            mobileImage: "/uploads/catalog/2026/b.jpg",
            videoUrl: "https://cdn.example/hero.mp4",
            posterImage: "/uploads/catalog/2026/p.jpg",
            ctaPrimaryText: "Shop now",
            ctaPrimaryLink: "/collections/new-arrivals",
            ctaSecondaryText: null, ctaSecondaryLink: null,
          },
        },
      ],
    };
    const doc = normalizeLegacyDocument(legacy);
    const payload = doc.sections[0].payload as any;
    expect(payload.behavior.autoplay).toBe(true);
    expect(payload.slides).toHaveLength(1);
    expect(payload.slides[0].media.type).toBe("VIDEO");
    expect(payload.slides[0].media.video.url).toBe("https://cdn.example/hero.mp4");
    expect(payload.slides[0].media.video.poster).toBe("/uploads/catalog/2026/p.jpg");
    expect(payload.slides[0].elements.ctaPrimary.text).toBe("Shop now");
    // 已归一化的文档幂等
    expect(normalizeLegacyDocument(doc)).toEqual(doc);
  });

  it("keeps image-only legacy heroes as IMAGE slides with the mobile image as override", () => {
    // desktopImage + mobileImage、无 videoUrl → type IMAGE，mobileOverride.enabled=true
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/cms/homepage-document.spec.ts`
Expected: FAIL — `Cannot find module './homepage-document.js'`

- [ ] **Step 3: 实现**

按 spec §3.2/§3.3 完整写出 zod schema（要点，全部字段与约束按 spec 逐条落地）：
- `hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)`；`siteMediaUrl` 复用 `common/site-media-url.ts` 的校验（http(s) 或单斜杠站内相对）。
- `linkSchema` 判别联合（PRODUCT/COLLECTION/CATEGORY/LANDING 为 `{type, id: uuid}`；EXTERNAL 为 `{type, url: https}`）。
- `elementStyleSchema`（全字段 `.partial()`，未设置=继承）：`fontSize 8–200`、`fontWeight ∈ {400,500,600,700,800}`、`lineHeight 0.8–3`、`letterSpacing -5–20`、`textColor hex`、`textAlign ∈ LEFT/CENTER/RIGHT`、`maxWidthPct 5–100`。
- `layoutSchema`：`xPct/yPct 0–100`、`widthPct 5–100`、`align`、`verticalAlign ∈ TOP/MIDDLE/BOTTOM`。
- `heroElementSchema`：`{ text ≤500, link nullable, style, layout, overrides: { tablet?: {layout.partial, style}, mobile?: … }, locked: boolean }`；`offer` 增 `chip: {background hex, textColor hex, borderRadius 0–48, paddingX 4–48, paddingY 2–32}`；两个 CTA 增 `button: {variant ∈ SOLID/OUTLINE/LINK, background/textColor/borderColor/hoverBackground/hoverTextColor hex|null, borderRadius, paddingX, paddingY, size ∈ SM/MD/LG}`；`countdown` 增 `{endsAt: datetime|null}`。
- `heroSlideSchema`：`{ id uuid, name ≤80, enabled, sortOrder 0–99, schedule, media, overlay: {color hex, opacity 0–1, gradient ∈ NONE/BOTTOM/FULL}, elements: 7 键对象 }`；`mediaSchema` 用 `superRefine` 强制：`type=IMAGE → image 必填且 alt 允许空`、`type=VIDEO → video 必填且 poster 必填`；`mobileOverride.enabled=false → image/video 必须为 null`。
- `heroPayloadSchema`：`behavior {autoplay, durationMs 3000–15000, transition ∈ FADE/SLIDE, pauseOnHover, arrows, pagination ∈ DOTS/COUNTER/PROGRESS, manualPauseMs 0–60000}` + `slides: array(heroSlideSchema).min(1).max(6)`。
- `announcementItemSchema`：`{ id uuid, text ≤200, link nullable, linkLabel ≤40 nullable, textColor hex, backgroundColor hex, schedule, enabled, sortOrder 0–99 }`；`announcementSchema`：`{enabled, rotationMs 2000–30000, items ≤6}`。
- `sectionSchema`：`{ id uuid, type ∈ 10 类型, title ≤200 nullable, subtitle ≤500 nullable, enabled, sortOrder 0–999, schedule, payload: z.record(z.unknown()), products ≤24 的 `{productId uuid, sortOrder 0–999, badge ≤20 nullable}` 数组, style: z.record(z.unknown()).optional() }`；**payload 对 HERO 用 `heroPayloadSchema` 严格校验、其余类型透传**（用 `superRefine` 按 type 分支）。
- `emptyDocument()`：HERO（1 张默认幻灯，含默认元素布局：heading x7.4/y22.8、sub x7.4/y38、CTA y54，widthPct 40；文本为空字符串）+ 默认 announcement（enabled:false，items:[]）。
- `normalizeLegacyDocument(input)`：`homepageDocumentSchema.parse` 前先做 payload 归一化——遍历 sections，`type==="HERO"` 且 `payload.slides === undefined` 时构造单幻灯：`media.type = videoUrl ? "VIDEO" : "IMAGE"`；`media.image = desktopImage ? {url, alt:""} : null`；`video = videoUrl ? {url, poster: posterImage ?? null, autoplay:true, muted:true, loop:true, playsInline:true, showSoundToggle:false, pauseOffscreen:true} : null`；`mobileOverride = mobileImage ? {enabled:true, image:{url,alt:""}, video:null} : {enabled:false,…}`；`ctaPrimary = {text: ctaPrimaryText ?? "", link: legacyLinkToValue(ctaPrimaryLink), …}`（`legacyLinkToValue`：以 `/products/`、`/collections/`、`/categories/`、`/lp/` 开头 → 对应类型但**无 id 无法解析 → 存 EXTERNAL? 否**：P1 规则=无法映射为实体 id 的旧路径链接降级为 `null` 并在发布校验里以 WARNING 提示运营重新选择；`https://` 外链 → EXTERNAL）。归一化函数对已含 `slides` 的 payload 直接返回。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/cms/homepage-document.spec.ts`
Expected: PASS（≥8 用例）

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/cms/homepage-document.ts small-house-commerce/backend/src/modules/cms/homepage-document.spec.ts
git commit -m "feat(homepage): add document schema v1 with legacy hero normalization"
```

---

### Task 3: HomepageDocumentService（草稿 / 版本 / 生效 / 发布 / 恢复 / 下线）

**Files:**
- Create: `small-house-commerce/backend/src/modules/cms/homepage-document.service.ts`
- Test: `small-house-commerce/backend/src/modules/cms/homepage-document.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 表（`prisma.homepageDocument` / `prisma.homepageVersion`）；Task 2 `homepageDocumentSchema` / `normalizeLegacyDocument`；Task 4 的 `validateHomepageDocument`（Task 4 在本任务之后实现，本任务用注入的 stub 类型 `DocumentValidator` 解耦——接口：`(doc: HomepageDocument) => Promise<{errors: PublishIssue[]; warnings: PublishIssue[]}>`）。
- Produces（Task 6/7 依赖，签名固定）：
  - `static readonly SINGLETON_ID = "00000000-0000-0000-0000-000000000001"`（类静态成员，测试与调用方均通过 `HomepageDocumentService.SINGLETON_ID` 引用）
  - `getDraft(): Promise<DraftSnapshot>`，`DraftSnapshot = { draft: HomepageDocument; draftRev: number; draftUpdatedAt: string; draftUpdatedById: string | null; published: { versionNo: number; publishAt: string } | null }`
  - `saveDraft(doc: unknown, expectedRev: number, userId: string | null): Promise<{ draftRev: number; draftUpdatedAt: string }>` — zod 校验失败抛 `BadRequestException`（附 issues）；rev 不匹配抛 `ConflictException({code:'DRAFT_REV_MISMATCH'})`。
  - `publish(opts: { note: string | null; publishAt: string | null; unpublishAt: string | null; confirmWarnings: boolean; userId: string | null }): Promise<{ versionNo: number; publishAt: string }>` — 校验当前草稿：有 ERROR → `UnprocessableEntityException({code:'PUBLISH_VALIDATION_FAILED', issues})`；有 WARNING 且 `!confirmWarnings` → 同 422 `{code:'PUBLISH_WARNINGS_UNCONFIRMED', issues}`；`publishAt` 缺省=now。
  - `listVersions(): Promise<VersionMeta[]>`，`VersionMeta = { id, versionNo, note, createdAt, publishAt, unpublishAt, status: 'SCHEDULED'|'LIVE'|'ENDED'|'SUPERSEDED' }`
  - `getVersion(id: string): Promise<VersionMeta & { document: HomepageDocument }>`（404 若不存在）
  - `restoreVersion(id: string, userId: string | null): Promise<{ draftRev: number }>` — 把该版本文档写入草稿（rev+1），不发布。
  - `unpublishVersion(id: string): Promise<void>` — `unpublishAt ??= now`（已下线则幂等）。
  - `getEffectiveVersion(now: Date): Promise<{ document: HomepageDocument; versionNo: number } | null>` — `publishAt <= now AND (unpublishAt IS NULL OR unpublishAt > now)` 按 `publishAt desc, versionNo desc` 取第一；无 → null（调用方回退旧表）。

- [ ] **Step 1: 写失败测试（含 Review Focus #1/#2 的边界）**

```ts
import { describe, expect, it, vi } from "vitest";
import { HomepageDocumentService } from "./homepage-document.service.js";
import { emptyDocument } from "./homepage-document.js";

function createPrismaMock() {
  const docRow = {
    id: HomepageDocumentService.SINGLETON_ID,
    draft: emptyDocument(),
    draftRev: 3,
    draftUpdatedById: null,
    publishedVersionId: null,
    createdAt: new Date("2026-09-28T00:00:00Z"),
    updatedAt: new Date("2026-09-28T00:00:00Z"),
  };
  return {
    homepageDocument: {
      findUniqueOrThrow: vi.fn(async () => structuredClone(docRow)),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => structuredClone(docRow)),
    },
    homepageVersion: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: "v-id", ...data })),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async ({ data }: any) => ({ id: "v-id", ...data })),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  } as any;
}

const validatorStub = { validate: vi.fn(async () => ({ errors: [], warnings: [] })) };

describe("HomepageDocumentService draft rev lock", () => {
  it("rejects a save whose expectedRev is stale with DRAFT_REV_MISMATCH", async () => {
    const prisma = createPrismaMock();
    const service = new HomepageDocumentService(prisma, validatorStub as never);
    await expect(
      service.saveDraft(emptyDocument(), 2, null), // 当前 rev=3
    ).rejects.toMatchObject({ status: 409, response: { code: "DRAFT_REV_MISMATCH" } });
    expect(prisma.homepageDocument.updateMany).not.toHaveBeenCalled();
  });

  it("bumps the rev exactly once on a matching save", async () => {
    const prisma = createPrismaMock();
    const service = new HomepageDocumentService(prisma, validatorStub as never);
    const result = await service.saveDraft(emptyDocument(), 3, "user-1");
    expect(prisma.homepageDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: HomepageDocumentService.SINGLETON_ID, draftRev: 3 },
        data: expect.objectContaining({ draftRev: 4, draftUpdatedById: "user-1" }),
      }),
    );
    expect(result.draftRev).toBe(4);
  });
});

describe("HomepageDocumentService effective version", () => {
  const v = (versionNo: number, publishAt: string, unpublishAt: string | null) => ({
    id: `v${versionNo}`, versionNo, publishAt: new Date(publishAt),
    unpublishAt: unpublishAt ? new Date(unpublishAt) : null,
  });

  it("picks the newest version whose window covers now (inclusive start, exclusive end)", async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findFirst.mockResolvedValue(
      v(2, "2026-10-09T12:00:00Z", "2026-10-11T16:00:00Z"),
    );
    const service = new HomepageDocumentService(prisma, validatorStub as never);
    await service.getEffectiveVersion(new Date("2026-10-09T12:00:00Z")); // == publishAt → 生效
    expect(prisma.homepageVersion.findFirst).toHaveBeenCalledWith({
      where: {
        publishAt: { lte: new Date("2026-10-09T12:00:00Z") },
        OR: [{ unpublishAt: null }, { unpublishAt: { gt: new Date("2026-10-09T12:00:00Z") } }],
      },
      orderBy: [{ publishAt: "desc" }, { versionNo: "desc" }],
    });
    prisma.homepageVersion.findFirst.mockClear();
    await service.getEffectiveVersion(new Date("2026-10-11T16:00:00Z")); // == unpublishAt → 失效
    expect(prisma.homepageVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ unpublishAt: null }, { unpublishAt: { gt: new Date("2026-10-11T16:00:00Z") } }] }),
      }),
    );
  });

  it("returns null when nothing is effective so callers can fall back to the legacy tables", async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findFirst.mockResolvedValue(null);
    const service = new HomepageDocumentService(prisma, validatorStub as never);
    await expect(service.getEffectiveVersion(new Date())).resolves.toBeNull();
  });
});

describe("HomepageDocumentService publish", () => {
  it("blocks publish on validation errors with PUBLISH_VALIDATION_FAILED", async () => {
    const prisma = createPrismaMock();
    const validator = { validate: vi.fn(async () => ({ errors: [{ severity: "ERROR", code: "HERO_MEDIA_MISSING", message: "x" }], warnings: [] })) };
    const service = new HomepageDocumentService(prisma, validator as never);
    await expect(
      service.publish({ note: null, publishAt: null, unpublishAt: null, confirmWarnings: false, userId: null }),
    ).rejects.toMatchObject({ status: 422, response: { code: "PUBLISH_VALIDATION_FAILED" } });
    expect(prisma.homepageVersion.create).not.toHaveBeenCalled();
  });

  it("requires explicit warning confirmation before publishing", async () => {
    const prisma = createPrismaMock();
    const validator = { validate: vi.fn(async () => ({ errors: [], warnings: [{ severity: "WARNING", code: "ALT_MISSING", message: "x" }] })) };
    const service = new HomepageDocumentService(prisma, validator as never);
    await expect(
      service.publish({ note: null, publishAt: null, unpublishAt: null, confirmWarnings: false, userId: null }),
    ).rejects.toMatchObject({ status: 422, response: { code: "PUBLISH_WARNINGS_UNCONFIRMED" } });
    const ok = await service.publish({ note: "n", publishAt: null, unpublishAt: null, confirmWarnings: true, userId: "u" });
    expect(ok.versionNo).toBeGreaterThanOrEqual(1);
    expect(prisma.homepageVersion.create).toHaveBeenCalledTimes(1);
  });

  it("schedules a future version without publishing it immediately", async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findFirst.mockResolvedValue(null); // max versionNo
    const service = new HomepageDocumentService(prisma, validatorStub as never);
    const future = "2026-10-09T20:00:00+08:00";
    await service.publish({ note: "10.10", publishAt: future, unpublishAt: "2026-10-11T00:00:00+08:00", confirmWarnings: true, userId: null });
    expect(prisma.homepageVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ publishAt: new Date(future) }) }),
    );
  });

  it("restores a version into the draft without publishing it", async () => {
    const prisma = createPrismaMock();
    prisma.homepageVersion.findUnique.mockResolvedValue({ id: "v9", versionNo: 9, document: emptyDocument() });
    const service = new HomepageDocumentService(prisma, validatorStub as never);
    await service.restoreVersion("v9", "u");
    expect(prisma.homepageDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ draft: expect.anything() }) }),
    );
    expect(prisma.homepageVersion.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --dir small-house-commerce/backend exec vitest run src/modules/cms/homepage-document.service.spec.ts`
Expected: FAIL — `Cannot find module './homepage-document.service.js'`

- [ ] **Step 3: 实现**

要点：
- 单例行读取一律 `where: { id: SINGLETON_ID }`；`saveDraft` 用 `updateMany({ where: { id, draftRev: expectedRev }, data: { draft, draftRev: { increment: 1 }, draftUpdatedById } })`，`count === 0` → 409 `DRAFT_REV_MISMATCH`；成功后 `revalidateCache` **不调用**（草稿不触达前台）。
- `getDraft`：`normalizeLegacyDocument(row.draft)` 后返回（保证编辑器永远拿到 v2）；`published` 取 `publishedVersionId` 对应版本 meta。
- `publish`：读草稿 → `validator.validate(doc)` → 错误/警告分支（见接口）→ 在 `$transaction` 内 `max(versionNo)+1` 创建版本（`document: doc`，`note`，`publishAt: publishAt ? new Date(publishAt) : now`，`unpublishAt`）并更新 `homepageDocument.publishedVersionId` → 事务外 `revalidateCache([CACHE_TAGS.STOREFRONT])`。
- `listVersions` 的 `status` 派生：`publishAt > now → SCHEDULED`；`unpublishAt <= now → ENDED`；否则若存在更大的生效版本号 → `SUPERSEDED`，否则 `LIVE`。
- `unpublishVersion`：仅允许对 `publishAt <= now` 或未来版本操作；写 `unpublishAt = now`（已设置则幂等不动）→ `revalidateCache`。
- 所有变更方法末尾 `revalidateCache([CACHE_TAGS.STOREFRONT])`（除 saveDraft）。

- [ ] **Step 4: 运行确认通过** → `PASS`（≥8 用例）

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/cms/homepage-document.service.ts small-house-commerce/backend/src/modules/cms/homepage-document.service.spec.ts
git commit -m "feat(homepage): add versioned document service with rev lock and scheduling"
```

---

### Task 4: 发布前校验规则

**Files:**
- Create: `small-house-commerce/backend/src/modules/cms/homepage-validation.ts`
- Test: `small-house-commerce/backend/src/modules/cms/homepage-validation.spec.ts`

**Interfaces:**
- Consumes: Task 2 类型；`homepagePayloadSchemas`（`dto/homepage-section.dto.ts`，非 HERO 区块的既有 payload 校验复用）；一个 `LinkLookup` 注入接口：`{ productExists(ids: string[]): Promise<Set<string>>; collectionExists(...); categoryExists(...); landingExists(...) }`（Task 7 用 Prisma 实现，测试用 stub）。
- Produces: `export type PublishIssue = { severity: "ERROR" | "WARNING"; code: string; message: string; sectionId?: string; slideId?: string }`；`export class HomepageValidator { validate(doc: HomepageDocument): Promise<{ errors: PublishIssue[]; warnings: PublishIssue[] }> }`（Task 3 的 `DocumentValidator` 接口实现者）。

- [ ] **Step 1: 写失败测试（逐条规则）**

```ts
// 每个 it 构造一份最小文档并断言 errors/warnings 的 code 集合
it("errors when an enabled hero slide has no media", …)            // HERO_MEDIA_MISSING
it("errors when a video slide has no poster", …)                    // HERO_POSTER_MISSING
it("errors when an enabled slide heading is empty", …)              // HERO_HEADING_REQUIRED
it("errors on overlapping schedules of two enabled slides", …)      // SCHEDULE_CONFLICT (slideId 标注)
it("errors when a CTA link target does not exist", …)               // LINK_TARGET_MISSING (linkLookup stub 返回空集)
it("errors when a non-hero section payload fails its legacy schema", …) // SECTION_PAYLOAD_INVALID
it("warns on missing image alt, empty product grid, and unavailable products", …) // ALT_MISSING / GRID_EMPTY / PRODUCT_UNAVAILABLE
it("passes a fully valid document with zero issues", …)
```

- [ ] **Step 2: 运行确认失败** → `Cannot find module './homepage-validation.js'`

- [ ] **Step 3: 实现**

要点：
- HERO：遍历 `payload.slides`，`enabled` 的逐条检查 media/poster/heading；排期冲突=两启用幻灯 `[publishAt??-∞, unpublishAt??+∞)` 区间相交（与 Task 3 相同的边界语义）。
- 链接：收集所有启用幻灯 7 元素的 `link`（非 EXTERNAL）+ announcement 启用项 link → 按类型批量 `linkLookup.*` → 缺失 → ERROR（EXTERNAL 已在 schema 层保证 https，不再查）。
- 非 HERO 区块：`homepagePayloadSchemas[type].safeParse(payload)` 失败 → ERROR `SECTION_PAYLOAD_INVALID`（含 zod issue 首条 message）。
- WARNING 集：IMAGE 缺 alt（hero 幻灯 + announcement 无 alt 概念不查）、PRODUCT_GRID 的 `products` 为空、`products` 引用的商品缺失/非 ACTIVE（复用 `linkLookup.productExists` 之外另查 status——扩展 `LinkLookup` 为 `productStatuses(ids): Promise<Map<string, "ACTIVE"|"DRAFT"|"DISABLED">>`）。
- 纯函数风格：不依赖 Nest DI 生命周期，`HomepageValidator` 构造函数注入 lookup。

- [ ] **Step 4: 运行确认通过** → PASS

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/cms/homepage-validation.ts small-house-commerce/backend/src/modules/cms/homepage-validation.spec.ts
git commit -m "feat(homepage): add pre-publish validation rules"
```

---

### Task 5: 预览 token + 配置项

**Files:**
- Create: `small-house-commerce/backend/src/modules/cms/homepage-preview-token.ts`
- Test: `small-house-commerce/backend/src/modules/cms/homepage-preview-token.spec.ts`
- Modify: `small-house-commerce/backend/src/config/configuration.ts`、`small-house-commerce/backend/src/config/env.validation.ts`
- Modify: `small-house-commerce/docker-compose.prod.yml`（backend environment）

**Interfaces:**
- Produces（Task 6/7/21 依赖）：
  - `export const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000`
  - `export function signPreviewToken(draftRev: number, secret: string, now: Date): string`
  - `export function verifyPreviewToken(token: string, secret: string, now: Date): { draftRev: number } | null`
- 配置：`HOMEPAGE_PREVIEW_SECRET`（可空字符串；空 = 预览功能整体禁用：签发端点 503、校验恒 null）。**部署前必须在 `.env.deploy` 写入 `openssl rand -hex 32` 生成的值，并把变量加入 compose backend environment。**

- [ ] **Step 1: 写失败测试**

```ts
it("round-trips a signed token within the TTL", …);
it("rejects a tampered payload and a tampered signature", …);   // 改 payload/改 hmac → null
it("rejects an expired token", …);                               // now = issued + 30min + 1ms
it("rejects a token signed with another secret", …);
it("rejects a token whose scope is not homepage-draft-preview", …); // 手工构造 scope 不符的 payload
it("returns null for empty secret (feature disabled)", …);
```

- [ ] **Step 2: 运行确认失败** → module not found

- [ ] **Step 3: 实现**

```ts
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const SCOPE = "homepage-draft-preview";

export function signPreviewToken(draftRev: number, secret: string, now: Date): string {
  const payload = Buffer.from(
    JSON.stringify({ scope: SCOPE, draftRev, exp: now.getTime() + PREVIEW_TOKEN_TTL_MS, jti: randomUUID() }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPreviewToken(token: string, secret: string, now: Date): { draftRev: number } | null {
  if (!secret || !token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as
      { scope?: string; draftRev?: number; exp?: number };
    if (parsed.scope !== SCOPE || typeof parsed.draftRev !== "number" || typeof parsed.exp !== "number") return null;
    if (parsed.exp <= now.getTime()) return null;
    return { draftRev: parsed.draftRev };
  } catch { return null; }
}
```
配置与 compose：`configuration.ts` 增 `homepagePreviewSecret: process.env.HOMEPAGE_PREVIEW_SECRET ?? ""`；compose backend environment 增 `HOMEPAGE_PREVIEW_SECRET: ${HOMEPAGE_PREVIEW_SECRET:-}`。

- [ ] **Step 4: 运行确认通过** → PASS

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/cms/homepage-preview-token.ts small-house-commerce/backend/src/modules/cms/homepage-preview-token.spec.ts small-house-commerce/backend/src/config small-house-commerce/docker-compose.prod.yml
git commit -m "feat(homepage): add signed draft-preview tokens"
```

---

### Task 6: Admin 控制器（新路由 + 删除旧写接口）

**Files:**
- Create: `small-house-commerce/backend/src/modules/cms/dto/homepage-document.dto.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/admin/homepage.controller.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/homepage.service.ts`（删除 `saveSections` / `setSectionProducts` 及仅其使用的私有方法；保留 `adminList`）
- Modify: `small-house-commerce/backend/src/modules/cms/cms.module.ts`（注册 `HomepageDocumentService`、`HomepageValidator`、`LinkLookup` provider）
- Test: `small-house-commerce/backend/src/modules/cms/admin/homepage.controller.spec.ts`（新建，controller 级路由存在性 + 旧写路由 404）
- Modify: `small-house-commerce/backend/src/modules/cms/homepage.service.spec.ts`（删除被删写方法的用例）

**Interfaces:**
- Consumes: Task 3 `HomepageDocumentService`、Task 4 `HomepageValidator`、Task 5 token 函数、Task 2 `homepageDocumentSchema`。
- Produces: 全部 9 个 admin 路由（spec §4.1 表），请求 DTO：
  - `saveDraftSchema = { draft: unknown, expectedRev: z.number().int().nonnegative() }`
  - `publishSchema = { note: z.string().max(200).nullable(), publishAt: z.string().datetime({ offset: true }).nullable(), unpublishAt: z.string().datetime({ offset: true }).nullable(), confirmWarnings: z.boolean().default(false) }`（`superRefine`：publishAt 与 unpublishAt 同时存在时要求 unpublishAt > publishAt）
  - `restoreSchema = {}`（无 body）；`unpublishSchema = {}`。
  - `previewTokenSchema = {}` → 返回 `{ token: string, expiresInMs: number }`；secret 空 → 503。

- [ ] **Step 1: 写失败测试**

```ts
// controller spec：用 Nest 测试基建或直接断言路由表
it("exposes the document draft routes under PRODUCT_MANAGE", …);   // GET/PUT /admin/homepage/draft
it("exposes validate, publish, versions, restore, unpublish, preview-token", …);
it("no longer routes PATCH /admin/homepage/sections (410/404)", …); // 旧写路由已删除
it("keeps GET /admin/homepage/sections read-only", …);
it("returns 503 for preview-token when the secret is not configured", …);
```

- [ ] **Step 2: 运行确认失败** → 路由/模块不存在

- [ ] **Step 3: 实现**

控制器要点（沿用现有 `@Controller('admin/homepage')` + `@Permissions('PRODUCT_MANAGE')`）：
```ts
@Get('draft')          getDraft() { return this.docs.getDraft(); }
@Put('draft')          saveDraft(@Body(new ZodValidationPipe(saveDraftSchema)) input, @Req() req) {
                         return this.docs.saveDraft(input.draft, input.expectedRev, req.user?.sub ?? null); }
@Post('validate')      async validate() { return this.validator.validate((await this.docs.getDraft()).draft); }
@Post('publish')       publish(@Body(...publishSchema) input, @Req() req) { … }
@Get('versions')       listVersions() { … }
@Get('versions/:id')   getVersion(@Param('id') id) { … }
@Post('versions/:id/restore')  restore(@Param('id') id, @Req() req) { … }
@Post('versions/:id/unpublish') unpublish(@Param('id') id) { … }
@Post('preview-token') previewToken() { … 503 when secret empty … }
```
删除 `@Patch('sections')` 与 `@Put('sections/:id/products')` 两个 handler 及其 DTO 导入；`homepage.service.ts` 删除 `saveSections` / `setSectionProducts`（连带 `SECTION_LIMITS` 中仅写路径使用的方法——`SECTION_LIMITS` 本身保留给 `adminList`/校验用；如无引用一并删除并同步其 spec）。
`LinkLookup` provider：包一层 Prisma 查询（`product.findMany({where:{id:{in}},select:{id,status,slug}})` 等四类），实现 Task 4 接口。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --dir small-house-commerce/backend test`
Expected: 全绿（旧写方法相关用例已随实现删除同步清理，不得留 skip）

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/cms
git commit -m "feat(homepage): add document admin routes and remove legacy write endpoints"
```

---

### Task 7: Storefront 改源（生效版本 + 排期过滤 + 链接解析 + announcement 端点）

**Files:**
- Modify: `small-house-commerce/backend/src/modules/cms/homepage.service.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/storefront/homepage.controller.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/homepage.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 `getEffectiveVersion`、Task 2 `normalizeLegacyDocument`、Task 5 `verifyPreviewToken`、现有 `presentSection` 水合逻辑、`ProductsService.storefrontByIds`。
- Produces:
  - `storefrontGet(opts?: { previewToken?: string }): Promise<{ sections: StorefrontSection[] }>` — 契约与今日完全一致（`{id,type,title,subtitle,enabled,sortOrder,payload,products,categories}`），HERO 的 `payload` 为 v2（含已解析 `href` 的 links）。
  - `storefrontGetAnnouncement(opts?: { previewToken?: string }): Promise<{ enabled: boolean; rotationMs: number; items: StorefrontAnnouncementItem[] } | null>` — 无启用项或功能无数据 → null。
  - 控制器新增：`GET /api/v1/storefront/announcement`（query `previewToken?`）。
  - `GET /api/v1/storefront/homepage` 增加可选 query `previewToken`；带有效 token → 返回**草稿**（`Cache-Control: no-store`，且不读 ISR 缓存——实现：该分支在 service 内直接读草稿并 `res.set('Cache-Control','private, no-store')`）。

- [ ] **Step 1: 写失败测试**

```ts
it("serves the effective version document with schedule filtering", async () => {
  // effectiveVersion 返回含两个幻灯的 HERO（一个 publishAt 在未来）
  // 断言：响应 sections 与今日契约同形；未来幻灯被过滤；其余区块水合规则不变
});
it("falls back to the legacy homepage_sections when no version is effective", …);
it("normalizes a legacy hero payload before serving", …);           // HeroSlider 永远拿到 v2
it("resolves PRODUCT/COLLECTION/CATEGORY/LANDING links to hrefs and drops unresolvable ones", …);
it("filters announcement items by schedule and resolves their links", …);
it("serves the DRAFT when a valid previewToken is supplied and ignores it when invalid", …);
```

- [ ] **Step 2: 运行确认失败** → 新行为断言失败

- [ ] **Step 3: 实现**

要点：
- `storefrontGet`：`const effective = await this.docs.getEffectiveVersion(new Date())`；有 → `normalizeLegacyDocument(effective.document)`；无 → 旧表路径（现有代码原样保留为 `legacyStorefrontGet()` 私有方法）。
- 区块过滤：`enabled && isScheduleActive(section.schedule, now)`；`isScheduleActive` 放 `homepage-document.ts` 并导出（Task 8 前端镜像同语义）。
- HERO：`presentSection` 的 HERO 分支改为透传 v2 payload + `resolveHeroLinks()`（收集全部启用幻灯的 link → 批量查 slug → 写入 `element.linkHref: string | null`；解析失败的 link 置 `linkHref:null` 但保留元素文本）。
- announcement：读同一文档的 `announcement`，`enabled` + 逐项 schedule 过滤 + link 解析 → `linkHref`。
- `previewToken`：`verifyPreviewToken` 通过 → 读草稿 `normalizeLegacyDocument(draft)` 走同一 present 管线（不写缓存）；失败 → 忽略 token 走正常路径（**不报错**，避免探测信号——spec 说预览页 404 由前端路由层负责，API 层静默降级）。
- 保留 `revalidateCache` 在 Task 3/6 写路径的调用；本任务只读。

- [ ] **Step 4: 运行确认通过** → `pnpm --dir small-house-commerce/backend test` 全绿

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/cms
git commit -m "feat(homepage): serve storefront from effective document with link resolution"
```

---

### Task 8: 前端文档类型 + 纯变更函数

**Files:**
- Create: `small-house-commerce/frontend/src/lib/homepage-document.ts`
- Test: `small-house-commerce/frontend/src/lib/homepage-document.spec.ts`

**Interfaces:**
- Consumes: 无（backend zod 的 TS 镜像；字段名/枚举必须与 Task 2 完全一致）。
- Produces（Task 9-21 全部依赖，签名固定）：
  - 类型：`HomepageDocument`、`HomepageSection`、`HeroPayload`、`HeroSlide`、`HeroElement`、`HeroElementKey`、`AnnouncementBlock`、`AnnouncementItem`、`LinkValue`、`Schedule`、`ElementStyle`、`ElementLayout`、`ElementOverrides`、`SliderBehavior`、`HeroMedia`、`SlideOverlay`。
  - `export function emptyDocument(): HomepageDocument`（与 backend 默认一致）
  - `export function emptySlide(sortOrder: number): HeroSlide`
  - `export function emptyElement(key: HeroElementKey): HeroElement`
  - 纯变更函数（全部 `(doc, …) => HomepageDocument`，内部 `structuredClone`）：
    - `updateSection(doc, sectionId, patch: Partial<Pick<HomepageSection,"title"|"subtitle"|"enabled"|"schedule">>)`
    - `moveSection(doc, fromIndex: number, toIndex: number)`（数组重排并重写 sortOrder=index*10）
    - `removeSection(doc, sectionId)` / `duplicateSection(doc, sectionId)`（新 uuid id，插在原后）
    - `updateHeroBehavior(doc, patch: Partial<SliderBehavior>)`
    - `addHeroSlide(doc)` / `duplicateHeroSlide(doc, slideId)` / `removeHeroSlide(doc, slideId)` / `moveHeroSlide(doc, from, to)`
    - `updateHeroSlide(doc, slideId, patch: Partial<Pick<HeroSlide,"name"|"enabled"|"schedule"|"overlay">>)`
    - `updateHeroMedia(doc, slideId, patch: Partial<HeroMedia>)`
    - `updateHeroElement(doc, slideId, key: HeroElementKey, patch: { text?: string; link?: LinkValue | null; style?: Partial<ElementStyle>; layout?: Partial<ElementLayout>; locked?: boolean; chip?: …; button?: …; endsAt?: string | null })`
    - `setElementOverride(doc, slideId, key, device: "tablet"|"mobile", patch: { style?: Partial<ElementStyle>; layout?: Partial<ElementLayout> } | null)`（null=清除覆盖恢复继承）
    - `resetElementLayout(doc, slideId, key)`（回到 `emptyElement(key).layout`）
    - `updateAnnouncement(doc, patch: Partial<Pick<AnnouncementBlock,"enabled"|"rotationMs">>)`
    - `addAnnouncementItem(doc)` / `removeAnnouncementItem(doc, itemId)` / `moveAnnouncementItem(doc, from, to)` / `updateAnnouncementItem(doc, itemId, patch: Partial<…>)`
  - `export function isScheduleActive(schedule: Schedule, now: Date): boolean`（与 backend 同语义：`publishAt<=now`、`unpublishAt==null || unpublishAt>now`）
  - `export function effectiveElementStyle(slide, key, device): { style: ElementStyle; layout: ElementLayout }`（继承链 mobile→tablet→desktop）
  - `export function clampPct(value: number): number`（NaN/越界 → 钳制 0–100，Task 16 拖拽依赖）

- [ ] **Step 1: 写失败测试**

```ts
it("moves a slide and renumbers sortOrder densely", …);
it("duplicates a slide with a fresh id and name suffix (副本)", …);
it("removes the last remaining slide is prevented (returns doc unchanged)", …); // 至少 1 张
it("clamps layout updates through clampPct (negative, >100, NaN)", …);
it("clears a mobile override to restore inheritance", …);
it("resolves effective element style through mobile → tablet → desktop", …);
it("isScheduleActive treats publishAt inclusive and unpublishAt exclusive", …);
it("every mutator returns a NEW document and never mutates the input", …); // 对全部导出 mutator 跑一遍 structuredClone 深比较
```

- [ ] **Step 2: 运行确认失败** → module not found

- [ ] **Step 3: 实现**

按 Interfaces 逐函数实现；`emptyElement` 的默认布局：`eyebrow {x:7.4,y:14,w:40,LEFT,TOP}`、`heading {x:7.4,y:22.8,w:40,LEFT,TOP}`、`subheading {x:7.4,y:38,w:40,LEFT,TOP}`、`offer {x:7.4,y:50,w:30,LEFT,TOP}`、`ctaPrimary {x:7.4,y:58,w:22,LEFT,TOP}`、`ctaSecondary {x:31,y:58,w:22,LEFT,TOP}`、`countdown {x:7.4,y:70,w:30,LEFT,TOP}`（与 backend `emptyDocument` 数值一致，两处都要写同样常量并在测试里交叉断言一个样例）。

- [ ] **Step 4: 运行确认通过** → PASS

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/lib/homepage-document.ts small-house-commerce/frontend/src/lib/homepage-document.spec.ts
git commit -m "feat(homepage): add editor document types and pure mutators"
```

---

### Task 9: 编辑器 reducer（undo/redo / dirty / saveState）

**Files:**
- Create: `small-house-commerce/frontend/src/lib/homepage-editor-state.ts`
- Test: `small-house-commerce/frontend/src/lib/homepage-editor-state.spec.ts`

**Interfaces:**
- Consumes: Task 8 `HomepageDocument`。
- Produces（Task 12 编辑器依赖）：
  - `type EditorState = { document: HomepageDocument; past: HomepageDocument[]; future: HomepageDocument[]; rev: number; dirty: boolean; saveState: "idle"|"saving"|"saved"|"error"; lastSavedAt: string | null; conflict: boolean }`
  - `const HISTORY_LIMIT = 50`
  - `type EditorAction = {type:"load"; document; rev; savedAt} | {type:"commit"; document} | {type:"undo"} | {type:"redo"} | {type:"saving"} | {type:"saved"; rev; savedAt} | {type:"saveError"} | {type:"conflict"} | {type:"resolveConflict"; document; rev; savedAt}`
  - `export function editorReducer(state: EditorState, action: EditorAction): EditorState`
  - `export function initEditorState(snapshot: {document; rev; savedAt}): EditorState`

- [ ] **Step 1: 写失败测试**

```ts
it("commit pushes the previous document onto past and marks dirty", …);
it("undo/redo walk the history and clear dirty when returning to the saved revision", …);
it("caps history at 50 entries", …);
it("load replaces everything and clears history", …);
it("saved records rev/savedAt and clears dirty", …);
it("a 409 conflict flags conflict=true and keeps the local document", …);
it("resolveConflict adopts the server document and resets history", …);
```

- [ ] **Step 2: 运行确认失败** → module not found
- [ ] **Step 3: 实现**（纯 reducer，无副作用；`dirty` 定义：`document !== 最后一次 saved/loaded 的引用`——用 rev 对比不可靠，改为在 state 内存 `savedDocument` 引用做全等比较）
- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/lib/homepage-editor-state.ts small-house-commerce/frontend/src/lib/homepage-editor-state.spec.ts
git commit -m "feat(homepage): add editor reducer with undo/redo"
```

---

### Task 10: CSS 变量编译器

**Files:**
- Create: `small-house-commerce/frontend/src/lib/homepage-styles.ts`
- Test: `small-house-commerce/frontend/src/lib/homepage-styles.spec.ts`

**Interfaces:**
- Consumes: Task 8 类型 + `effectiveElementStyle`。
- Produces（Task 12 预览 / Task 19 前台共用）：
  - `export function heroCss(sectionId: string, payload: HeroPayload): string` — 生成作用域 `#hp-hero-<sectionId>` 的变量块：base=移动端生效值，`@media (min-width:768px)`=tablet 生效值，`@media (min-width:1024px)`=desktop 生效值；每个幻灯 `[data-slide="<slideId>"]` 前缀；元素变量命名 `--el-<key>-{x,y,w,size,weight,lh,ls,color,align,maxw}`。
  - `export function elementInlineVars(key: HeroElementKey): CSSProperties` — 返回 `{ left: "var(--el-heading-x)", top: …, width: …, fontSize: "var(--el-heading-size)", … }` 供元素容器直接展开。
  - `export function safeHex(value: string | null | undefined, fallback: string): string`（非 `#rrggbb` 一律 fallback——防注入第二道闸）。
  - `export function overlayCss(overlay: SlideOverlay): string`（`linear-gradient` 生成，白名单枚举）。

- [ ] **Step 1: 写失败测试**

```ts
it("emits mobile values in the base block and desktop in the min-width:1024 block", …);
it("lets a mobile override win in the base block while desktop keeps its own value", …);
it("falls back to desktop values when tablet has no override", …);
it("rejects a malicious color string and emits the fallback", …);
it("produces one scoped block per slide", …);
```

- [ ] **Step 2: 运行确认失败** → module not found
- [ ] **Step 3: 实现**（字符串拼接 + 严格白名单；数字一律 `Number.isFinite` 过滤后输出，颜色经 `safeHex`）
- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/lib/homepage-styles.ts small-house-commerce/frontend/src/lib/homepage-styles.spec.ts
git commit -m "feat(homepage): add SSR-safe css variable compiler"
```

---

### Task 11: admin-api 客户端方法 + i18n 键

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`、`small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Produces（Task 12-17 依赖）：
  - `adminApi.getHomepageDraft(): Promise<HomepageDraftSnapshot>`（类型与 backend Task 3 `DraftSnapshot` 同形）
  - `adminApi.saveHomepageDraft(draft: unknown, expectedRev: number): Promise<{ draftRev: number; draftUpdatedAt: string }>`
  - `adminApi.validateHomepage(): Promise<{ errors: PublishIssue[]; warnings: PublishIssue[] }>`
  - `adminApi.publishHomepage(input: { note: string | null; publishAt: string | null; unpublishAt: string | null; confirmWarnings: boolean }): Promise<{ versionNo: number; publishAt: string }>`
  - `adminApi.listHomepageVersions(): Promise<HomepageVersionMeta[]>`
  - `adminApi.getHomepageVersion(id): Promise<HomepageVersionMeta & { document: unknown }>`
  - `adminApi.restoreHomepageVersion(id): Promise<{ draftRev: number }>`
  - `adminApi.unpublishHomepageVersion(id): Promise<void>`
  - `adminApi.createHomepagePreviewToken(): Promise<{ token: string; expiresInMs: number }>`
  - `export type PublishIssue`、`HomepageVersionMeta`、`HomepageDraftSnapshot`。
- i18n：新增 `homepage_builder_*` 前缀键（编辑器全部文案：三栏标题、Save Draft/Preview/Publish、版本历史、校验面板、媒体面板、Safe Area、Link Picker、Announcement 等，约 80–110 键，zh 为主、en 同步）；**en.ts 与 zh.ts 同步新增，zh 用 `satisfies typeof en` 校验**。

- [ ] **Step 1: 写失败测试**（admin-api 不单测网络层——沿用既有惯例由页面/组件 spec 覆盖；本任务直接进入实现，但 i18n 完整性由 `tsc` 保证：zh 缺键即编译失败）
- [ ] **Step 2: 实现**（9 个方法按 Interfaces 签名，`adminAuthedFetch` 模式与既有 `bulkTitleLandingPages` 完全一致；错误由 `AdminApiError.status` 携带 409/422 供 UI 分支）
- [ ] **Step 3: 验证**：`pnpm --dir small-house-commerce/frontend exec tsc --noEmit` 0 error
- [ ] **Step 4: Commit**

```bash
git add small-house-commerce/frontend/src/lib/admin-api.ts small-house-commerce/frontend/src/i18n
git commit -m "feat(homepage): add builder api client and i18n keys"
```

---

### Task 12: 编辑器外壳 + Website 导航分组 + 路由替换

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/HomepageEditor.tsx`
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/homepage/page.tsx`（整页替换为挂载 `<HomepageEditor />`；旧表单实现删除）
- Modify: `small-house-commerce/frontend/src/components/admin/AdminShell.tsx`（`NAV_ITEMS` 支持分组：`Website` 组内 `Homepage`；分组标题仅渲染给有 PRODUCT_MANAGE 的用户）
- Test: `small-house-commerce/frontend/src/components/admin/homepage/HomepageEditor.spec.tsx`（新建）
- Modify: `small-house-commerce/frontend/src/components/admin/AdminShell.spec.tsx`（导航分组断言）

**Interfaces:**
- Consumes: Task 9 reducer、Task 11 API、`DeviceFrame`/`PreviewPane`（复用现有）、Task 13-17 的子组件（本任务先用占位空面板接线，13-17 逐个填充——**占位必须是真实导出组件的最小实现，不留 TODO 注释**）。
- Produces：
  - `HomepageEditor` props：`{}`（自取数据）。
  - 内部状态契约（子组件 props 的公共形状）：`{ state: EditorState; dispatch: (a: EditorAction) => void; device: "desktop"|"tablet"|"mobile"; setDevice; selectedSectionId: string|null; setSelectedSectionId; selectedSlideId: string|null; setSelectedSlideId; selectedElementKey: HeroElementKey|null; setSelectedElementKey; safeAreaFlags: SafeAreaFlags; setSafeAreaFlags }` — 组装为 `EditorContext`（`createContext`，`useHomepageEditor()` hook 读取；子组件 specs 可用测试 wrapper 注入）。`SafeAreaFlags = { header: boolean; text: boolean; mobileCrop: boolean; mediaCrop: boolean; universal: boolean }`（默认全 false，Task 15 的开关驱动、Task 16 的覆盖层消费）。
  - 顶部状态栏：`Last Saved`（`state.lastSavedAt` + `draftUpdatedBy`）、`Last Published`（快照 `published`）、Draft/Published 徽标、未保存圆点、`Save Draft`、`Preview Draft`、`Publish`、`Versions` 链接按钮。
  - 自动保存：`dirty && saveState!=="saving"` 时 3s 防抖 `saveHomepageDraft(document, rev)`；成功 `saved`，409 → `dispatch({type:"conflict"})` 并弹出冲突条（`conflict` 状态：按钮"载入最新（丢弃我的改动）"与"保留我的（重新保存为最新 rev）"——后者先 `getHomepageDraft` 拿新 rev 再立即保存本地文档）。
  - `Cmd/Ctrl+S` → 立即保存；`Cmd/Ctrl+Z / Shift+Z` → undo/redo。

- [ ] **Step 1: 写失败测试**

```tsx
it("loads the draft on mount and renders the three panes", …);
it("autosaves 3s after a change and shows Saved", async () => { vi.useFakeTimers(); … });
it("surfaces a 409 conflict with load-latest / keep-mine choices", async () => { /* save 抛 AdminApiError 409 */ });
it("saves immediately on Cmd+S", …);
it("undo/redo keyboard shortcuts walk the history", …);
it("hides the Website nav group without PRODUCT_MANAGE", …); // AdminShell.spec
```

- [ ] **Step 2: 运行确认失败** → 组件不存在
- [ ] **Step 3: 实现**（三栏 grid：`280px minmax(0,1fr) 360px`，窄屏 <1280px 折叠为顶部 tab 切换三栏；设备切换用现有 `DeviceFrame`；`<style>{heroCss(...)}</style>` 注入预览样式）
- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/homepage small-house-commerce/frontend/src/components/admin/AdminShell.tsx small-house-commerce/frontend/src/components/admin/AdminShell.spec.tsx "small-house-commerce/frontend/src/app/admin/(shell)/homepage/page.tsx"
git commit -m "feat(homepage): replace admin editor with three-pane builder shell"
```

---

### Task 13: 模块树（dnd-kit）+ Announcement 编辑器

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/ModuleTree.tsx`、`AnnouncementSettings.tsx`
- Modify: `small-house-commerce/frontend/package.json`（`pnpm add @dnd-kit/core @dnd-kit/sortable`）
- Test: `ModuleTree.spec.tsx`、`AnnouncementSettings.spec.tsx`

**Interfaces:**
- Consumes: Task 8 mutators（`moveSection`/`removeSection`/`duplicateSection`/`updateAnnouncement*`）、Task 12 context。
- Produces：
  - `ModuleTree` — Sections 列表（拖拽排序、显隐开关、复制、删除、恢复删除：state 内 `lastRemoved: {section, index} | null` + "撤销删除"按钮）、每个 section 下缩进列出 HERO 的幻灯（点击选中幻灯）；**不出现"单例模块"术语**：`Fixed Section` 只有 Hide 无 Delete，`Addable Section`（PRODUCT_GRID/PRODUCT_STORY）可 Duplicate/Delete。
  - `AnnouncementSettings` — 条目列表（增删/排序/启用）、文本、LinkPicker 链接、`linkLabel`、文字色/背景色（hex 输入 + 预设色板：浅蓝灰 `#E8EEF4`、淡绿 `#E7F0E7`、暖米 `#F2EFE9`）、排期两个 datetime-local、`rotationMs` 滑杆。

- [ ] **Step 1: 写失败测试**

```tsx
it("drag-sorts sections and renumbers sortOrder", …);      // 用 dnd-kit 的 keyboard sensor：Space 拾起、ArrowDown、Space 放下（真实键盘路径，不用私有 API）
it("hides delete for fixed sections and offers duplicate only for addable ones", …);
it("restores the last removed section from the undo affordance", …);
it("adds an announcement item with palette colors and reorders items", …);
it("edits an announcement schedule with datetime-local inputs", …);
```

- [ ] **Step 2: 运行确认失败** → 组件不存在
- [ ] **Step 3: 实现**（`DndContext` + `SortableContext` + `useSortable`；`onDragEnd` → `dispatch commit(moveSection(...))`；键盘 sensor 必须启用——a11y 要求）
- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/package.json small-house-commerce/frontend/pnpm-lock.yaml small-house-commerce/frontend/src/components/admin/homepage
git commit -m "feat(homepage): add module tree with drag sorting and announcement editor"
```

---

### Task 14: Hero 幻灯列表 + 右侧设置面板（内容/排版/位置/行为/样式）

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/SlideList.tsx`、`SettingsPanel.tsx`、`HeroStyleSettings.tsx`
- Test: `SlideList.spec.tsx`、`SettingsPanel.spec.tsx`

**Interfaces:**
- Consumes: Task 8 mutators、Task 12 context、`LinkPicker`（Task 18 实现——本任务先用 `LinkPicker` 的接口 `{value: LinkValue|null; onChange(v): void; allowExternal: boolean}` 以最小实现内联，Task 18 替换为完整版）。
- Produces：
  - `SlideList` — 幻灯卡片（序号两位 `01`、名称、启用开关、缩略图=媒体图/视频 poster、排期角标、拖拽排序、复制、删除、上/下移按钮兜底）；`+ 添加幻灯`（上限 6）。
  - `SettingsPanel` — 按 `selectedElementKey` 分派分组：`Content`（文本 textarea、LinkPicker、Offer 文本、Countdown endsAt datetime-local）/ `Typography`（fontSize/weight/lineHeight/letterSpacing/textColor/textAlign/maxWidthPct，每项带"继承"清除按钮）/ `Position`（x/y/width 数字输入 + align/verticalAlign + Reset + Lock）/ `Responsive`（非 desktop 设备时显示"本设备覆盖"编辑 + "重置为 Desktop 值"）/ `Style`（Offer chip 四件套、CTA button 全字段，按 `selectedElementKey` 条件渲染）。
  - `HeroStyleSettings` — 区块级 `behavior` 面板（autoplay/durationMs/transition/pauseOnHover/arrows/pagination/manualPauseMs）＋ 幻灯级 `overlay`（color/opacity/gradient）。
- 所有输入变更走 `dispatch({type:"commit", document: updateHeroElement(...)})`；数字输入使用现有 `DecimalInput` 的防抖模式或受控本地态 + blur 提交（**不得每次击键 commit 进 undo 历史**——文本输入用本地态 + 300ms 合并，数字/滑杆用 change 合并策略：同一个元素同一字段 800ms 内的连续修改合并为一条历史）。

- [ ] **Step 1: 写失败测试**

```tsx
it("edits heading text and reflects it in the committed document once per typing burst", …);
it("clears a typography value back to inherit", …);
it("sets a mobile-only override and resets it to the desktop value", …);
it("toggles offer chip colors and CTA variant with the full style set", …);
it("adds, duplicates and deletes slides; the last slide cannot be deleted", …);
it("changes slider behavior values and commits them", …);
```

- [ ] **Step 2-4: RED → 实现 → GREEN**（同前）
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/homepage
git commit -m "feat(homepage): add hero slide list and settings panels"
```

---

### Task 15: Hero 媒体面板 + 视频探测 + Safe Area

**Files:**
- Create: `small-house-commerce/frontend/src/lib/video-probe.ts`、`small-house-commerce/frontend/src/components/admin/homepage/HeroMediaSettings.tsx`
- Test: `small-house-commerce/frontend/src/lib/video-probe.spec.ts`（纯逻辑部分：限额判定、探测结果 → 通过/拒绝原因的映射）、`HeroMediaSettings.spec.tsx`

**Interfaces:**
- Consumes: 现有 `ImageUrlInput`（图/视频上传复用）、Task 8 `updateHeroMedia`。
- Produces：
  - `video-probe.ts`：`export type ProbeResult = { ok: true; durationSec: number; width: number; height: number; posterBlob: Blob } | { ok: false; reason: "DECODE" | "SEEK" | "FRAME" | "TOO_LONG" | "TOO_SMALL" }`；`export async function probeVideo(file: File): Promise<ProbeResult>`（`<video>` + objectURL：`loadedmetadata` → 检查 duration/resolution → `currentTime=1` 等 `seeked` → canvas `drawImage` → `toBlob("image/jpeg", 0.85)`；全部 10s 超时保护）；`export function probeFailureMessageKey(reason): TKey`。
  - `HeroMediaSettings` — Media Type 切换；Hero Image（`ImageUrlInput`）+ Alt 输入；Hero Video（上传时先 `probeVideo`，失败即拒绝并显示可读原因；通过后自动上传 poster blob）；Poster（显示缩略图 + 替换/重新上传）；Fit Mode；**Global Focal Point**（媒体预览图上点击/拖动十字准星 → `focal {x,y}`）；**逐设备 Object Position**（选择 desktop/tablet/mobile 后独立准星，`Reset to Focal Point`）；`Use separate mobile media` 开关（默认 OFF，ON 后出现 Mobile Image/Video 槽位）；**Safe Area 覆盖层开关**：Header Safe Area / Text Safe Area / Mobile Crop / Media Crop Boundary / Universal Safe Zone（五个 checkbox 控制 HeroCanvas 上的覆盖线——通过 context 的 `safeAreaFlags` 传给画布）。
- 视频播放设置（Autoplay/Muted/Loop/Plays Inline/Show Sound Toggle/Pause When Off-screen）默认 ON/ON/ON/ON/OFF/ON，放在本面板底部。

- [ ] **Step 1: 写失败测试**

```tsx
it("maps probe failures to readable reasons (decode/seek/frame/too long/too small)", …);
it("rejects a 45s video file by metadata duration", …);          // probeVideo mock 注入
it("switches media type and keeps independent image/video slots", …);
it("enables the mobile override only when the toggle is on", …);
it("resets a device object position back to the focal point", …);
it("toggles the safe-area overlays", …);
```

- [ ] **Step 2-4: RED → 实现 → GREEN**（`probeVideo` 的浏览器路径不做 jsdom 单测，逻辑分支通过把"探测执行器"作为可注入参数覆盖；真实解码路径由 Task 22 E2E 覆盖）
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/lib/video-probe.ts small-house-commerce/frontend/src/lib/video-probe.spec.ts small-house-commerce/frontend/src/components/admin/homepage
git commit -m "feat(homepage): add hero media panel with video probe and safe areas"
```

---

### Task 16: Hero 画布（选中 / 拖拽 / 吸附 / 键盘 / 锁定）

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/HeroCanvas.tsx`
- Test: `HeroCanvas.spec.tsx`

**Interfaces:**
- Consumes: Task 12 context、Task 8 `clampPct`/`updateHeroElement`/`effectiveElementStyle`、Task 10 `elementInlineVars`、Task 19 `HeroSlider`（本任务先以内联最小渲染接线；Task 19 完成后替换为真实组件——**内联实现与真实组件的元素 DOM 结构必须一致**，由 Task 19 的测试交叉验证）。`HeroSlider` 的最终签名（Task 19 实现，本任务按此消费）：
  ```ts
  HeroSlider({ section, edit }: {
    section: HomepageSection;                       // payload 为 v2（服务端已解析 linkHref）
    edit?: { selectedElementKey: HeroElementKey | null; onSelectElement(key: HeroElementKey): void };
  })
  ```
  无 `edit` = 只读渲染（前台与版本预览）；有 `edit` = 元素可点击选中、每个元素容器带 `data-hero-element="<key>"` 供画布命中。
- Produces：
  - 画布：`DeviceFrame` 内渲染当前幻灯（真实 `HeroSlider` 编辑模式），点击元素 → `setSelectedElementKey`；选中框（虚线 + 四角手柄）。
  - 拖拽：`pointerdown` 于元素 → `setPointerCapture` → `pointermove` 换算百分比 `dx/rect.width*100` → 实时更新（不 commit）；`pointerup` → 单次 `commit`。**吸附**：中线/安全区边缘/其他元素边缘 ±1.5% 内吸附；拖动中显示对齐辅助线；`Shift` 禁用吸附。
  - 键盘：选中元素后方向键 ±0.5%（`Shift`=±5%）→ commit；`Escape` 取消选中；`Tab` 在元素间循环。
  - 悬浮工具条：对齐三连（LEFT/CENTER/RIGHT）、垂直对齐、`Reset Position`、`Lock`（锁定后拖拽禁用，图标显示锁态）。
  - Safe Area 覆盖层（由 Task 15 的 flags 驱动）：Header 线（顶部 80px）、文本安全区、媒体裁切边界、移动端裁切、中心通用安全区——全部 `pointer-events-none`。
  - **所有坐标写回前经 `clampPct`**（Review Focus #4）。
- 拖拽数学提取为纯函数便于测试：`export function dragDeltaToPct(startPct: number, deltaPx: number, containerPx: number): number`（含钳制）、`export function snapValue(pct: number, guides: number[], threshold = 1.5): { value: number; snapped: boolean }`。

- [ ] **Step 1: 写失败测试**

```tsx
it("selects an element on click and shows the toolbar", …);
it("drags heading and commits the new percentage exactly once on pointerup", …);   // fireEvent.pointerDown/Move/Up + getBoundingClientRect mock
it("clamps a drag beyond the container to 0–100 and never writes NaN", …);
it("snaps to the center guide within 1.5% and skips snapping with Shift", …);
it("nudges the selected element with arrow keys and commits once", …);
it("locks an element: dragging it no longer changes the document", …);
it("resets an element to its default layout", …);
```

- [ ] **Step 2-4: RED → 实现 → GREEN**
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/homepage
git commit -m "feat(homepage): add hero canvas with drag, snapping and keyboard nudging"
```

---

### Task 17: 发布面板 + 校验 UI + 版本历史页

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/PublishPanel.tsx`
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/homepage/versions/page.tsx`（+ `versions/page.spec.tsx`）
- Modify: `HomepageEditor.tsx`（接入 PublishPanel 与 Preview Draft 按钮）

**Interfaces:**
- Consumes: Task 11 API、Task 12 context。
- Produces：
  - `PublishPanel`（Dialog）：保存检查（未保存先自动保存）→ `validateHomepage()` → 结果分组展示（ERROR 红 / WARNING 黄，每条含 message 与定位按钮"跳到该幻灯"→ 设置 `selectedSlideId`）；`note` 输入（默认自动摘要："Hero: N slides; Announcement: M items"）；`publishAt`/`unpublishAt` datetime-local（留空=立即）；有 WARNING 未确认时确认按钮文案"确认风险并发布"；422 时把 issues 渲染进面板不关闭。
  - `Preview Draft` 按钮：`createHomepagePreviewToken()` → `window.open('/preview/homepage?token=…')`；503（未配置密钥）→ 按钮禁用 + tooltip"预览功能未配置"。
  - 版本历史页：列表（版本号/时间/操作人/note/状态徽标 LIVE/SCHEDULED/ENDED/SUPERSEDED）；操作：`预览`（Dialog 内只读渲染该版本 → 打开 `/preview/homepage?token=` 不可用（token 只对草稿）→ 改为行内 Dialog 以只读模式渲染 sections 快照）、`恢复到草稿`（确认后调 restore + 提示"已恢复到草稿，发布后生效"）、`下线`（仅 LIVE/SCHEDULED）。

- [ ] **Step 1: 写失败测试**

```tsx
it("blocks publish and lists errors with a jump-to-slide action", …);
it("requires explicit confirmation before publishing with warnings", …);
it("schedules a future publish and shows it as SCHEDULED in the versions list", …);
it("restores a version into the draft without publishing", …);
it("opens the draft preview with a fresh token", …);
it("disables preview when the token endpoint answers 503", …);
```

- [ ] **Step 2-4: RED → 实现 → GREEN**
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/homepage "small-house-commerce/frontend/src/app/admin/(shell)/homepage"
git commit -m "feat(homepage): add publish panel, validation ui and version history"
```

---

### Task 18: Link Picker（完整版）并接入 Hero CTA 与 Announcement

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/homepage/LinkPicker.tsx`
- Modify: `SettingsPanel.tsx`、`AnnouncementSettings.tsx`（替换 Task 14/13 的最小内联实现）
- Test: `LinkPicker.spec.tsx`

**Interfaces:**
- Consumes: 现有 `adminApi.listProducts`（搜索）、`listCategories`、`listCollections`（若无分页搜索端点则客户端过滤——实现前先 `rg` 确认 admin-api 现有方法）、`listLandingPages`；Task 8 `LinkValue`。
- Produces：
  - `LinkPicker({ value, onChange, allowExternal }: { value: LinkValue | null; onChange(v: LinkValue | null): void; allowExternal: boolean })` — 类型下拉（Product/Collection/Category/Landing Page/External）+ 可搜索实体列表（复用 `ProductPickerDialog` 的搜索交互模式，单选）+ 外链输入（仅 https，即时校验）+ 预览最终解析形态（实体显示 `名称（将解析为前台链接）`）+ 清除按钮。
  - 实体类型为 PRODUCT 时提供"跳转编辑该商品"链接（新标签）。

- [ ] **Step 1: 写失败测试**

```tsx
it("searches products and stores {type:'PRODUCT', id}", …);
it("rejects an http:// external url and accepts https://", …);
it("clears the value back to null", …);
it("shows the selected entity name from the loaded option list", …);
```

- [ ] **Step 2-4: RED → 实现 → GREEN**
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/admin/homepage
git commit -m "feat(homepage): add entity link picker and wire hero ctas"
```

---

### Task 19: 前台 HeroSlider + Countdown + CSS 变量接入

**Files:**
- Create: `small-house-commerce/frontend/src/components/home/HeroSlider.tsx`（`"use client"`）、`HeroSlideCountdown.tsx`
- Modify: `small-house-commerce/frontend/src/components/home/sectionRegistry.tsx`（HERO → `HeroSlider`）
- Modify: `small-house-commerce/frontend/src/lib/api.ts`（`HomepageSection` 类型：HERO payload 增 v2 形状的宽松类型；不改其它）
- Test: `HeroSlider.spec.tsx`、`HeroSlideCountdown.spec.tsx`

**Interfaces:**
- Consumes: Task 10 `heroCss`/`elementInlineVars`/`overlayCss`、现有 `ViewportVideo`（`mode="HERO"`）、`SectionShell` 追踪属性 `data-track-*`（保留 `HeroClick`，新增 `data-slide-id`）。
- Produces：
  - `HeroSlider({ section, edit }: { section: HomepageSection; edit?: { selectedElementKey: HeroElementKey | null; onSelectElement(key: HeroElementKey): void } })` — 渲染 `payload.slides`（服务端已按排期过滤）：`<style>{heroCss(section.id, payload)}</style>` + 幻灯容器（仅当前幻灯可见，FADE/SLIDE 过渡）+ 元素绝对定位（`elementInlineVars`，每个元素容器带 `data-hero-element="<key>"`）+ 视频幻灯用 `<ViewportVideo mode="HERO" …>` + poster + 声音开关（`showSoundToggle` 时显示喇叭按钮，切换 muted）+ overlay + 两个 CTA（`linkHref` 为空则不渲染该 CTA）+ countdown。`edit` 存在时：元素可点击（`onSelectElement`）、选中元素显示 2px 虚线轮廓；`edit` 不存在时零交互（前台与版本预览复用同一渲染路径）。
  - 行为：autoplay（`durationMs`）、`pauseOnHover`、手动切换后暂停 `manualPauseMs`、箭头、分页三形态（DOTS / `01 / 03` 计数 / PROGRESS 条）；`prefers-reduced-motion` → 关闭自动播放与过渡；无媒体幻灯 → 保留渐变兜底块。
  - `HeroSlideCountdown({ endsAt, style, layout })` — 客户端倒计时（天/时/分/秒），到点显示 0 并停表；`endsAt` 为空或已过 → 不渲染。
  - 高度：容器 `clamp(560px, 72vh, 720px)`（desktop）；`@media` 内由 `heroCss` 输出 tablet/mobile 高度覆盖（新增变量 `--hp-hero-height`，默认 mobile 4:5 换算、desktop 取 clamp 公式——**高度用 CSS 变量 + calc 输出**）。

- [ ] **Step 1: 写失败测试**

```tsx
it("renders only the first slide's media eagerly and marks the rest aria-hidden", …);
it("advances with autoplay after durationMs and pauses on hover", …);      // fake timers
it("manual navigation pauses autoplay for manualPauseMs", …);
it("renders dots / counter / progress pagination per behavior.pagination", …);
it("disables autoplay and transitions under prefers-reduced-motion", …);
it("renders no CTA when its linkHref is null but keeps the text elements", …);
it("keeps the gradient fallback for a slide without media", …);
it("counts down to endsAt and stops at zero", …);                          // HeroSlideCountdown
it("keeps data-track attributes with the slide id", …);
```

- [ ] **Step 2-4: RED → 实现 → GREEN**
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/home small-house-commerce/frontend/src/lib/api.ts
git commit -m "feat(storefront): add hero slider with responsive css vars"
```

---

### Task 20: AnnouncementBar v2 + storefront layout 接线

**Files:**
- Modify: `small-house-commerce/frontend/src/components/layout/AnnouncementBar.tsx`
- Modify: `small-house-commerce/frontend/src/app/(storefront)/layout.tsx`
- Modify: `small-house-commerce/frontend/src/lib/api.ts`（`getAnnouncement()`）
- Test: `AnnouncementBar.spec.tsx`

**Interfaces:**
- Consumes: Task 7 的 `GET /storefront/announcement`。
- Produces：
  - `AnnouncementBar({ data }: { data: AnnouncementBlockView | null })` — `"use client"`；无数据/无启用项 → 返回 null；多条 → `rotationMs` 轮播（悬停暂停、`prefers-reduced-motion` 不轮播只显示第一条）；每条颜色 inline（服务端已白名单，客户端再过 `safeHex`）；有 `linkHref` 渲染 `<a>`，`linkLabel` 渲染为文字后缀。
  - layout：`getAnnouncement()`（revalidate 120，tag `storefront`，失败静默 null）→ 传入 bar；删除现有硬编码字符串。

- [ ] **Step 1: 写失败测试**

```tsx
it("renders nothing without data or with all items disabled", …);
it("rotates items on the configured interval and pauses on hover", …);
it("renders the link only when linkHref exists", …);
it("shows a single static item under prefers-reduced-motion", …);
```

- [ ] **Step 2-4: RED → 实现 → GREEN**
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/components/layout/AnnouncementBar.tsx "small-house-commerce/frontend/src/app/(storefront)/layout.tsx" small-house-commerce/frontend/src/lib/api.ts
git commit -m "feat(storefront): serve announcement bar from the homepage document"
```

---

### Task 21: 草稿预览路由（token 门禁 / 零追踪）

**Files:**
- Create: `small-house-commerce/frontend/src/app/preview/homepage/page.tsx`（独立于 `(storefront)` 分组——不继承 MetaPixelInit/Header/Footer）
- Test: `small-house-commerce/frontend/src/app/preview/homepage/page.spec.tsx`

**Interfaces:**
- Consumes: Task 7 的 `previewToken` 参数；`SECTION_REGISTRY`、`HeroSlider`、`AnnouncementBar`。
- Produces：`/preview/homepage?token=…`：
  - `export const dynamic = "force-dynamic"`；`export const metadata = { robots: { index: false, follow: false } }`。
  - 服务端 `fetch(…/storefront/homepage?previewToken=…, { cache: "no-store" })` + announcement 同理；**无 token 或 API 返回非 200 → `notFound()`（404）**。
  - 响应头 `Cache-Control: private, no-store` 与 `Referrer-Policy: no-referrer`（`next.config.ts` headers 或 route 内 `headers()` 实现，二选一，实现时以能覆盖该路由为准）。
  - 渲染：announcement + sections（同一 registry）；页面顶部一条固定提示条"草稿预览 · 未发布"；**不加载 MetaPixelInit、不渲染 HomeTracking、data-track 属性不生效**（HeroSlider 等组件保留属性但不挂 HomeTracking 委托监听即可）。

- [ ] **Step 1: 写失败测试**

```tsx
it("404s without a token and with an invalid token (API 401/404 分支)", …);
it("renders draft sections when the API accepts the token", …);
it("sets noindex/nofollow metadata and no-store headers", …);
it("mounts no MetaPixel/HomeTracking in the preview tree", …);   // 断言渲染树中不含像素脚本与 HomeTracking
```

- [ ] **Step 2-4: RED → 实现 → GREEN**
- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/frontend/src/app/preview small-house-commerce/frontend/next.config.ts
git commit -m "feat(homepage): add token-gated draft preview route"
```

---

### Task 22: E2E 套件 + 视觉证据 + 完整门禁 + 审查 + 发布准备

**Files:**
- Create: `small-house-commerce/frontend/e2e/homepage-builder.spec.ts`
- Create: `docs/superpowers/acceptance/2026-09-27-homepage-builder/`（截图证据）

**Interfaces:**
- Consumes: 既有 E2E 基建（`e2e/bootstrap.ts` 强制 loopback + 隔离库 `small_house_variant_test`、`openEditorWithStoredSession()` 零登录模式——**新增测试必须零登录**，登录限流 10 次/10 分钟已被现有套件用满）。
- Produces：E2E 场景（全部只写隔离库）：

- [ ] **Step 1: 写 E2E（先跑必失败）**

```ts
test("edits hero text and sees the live preview update without saving", …);
test("drags a hero element and persists the percentage after Save Draft", …);
test("publishes and the storefront homepage serves the new slide", …);
test("a scheduled version stays invisible until its publishAt", …);   // 通过 API 造 publishAt=+1s 的版本，等待后刷新断言
test("restores a previous version into the draft", …);
test("draft preview shows unpublished changes and fires zero tracking requests", …); // 拦截 /fbevents.js 与 beacon 请求断言 0
test("expired/tampered preview tokens 404", …);
test("375 / 768 / 1440: builder and storefront hero render without overflow or console errors", …);
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --dir small-house-commerce/frontend exec playwright test e2e/homepage-builder.spec.ts --project=chromium`
Expected: FAIL（页面/路由尚未接线完整的行为断言）

- [ ] **Step 3: 逐场景修复至全绿；生成视觉证据**

每档视口截图（builder 三栏 + 前台 Hero + Announcement）存 `docs/superpowers/acceptance/2026-09-27-homepage-builder/`，与 Task 0 baseline 同视口对照。

- [ ] **Step 4: 完整门禁（全部新鲜执行）**

```bash
pnpm --dir small-house-commerce/backend test            # 期望全绿（≥735）
pnpm --dir small-house-commerce/backend exec tsc --noEmit
pnpm --dir small-house-commerce/backend build
pnpm --dir small-house-commerce/frontend test           # 期望全绿（≥700）
pnpm --dir small-house-commerce/frontend exec tsc --noEmit
pnpm --dir small-house-commerce/frontend lint           # 0 error
pnpm --dir small-house-commerce/frontend build
pnpm --dir small-house-commerce/frontend exec playwright test --project=chromium   # 全量 ≥64 场景
git diff --check
```

- [ ] **Step 5: 独立审查（whole-branch）**

用 superpowers:requesting-code-review 模板派发 fresh reviewer（最强模型），审查范围 `git merge-base main HEAD..HEAD`，附 spec 与 Review Focus 五条。

- [ ] **Step 6: 修复 Critical/Important（RED→GREEN）后 Commit**

```bash
git add -A -- small-house-commerce/frontend/e2e docs/superpowers/acceptance/2026-09-27-homepage-builder
git commit -m "test(homepage): add builder e2e suite and acceptance evidence"
```

- [ ] **Step 7: 发布准备清单（只准备，不部署；等用户批准）**

1. 本地克隆库演练：迁移 + 回填等价性 + 单例约束（Task 1 Step 3 重跑）。
2. 生产部署顺序（用户批准后执行）：备份 `pg_dump` → `rollback-<当前sha>` 双镜像标记 → **`.env.deploy` 写入 `HOMEPAGE_PREVIEW_SECRET=$(openssl rand -hex 32)`** → `git merge --ff-only FETCH_HEAD` → `build backend frontend` → `up -d backend frontend` → 冒烟（旧表未动、`/storefront/homepage` 与今日契约同形、`/storefront/announcement` 200、预览 token 签发可用、PDP/购物车/结账回归）。
3. 回滚预案：镜像回滚 + 旧表只读回退路径已内建（无生效版本 → 自动读旧表）。
