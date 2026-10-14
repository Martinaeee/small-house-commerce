# Storefront Shell and Brand Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立独立的全站 Header/Footer 与品牌编辑器，使内容、结构化链接、横向/方形 Logo 和基础主题经过草稿、预览、CAS 保存与原子发布后统一作用于所有顾客前台页面。

**Architecture:** 新建单例 `StorefrontShell` 文档与 append-only `StorefrontShellAsset` 注册表；后端负责规范化、实体解析、图片派生、对比度验证、草稿/发布和公开降级。前端复用真实 `Header`、`MainNav`、`Footer` 与设计 token，在独立后台工作区提供惰性预览；公开 storefront layout 只读取已发布投影并通过受控 CSS variables 应用主题。

**Tech Stack:** Node.js ≥22、pnpm 12.3.4、NestJS 12、Prisma 7.10、PostgreSQL、Zod、Sharp 0.35.5、Culori 4.0.2、Next.js 16.3.4、React 19.2.8、Tailwind CSS 4、dnd-kit、Vitest、Testing Library、Playwright。

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-12-storefront-shell-brand-editor-design.md`

## Global Constraints

- 当前工作区是共享且高度脏的 `feature/homepage-builder`；不得整树 restore、reset、checkout、clean、stash、stage 或提交。
- 每次编辑前重新读取目标文件；并行 Newsletter、FAQ、Product Card、Bundle、Marketing 改动必须原样保留。
- 没有 commit、push、PR、merge 或生产部署授权。每个任务的“checkpoint”只在后来获得明确授权且 staged diff 精确时才执行；否则只写 SDD ledger。
- Prisma schema、migration 和 generated client 只能在协调到独占窗口后修改；执行前后都通知并行工作线，禁止并发 generate/migrate。
- 开发期唯一允许写入的数据库是明确隔离的 `small_house_marketing_dev`；不得写生产库、rehearsal 库或同伴数据库。
- migration 是 additive-only；不得修改 Product、SKU、Inventory、Cart、Order、Customer、Marketing attribution 的业务语义或历史事实。
- 不得重启或覆盖用户/同伴的 `3000`、`3001`、`3005`、`3216`、`3217` 或其 `.next`。最终浏览器验收使用本计划独占的 runtime copy 和空闲端口（预定 backend `3230`、frontend `3231`，启动前必须确认空闲）。
- Root layout 必须保持同步；现有慢加载开屏“快网零闪烁”协议不可退化。
- 顾客前台文案保持英文；后台操作文案同时补齐 `zh.ts` 与 `en.ts`。
- 只允许实际解码为单帧 PNG/WebP/JPEG 的 Logo；禁止 SVG、动画、多页图片、任意字体上传、远程字体、任意 HTML/CSS/脚本。
- 横向派生图采用最长 `1200×400` 的 contain-inside WebP；方形派生图采用透明 padding、无裁切的 `512×512` PNG；两者都不得保留源 metadata。
- 桌面 Header/Footer 使用横向 Logo；手机 Header、favicon 和慢加载开屏使用方形标识。
- 公开主题只接受五个严格 `#rrggbb` 源色与固定字体枚举；admin 绿色主题不受影响。
- 当前 LUWAG Header/Footer、Logo fallback 与色值必须是迁移后及故障时的精确默认结果。
- 所有行为变更必须先观察语义 RED，再写最小 GREEN；每个任务结束运行任务级完整测试。
- 安装依赖前先记录 lockfile 基线；固定安装 `sharp@0.35.5`（backend）与 `culori@4.0.2`（backend/frontend），不升级 Next、React、Prisma、Puck 或其他包。
- Next 16 行为以仓库内 `frontend/node_modules/next/dist/docs/` 为准：普通 GET Route Handler 默认不缓存；metadata icon 特殊路由默认静态；外部发布回调同时使用 `revalidateTag(tag, { expire: 0 })` 与 storefront layout `revalidatePath`。
- R2 或明确 durable 的本地上传存储才允许发布新品牌资产；开发/测试本地目录视为 durable，production 本地目录必须显式 `UPLOAD_STORAGE_DURABLE=true`。

## Review Focus

1. **发布后目标被停用，同时旧 layout 与 public-shell 缓存仍存在**：下一次访问必须让 projection-hash ETag 改变、仅省略失效链接，favicon 继续使用当前 shell revision，不能 304 复活旧链接或整页报错。由 Task 2、Task 4、Task 6、Task 9 的删除后读取和缓存回归覆盖。
2. **草稿替换/移除 Logo 时线上仍引用旧资产**：旧 `StorefrontShellAsset` 与对象必须保留，公开版本继续工作；草稿上传不能删除或污染线上资产。由 Task 5 的 append-only/replace/remove 测试覆盖。
3. **前后端在 WCAG 4.5 边界附近的颜色计算漂移**：相同 fixture 必须生成相同 derived tokens 和 issue codes，不能前端允许而后端拒绝。由 Task 1 的双端共享 fixture 与 Task 13 的 validate round-trip 覆盖。
4. **账号/权限或 document version 在上传、验证、保存请求期间变化**：晚返回不得写入新账号页面、覆盖新草稿或解除错误的上传锁。由 Task 10 与 Task 13 的 actor/request-generation 回归覆盖。
5. **favicon/Logo 首次请求发生在后端不可用或上传对象消失时**：`/brand-mark` 必须返回内置 SVG 和正确 content type/ETag，Root layout 仍同步，开屏不等待 API。由 Task 9 的 route-handler/fallback/build 测试覆盖。

---

## File Structure

### Backend domain and persistence

| File | Responsibility |
| --- | --- |
| `backend/src/modules/storefront-shell/storefront-shell-document.ts` | 文档类型、Zod 草稿结构、默认值、规范化、issue 类型 |
| `backend/src/modules/storefront-shell/storefront-shell-theme.ts` | Culori 派生 token、WCAG 检查、CSS-safe theme projection |
| `backend/src/modules/storefront-shell/storefront-shell-targets.ts` | 批量解析 Category/Collection/Product/Landing/Internal/External 目标 |
| `backend/src/modules/storefront-shell/storefront-shell-validation.ts` | 发布期内容、实体、资产、数量、对比度校验 |
| `backend/src/modules/storefront-shell/storefront-shell.service.ts` | 单例读取、CAS 保存、validate、Serializable 发布、公开投影、fallback |
| `backend/src/modules/storefront-shell/storefront-shell-assets.service.ts` | Sharp 解码/派生、存储、asset registry 写入和 durable 校验 |
| `backend/src/modules/storefront-shell/dto/storefront-shell.dto.ts` | save/publish/upload query DTO |
| `backend/src/modules/storefront-shell/admin/storefront-shell.controller.ts` | 受 `STOREFRONT_SHELL_MANAGE` 保护的 admin API |
| `backend/src/modules/storefront-shell/storefront/storefront-shell.controller.ts` | 匿名只读 published shell API |
| `backend/src/modules/storefront-shell/storefront-shell.module.ts` | 模块装配 |
| `backend/prisma/schema/settings.prisma` | `StorefrontShell` 与 `StorefrontShellAsset` model |
| `backend/prisma/schema/identity.prisma` | 新 permission 与 User 审计关系 |
| `backend/prisma/migrations/20261014200000_add_storefront_shell/migration.sql` | additive table/permission/default-document migration |
| `backend/prisma/rbac.ts` | permission 元数据及 SUPER_ADMIN 初始授权 |

### Backend shared infrastructure

| File | Responsibility |
| --- | --- |
| `backend/src/modules/uploads/uploads.service.ts` | namespaced processed-buffer 持久化（R2 或 local）与 durable 能力 |
| `backend/src/config/configuration.ts` | `upload.durable` 投影 |
| `backend/src/config/env.validation.ts` | `UPLOAD_STORAGE_DURABLE` 验证 |
| `backend/.env.example` | durable storage 运维说明 |
| `backend/src/modules/settings/dto/settings.dto.ts` | 从通用 settings 写接口移除客服字段写权限 |
| `backend/src/modules/settings/settings.service.ts` | 继续公开兼容字段，但不再由普通 settings mutation 更新 |
| `backend/src/app.module.ts` | 注册 `StorefrontShellModule` |
| `backend/package.json`, `backend/pnpm-lock.yaml` | Sharp/Culori 固定依赖（共享 lockfile 只改一次） |

### Frontend domain and API

| File | Responsibility |
| --- | --- |
| `frontend/src/lib/storefront-shell-document.ts` | 与 API 对齐的 document/admin/public 类型、前端 normalize/default |
| `frontend/src/lib/storefront-theme.ts` | Culori 本地预览派生、issue fixtures、CSS variable serializer |
| `frontend/src/lib/storefront-shell-api.ts` | admin/public fetch、CAS/validate/publish/upload |
| `frontend/src/lib/site-settings.ts` | 与公开 settings 兼容，不再作为 Footer 内容源 |
| `frontend/src/lib/nav.ts` | 由公开 Header 配置 + live category tree 构建 nav，保留 legacy fallback |
| `frontend/src/lib/homepage-document.ts` | 给结构化链接增加安全 `INTERNAL` 类型 |
| `frontend/src/lib/fonts.ts` | 暴露 self-hosted Poppins CSS variable；system/serif 继续使用固定安全 stack |
| `frontend/package.json`, `frontend/pnpm-lock.yaml` | Culori 固定依赖（与 backend 共用根 lockfile 实际只出现一份变更） |

### Shared storefront rendering

| File | Responsibility |
| --- | --- |
| `frontend/src/components/layout/BrandWordmark.tsx` | 横向/方形上传资产与当前 LUWAG fallback |
| `frontend/src/components/layout/BrandAssetImage.tsx` | client-side image error fallback，不让缺失对象显示 broken-image UI |
| `frontend/src/components/layout/Header.tsx` | desktop horizontal/mobile square 品牌 + live/inert mode |
| `frontend/src/components/layout/MainNav.tsx` | configured nav，preview mode 不 portal/不导航 |
| `frontend/src/components/layout/Footer.tsx` | 公开 Footer view model 与 inert mode |
| `frontend/src/components/layout/StorefrontShellPresentation.tsx` | production/preview 共用的 Header + content slot + Footer 外壳 |
| `frontend/src/components/layout/BootSplash.tsx` | `/brand-mark` 方形标识、CSS token 色、fallback |
| `frontend/src/app/(storefront)/layout.tsx` | 并行读取 shell、注入 theme、向 Header/Footer 传公开投影 |
| `frontend/src/app/globals.css` | storefront heading/body font token 与 admin 隔离 |
| `frontend/src/app/layout.tsx` | metadata favicon 指向 `/brand-mark`，保持同步 |
| `frontend/src/app/brand-mark/route.ts` | request-time same-origin mark proxy/fallback/ETag |
| `frontend/src/app/icon.svg` | 实施后删除，避免重复 icon 声明；SVG 内容搬入 fallback constant |
| `frontend/src/lib/default-brand-mark.ts` | 内置 LUWAG SVG fallback 常量 |
| `frontend/src/app/api/internal/revalidate/route.ts` | tag + storefront layout + brand-mark path invalidation |

### Admin editor

| File | Responsibility |
| --- | --- |
| `frontend/src/app/admin/(shell)/storefront-shell/page.tsx` | Header & Footer editor route |
| `frontend/src/app/admin/(shell)/storefront-shell/preview/page.tsx` | authenticated noindex saved-draft preview page |
| `frontend/src/components/admin/storefront-shell/SavedStorefrontShellPreview.tsx` | saved-draft preview 的鉴权加载、错误与重试状态 |
| `frontend/src/components/admin/storefront-shell/StorefrontShellEditor.tsx` | load/state/save/validate/publish/conflict/actor isolation |
| `frontend/src/components/admin/storefront-shell/StorefrontShellPublishBar.tsx` | status and actions |
| `frontend/src/components/admin/storefront-shell/HeaderContentEditor.tsx` | Logo slots + nav list |
| `frontend/src/components/admin/storefront-shell/FooterContentEditor.tsx` | brand/copy/columns/contact/copyright |
| `frontend/src/components/admin/storefront-shell/BrandThemeEditor.tsx` | five colors、font presets、contrast status |
| `frontend/src/components/admin/storefront-shell/BrandAssetField.tsx` | image upload/replacement/remove/dimensions/pending lifecycle |
| `frontend/src/components/admin/storefront-shell/ShellLinkEditor.tsx` | existing LinkPicker adapter + INTERNAL path |
| `frontend/src/components/admin/storefront-shell/StorefrontShellPreview.tsx` | 1200/768/390 inert shared rendering |
| `frontend/src/components/admin/storefront-shell/OrderedRows.tsx` | dnd-kit + keyboard up/down bounded list |
| `frontend/src/components/admin/AdminShell.tsx` | Website group and permission-filtered entry |
| `frontend/src/app/admin/(shell)/settings/page.tsx` | support fields read-only迁移提示 + deep link |
| `frontend/src/i18n/zh.ts`, `frontend/src/i18n/en.ts` | 完整后台文案 |

---

### Task 1: Lock the document contract and accessible theme derivation

**Files:**
- Modify: `small-house-commerce/backend/package.json`
- Modify: `small-house-commerce/frontend/package.json`
- Modify: `small-house-commerce/backend/pnpm-lock.yaml`
- Modify: `small-house-commerce/frontend/pnpm-lock.yaml`（若两个路径是同一 workspace lock 规则，以实际单一 lock 为准，禁止重复覆盖）
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-document.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-document.spec.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-theme.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-theme.spec.ts`
- Create: `small-house-commerce/frontend/src/lib/storefront-shell-document.ts`
- Create: `small-house-commerce/frontend/src/lib/storefront-shell-document.spec.ts`
- Create: `small-house-commerce/frontend/src/lib/storefront-theme.ts`
- Create: `small-house-commerce/frontend/src/lib/storefront-theme.spec.ts`
- Create: `small-house-commerce/contracts/storefront-theme-fixtures.json`

**Interfaces:**
- Produces backend/frontend-identical `StorefrontShellDocument`, `StorefrontThemeSource`, `DerivedStorefrontTheme`, `ShellIssue`, `createCurrentLuwagShellDocument(seedInput)`, `deriveStorefrontTheme()`, `themePublicationIssues()`, `normalizeStorefrontShellDocument()`.
- Consumed by every later backend service, public renderer, editor and migration.

- [ ] **Step 1: Record dependency and official-reference evidence without changing packages**

Record in the SDD ledger:

```text
sharp 0.35.5: Node >=20.9; chosen for decode, metadata strip, bounded raster derivatives.
culori 4.0.2: Node >=16; chosen for OKLCH interpolation and wcagContrast.
Next 16.3.4 local docs:
- normal GET Route Handlers are request-time by default;
- metadata icon routes are static unless request-time/uncached data is used;
- revalidateTag(tag, {expire:0}) + revalidatePath(layout) are complementary.
```

Expected: no package or source diff.

- [ ] **Step 2: Write backend and frontend RED contract/theme tests**

Use the same source fixtures in `small-house-commerce/contracts/storefront-theme-fixtures.json`:

```json
[
  {
    "name": "current-luwag",
    "source": {
      "primary": "#c9a77b",
      "action": "#6b4f3a",
      "background": "#faf8f5",
      "surface": "#ffffff",
      "text": "#222222",
      "headingFont": "SYSTEM",
      "bodyFont": "SYSTEM"
    },
    "expected": {
      "primaryDark": "#b8946a",
      "primaryLight": "#e8dccb",
      "actionHover": "#5a4130",
      "textSecondary": "#666666",
      "textMuted": "#999999",
      "border": "#e8e2d9",
      "focus": "#6b4f3a",
      "disabled": "#999999",
      "actionForeground": "#ffffff"
    }
  },
  {
    "name": "high-contrast-blue",
    "source": {
      "primary": "#3157a4",
      "action": "#173f8a",
      "background": "#f7f9ff",
      "surface": "#ffffff",
      "text": "#172033",
      "headingFont": "POPPINS_HEADING",
      "bodyFont": "SYSTEM"
    }
  }
]
```

Backend and frontend specs must assert:

```ts
expect(normalizeStorefrontShellDocument(input).schemaVersion).toBe(1);
expect(deriveStorefrontTheme(current.source)).toEqual(current.expected);
expect(themePublicationIssues(current.source)).toEqual([]);
expect(themePublicationIssues({ ...current.source, text: "#cccccc" }))
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "THEME_TEXT_BACKGROUND_CONTRAST", path: ["theme", "text"] }),
  ]));
expect(() => storefrontShellDocumentSchema.parse({ ...doc, theme: { ...doc.theme, primary: "red;--x:1" } })).toThrow();
expect(() => storefrontShellDocumentSchema.parse({ ...doc, theme: { ...doc.theme, headingFont: "https://fonts.example/x" } })).toThrow();
```

Document shape pinned by both suites:

```ts
export type StructuredLink =
  | { type: "PRODUCT" | "COLLECTION" | "CATEGORY" | "LANDING"; id: string }
  | { type: "INTERNAL"; path: string }
  | { type: "EXTERNAL"; url: string };

export type ShellAssetRef = { assetId: string } | null;

export type HeaderItem =
  | { id: string; kind: "CATEGORY_ROOT"; targetId: string; labelOverride: string; enabled: boolean }
  | { id: string; kind: "COLLECTION"; targetId: string; labelOverride: string; enabled: boolean }
  | { id: string; kind: "STRUCTURED_LINK"; label: string; link: StructuredLink; enabled: boolean };

export type FooterRow =
  | { id: string; kind: "LINK"; label: string; link: StructuredLink }
  | { id: string; kind: "TEXT"; text: string };

export type FooterColumn =
  | { id: string; kind: "LINKS"; title: string; rows: FooterRow[] }
  | {
      id: string; kind: "CONTACT"; title: string;
      supportEmail: string; supportHours: string; codText: string;
      trackOrderLabel: string; trackOrderLink: StructuredLink;
    };

export type StorefrontThemeSource = {
  primary: string; action: string; background: string; surface: string; text: string;
  headingFont: "SYSTEM" | "POPPINS_HEADING" | "SERIF_HEADING";
  bodyFont: "SYSTEM";
};

export type DerivedStorefrontTheme = {
  primaryDark: string; primaryLight: string; actionHover: string;
  textSecondary: string; textMuted: string; border: string;
  focus: string; disabled: string; actionForeground: string;
};

export type ShellIssue = {
  code: string;
  path: string[];
  message: string;
  itemId?: string;
  ratio?: number;
  requiredRatio?: number;
};

export type StorefrontShellDocument = {
  schemaVersion: 1;
  brand: { brandName: string; horizontalLogo: ShellAssetRef; squareMark: ShellAssetRef };
  header: { items: HeaderItem[] };
  footer: {
    tagline: string; description: string; columns: FooterColumn[];
    copyrightBrand: string;
  };
  theme: StorefrontThemeSource;
};

export type CurrentLuwagShellSeedInput = {
  rootCategories: Array<{ id: string; name: string; sortOrder: number }>;
  navigationCollections: Array<{ id: string; name: string; slug: string; sortOrder: number }>;
  supportEmail: string;
  supportHours: string;
};

export function createCurrentLuwagShellDocument(
  input: CurrentLuwagShellSeedInput,
): StorefrontShellDocument;
```

The factory emits the current New Arrivals → sorted root categories → Solutions → Best Sellers Header order, current Shop/Contact Footer copy, null Logo refs, and exact compile-time LUWAG theme. The v1 body preset is serialized as `SYSTEM`; the heading preset is the only multi-choice font field (`SYSTEM`, `POPPINS_HEADING`, `SERIF_HEADING`).

- [ ] **Step 3: Run the RED tests**

Run:

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/storefront-shell-document.spec.ts \
  src/modules/storefront-shell/storefront-shell-theme.spec.ts
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/storefront-shell-document.spec.ts \
  src/lib/storefront-theme.spec.ts
```

Expected: FAIL only because the new modules/exports do not exist.

- [ ] **Step 4: Install exact dependencies after preserving concurrent lockfile work**

Run only after re-reading both package files and checking no package manager process is active:

```bash
pnpm --dir small-house-commerce/backend add --save-exact sharp@0.35.5 culori@4.0.2
pnpm --dir small-house-commerce/frontend add --save-exact culori@4.0.2
```

Expected: no version movement for Next/React/Prisma/Puck; package diffs contain only the declared packages plus lock resolution needed for Sharp.

- [ ] **Step 5: Implement strict draft schemas and normalization in both packages**

Use exact scalar limits:

```ts
const label = z.string().trim().max(40);
const footerText = z.string().trim().max(120);
const tagline = z.string().trim().max(100);
const description = z.string().trim().max(300);
const brandName = z.string().trim().max(80);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase());
const internalPath = z.string().trim().max(2048).refine(isSafeInternalPath);
```

`isSafeInternalPath()` must require one leading slash, reject `//`, backslashes, ASCII control/space characters, and verify `new URL(path, "https://luwag.invalid").origin` remains the base origin.

Normalization must:

- trim strings;
- lowercase hex values;
- preserve stable ids and array order;
- cap nothing silently (over-limit shape is a save-time 400);
- preserve incomplete empty labels in a draft;
- drop unknown keys through explicit Zod objects;
- never accept document-provided derived colors, hrefs, CSS, MIME, dimensions, or asset URLs.

- [ ] **Step 6: Implement deterministic theme derivation in both packages**

Use Culori for non-default themes:

```ts
import { formatHex, interpolate, wcagContrast } from "culori";

const mix = (from: string, to: string, amount: number): string => {
  const value = formatHex(interpolate([from, to], "oklch")(amount));
  if (!value) throw new Error("Theme color could not be converted to sRGB");
  return value.toLowerCase();
};

export function deriveStorefrontTheme(source: StorefrontThemeSource): DerivedStorefrontTheme {
  if (sameSource(source, CURRENT_LUWAG_THEME_SOURCE)) return CURRENT_LUWAG_DERIVED_THEME;
  const actionForeground = ["#ffffff", source.text]
    .sort((a, b) => wcagContrast(source.action, b) - wcagContrast(source.action, a))[0];
  return {
    primaryDark: mix(source.primary, "#000000", 0.18),
    primaryLight: mix(source.primary, source.background, 0.72),
    actionHover: mix(source.action, "#000000", 0.15),
    textSecondary: mix(source.text, source.background, 0.35),
    textMuted: mix(source.text, source.background, 0.55),
    border: mix(source.text, source.background, 0.82),
    focus: source.action,
    disabled: mix(source.text, source.background, 0.65),
    actionForeground,
  };
}
```

`themePublicationIssues()` must use `wcagContrast` and emit stable codes for text/background, text/surface, CTA, Header, Footer, focus/background, and focus/surface. Normal text threshold is 4.5; focus threshold is 3.

- [ ] **Step 7: Run targeted GREEN tests and scoped lint/type checks**

Run:

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/storefront-shell-document.spec.ts \
  src/modules/storefront-shell/storefront-shell-theme.spec.ts
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/storefront-shell-document.spec.ts \
  src/lib/storefront-theme.spec.ts
pnpm --dir small-house-commerce/backend exec eslint \
  src/modules/storefront-shell/storefront-shell-document.ts \
  src/modules/storefront-shell/storefront-shell-theme.ts
pnpm --dir small-house-commerce/frontend exec eslint \
  src/lib/storefront-shell-document.ts src/lib/storefront-theme.ts
```

Expected: all targeted tests GREEN; no new warnings/errors.

- [ ] **Step 8: Conditional checkpoint**

If explicit commit authorization is still absent, append Task 1 test evidence and exact changed-file list to the SDD ledger and do not run git add/commit. If authorization later exists, stage only Task 1 files and commit `feat(shell): define shell document and theme tokens`.

---

### Task 2: Resolve structured targets and enforce publication validity

**Files:**
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-targets.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-targets.spec.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-validation.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-validation.spec.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/homepage-document.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/homepage-validation.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/homepage.service.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/homepage-document.spec.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/homepage-validation.spec.ts`
- Modify: `small-house-commerce/backend/src/modules/cms/homepage.service.spec.ts`

**Interfaces:**
- Consumes Task 1 `StructuredLink`, document, issue and theme APIs.
- Produces `StorefrontShellTargetResolver.resolve(document, prisma?)`, `validateShellForPublish(document, context)`, and public `ResolvedStorefrontShell` projection.

- [ ] **Step 1: Write RED target-resolution and strict-validation tests**

Use a `validDocument()` fixture plus explicit Prisma boundary stubs, then pin these inputs and outputs:

```ts
const document = validDocument();
document.header.items = [
  { id: IDS.productItem, kind: "STRUCTURED_LINK", label: "Chair", enabled: true,
    link: { type: "PRODUCT", id: IDS.product } },
  { id: IDS.collectionItem, kind: "COLLECTION", targetId: IDS.collection,
    labelOverride: "New", enabled: true },
];
prisma.product.findMany.mockResolvedValue([{ id: IDS.product, slug: "chair", status: "ACTIVE" }]);
prisma.collection.findMany.mockResolvedValue([{ id: IDS.collection, slug: "new", status: "ACTIVE" }]);
expect(await resolver.resolve(document)).toMatchObject({
  header: { items: [
    { id: IDS.productItem, href: "/products/chair" },
    { id: IDS.collectionItem, href: "/collections/new" },
  ] },
});
```

Add separate tests that:

- resolve Product/Collection/Category/Landing ids to their **current** slugs and ignore every client href;
- require CATEGORY_ROOT to be `ACTIVE` and `parentId=null`;
- require Product/Collection/Category to be `ACTIVE`, and Landing to be `ACTIVE` with `publishedContent`, active parent Product and current time inside `startAt/endAt`;
- accept `/track-order` while rejecting `//evil.test`, `/\\evil`, whitespace, credentials, non-HTTPS external URLs and `javascript:`;
- resolve once while active, disable one target, resolve again, and omit only that item;
- block publish for zero enabled Header items, duplicate ids, more than eight **enabled** Header items, more than four Footer columns, or more than eight rows in one column;
- allow up to 24 total Header draft rows so disabled work-in-progress rows do not consume the eight-visible-item allowance; reject row 25 as an absolute draft safety bound;
- allow an incomplete saved draft but report stable item-id-addressable publication issues.

Assert issue shape:

```ts
expect(issues).toContainEqual({
  code: "TARGET_UNAVAILABLE",
  path: ["header", "items", item.id, "targetId"],
  itemId: item.id,
  message: expect.any(String),
});
```

Review Focus deletion case: resolve once while ACTIVE, mark the fake target DISABLED, resolve again, and assert only that link disappears.

- [ ] **Step 2: Run RED tests**

Run:

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/storefront-shell-targets.spec.ts \
  src/modules/storefront-shell/storefront-shell-validation.spec.ts
```

Expected: FAIL because resolver/validator do not exist.

- [ ] **Step 3: Extend the existing shared link contract with `INTERNAL`**

Backend Homepage schema becomes:

```ts
const httpsExternalUrlSchema = z.string().trim().max(2048).url().refine((value) => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
}, "External links must be credential-free HTTPS URLs");

export const linkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["PRODUCT", "COLLECTION", "CATEGORY", "LANDING"]), id: z.string().uuid() }),
  z.object({ type: z.literal("INTERNAL"), path: internalPathSchema }),
  z.object({ type: z.literal("EXTERNAL"), url: httpsExternalUrlSchema }),
]);
```

Homepage validation treats INTERNAL as structurally valid without a DB lookup. Homepage rendering returns `link.path` directly. Add regression tests proving every old document remains valid and an INTERNAL link renders exactly `/track-order`, never an absolute attacker origin.

- [ ] **Step 4: Implement `StorefrontShellTargetResolver` with one query per entity type**

Expose:

```ts
export type ResolvedLink = { available: true; href: string } | { available: false; reason: string };
export type ResolvedHeaderItem =
  | { id: string; kind: "CATEGORY_ROOT"; categoryId: string; label: string }
  | { id: string; kind: "LINK"; label: string; href: string };
export type ResolvedTargets = {
  headerByItemId: ReadonlyMap<string, ResolvedHeaderItem>;
  footerLinkByRowId: ReadonlyMap<string, ResolvedLink>;
  unavailableByItemId: ReadonlyMap<string, string>;
};

export class StorefrontShellTargetResolver {
  constructor(private readonly prisma: PrismaService) {}
  resolve(document: StorefrontShellDocument, client: PrismaService | Prisma.TransactionClient = this.prisma): Promise<ResolvedTargets>;
}
```

Batch unique ids. Availability rules:

- Product: `status=ACTIVE`.
- Collection: `status=ACTIVE`.
- Category and CATEGORY_ROOT: `status=ACTIVE`; CATEGORY_ROOT additionally `parentId=null`.
- Landing: `status=ACTIVE`, `publishedContent != null`, parent Product `ACTIVE`, and current time inside start/end window.
- INTERNAL: safe path from Task 1.
- EXTERNAL: normalized HTTPS URL.

Build current hrefs from current slugs. Never accept or persist an href snapshot for entity links.

- [ ] **Step 5: Implement strict publication validation and tolerant public projection**

`validateShellForPublish()` combines:

- structural/business limits;
- required Header and CONTACT column checks;
- email and text constraints;
- duplicate stable ids;
- target availability;
- Task 1 theme issues;
- asset issues supplied by Task 5's interface (`missing`, `wrong-kind`, `not-durable`).

`publicProjection()` omits unavailable targets but preserves every valid neighbor and returns structured issue telemetry only to admin callers.

- [ ] **Step 6: Run GREEN plus Homepage regressions**

Run:

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/storefront-shell-targets.spec.ts \
  src/modules/storefront-shell/storefront-shell-validation.spec.ts \
  src/modules/cms/homepage-document.spec.ts \
  src/modules/cms/homepage-validation.spec.ts \
  src/modules/cms/homepage.service.spec.ts
```

Expected: all GREEN; existing Homepage link behavior unchanged.

- [ ] **Step 7: Conditional checkpoint**

No authorization: ledger only. Authorized later: exact Task 2 files, commit `feat(shell): validate and resolve shell links`.

---

### Task 3: Add additive schema, migration, singleton seed and RBAC permission

**Files:**
- Modify: `small-house-commerce/backend/prisma/schema/settings.prisma`
- Modify: `small-house-commerce/backend/prisma/schema/identity.prisma`
- Modify: `small-house-commerce/backend/prisma/rbac.ts`
- Modify: `small-house-commerce/backend/prisma/rbac.spec.ts`
- Create: `small-house-commerce/backend/prisma/storefront-shell-schema.spec.ts`
- Create: `small-house-commerce/backend/prisma/storefront-shell-migration.integration.spec.ts`
- Create: `small-house-commerce/backend/prisma/migrations/20261014200000_add_storefront_shell/migration.sql`
- Generated: `small-house-commerce/backend/src/generated/prisma/**` only during coordinated generate window

**Interfaces:**
- Produces Prisma models `StorefrontShell`, `StorefrontShellAsset`, enums `StorefrontShellAssetKind`, `StorefrontShellAssetStorage`, and permission `STOREFRONT_SHELL_MANAGE`.
- Consumed by Tasks 4–6.

- [ ] **Step 1: Claim the schema/generate window and capture database invariants**

Before touching schema:

```bash
ps aux | grep -E '[p]risma (generate|migrate)' || true
find small-house-commerce/backend/prisma/migrations -maxdepth 1 -type d | sort | tail -5
```

Confirm `20261014200000_add_storefront_shell` is still unused. Capture row counts and hashes for `products`, `skus`, `inventory_ledger`, `orders`, `order_attributions`, `product_landing_pages`, and `landing_page_visits` in `small_house_marketing_dev`; store results in the plan workspace, not git.

Expected: no active schema owner and no migration-name collision. If either exists, stop this task until the window is released; do not choose another database silently.

- [ ] **Step 2: Write RED schema/RBAC tests**

Assert:

```ts
expect(permissionCodes).toContain("STOREFRONT_SHELL_MANAGE");
expect(rolePermissions.SUPER_ADMIN).toContain("STOREFRONT_SHELL_MANAGE");
expect(rolePermissions.ADMIN).not.toContain("STOREFRONT_SHELL_MANAGE");
expect(schema).toContain("model StorefrontShell");
expect(schema).toContain("model StorefrontShellAsset");
expect(migration).toContain("SET lock_timeout = '5s'");
expect(migration).toContain('CHECK ("id" = \'00000000-0000-0000-0000-000000000002\')');
expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|ON DELETE CASCADE/);
```

- [ ] **Step 3: Run RED tests**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  prisma/storefront-shell-schema.spec.ts prisma/rbac.spec.ts
```

Expected: FAIL for missing models, enum value, migration and RBAC entry.

- [ ] **Step 4: Add exact Prisma models and User audit relations**

Use:

```prisma
enum StorefrontShellAssetKind {
  HORIZONTAL
  SQUARE
}

enum StorefrontShellAssetStorage {
  LOCAL
  R2
}

model StorefrontShell {
  id                   String   @id @db.Uuid
  schemaVersion        Int      @default(1) @map("schema_version")
  draftDocument        Json     @map("draft_document")
  publishedDocument    Json?    @map("published_document")
  version              Int      @default(1)
  publishedRevision    Int      @default(1) @map("published_revision")
  draftUpdatedByUserId String?  @map("draft_updated_by_user_id") @db.Uuid
  publishedByUserId    String?  @map("published_by_user_id") @db.Uuid
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt            DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  publishedAt          DateTime? @map("published_at") @db.Timestamptz(3)

  draftUpdatedBy User? @relation("StorefrontShellDraftUpdater", fields: [draftUpdatedByUserId], references: [id], onDelete: SetNull)
  publishedBy    User? @relation("StorefrontShellPublisher", fields: [publishedByUserId], references: [id], onDelete: SetNull)

  @@map("storefront_shells")
}

model StorefrontShellAsset {
  id              String                      @id @default(uuid(7)) @db.Uuid
  kind            StorefrontShellAssetKind
  storage         StorefrontShellAssetStorage
  storageKey      String                      @unique @map("storage_key")
  publicUrl       String                      @map("public_url")
  mimeType        String                      @map("mime_type")
  width           Int
  height          Int
  durable         Boolean
  createdByUserId String?                     @map("created_by_user_id") @db.Uuid
  createdAt       DateTime                    @default(now()) @map("created_at") @db.Timestamptz(3)

  createdBy User? @relation("StorefrontShellAssetCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)

  @@index([kind, createdAt])
  @@map("storefront_shell_assets")
}
```

Add the three inverse arrays to `User` and add `STOREFRONT_SHELL_MANAGE` to `PermissionCode`.

- [ ] **Step 5: Update RBAC source and migration**

Add permission metadata to `rbac.ts`; `ALL_PERMISSIONS` automatically grants SUPER_ADMIN, while ADMIN remains unchanged.

Migration must begin with a bounded session lock timeout and then:

```sql
SET lock_timeout = '5s';
```

1. `ALTER TYPE "PermissionCode" ADD VALUE 'STOREFRONT_SHELL_MANAGE';`
2. create both enums and tables with SetNull FKs;
3. add singleton CHECK id `00000000-0000-0000-0000-000000000002`;
4. seed one normalized document.

The seed CTE must derive:

- Header order: active `new-arrivals`, active root categories by `sort_order`, active `small-space-solutions`, active `best-sellers`;
- Shop rows: active `NAVIGATION` collections ordered by `sort_order,name`;
- Contact values: current `site_settings.support_email/support_hours`;
- fixed current copy and exact current LUWAG theme;
- null asset ids so code-rendered marks remain active.

Use deterministic UUIDv7-looking ids for fixed Footer columns/rows (`00000000-0000-7000-8000-0000000002xx`) and entity ids for migrated entity-backed item ids. Insert the same JSON into `draft_document` and `published_document`, version/revision `1`.

- [ ] **Step 6: Validate, generate and apply only to the dedicated database**

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public' \
  pnpm --dir small-house-commerce/backend exec prisma validate
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public' \
  pnpm --dir small-house-commerce/backend exec prisma generate
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public' \
  pnpm --dir small-house-commerce/backend exec prisma migrate deploy
```

Expected: exactly one pending migration applies; generated client includes both models and permission; no other migration runs unexpectedly.

- [ ] **Step 7: Verify seed and unrelated-data invariants**

Query the shell row, parse both JSON documents with `storefrontShellDocumentSchema`, independently query the active legacy nav entities/current settings, build the expected value with `createCurrentLuwagShellDocument(seedInput)`, and assert deep equality for draft and published documents. Also assert:

```text
schema_version=1, version=1, published_revision=1,
draft_document=published_document,
header enabled item count >= 1,
footer CONTACT count = 1,
theme current LUWAG values.
```

This must be an automated dedicated-PostgreSQL assertion in `prisma/storefront-shell-migration.integration.spec.ts`, not a visual SQL spot check.

Recompute Task 3 pre-migration counts/hashes. Expected: every unrelated table invariant is byte-for-byte/count-equal.

Run:

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  prisma/storefront-shell-schema.spec.ts prisma/rbac.spec.ts
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public' \
  pnpm --dir small-house-commerce/backend exec vitest run \
  prisma/storefront-shell-migration.integration.spec.ts
pnpm --dir small-house-commerce/backend exec tsc --noEmit --incremental false
```

- [ ] **Step 8: Release the schema window and conditional checkpoint**

Notify peers that generate/migration is finished. No authorization: ledger schema hash, migration result and invariant evidence only. Authorized later: exact schema/RBAC/migration/generated files, commit `feat(shell): add versioned shell storage`.

---

### Task 4: Implement CAS draft, validation, atomic publish and public fallback

**Files:**
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell.service.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell.service.spec.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell.integration.spec.ts`
- Modify: `small-house-commerce/backend/src/modules/settings/dto/settings.dto.ts`
- Modify: `small-house-commerce/backend/src/modules/settings/settings.service.ts`
- Modify: `small-house-commerce/backend/src/modules/settings/settings.service.spec.ts`

**Interfaces:**
- Consumes Tasks 1–3 contracts, target resolver and Prisma models.
- Produces `getAdminDraft`, `saveDraft`, `validateDraft`, `publish`, `getSavedPreview`, `getPublic`.

- [ ] **Step 1: Write service RED tests**

Pin these methods:

```ts
getAdminDraft(): Promise<AdminShellSnapshot>;
saveDraft(document: unknown, expectedVersion: number, userId: string): Promise<AdminShellSnapshot>;
validateDraft(document: unknown): Promise<AdminShellValidationResult>;
publish(expectedVersion: number, userId: string): Promise<AdminShellSnapshot>;
getSavedPreview(): Promise<AdminShellPreviewResult>;
getPublic(): Promise<ResolvedStorefrontShell>;
```

Where every admin result carries the current CAS version and structured issues:

```ts
type AdminShellValidationResult = {
  version: number;
  issues: ShellIssue[];
  derivedTheme: DerivedStorefrontTheme;
};
type AdminShellPreviewResult = {
  version: number;
  issues: ShellIssue[];
  shell: ResolvedStorefrontShell;
};
```

Tests:

- save with version 1 updates draft/version 2 but leaves published JSON, revision, compatibility settings and revalidation untouched;
- stale save returns 409 code `SHELL_VERSION_MISMATCH` and `currentVersion`;
- validate accepts unsaved input without persistence;
- publish revalidates inside a Serializable transaction, updates published JSON + revision + version + audit + compatibility contact in one commit;
- a post-commit `revalidateCache` rejection is logged but publish still returns the committed snapshot; it cannot report a false database failure;
- failed validation or transaction leaves all published fields unchanged;
- published target disabled after publish is omitted by `getPublic` but neighboring links survive;
- no row/malformed published JSON/Prisma read failure returns exact LUWAG fallback;
- normal settings PATCH no longer changes support email/hours;
- public settings still returns mirrored published support values.

- [ ] **Step 2: Run RED service tests**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/storefront-shell.service.spec.ts \
  src/modules/settings/settings.service.spec.ts
```

Expected: missing service and old settings-write behavior failures.

- [ ] **Step 3: Implement admin snapshot and CAS save**

Return:

```ts
export type AdminShellAsset = {
  id: string;
  kind: "HORIZONTAL" | "SQUARE";
  url: string;
  mimeType: "image/png" | "image/webp";
  width: number;
  height: number;
  durable: boolean;
  createdAt: string;
};

export type ResolvedFooterRow =
  | { id: string; kind: "LINK"; label: string; href: string }
  | { id: string; kind: "TEXT"; text: string };
export type ResolvedFooterColumn =
  | { id: string; kind: "LINKS"; title: string; rows: ResolvedFooterRow[] }
  | {
      id: string; kind: "CONTACT"; title: string;
      supportEmail: string; supportHours: string; codText: string;
      trackOrderLabel: string; trackOrderHref: string;
    };
export type ResolvedStorefrontShell = {
  publishedRevision: number;
  brand: {
    brandName: string;
    horizontalLogo: Pick<AdminShellAsset, "id" | "url" | "width" | "height"> | null;
    squareMark: Pick<AdminShellAsset, "id" | "url" | "width" | "height"> | null;
  };
  header: { items: ResolvedHeaderItem[] };
  footer: {
    tagline: string; description: string;
    columns: ResolvedFooterColumn[]; copyrightBrand: string;
  };
  theme: StorefrontThemeSource;
  derivedTheme: DerivedStorefrontTheme;
};

export type AdminShellSnapshot = {
  document: StorefrontShellDocument;
  version: number;
  publishedRevision: number;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  publishedAt: string | null;
  issues: ShellIssue[];
  assets: Record<string, AdminShellAsset>;
};
```

`saveDraft` flow:

```ts
const parsed = storefrontShellDocumentSchema.safeParse(input);
if (!parsed.success) throw new BadRequestException({ code: "SHELL_DRAFT_INVALID", issues: parsed.error.issues });
const normalized = normalizeStorefrontShellDocument(parsed.data);
const result = await prisma.storefrontShell.updateMany({
  where: { id: SINGLETON_ID, version: expectedVersion },
  data: {
    draftDocument: normalized as Prisma.InputJsonValue,
    version: { increment: 1 },
    draftUpdatedByUserId: userId,
  },
});
if (result.count !== 1) {
  const current = await prisma.storefrontShell.findUnique({
    where: { id: SINGLETON_ID },
    select: { version: true },
  });
  throw new ConflictException({
    code: "SHELL_VERSION_MISMATCH",
    currentVersion: current?.version ?? null,
  });
}
```

No cache invalidation on save/validate/upload.

- [ ] **Step 4: Implement Serializable publish**

Run the following ordered work inside an explicit Serializable callback (`shellVersionConflict(version)` returns `new ConflictException({ code: "SHELL_VERSION_MISMATCH", currentVersion: version })`; `requireContactColumn(document)` returns the sole CONTACT column and throws an internal invariant error only if strict validation was bypassed):

```ts
await prisma.$transaction(
  async (tx) => {
    const row = await tx.storefrontShell.findUniqueOrThrow({ where: { id: SINGLETON_ID } });
    if (row.version !== expectedVersion) throw shellVersionConflict(row.version);
    const draft = normalizeStorefrontShellDocument(row.draftDocument);
    const targets = await targetResolver.resolve(draft, tx);
    const assets = await assetService.assetsForDocument(draft, tx);
    const issues = validateShellForPublish(draft, { targets, assets });
    if (issues.length > 0) {
      throw new UnprocessableEntityException({ code: "SHELL_PUBLISH_VALIDATION_FAILED", issues });
    }
    const contact = requireContactColumn(draft);
    const updated = await tx.storefrontShell.updateMany({
      where: { id: SINGLETON_ID, version: expectedVersion },
      data: {
        publishedDocument: draft as Prisma.InputJsonValue,
        version: { increment: 1 },
        publishedRevision: { increment: 1 },
        publishedByUserId: userId,
        publishedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw shellVersionConflict(null);
    await tx.siteSetting.upsert({
      where: { id: SITE_SETTINGS_ID },
      create: { id: SITE_SETTINGS_ID, supportEmail: contact.supportEmail, supportHours: contact.supportHours },
      update: { supportEmail: contact.supportEmail, supportHours: contact.supportHours },
    });
    return { draft, nextVersion: expectedVersion + 1 };
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
);
```

The production implementation derives `contact` from the validated CONTACT column before the upsert and reloads the full snapshot after commit. Inside that transaction it therefore:

1. read singleton and compare exact `expectedVersion`;
2. normalize stored draft;
3. resolve targets and assets using `tx`;
4. run strict validation;
5. on issues throw 422 `SHELL_PUBLISH_VALIDATION_FAILED` with stable issues;
6. guarded `updateMany` by id/version writes published JSON, increments version/revision, audit/timestamp;
7. update `site_settings.support_email/support_hours` from the CONTACT column;
8. return new snapshot metadata.

After commit:

```ts
try {
  await revalidateCache([CACHE_TAGS.STOREFRONT]);
} catch (error) {
  logger.warn("Storefront shell published but cache revalidation failed", error);
}
return this.getAdminDraft();
```

The current helper already resolves on network failure, but the service-level guard pins the contract against a future helper or test double that rejects.

Never catch and convert a serialization conflict to success; map Prisma conflict to HTTP 409.

- [ ] **Step 5: Remove the competing Site Settings write path**

Change `updateSettingsSchema` so `supportEmail` and `supportHours` are not accepted writable keys. `SettingsService.update()` preserves the stored compatibility columns. `getRow()`/`getPublic()` continue returning them. Update settings tests so a stale client payload cannot change them.

- [ ] **Step 6: Run unit GREEN and real PostgreSQL integration**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/storefront-shell.service.spec.ts \
  src/modules/settings/settings.service.spec.ts
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public' \
  pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/storefront-shell.integration.spec.ts
```

Integration must create two Prisma clients, prove one of two same-version saves gets 409, publish atomically mirrors contact fields, and restore the original shell/settings rows in `afterAll`.

- [ ] **Step 7: Conditional checkpoint**

No authorization: ledger. Authorized later: exact Task 4 files, commit `feat(shell): add shell draft and publish lifecycle`.

---

### Task 5: Process and register durable horizontal/square brand assets

**Files:**
- Modify: `small-house-commerce/backend/package.json`
- Modify: lockfile
- Modify: `small-house-commerce/backend/src/modules/uploads/uploads.service.ts`
- Modify: `small-house-commerce/backend/src/modules/uploads/uploads.service.spec.ts`
- Modify: `small-house-commerce/backend/src/config/configuration.ts`
- Modify: `small-house-commerce/backend/src/config/env.validation.ts`
- Modify: `small-house-commerce/backend/.env.example`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-assets.service.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell-assets.service.spec.ts`

**Interfaces:**
- Consumes Task 3 asset model and `UploadsService`.
- Produces `processAndStore(kind, bytes, claimedMime, userId)` and `assetsForDocument(document, client)`.

- [ ] **Step 1: Write RED upload/storage tests using real raster bytes**

Generate fixtures in-memory with Sharp in tests:

```ts
const horizontal = await sharp({ create: { width: 600, height: 120, channels: 4, background: "#ff000080" } }).png().toBuffer();
const square = await sharp({ create: { width: 300, height: 280, channels: 4, background: "#00ff0080" } }).webp().toBuffer();
```

Assert:

- spoofed `image/png` containing text is 400;
- a claimed PNG whose bytes decode as JPEG succeeds as JPEG input, proving request MIME is not trusted;
- decoded GIF/TIFF/AVIF, animated WebP and multi-page input are rejected even if Sharp can decode them;
- zero bytes and >5 MB raw input are 400 before decode;
- decompression-bomb dimensions over 4096 are 400;
- horizontal output is metadata-stripped WebP, <=1200×400, no crop;
- square ratio `<0.9` or `>1.1` is 400;
- valid square output is transparent-padded PNG exactly 512×512;
- DB row records server-detected metadata, generated key under `brand/<year>/`, creator and durability;
- replacing/removing a document reference does not delete the prior row or bytes;
- R2 path performs a signed PUT with `Uint8Array`, checks `response.ok`, and returns configured public URL;
- production local storage with no explicit durable flag records `durable=false`; test/development local storage records true; complete R2 config records true.

- [ ] **Step 2: Run RED tests**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/storefront-shell-assets.service.spec.ts \
  src/modules/uploads/uploads.service.spec.ts
```

Expected: missing processing/storage APIs.

- [ ] **Step 3: Add durable-storage configuration**

`env.validation.ts`:

```ts
UPLOAD_STORAGE_DURABLE: z.enum(["true", "false"]).optional(),
```

`configuration.ts`:

```ts
upload: {
  dir: env.UPLOAD_DIR ?? null,
  durable:
    hasCompleteR2(env) ||
    env.UPLOAD_STORAGE_DURABLE === "true" ||
    env.NODE_ENV !== "production",
},
```

Document that production local paths require a persistent mounted volume and explicit true; R2 is automatically durable.

- [ ] **Step 4: Add namespaced processed-buffer persistence**

Keep existing `saveLocal()` behavior. Add:

```ts
saveProcessed(
  buffer: Buffer,
  contentType: "image/png" | "image/webp",
  namespace: "brand",
): Promise<{ url: string; key: string; storage: "LOCAL" | "R2"; durable: boolean }>;
```

For R2, create a namespaced signed PUT and call `fetch(uploadUrl, { method: "PUT", headers: { "content-type": contentType }, body: new Uint8Array(buffer) })`. For local, write under `brand/<year>/uuid.ext`. Never reuse an operator filename.

- [ ] **Step 5: Implement Sharp processing and append-only registry write**

```ts
const decoded = sharp(bytes, { failOn: "error", limitInputPixels: 4096 * 4096 }).rotate();
const meta = await decoded.metadata();
if (!meta.format || !["png", "webp", "jpeg"].includes(meta.format) || (meta.pages ?? 1) !== 1) {
  throw new BadRequestException({ code: "SHELL_ASSET_UNSUPPORTED_RASTER" });
}
```

- Horizontal: require 32–4096 each axis; use a fresh `.clone().resize({ width: 1200, height: 400, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 })`. Sharp strips source metadata by default, so do **not** call `keepMetadata()` or `withMetadata()`.
- Square: require 64–4096 and ratio 0.9–1.1; use a fresh `.clone().resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png()`, again without metadata-retention methods.
- Read the derivative's own metadata and persist only its detected output MIME/dimensions; never copy the request MIME, filename, EXIF or source dimensions into trusted derivative fields.
- Persist processed bytes, then create `StorefrontShellAsset`. If DB insertion fails, report failure; do not delete an object that another retry may already reference. Garbage collection stays out of scope.

- [ ] **Step 6: Run GREEN, type and lint**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/storefront-shell-assets.service.spec.ts \
  src/modules/uploads/uploads.service.spec.ts
pnpm --dir small-house-commerce/backend exec tsc --noEmit --incremental false
pnpm --dir small-house-commerce/backend exec eslint \
  src/modules/storefront-shell/storefront-shell-assets.service.ts \
  src/modules/uploads/uploads.service.ts src/config/configuration.ts src/config/env.validation.ts
```

- [ ] **Step 7: Conditional checkpoint**

No authorization: ledger. Authorized later: exact Task 5 files, commit `feat(shell): process durable brand assets`.

---

### Task 6: Expose guarded admin and resilient public shell APIs

**Files:**
- Create: `small-house-commerce/backend/src/modules/storefront-shell/dto/storefront-shell.dto.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/admin/storefront-shell.controller.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/admin/storefront-shell.controller.spec.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront/storefront-shell.controller.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront/storefront-shell.controller.spec.ts`
- Create: `small-house-commerce/backend/src/modules/storefront-shell/storefront-shell.module.ts`
- Modify: `small-house-commerce/backend/src/app.module.ts`

**Interfaces:**
- Consumes Tasks 4–5 service/asset APIs.
- Produces exact HTTP API consumed by frontend Task 7.

- [ ] **Step 1: Write RED route, guard, header and body tests**

Expected route contract:

```text
GET    /api/v1/admin/storefront-shell
PATCH  /api/v1/admin/storefront-shell
POST   /api/v1/admin/storefront-shell/validate
POST   /api/v1/admin/storefront-shell/publish
POST   /api/v1/admin/storefront-shell/upload?slot=horizontal|square
GET    /api/v1/admin/storefront-shell/preview
GET    /api/v1/storefront/shell
```

Assert every admin route has JWT + `STOREFRONT_SHELL_MANAGE`; admin GET/validate/preview set `Cache-Control: private, no-store`; preview also sets `Referrer-Policy: no-referrer`; every successful admin payload includes `version` and `issues` (upload returns `{ version, issues, asset }`). Test missing/invalid slot, MIME, empty/oversized body, and unauthenticated/permission refusal.

For the public route, assert `publishedRevision`, no draft/audit/raw-storage fields, `Cache-Control: public, max-age=0, must-revalidate`, and a projection-derived weak ETag. Resolve revision 7 once, disable one linked entity without changing revision, resolve again, and prove the ETag changes with the projection hash so `If-None-Match` cannot resurrect the disabled link.

- [ ] **Step 2: Run RED controller tests**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell/admin/storefront-shell.controller.spec.ts \
  src/modules/storefront-shell/storefront/storefront-shell.controller.spec.ts
```

Expected: missing controller/module failures.

- [ ] **Step 3: Implement exact DTOs and controllers**

DTOs:

```ts
export const shellWriteSchema = z.object({
  expectedVersion: z.coerce.number().int().min(1),
  document: storefrontShellDocumentSchema,
});
export const shellPublishSchema = z.object({ expectedVersion: z.coerce.number().int().min(1) });
export const shellUploadQuerySchema = z.object({ slot: z.enum(["horizontal", "square"]) });
```

Admin controller uses `@CurrentUser() user: { userId: string }`, normalizes the request `Content-Type` without parameters and requires it to be one of `image/png`, `image/webp`, or `image/jpeg`, then calls `readRawBody(req, 5 * 1024 * 1024)` and maps slot to `HORIZONTAL|SQUARE`. That header is only an admission check; Task 5 detected bytes remain authoritative. Validate never writes. Upload returns the unchanged current document version, current issues, and the new server-owned asset record. Preview calls saved draft projection only.

Public controller canonical-stringifies the resolved public projection, computes SHA-256, and emits `W/"shell-<publishedRevision>-<first16hex>"`; it returns 304 only when the request validator equals that full revision+projection hash. It sets `Cache-Control: public, max-age=0, must-revalidate`. This means a live target status/slug change changes the validator even when `publishedRevision` does not. The controller catches no errors itself; service fallback owns resilience so programming errors remain visible in tests/logging while read failures return defaults inside `getPublic()`.

- [ ] **Step 4: Register the module without widening other modules**

`StorefrontShellModule` imports `AuthModule`, `UploadsModule`, and `SettingsModule`; provides service, resolver, validator and asset service; registers both controllers. Add only this module to `AppModule`.

- [ ] **Step 5: Run controllers plus full backend unit gate**

```bash
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/storefront-shell
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit --incremental false
pnpm --dir small-house-commerce/backend lint
```

Expected: all backend tests pass; default DB integration tests may skip only under their existing env guards; no new warnings.

- [ ] **Step 6: Conditional checkpoint**

No authorization: ledger. Authorized later: exact Task 6 files, commit `feat(shell): expose shell admin and storefront APIs`.

---

### Task 7: Add frontend contracts, API client and matching theme projection

**Files:**
- Create: `small-house-commerce/frontend/src/lib/storefront-shell-api.ts`
- Create: `small-house-commerce/frontend/src/lib/storefront-shell-api.spec.ts`
- Modify: Task 1 frontend contract/theme files and specs
- Modify: `small-house-commerce/frontend/src/lib/homepage-document.ts`
- Modify: `small-house-commerce/frontend/src/components/admin/homepage/LinkPicker.tsx`
- Modify: corresponding LinkPicker/Homepage specs

**Interfaces:**
- Consumes Task 6 response shapes.
- Produces `storefrontShellApi`, public/admin response types, `themeCssVariables`, and INTERNAL-capable LinkPicker used by Tasks 8–13.

- [ ] **Step 1: Write API RED tests**

Pin calls:

```ts
storefrontShellApi.get();
storefrontShellApi.save(document, expectedVersion);
storefrontShellApi.validate(document);
storefrontShellApi.publish(expectedVersion);
storefrontShellApi.upload(file, "horizontal" | "square");
storefrontShellApi.preview();
```

Assert URL encoding, JSON bodies, raw image `Content-Type`, access-token auth via existing admin fetch helper, 409 error payload preservation, and no retry of non-idempotent upload/publish. Parse every admin response through its exact schema and reject a fixture missing `version` or `issues`; upload must parse `{ version, issues, asset }`.

- [ ] **Step 2: Write INTERNAL LinkPicker RED tests**

Assert selection of “Internal path”, `/track-order` commit, invalid `//evil.test` inline error, language change preserving input, and old Product/Collection/Category/Landing/External behavior unchanged.

- [ ] **Step 3: Run RED tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/storefront-shell-api.spec.ts \
  src/components/admin/homepage/LinkPicker.spec.tsx \
  src/lib/homepage-document.spec.ts
```

- [ ] **Step 4: Implement API and exact public/admin types**

Public view model mirrors Task 4 without importing backend source:

```ts
export type ResolvedFooterView = {
  tagline: string;
  description: string;
  columns: Array<
    | { id: string; kind: "LINKS"; title: string; rows: Array<
        | { id: string; kind: "LINK"; label: string; href: string }
        | { id: string; kind: "TEXT"; text: string }
      > }
    | {
        id: string; kind: "CONTACT"; title: string;
        supportEmail: string; supportHours: string; codText: string;
        trackOrderLabel: string; trackOrderHref: string;
      }
  >;
  copyrightBrand: string;
};

export type PublicStorefrontShell = {
  publishedRevision: number;
  brand: {
    brandName: string;
    horizontalLogo: { id: string; url: string; width: number; height: number } | null;
    squareMark: { id: string; url: string; width: number; height: number } | null;
  };
  header: { items: Array<
    | { id: string; kind: "CATEGORY_ROOT"; categoryId: string; label: string }
    | { id: string; kind: "LINK"; label: string; href: string }
  > };
  footer: ResolvedFooterView;
  theme: StorefrontThemeSource;
  derivedTheme: DerivedStorefrontTheme;
};
```

Admin API types are not widened ad hoc:

```ts
export type AdminShellValidationResult = {
  version: number;
  issues: ShellIssue[];
  derivedTheme: DerivedStorefrontTheme;
};
export type AdminShellUploadResult = {
  version: number;
  issues: ShellIssue[];
  asset: AdminShellAsset;
};
export type AdminShellPreviewResult = {
  version: number;
  issues: ShellIssue[];
  shell: PublicStorefrontShell;
};
```

GET/save/publish use Task 4 `AdminShellSnapshot`. Use existing `apiFetch`/auth conventions rather than a second token store.

- [ ] **Step 5: Implement `themeCssVariables()` and cross-check backend validate**

Map only fixed keys:

```ts
{
  "--color-primary": source.primary,
  "--color-primary-dark": derived.primaryDark,
  "--color-primary-light": derived.primaryLight,
  "--color-background": source.background,
  "--color-card": source.surface,
  "--color-ink": source.text,
  "--color-ink-secondary": derived.textSecondary,
  "--color-ink-muted": derived.textMuted,
  "--color-cta": source.action,
  "--color-cta-hover": derived.actionHover,
  "--color-border": derived.border,
  "--color-focus": derived.focus,
  "--color-disabled": derived.disabled,
  "--color-cta-foreground": derived.actionForeground,
}
```

Serializer accepts a selector and emits only these validated values plus fixed font-stack strings. Test that `</style>` or unknown keys cannot enter output.

- [ ] **Step 6: Run GREEN and scoped checks**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/storefront-shell-api.spec.ts src/lib/storefront-theme.spec.ts \
  src/components/admin/homepage/LinkPicker.spec.tsx src/lib/homepage-document.spec.ts
pnpm --dir small-house-commerce/frontend exec tsc --noEmit --incremental false
pnpm --dir small-house-commerce/frontend exec eslint \
  src/lib/storefront-shell-api.ts src/lib/storefront-theme.ts \
  src/components/admin/homepage/LinkPicker.tsx
```

- [ ] **Step 7: Conditional checkpoint**

No authorization: ledger. Authorized later: Task 7 files, commit `feat(shell): add shell client contracts`.

---

### Task 8: Make Header, MainNav, Footer and BrandWordmark data-driven and preview-safe

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/nav.ts`
- Modify: `small-house-commerce/frontend/src/lib/nav.spec.ts` or create it if absent
- Modify: `small-house-commerce/frontend/src/components/layout/BrandWordmark.tsx`
- Create/Modify: `small-house-commerce/frontend/src/components/layout/BrandWordmark.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/layout/BrandAssetImage.tsx`
- Create: `small-house-commerce/frontend/src/components/layout/BrandAssetImage.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/layout/Header.tsx`
- Create/Modify: `small-house-commerce/frontend/src/components/layout/Header.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/layout/MainNav.tsx`
- Create/Modify: `small-house-commerce/frontend/src/components/layout/MainNav.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/layout/Footer.tsx`
- Create/Modify: `small-house-commerce/frontend/src/components/layout/Footer.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/layout/StorefrontShellPresentation.tsx`
- Create: `small-house-commerce/frontend/src/components/layout/StorefrontShellPresentation.spec.tsx`

**Interfaces:**
- Consumes Task 7 public view model.
- Produces shared live/inert presentation consumed by storefront layout and admin preview.

- [ ] **Step 1: Write RED rendering and inertness tests**

Assert:

- configured Header order wins over hard-coded order;
- CATEGORY_ROOT uses current root children/image and label override without mutating category name;
- missing target is absent while neighbors remain;
- `buildNav(roots, collections, null)` exactly matches current legacy output;
- desktop renders horizontal Logo, mobile renders square mark, both fall back to current generated LUWAG markup;
- firing `error` on an uploaded horizontal or square `<img>` removes the broken image and renders the correct generated fallback without collapsing layout;
- Header desktop/mobile duplicate marks have empty alt under one `${brandName} home` link name, Footer exposes one brand-name image, and splash remains decorative;
- Footer renders brand copy, ordered LINKS and CONTACT columns, text rows, resolved links and dynamic current year;
- `mode="preview"` renders no navigable anchors for shell content, does not mount AccountEntry/CartBadge portals, and does not call router/tracking APIs;
- `StorefrontShellPresentation` supplies the same Header/content-slot/Footer order and landmark structure in live and preview modes;
- `mode="live"` preserves existing desktop hover, keyboard, Escape, outside-click, mobile drawer and focus-trap behavior.

- [ ] **Step 2: Run RED tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/nav.spec.ts \
  src/components/layout/BrandWordmark.spec.tsx \
  src/components/layout/BrandAssetImage.spec.tsx \
  src/components/layout/Header.spec.tsx \
  src/components/layout/MainNav.spec.tsx \
  src/components/layout/Footer.spec.tsx \
  src/components/layout/StorefrontShellPresentation.spec.tsx
```

- [ ] **Step 3: Extend Nav types without mutating live entities**

```ts
export interface NavTree {
  kind: "tree";
  root: Category;
  label: string;
  position: number;
}
```

`buildNav(roots, collections, configuredItems?)` maps configured CATEGORY_ROOT by id, maps resolved links directly, and returns legacy `FLAT_LINKS + roots` only when config is null/fallback.

- [ ] **Step 4: Implement asset-aware BrandWordmark**

Props:

```ts
type BrandWordmarkProps = {
  brand?: PublicStorefrontShell["brand"];
  variant?: "horizontal" | "square";
  decorative?: boolean;
  className?: string;
};
```

Uploaded assets render through a tiny client `BrandAssetImage` with known dimensions, `object-contain`, and `alt={decorative ? "" : brand.brandName}`. `BrandAssetImage` resets its failed state when `src` changes and renders its supplied generated fallback after `onError`; no component attempts repeated refetch loops. Header home links expose `${brandName} home` on the link and mark nested desktop/mobile images decorative; the Footer exposes one non-decorative brand name; splash remains decorative. Current inline SVG/Poppins wordmark remains the exact fallback. Footer and desktop Header request horizontal; mobile Header requests square.

- [ ] **Step 5: Add explicit live/preview mode to shell components**

`Header` and `Footer` accept `mode: "live" | "preview"`. MainNav preview uses spans/disabled buttons and never portals. Header preview renders static search/account/cart glyphs. Footer preview renders spans in place of links. `StorefrontShellPresentation` is the only component that orders Header, the supplied `<main>` content slot, and Footer; both storefront layout and editor preview consume it with their live/inert adapters. Keep one outer layout/markup path; do not create a copied PreviewHeader/PreviewFooter implementation.

- [ ] **Step 6: Run GREEN and existing layout regressions**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/nav.spec.ts src/components/layout/BrandWordmark.spec.tsx \
  src/components/layout/Header.spec.tsx src/components/layout/MainNav.spec.tsx \
  src/components/layout/Footer.spec.tsx \
  src/components/layout/StorefrontShellPresentation.spec.tsx \
  src/app/'(storefront)'/layout.spec.tsx
```

Expected: all GREEN and existing shell behavior retained.

- [ ] **Step 7: Conditional checkpoint**

No authorization: ledger. Authorized later: Task 8 files, commit `refactor(storefront): render shell from published content`.

---

### Task 9: Wire public shell, theme, dynamic brand mark and Next 16 revalidation

**Files:**
- Create: `small-house-commerce/frontend/src/lib/default-brand-mark.ts`
- Create: `small-house-commerce/frontend/src/lib/storefront-shell.ts`
- Create: `small-house-commerce/frontend/src/lib/storefront-shell.spec.ts`
- Modify: `small-house-commerce/frontend/src/app/(storefront)/layout.tsx`
- Modify: `small-house-commerce/frontend/src/app/(storefront)/layout.spec.tsx`
- Modify: `small-house-commerce/frontend/src/app/globals.css`
- Modify: `small-house-commerce/frontend/src/lib/fonts.ts`
- Modify: `small-house-commerce/frontend/src/app/layout.tsx`
- Create: `small-house-commerce/frontend/src/app/layout.spec.tsx`
- Create: `small-house-commerce/frontend/src/app/brand-mark/route.ts`
- Create: `small-house-commerce/frontend/src/app/brand-mark/route.spec.ts`
- Delete after tests: `small-house-commerce/frontend/src/app/icon.svg`
- Modify: `small-house-commerce/frontend/src/components/layout/BootSplash.tsx`
- Modify: BootSplash specs
- Modify: `small-house-commerce/frontend/src/app/api/internal/revalidate/route.ts`
- Modify: `small-house-commerce/frontend/src/app/api/internal/revalidate/route.spec.ts`

**Interfaces:**
- Consumes Task 7 API/theme and Task 8 shared rendering.
- Produces production storefront integration and stable `/brand-mark` behavior.

- [ ] **Step 1: Write RED fetch/layout/theme tests**

Assert:

- categories, collections, settings, announcement and shell load in parallel;
- shell API failure uses exact current legacy nav/Footer/theme;
- public shell supplies Header/Footer and a `<style id="storefront-theme-tokens">` with only known variables;
- `.storefront-app` applies body and zero-specificity heading font tokens while explicit section font utilities still win;
- `poppins` exposes `variable: "--font-poppins"` and the synchronous RootLayout body carries `poppins.variable`, so the heading preset can reference the self-hosted face without remote requests;
- custom brand colors do not rewrite fixed danger, warning, success, sale-price or star-rating tokens;
- all fixed overlays inherit root theme variables;
- admin route rendering has no storefront token style;
- RootLayout remains a synchronous function (not `AsyncFunction`).

- [ ] **Step 2: Write RED `/brand-mark` and cache tests**

Cases use real `NextRequest`/`Response` objects and explicit bytes:

```ts
it("proxies the published square PNG with an asset ETag", async () => {
  vi.mocked(fetchStorefrontShell).mockResolvedValue(shellWithSquare({
    revision: 7, id: "018f0000-0000-7000-8000-000000000001", url: "https://cdn.example/mark.png",
  }));
  vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200, headers: { "content-type": "image/png", "content-length": "4" },
  }));
  const response = await GET(new NextRequest("http://localhost/brand-mark"));
  expect(response.headers.get("etag")).toBe('"shell-r7-asset-018f0000-0000-7000-8000-000000000001"');
  expect(response.headers.get("content-type")).toBe("image/png");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
});

it("returns 304 only after selecting the same successful payload and ETag", async () => {
  vi.mocked(fetchStorefrontShell).mockResolvedValue(shellWithSquare({ revision: 7, id: IDS.square, url: CDN_MARK }));
  vi.mocked(fetch).mockResolvedValue(pngResponse());
  const response = await GET(new NextRequest("http://localhost/brand-mark", {
    headers: { "if-none-match": `"shell-r7-asset-${IDS.square}"` },
  }));
  expect(response.status).toBe(304);
});

it.each(["network", "wrong-type", "oversized", "redirect"])(
  "returns built-in SVG with a default ETag for %s object failure",
  async (failure) => {
    arrangeFailedBrandObject(failure);
    const response = await GET(new NextRequest("http://localhost/brand-mark"));
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("etag")).toBe('"shell-r7-default"');
    expect(await response.text()).toBe(DEFAULT_BRAND_MARK_SVG);
  },
);

it("is explicitly request-time", () => {
  expect(dynamic).toBe("force-dynamic");
});

it("revalidates the tag, storefront layout and brand-mark route", async () => {
  await POST(authorizedRevalidationRequest(["storefront"]));
  expect(revalidateTag).toHaveBeenCalledWith("storefront", { expire: 0 });
  expect(revalidatePath).toHaveBeenCalledWith("/(storefront)", "layout");
  expect(revalidatePath).toHaveBeenCalledWith("/brand-mark");
});
```

The test file defines `shellWithSquare`, `pngResponse`, `arrangeFailedBrandObject`, `authorizedRevalidationRequest`, `IDS.square`, and `CDN_MARK` as fixed local fixtures; none performs network I/O.

Review Focus: publish revision N+1, call internal revalidation, then assert route no longer honors revision N ETag and returns N+1 bytes/fallback.

- [ ] **Step 3: Run RED tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/storefront-shell.spec.ts src/app/'(storefront)'/layout.spec.tsx \
  src/app/brand-mark/route.spec.ts src/app/api/internal/revalidate/route.spec.ts \
  src/components/layout/BootSplash.spec.tsx
```

- [ ] **Step 4: Implement resilient tagged shell fetch and storefront theme style**

`fetchStorefrontShell()` uses:

```ts
fetch(serverApiUrl("/api/v1/storefront/shell"), {
  next: { revalidate: 300, tags: STOREFRONT_TAGS },
});
```

It validates/coerces and returns `DEFAULT_PUBLIC_STOREFRONT_SHELL` on any failure. `StorefrontLayout` renders Task 8 `StorefrontShellPresentation`, emits a validated style targeting `:root`, and wraps visual children in `.storefront-app flex min-h-full flex-1 flex-col` so typography selectors do not affect admin.

Update `poppins` to include `variable: "--font-poppins"` and apply `poppins.variable` on the synchronous RootLayout body. The serializer maps `SYSTEM`, `POPPINS_HEADING`, `SERIF_HEADING`, and body `SYSTEM` to fixed source-code constants only. Use `:where(.storefront-app)` and `:where(.storefront-app) :where(h1,h2,h3,h4,h5,h6)` so explicit Tailwind font utilities have higher specificity.

- [ ] **Step 5: Implement request-time brand route and remove duplicate static icon**

`/brand-mark` exports `dynamic = "force-dynamic"` and:

1. reads shell with the storefront tag;
2. when a square asset exists, fetches its server-owned URL with `redirect: "error"` and a three-second abort signal;
3. accepts only an `ok` `image/png` response and reads at most 2 MiB through a bounded stream reader (a missing/lying `Content-Length` does not bypass the cap);
4. selects either the PNG payload with ETag `` `shell-r${revision}-asset-${assetId}` `` or the built-in SVG with ETag `` `shell-r${revision}-default` ``;
5. only after selecting the actual payload compares `If-None-Match` and may return 304, so a temporarily missing object can later recover under a different ETag;
6. returns PNG bytes or `DEFAULT_BRAND_MARK_SVG` with the matching content type;
7. always sets `Cache-Control: no-cache` and `X-Content-Type-Options: nosniff`.

A redirect, timeout, non-PNG content, non-OK status, or body over 2 MiB selects the SVG fallback; none propagates an error into page rendering.

Set root metadata `icons: { icon: "/brand-mark" }`. Only after the metadata/route test is GREEN, delete `app/icon.svg`; assert generated metadata has one icon declaration.

- [ ] **Step 6: Preserve synchronous splash protocol**

`BootSplash` renders `<img src="/brand-mark" alt="" />` and uses `var(--color-background)` / `var(--color-cta)` rather than hard-coded colors. Do not fetch inside RootLayout or BootSplash. Keep the 450 ms fast/slow threshold and all existing timing tests unchanged.

- [ ] **Step 7: Update Next 16 invalidation**

Internal route must call:

```ts
revalidateTag(CACHE_TAGS.STOREFRONT, { expire: 0 });
revalidatePath("/(storefront)", "layout");
revalidatePath("/brand-mark");
```

Retain existing LP invalidation behavior. Test all calls and reject unauthorized requests exactly as before.

- [ ] **Step 8: Run GREEN, full frontend type and isolated build**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/lib/storefront-shell.spec.ts src/app/'(storefront)'/layout.spec.tsx \
  src/app/brand-mark/route.spec.ts src/app/api/internal/revalidate/route.spec.ts \
  src/components/layout/BootSplash.spec.tsx
pnpm --dir small-house-commerce/frontend exec tsc --noEmit --incremental false
```

Build in the plan-owned runtime copy, never primary `.next`. Expected: `/brand-mark` is dynamic/request-time; RootLayout remains sync; all routes compile.

- [ ] **Step 9: Conditional checkpoint**

No authorization: ledger. Authorized later: Task 9 files, commit `feat(storefront): apply published shell and brand theme`.

---

### Task 10: Build editor state, status actions, route and permission-filtered navigation

**Files:**
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/storefront-shell/page.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/StorefrontShellEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/StorefrontShellEditor.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/StorefrontShellPublishBar.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/StorefrontShellPublishBar.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminShell.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminShell.spec.tsx`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Consumes Task 7 admin API.
- Produces controlled editor context/actions used by Tasks 11–13.

- [ ] **Step 1: Write RED editor lifecycle tests**

Cover:

- initial skeleton/error/retry;
- local edit marks unsaved;
- tab/device/language changes preserve document;
- initial `?tab=footer` selects Footer while a missing/invalid tab defaults to Header without changing document;
- save sends exact loaded version and adopts returned version;
- same-tick double save joins one request;
- publish disabled with unsaved input or pending upload;
- publish sends exact saved version and clears `hasUnpublishedChanges` only from server response;
- save/publish/validate network failures preserve every local field, order, asset ref and selected tab while showing a retryable error;
- 409 preserves local document and exposes explicit reload;
- leave-page warning only while unsaved;
- actor id/permission change clears old document immediately and late load/save/validate/upload results are ignored;
- read-only/unauthorized page never renders draft content.

Review Focus stale actor case must dispatch request A, change mocked admin, resolve A, and assert zero old content/locks in actor B.

- [ ] **Step 2: Write RED admin navigation tests**

Expected Website group:

```text
Homepage             PRODUCT_MANAGE
Header & Footer      STOREFRONT_SHELL_MANAGE
Site Settings        SYSTEM_SETTINGS_EDIT
```

The group renders if any child survives. A user holding only shell permission sees only Header & Footer; a PRODUCT_MANAGE user does not inherit it.

- [ ] **Step 3: Run RED tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/storefront-shell/StorefrontShellEditor.spec.tsx \
  src/components/admin/storefront-shell/StorefrontShellPublishBar.spec.tsx \
  src/components/admin/AdminShell.spec.tsx
```

- [ ] **Step 4: Implement a reducer-owned editor state**

State:

```ts
type ShellEditorState = {
  actorKey: string;
  load: "loading" | "ready" | "error";
  server: AdminShellSnapshot | null;
  document: StorefrontShellDocument | null;
  tab: "header" | "footer";
  device: "desktop" | "tablet" | "mobile";
  pendingUploads: Set<"horizontal" | "square">;
  saving: boolean;
  validating: boolean;
  publishing: boolean;
  conflict: { currentVersion?: number } | null;
  requestGeneration: {
    load: number;
    save: number;
    validate: number;
    publish: number;
    horizontalUpload: number;
    squareUpload: number;
  };
};
```

Derive `unsaved` by canonical document comparison; do not maintain an independently mutable dirty boolean. Initialize `tab` from `useSearchParams().get("tab") === "footer" ? "footer" : "header"` so the Site Settings handoff works. Every async completion carries actorKey, its own operation generation, and the initiating server version; ignore it when any of those no longer match. Per-operation counters prevent a validation request from accidentally invalidating an unrelated save or upload completion.

- [ ] **Step 5: Implement status bar and safe actions**

Save joins an in-flight promise; publish refuses unsaved or uploading state; restore defaults requires confirmation and changes local draft only. Debounce unsaved-document validation by 300 ms, increment requestGeneration for each run, and apply results only when actor/document generation still matches. Status copy distinguishes local unsaved, validating, saved draft, and pending publish.

- [ ] **Step 6: Add Website nav group and bilingual keys**

Add exact keys for page title, tabs, statuses, save/publish/reload, validation, Logo, theme, Header/Footer fields, issue messages, preview devices, migrated settings hint, and nav group/item. Keep dictionaries key-for-key.

- [ ] **Step 7: Run GREEN and scoped checks**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/storefront-shell/StorefrontShellEditor.spec.tsx \
  src/components/admin/storefront-shell/StorefrontShellPublishBar.spec.tsx \
  src/components/admin/AdminShell.spec.tsx
pnpm --dir small-house-commerce/frontend exec tsc --noEmit --incremental false
```

- [ ] **Step 8: Conditional checkpoint**

No authorization: ledger. Authorized later: Task 10 files, commit `feat(admin): add storefront shell workspace`.

---

### Task 11: Implement Header navigation authoring and bounded ordering

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/OrderedRows.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/OrderedRows.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/ShellLinkEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/ShellLinkEditor.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/HeaderContentEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/HeaderContentEditor.spec.tsx`

**Interfaces:**
- Consumes editor document dispatch and existing admin category/collection/product/landing APIs.
- Produces Header document edits with stable ids and no direct persistence.

- [ ] **Step 1: Write RED ordered-list tests**

Assert pointer drag, keyboard up/down, delete, enable/hide, stable ids, configurable absolute-list bound, focus retention, disabled destructive controls while a Logo upload is pending, and no mutation of controlled input. Keyboard actions announce the new position.

- [ ] **Step 2: Write RED Header editor tests**

Cover:

- add active root category and preserve its target id;
- reject a child category as CATEGORY_ROOT;
- add collection and structured link;
- label override does not rename backing entity;
- INTERNAL path uses Task 7 LinkPicker;
- unavailable target warning focuses the addressed row;
- zero enabled rows shows publish issue but remains saveable;
- reorder updates only array order;
- a ninth total row is allowed when at most eight are enabled, but enabling a ninth row is blocked with clear copy;
- total draft row 25 is blocked by the absolute safety bound;
- pending Logo upload disables delete, move, enable/hide and add actions that could orphan the returned asset association.

- [ ] **Step 3: Run RED tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/storefront-shell/OrderedRows.spec.tsx \
  src/components/admin/storefront-shell/ShellLinkEditor.spec.tsx \
  src/components/admin/storefront-shell/HeaderContentEditor.spec.tsx
```

- [ ] **Step 4: Implement `OrderedRows` on existing dnd-kit**

Props:

```ts
type RowControls = {
  moveUp: () => void;
  moveDown: () => void;
  remove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled: boolean;
  dragHandleProps: Record<string, unknown>;
};

type OrderedRowsProps<T extends { id: string }> = {
  items: readonly T[];
  maxItems: number;
  labelFor: (item: T) => string;
  onChange: (items: T[]) => void;
  renderItem: (item: T, index: number, controls: RowControls) => ReactNode;
};
```

Expose buttons for move up/down in addition to drag handle. Never use array index as key.

- [ ] **Step 5: Implement Header editor with explicit entity kinds**

Use current admin APIs to list active root categories and collections. Generate new row ids with `crypto.randomUUID()`. Store only ids, labels and structured links. Do not store names/slugs/images from picker responses as truth. Pass `maxItems={24}` to `OrderedRows`; separately derive `enabledCount` and refuse only the transition that would make it exceed eight. Feed editor-level `pendingUploads.size > 0` into every destructive/reorder control.

- [ ] **Step 6: Run GREEN and editor integration tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/storefront-shell/OrderedRows.spec.tsx \
  src/components/admin/storefront-shell/ShellLinkEditor.spec.tsx \
  src/components/admin/storefront-shell/HeaderContentEditor.spec.tsx \
  src/components/admin/storefront-shell/StorefrontShellEditor.spec.tsx
```

- [ ] **Step 7: Conditional checkpoint**

No authorization: ledger. Authorized later: Task 11 files, commit `feat(admin): edit storefront header navigation`.

---

### Task 12: Implement Footer content authoring and retire the duplicate contact writer

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/FooterContentEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/FooterContentEditor.spec.tsx`
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/settings/page.tsx`
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/settings/page.spec.tsx`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`

**Interfaces:**
- Consumes `OrderedRows`, ShellLinkEditor and editor dispatch.
- Produces valid brand copy, LINKS/CONTACT columns and compatibility navigation from old settings.

- [ ] **Step 1: Write RED Footer editor tests**

Cover:

- tagline 100, description 300, title 40, row 120 limits;
- add/remove/reorder up to four total columns and eight rows each;
- exactly one CONTACT column; it can move but not be duplicated or removed;
- LINKS rows switch between LINK and TEXT without leaking stale fields;
- support email validation, support hours, COD text, Track Order label/link;
- copyright brand text with year absent from stored document;
- unavailable link issue focuses correct row;
- pending Logo upload disables column/row add, delete, kind-switch and reorder actions;
- narrow viewport fieldsets do not overflow.

- [ ] **Step 2: Write RED Site Settings migration tests**

Assert the page no longer renders writable support email/hours or validates them as part of the Site Settings submission, displays current published values read-only, links to `/admin/storefront-shell?tab=footer`, and still edits Messenger/Newsletter without sending support fields.

- [ ] **Step 3: Run RED tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/storefront-shell/FooterContentEditor.spec.tsx \
  src/app/admin/'(shell)'/settings/page.spec.tsx
```

- [ ] **Step 4: Implement bounded Footer controls**

Use discriminated column UIs; do not implement a free canvas. CONTACT edits the dedicated fields and Track Order structured link. LINKS uses `OrderedRows` for rows. Show character counters near limits and server issue anchors by stable id. Pass the shared pending-upload lock into every add/delete/kind-switch/reorder control.

- [ ] **Step 5: Convert Site Settings contact controls to read-only handoff**

Keep load response compatibility. Submit payload contains only Messenger and Newsletter fields accepted by Task 4 backend schema. Add a clear Header & Footer deep link; do not silently redirect users who are editing Newsletter settings.

- [ ] **Step 6: Run GREEN plus settings/backend compatibility tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/storefront-shell/FooterContentEditor.spec.tsx \
  src/app/admin/'(shell)'/settings/page.spec.tsx
pnpm --dir small-house-commerce/backend exec vitest run \
  src/modules/settings/settings.service.spec.ts \
  src/modules/storefront-shell/storefront-shell.service.spec.ts
```

- [ ] **Step 7: Conditional checkpoint**

No authorization: ledger. Authorized later: Task 12 files, commit `feat(admin): edit storefront footer content`.

---

### Task 13: Add Logo/theme controls, inert device preview and saved-draft preview

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/BrandAssetField.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/BrandAssetField.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/BrandThemeEditor.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/BrandThemeEditor.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/StorefrontShellPreview.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/StorefrontShellPreview.spec.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/SavedStorefrontShellPreview.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/storefront-shell/SavedStorefrontShellPreview.spec.tsx`
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/storefront-shell/preview/page.tsx`
- Modify: `StorefrontShellEditor.tsx` and its spec

**Interfaces:**
- Consumes Tasks 7–10 API, theme, rendering and editor state.
- Completes the admin workspace.

- [ ] **Step 1: Write RED BrandAssetField lifecycle tests**

Cover:

- correct accept list `.png,.webp,.jpg,.jpeg`;
- horizontal/square calls correct slot;
- pending callback fires synchronously before request and always clears on success/failure/unmount;
- failed upload preserves the current document and selected filename with an explicit retry action;
- server-detected dimensions/MIME are displayed;
- replacement changes only local asset id;
- remove sets asset ref null but does not issue DELETE;
- late upload after actor/version/request-generation change is ignored;
- save, publish, defaults restore, Header row deletion/reorder/enable, and Footer column/row deletion/reorder/kind-switch remain locked while either slot uploads.

- [ ] **Step 2: Write RED theme editor and boundary tests**

Assert five color controls, fixed heading/body enums, current LUWAG reset, live derived swatches, exact issue codes, and `/validate` round-trip equality:

```ts
expect(server.derivedTheme).toEqual(deriveStorefrontTheme(localDocument.theme));
expect(server.issues.map(i => i.code)).toEqual(themePublicationIssues(localDocument.theme).map(i => i.code));
```

Include a fixture whose text/background contrast is just below 4.5 and one just above; both frontend and mocked server expectations must agree.

- [ ] **Step 3: Write RED preview tests**

Assert device width 1200/768/390, local unsaved updates, shared Header/Footer presentation, square mobile Logo, horizontal desktop/Footer Logo, inert links/actions, no Providers/customer/cart/tracking calls, vertical scrolling, and no root horizontal overflow.

Saved-preview page tests assert noindex metadata, private/no-store data request, server-saved draft rather than editor local state, and no reusable token.

- [ ] **Step 4: Run RED tests**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/storefront-shell/BrandAssetField.spec.tsx \
  src/components/admin/storefront-shell/BrandThemeEditor.spec.tsx \
  src/components/admin/storefront-shell/StorefrontShellPreview.spec.tsx \
  src/components/admin/storefront-shell/SavedStorefrontShellPreview.spec.tsx \
  src/components/admin/storefront-shell/StorefrontShellEditor.spec.tsx
```

- [ ] **Step 5: Implement Logo fields and upload lifecycle**

Use raw `File` bytes through Task 7 API. Parent owns pending slots; field owns input value, selected filename, retry error, preview object URL and request generation. Revoke object URLs on replacement/unmount; clear the native input only after success or explicit remove, not after failure. Display published/current fallback separately from draft selection so remove is unambiguous.

- [ ] **Step 6: Implement theme controls and contrast panel**

Use native color input plus validated text input tied to one controlled value. Render each contrast ratio and stable pass/fail label. Do not modify chosen source colors automatically. Heading choices are exactly `SYSTEM`, `POPPINS_HEADING`, and `SERIF_HEADING`; the initial body enum is exactly `SYSTEM` and is still serialized/displayed as the fixed body preset so future schema versions can add choices without changing v1 meaning.

- [ ] **Step 7: Implement shared inert preview and saved-draft page**

Preview supplies `mode="preview"` to Task 8 components, applies `themeCssVariables()` to its isolated canvas, and uses a neutral placeholder body between Header/Footer. Device buttons change fixed canvas width, not browser viewport CSS hacks.

`SavedStorefrontShellPreview` waits for admin auth hydration, calls `storefrontShellApi.preview()`, verifies the returned `version/issues/shell`, and renders the same preview at full available height with explicit loading/error/retry states. The server page at `app/admin/(shell)/storefront-shell/preview/page.tsx` exports `robots: { index: false, follow: false }`; the backend request remains authenticated and private/no-store. No query token or reusable draft credential is accepted.

- [ ] **Step 8: Run GREEN and full editor suite**

```bash
pnpm --dir small-house-commerce/frontend exec vitest run \
  src/components/admin/storefront-shell \
  src/app/admin/'(shell)'/settings/page.spec.tsx \
  src/components/admin/AdminShell.spec.tsx
pnpm --dir small-house-commerce/frontend exec tsc --noEmit --incremental false
pnpm --dir small-house-commerce/frontend lint
```

Expected: all targeted tests GREEN; no new act/src/navigation warnings from these files.

- [ ] **Step 9: Conditional checkpoint**

No authorization: ledger. Authorized later: Task 13 files, commit `feat(admin): preview and publish storefront branding`.

---

### Task 14: Dedicated-database, full-suite and real-browser closure

**Files:**
- Create: plan-workspace-only browser scripts/logs/screenshots under `.superpowers/sdd/2026-10-12-storefront-shell-brand-editor/` (gitignored)
- Create: `small-house-commerce/frontend/e2e/storefront-shell.spec.ts`
- Create: `small-house-commerce/frontend/e2e/storefront-shell-prepare.ts`
- Modify product code only through new RED→GREEN findings; no opportunistic cleanup

**Interfaces:**
- Consumes the complete implementation.
- Produces release evidence, final scoped manifest and review package; no deployment.

- [ ] **Step 1: Freeze a scoped manifest and verify no concurrent overwrite**

Generate a manifest of every file listed in this plan with pre-test hashes. Compare current mtimes/diffs to task ledgers; re-read any shared file changed since its task. Run:

```bash
git diff --check -- \
  small-house-commerce/backend/src/modules/storefront-shell \
  small-house-commerce/backend/src/modules/uploads \
  small-house-commerce/backend/src/modules/settings \
  small-house-commerce/backend/src/config \
  small-house-commerce/backend/src/app.module.ts \
  small-house-commerce/backend/prisma/schema/settings.prisma \
  small-house-commerce/backend/prisma/schema/identity.prisma \
  small-house-commerce/backend/prisma/rbac.ts \
  small-house-commerce/backend/prisma/rbac.spec.ts \
  small-house-commerce/backend/prisma/storefront-shell-schema.spec.ts \
  small-house-commerce/backend/prisma/storefront-shell-migration.integration.spec.ts \
  small-house-commerce/backend/prisma/migrations/20261014200000_add_storefront_shell \
  small-house-commerce/backend/package.json small-house-commerce/backend/pnpm-lock.yaml \
  small-house-commerce/frontend/src/lib \
  small-house-commerce/frontend/src/components/layout \
  small-house-commerce/frontend/src/components/admin/storefront-shell \
  small-house-commerce/frontend/src/components/admin/AdminShell.tsx \
  small-house-commerce/frontend/src/app/'(storefront)'/layout.tsx \
  small-house-commerce/frontend/src/app/layout.tsx \
  small-house-commerce/frontend/src/app/globals.css \
  small-house-commerce/frontend/src/app/brand-mark \
  small-house-commerce/frontend/src/app/api/internal/revalidate \
  small-house-commerce/frontend/src/app/admin/'(shell)'/storefront-shell \
  small-house-commerce/frontend/src/app/admin/'(shell)'/settings/page.tsx \
  small-house-commerce/frontend/src/i18n \
  small-house-commerce/frontend/e2e/storefront-shell.spec.ts \
  small-house-commerce/frontend/e2e/storefront-shell-prepare.ts \
  small-house-commerce/frontend/package.json small-house-commerce/frontend/pnpm-lock.yaml \
  small-house-commerce/contracts/storefront-theme-fixtures.json \
  small-house-commerce/docs/superpowers/specs/2026-10-12-storefront-shell-brand-editor-design.md \
  small-house-commerce/docs/superpowers/plans/2026-10-12-storefront-shell-brand-editor.md
```

Expected: no whitespace errors and no unexplained concurrent hunks.

- [ ] **Step 2: Run complete backend/frontend gates**

```bash
pnpm --dir small-house-commerce/backend test
pnpm --dir small-house-commerce/frontend test
pnpm --dir small-house-commerce/backend exec tsc --noEmit --incremental false
pnpm --dir small-house-commerce/frontend exec tsc --noEmit --incremental false
pnpm --dir small-house-commerce/backend lint
pnpm --dir small-house-commerce/frontend lint
pnpm --dir small-house-commerce/backend build
```

Build frontend only in a plan-owned runtime copy so the shared primary `.next` is untouched. Report every warning by file; do not call the tree green if any test/type/build fails.

- [ ] **Step 3: Run migration validation/diff and PostgreSQL suites**

Against `small_house_marketing_dev` only:

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public' \
  pnpm --dir small-house-commerce/backend exec prisma migrate status
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public' \
  pnpm --dir small-house-commerce/backend exec vitest run \
  prisma/storefront-shell-migration.integration.spec.ts \
  src/modules/storefront-shell/storefront-shell.integration.spec.ts
```

Generate a Prisma schema↔database diff and require zero unexpected drift. Re-check unrelated table hashes from Task 3.

- [ ] **Step 4: Build and start owned runtime**

Use runtime copies under this plan workspace, backend `127.0.0.1:3230`, frontend `127.0.0.1:3231`, unique JWT/revalidation secret, isolated upload directory, and the dedicated DB. Confirm ports are free before launch. Run backend `prisma generate` before backend build, per deployment gate.

Do not start/stop any other port or process.

- [ ] **Step 5: Seed reversible browser fixtures through application/Prisma setup**

Create:

- one SUPER_ADMIN with `STOREFRONT_SHELL_MANAGE`;
- one ADMIN without it;
- active root categories and collections;
- active product and published landing page link targets;
- real horizontal PNG and near-square WebP files generated outside upload directories;
- a complete snapshot of original shell/settings rows for restoration.

Never print access tokens; normal form login only.

- [ ] **Step 6: Run real browser draft/publish/permission workflow**

Prove:

1. SUPER_ADMIN sees Website → Header & Footer; ADMIN does not.
2. Local Header/Footer/theme edits and real uploads update only inert preview.
3. Public Homepage/PDP remain byte/DOM-equivalent before save and after save.
4. Pending upload locks save/publish/restore and resolves cleanly.
5. Save draft does not change public revision or favicon.
6. Saved-draft preview shows server draft, noindex/no-store, and emits zero customer/tracking writes.
7. A second client saves first; stale client gets 409 and keeps all local text, ordering, Logo refs and colors.
8. Contrast-invalid draft saves but cannot publish with exact issue focus.
9. Valid publish atomically changes Header, Footer, horizontal desktop Logo, square mobile Logo, theme and `/brand-mark` ETag.
10. Disable/delete one linked fixture target after publish; next public read omits only it.
11. Homepage, category, collection, search, PDP, marketing LP, cart, checkout, login/account and track-order all share revision/theme.
12. Desktop Mega Menu and mobile drawer remain interactive in live mode.
13. Preview controls remain inert and produce zero cart/auth/marketing/order mutations.
14. 390/768/1440 have no root horizontal overflow or clipped editor fields.
15. Browser console/page errors are zero.

Run the permanent focused gate against the owned runtime:

```bash
E2E_BACKEND_PORT=3230 E2E_FRONTEND_PORT=3231 \
  pnpm --dir small-house-commerce/frontend exec playwright test \
  e2e/storefront-shell.spec.ts --workers=1
```

Expected: all storefront-shell projects/cases pass; the prepare helper restores fixtures in teardown even when one assertion fails.

- [ ] **Step 7: Verify splash/fallback/cache edge cases**

Throttle network so the splash crosses the existing threshold. Verify the published square mark appears without making RootLayout async; fast navigation still has no flash. Stop backend temporarily only within the owned runtime, request `/brand-mark`, and assert built-in SVG fallback plus working storefront fallback. Restart only owned backend, publish revision N+1, invalidate, and assert old ETag N no longer yields 304.

- [ ] **Step 8: Restore reversible fixtures and inspect screenshots**

Restore original singleton/settings rows and remove only this plan's fixture entities/assets where no published revision references them. Do not delete append-only asset records that the original/restored shell references. Visually inspect at least:

- desktop editor Header tab;
- mobile editor/Footer tab;
- desktop live Header/Footer;
- mobile live Header/Footer;
- invalid contrast issue state;
- slow-load splash.

- [ ] **Step 9: Fresh whole-increment review and one fix pass**

Build the review package from the scoped manifest, spec, plan, ledger rulings, tests, browser evidence and Review Focus. Because the standing instruction forbids Agent use unless explicitly requested, perform a separate author self-review unless the user explicitly authorizes a reviewer agent. State that limitation.

Re-grade findings by user effect. Fix every Critical/Important finding in one TDD pass: reproduce RED, minimal GREEN, rerun full suites. Ledger Minor findings without opportunistic fixes.

- [ ] **Step 10: Stop owned services and hand off without release actions**

Stop only `3230/3231`. Preserve plan workspace evidence and local DB unless the user explicitly requests cleanup. Report:

- exact test/build/browser counts;
- migration/hash evidence;
- review rulings and deferred minors;
- current dirty/shared-tree packaging risk;
- persistent production media-storage readiness;
- that no commit/push/production migration/deploy occurred.

Do not invoke branch merge/push/deploy flow until separately authorized.

---

## Execution Notes

- Recommended execution mode is **Native / superpowers:executing-plans**: the 14 tasks have tightly coupled contracts and this harness is explicitly instructed not to dispatch agents unless the user requests them. TDD, the persisted ledger, scoped manifest and final separate self-review provide the gates.
- If the user later explicitly asks for subagent-driven execution, use the same plan/ledger and do not replay completed tasks.
- Because the user explicitly waived an additional spec-review pause, planning can hand directly into the chosen execution method once execution itself is authorized.

## Reference Sources Consulted

- Installed Next.js 16.3.4 docs: `frontend/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- Installed Next.js 16.3.4 docs: `frontend/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`
- Installed Next.js 16.3.4 docs: `frontend/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`
- Installed Next.js 16.3.4 docs: `frontend/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`
- Culori 4 API: `https://culorijs.org/api/`
- Culori migration/API stability notes: `https://culorijs.org/guides/migration/`
- Sharp package/runtime requirement: `https://www.npmjs.com/package/sharp`
