# 后台站点联系设置 + Messenger 客服激活（A 批）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让超级管理员在后台 `/admin/settings` 热改 Messenger 链接 / 客服邮箱 / 服务时间；前台据此激活全站浮动 Messenger 按钮（含 45 秒闲置气泡）、checkout "Need help?"，并消灭三处硬编码联系方式。

**Architecture:** 后端新增单例 `site_settings` 表（固定 UUID 行，迁移内置默认行）+ `modules/settings/` 模块（公开只读 + 管理端 GET/PATCH，PATCH 后打 `storefront` ISR 失效）。前台 server 端 fetch 后经 React context 下发给 client 组件；server 组件（Footer、PdpInfoSections）走 props；PdpView 自己调 `fetchSiteSettings()`（请求内 fetch 去重）。

**Tech Stack:** NestJS（ESM `.js` 后缀、Zod 4 校验管道、Prisma 7 拆分 schema）+ Next.js 16 App Router / React 19（client context、ISR tag）+ Tailwind tokens。零新依赖。

**Spec:** `docs/superpowers/specs/2026-09-16-site-contact-settings-design.md`（实现者必须同时阅读；冲突时以 spec 为准）

## Global Constraints

- **零新 npm 依赖**：`package.json` / lockfile 零 diff。不引入任何 SDK/图标库/聊天插件。
- **不新增任何 eslint-disable 种类**；现有 `@next/next/no-img-element` 豁免与本批无关，不新增同类豁免。
- 不新增任何 Meta Pixel 事件；不改冻结的 COD/配送文案；新前台英文串仅限：`Have questions?`、`Chat now`、`Dismiss`、`Need help?`、`Chat on Messenger`。后台 chrome 用中文。
- 价格只处理 PHP（本批不涉及价格）。Tailwind 仅用 design tokens（`cta / cta-hover / ink / ink-secondary / ink-muted / border / card / background / primary-light`）。
- 提交只在 `feat/site-contact-settings` 分支；**显式路径 `git add <path>`，严禁 `git add -A` / `.`**；不 merge、不 push、不部署。
- 端口纪律：不碰 3000（用户后端）、3001（用户前端）、3002（线 A）、3100；线 B 前端用 `PORT=3003 npm run dev`（在 `frontend/` 目录）。
- 数据库：共享 localhost:5432/small_house。**严禁 `prisma migrate reset`；只允许纯新增表的 additive 迁移**。遇 drift/reset 提示立即 STOP 上报。
- 不留测试数据：浏览器验收结束后后台三个字段必须恢复为默认值（messenger 留空、`support@luwag.ph`、`Mon–Sat, 9am–6pm (PHT)`）。
- `frontend/src/lib/api.ts` 完全不碰；storefront 设置类型放新文件 `lib/site-settings.ts`；管理端类型/方法进 `lib/admin-api.ts`。
- 门禁（每个任务结束都必须绿）：
  - 后端：`cd backend && pnpm build`
  - 前端：`cd frontend && npx tsc --noEmit && npx eslint src && npm run build`
- Next 16 环境注意：仓库 `frontend/AGENTS.md` 要求写代码前查阅 `frontend/node_modules/next/dist/docs/` 内相关文档（如对 App Router 数据获取/缓存 API 有疑问先查）。StrictMode 开着：所有监听类 effect 的 setup/cleanup 必须对称，ref 类标志必须在 setup 中重新置位（教训见 quick-add 修复 f9ad401）。

## 协调闸（控制器职责，实现者会在任务简报中收到放行通知）

1. **T1 迁移前**：控制器向并行线 A（feat/home-pdp）串行通报并确认其无进行中的迁移，才允许跑 `prisma migrate dev`。
2. **T3/T4/T6 共享文件编辑前**：`(storefront)/layout.tsx`、`Footer.tsx`、`PdpClient.tsx`、`PdpInfoSections.tsx`、`PdpView.tsx`、`AdminShell.tsx` 属共享文件，控制器确认线 A 热点工作已提交（现状：0f44208 已落地、工作区干净）后放行；编辑均为取值替换/纯增量，不改结构。

---

## File Structure

**后端（新建）**
- `backend/prisma/schema/settings.prisma` — SiteSetting 模型（单例）
- `backend/prisma/migrations/<ts>_add_site_settings/migration.sql` — 建表 + 插入默认行
- `backend/src/modules/settings/settings.module.ts`
- `backend/src/modules/settings/settings.service.ts` — 固定 UUID 单例 get-or-create / PATCH + ISR 失效
- `backend/src/modules/settings/dto/settings.dto.ts` — Zod 规则
- `backend/src/modules/settings/storefront/settings.controller.ts` — 公开 GET
- `backend/src/modules/settings/admin/settings.controller.ts` — 管理端 GET/PATCH

**后端（修改）**
- `backend/src/app.module.ts` — 注册 SettingsModule（2 处）

**前台（新建）**
- `frontend/src/lib/site-settings.ts` — 类型、默认值、`fetchSiteSettings()`（server）
- `frontend/src/components/site/SiteSettingsProvider.tsx` — context + hook（client）
- `frontend/src/app/admin/(shell)/settings/page.tsx` — 后台设置页

**前台（修改）**
- `frontend/src/components/auth/Providers.tsx` — 包一层 SiteSettingsProvider
- `frontend/src/app/(storefront)/layout.tsx` — Promise.all 加设置 fetch，传 settings
- `frontend/src/components/layout/Footer.tsx` — 联系信息改 props
- `frontend/src/components/chat/MessengerChat.tsx` — 换数据源 + 闲置气泡
- `frontend/src/components/checkout/CheckoutForm.tsx` — 标题行 Need help?
- `frontend/src/components/product/PdpClient.tsx` — 删硬编码，用 hook
- `frontend/src/components/product/PdpInfoSections.tsx` — 删硬编码，用 props
- `frontend/src/components/product/PdpView.tsx` — 改 async，取 settings 后下发
- `frontend/src/components/admin/AdminShell.tsx` — 导航加「站点设置」
- `frontend/src/lib/admin-api.ts` — 类型 + getSettings/updateSettings
- 删除 `frontend/src/lib/siteConfig.ts`（MessengerChat 是唯一引用方）

---

## Task 1: Prisma 模型 + site_settings 迁移（含默认行）

**Files:**
- Create: `backend/prisma/schema/settings.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_site_settings/migration.sql`（prisma 生成后手工补 INSERT）

**Interfaces:**
- Produces: Prisma client delegate `prisma.siteSetting`（模型 `SiteSetting`，列 camelCase / 表与列 snake-case 映射），单例 ID 常量在 T2 service 中定义为 `"00000000-0000-0000-0000-000000000001"`。

> 前置：控制器已完成与线 A 的迁移串行确认。未收到放行不得执行本任务。

- [ ] **Step 1: 新建 schema 文件**

创建 `backend/prisma/schema/settings.prisma`，内容完整如下（与 spec §3.1 一致；不要给 id 加 `@default`，行由迁移/upsert 显式插入固定 UUID）：

```prisma
// Site-wide singleton settings (contact/support configuration).
// Exactly one row exists, with the fixed id below; the migration seeds it.
model SiteSetting {
  id           String   @id @map("id") @db.Uuid
  messengerUrl String   @default("") @map("messenger_url")
  supportEmail String   @default("support@luwag.ph") @map("support_email")
  supportHours String   @default("Mon–Sat, 9am–6pm (PHT)") @map("support_hours")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("site_settings")
}
```

- [ ] **Step 2: 生成迁移（先只生成不应用）**

在 `backend/` 目录执行：

```bash
pnpm exec prisma migrate dev --create-only --name add_site_settings
```

打开生成的 `backend/prisma/migrations/*_add_site_settings/migration.sql`，确认内容**只有**一条 CREATE TABLE，形态如下（生成器输出为准；列名/类型必须与此一致）：

```sql
-- CreateTable
CREATE TABLE "site_settings" (
    "id" UUID NOT NULL,
    "messenger_url" TEXT NOT NULL DEFAULT '',
    "support_email" TEXT NOT NULL DEFAULT 'support@luwag.ph',
    "support_hours" TEXT NOT NULL DEFAULT 'Mon–Sat, 9am–6pm (PHT)',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);
```

在文件末尾追加单例默认行的插入语句（迁移可重复执行的目录由 prisma 记录，正常只跑一次；不加 ON CONFLICT，保持与其他迁移一致的朴素风格）：

```sql

-- Seed the singleton row with the fixed id; the app reads/writes only this row.
INSERT INTO "site_settings" ("id", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

注意 `Mon–Sat` 中的 `–` 是 en dash（U+2013），照抄。

- [ ] **Step 3: 应用迁移（同时重新生成 client）**

```bash
pnpm exec prisma migrate dev
```

期望：迁移 applied、Prisma Client generated、无 drift 提示。若出现任何 reset/drift 提示，**立即停止并上报**，不要确认任何交互。

- [ ] **Step 4: 验证**

```bash
pnpm exec prisma migrate status
```

期望：`Database schema is up to date!`

```bash
printf 'SELECT id, messenger_url, support_email, support_hours FROM site_settings;' | pnpm exec prisma db execute --stdin
```

期望：无报错（表与列存在；db execute 不打印行数据，行内容在 T2 用接口验证）。

确认生成的 client 包含新模型：

```bash
grep -c "siteSetting" src/generated/prisma/client.js
```

期望：≥1（client.js 内含 delegate；具体实现可能在相邻生成文件中，`grep -rl "site_settings" src/generated/prisma | head` 也应有输出）。

- [ ] **Step 5: 提交**

```bash
git add backend/prisma/schema/settings.prisma
git add backend/prisma/migrations
git add backend/src/generated/prisma
git commit -m "feat(db): add site_settings singleton table for contact configuration"
```

（`backend/src/generated/prisma` 是否被 git 跟踪以仓库现状为准：先 `git status --short backend/src/generated` 查看；若生成产物被 ignore 则不 add，不改变 ignore 规则。）

---

## Task 2: 后端 settings 模块（公开 GET + 管理端 GET/PATCH）

**Files:**
- Create: `backend/src/modules/settings/dto/settings.dto.ts`
- Create: `backend/src/modules/settings/settings.service.ts`
- Create: `backend/src/modules/settings/storefront/settings.controller.ts`
- Create: `backend/src/modules/settings/admin/settings.controller.ts`
- Create: `backend/src/modules/settings/settings.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces:
  - `GET /api/v1/storefront/settings` → `{ messengerUrl: string; supportEmail: string; supportHours: string }`（匿名可读）
  - `GET /api/v1/admin/settings` → 完整行（含 id/createdAt/updatedAt），需 SYSTEM_SETTINGS_EDIT
  - `PATCH /api/v1/admin/settings`，body `{ messengerUrl, supportEmail, supportHours }`（均 string；服务端 trim），返回完整行；成功后 best-effort revalidate tag `storefront`

- [ ] **Step 1: DTO（Zod 规则与 spec §3.2 一致）**

创建 `backend/src/modules/settings/dto/settings.dto.ts`：

```ts
import { z } from 'zod';

/** Empty (feature hidden) or an absolute https:// URL, max 500 chars. */
const messengerUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      if (value === '') return true;
      if (!value.startsWith('https://')) return false;
      try {
        // Rejects malformed URLs; javascript:/http: are blocked by the prefix check.
        const url = new URL(value);
        return url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'messengerUrl must be empty or an absolute https:// URL' },
  );

export const updateSettingsSchema = z.object({
  messengerUrl: messengerUrlSchema,
  // Email is the guaranteed fallback channel, so it is required and non-empty.
  supportEmail: z.string().trim().min(1).email().max(200),
  supportHours: z.string().trim().min(1).max(100),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
```

- [ ] **Step 2: Service（单例 get-or-create + 更新后 revalidate）**

创建 `backend/src/modules/settings/settings.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import {
  CACHE_TAGS,
  revalidateCache,
} from '../../common/revalidation.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { UpdateSettingsInput } from './dto/settings.dto.js';

/**
 * The single settings row. Mirrors the INSERT baked into the
 * add_site_settings migration; the upsert is only a backstop for restores
 * that skipped the migration.
 */
export const SITE_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full row (admin form echo / internal backstop). */
  async getRow() {
    const existing = await this.prisma.siteSetting.findUnique({
      where: { id: SITE_SETTINGS_ID },
    });
    if (existing) return existing;
    return this.prisma.siteSetting.upsert({
      where: { id: SITE_SETTINGS_ID },
      create: { id: SITE_SETTINGS_ID },
      update: {},
    });
  }

  /** Public payload: only the three shopper-facing fields. */
  async getPublic() {
    const row = await this.getRow();
    return {
      messengerUrl: row.messengerUrl,
      supportEmail: row.supportEmail,
      supportHours: row.supportHours,
    };
  }

  async update(input: UpdateSettingsInput) {
    await this.prisma.siteSetting.upsert({
      where: { id: SITE_SETTINGS_ID },
      create: { id: SITE_SETTINGS_ID, ...input },
      update: input,
    });
    // Best-effort ISR refresh; never blocks/fails the mutation (see helper).
    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return this.getRow();
  }
}
```

- [ ] **Step 3: Storefront controller（无 guard）**

创建 `backend/src/modules/settings/storefront/settings.controller.ts`：

```ts
import { Controller, Get } from '@nestjs/common';
import { SettingsService } from '../settings.service.js';

/** Public site contact settings; consumed by every storefront page. */
@Controller('storefront/settings')
export class StorefrontSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getPublic();
  }
}
```

- [ ] **Step 4: Admin controller（类级 SYSTEM_SETTINGS_EDIT，house style 用 PATCH）**

创建 `backend/src/modules/settings/admin/settings.controller.ts`：

```ts
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { Permissions } from '../../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import {
  updateSettingsSchema,
  type UpdateSettingsInput,
} from '../dto/settings.dto.js';
import { SettingsService } from '../settings.service.js';

/**
 * Site contact settings. SYSTEM_SETTINGS_EDIT is granted to SUPER_ADMIN only
 * (ADMIN does not hold it) — same guard class as user administration.
 */
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getRow();
  }

  @Patch()
  update(
    @Body(new ZodValidationPipe(updateSettingsSchema))
    input: UpdateSettingsInput,
  ) {
    return this.settings.update(input);
  }
}
```

- [ ] **Step 5: Module**

创建 `backend/src/modules/settings/settings.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SettingsService } from './settings.service.js';
import { StorefrontSettingsController } from './storefront/settings.controller.js';
import { AdminSettingsController } from './admin/settings.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [StorefrontSettingsController, AdminSettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
```

- [ ] **Step 6: 注册到 app.module.ts**

`backend/src/app.module.ts` 两处修改。

import 区（在 UploadsModule import 之后加一行）：

```ts
import { UploadsModule } from './modules/uploads/uploads.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
```

imports 数组（在 `UploadsModule,` 之后加 `SettingsModule,`）：

```ts
    CollectionsModule,
    UploadsModule,
    SettingsModule,
  ],
```

- [ ] **Step 7: 后端门禁**

```bash
cd backend && pnpm build
```

期望 0 error。

- [ ] **Step 8: 接口验证（用户的 3000 后端为 watch 模式；不要重启它）**

```bash
curl -s http://localhost:3000/api/v1/storefront/settings
```

期望（200，JSON）：

```json
{"messengerUrl":"","supportEmail":"support@luwag.ph","supportHours":"Mon–Sat, 9am–6pm (PHT)"}
```

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3000/api/v1/admin/settings \
  -H 'content-type: application/json' -d '{"messengerUrl":"","supportEmail":"a@b.co","supportHours":"x"}'
```

期望：`401`（或 403；无 token 必须被拒）。

若 3000 未热加载新路由（404），**不要重启进程**；在报告中说明，由控制器决定（浏览器验收阶段再确认）。

- [ ] **Step 9: 提交**

```bash
git add backend/src/modules/settings backend/src/app.module.ts
git commit -m "feat(settings): admin-editable site contact settings with public read endpoint"
```

---

## Task 3: 前台 settings 数据通路（lib + Provider + layout + Footer）

**Files:**
- Create: `frontend/src/lib/site-settings.ts`
- Create: `frontend/src/components/site/SiteSettingsProvider.tsx`
- Modify: `frontend/src/components/auth/Providers.tsx`
- Modify: `frontend/src/app/(storefront)/layout.tsx`
- Modify: `frontend/src/components/layout/Footer.tsx`

**Interfaces:**
- Produces:
  - `interface SiteSettings { messengerUrl: string; supportEmail: string; supportHours: string }`
  - `DEFAULT_SITE_SETTINGS: SiteSettings`
  - `fetchSiteSettings(): Promise<SiteSettings>`（**server-only 调用方**；永不抛错，失败回默认）
  - `<SiteSettingsProvider settings={SiteSettings}>` 与 `useSiteSettings(): SiteSettings`（client）
  - `Providers` 新增必传 prop `settings: SiteSettings`
  - `Footer` 新增必传 props `supportEmail: string`、`supportHours: string`

> 共享文件闸：layout/Footer 动刀前由控制器确认线 A 无冲突。

- [ ] **Step 1: 新建 lib**

创建 `frontend/src/lib/site-settings.ts`：

```ts
import { serverApiUrl } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

/** Shopper-facing contact configuration; mirrors storefront/settings payload. */
export interface SiteSettings {
  messengerUrl: string;
  supportEmail: string;
  supportHours: string;
}

/** Fallback values when the backend/settings endpoint is unavailable. */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  messengerUrl: "",
  supportEmail: "support@luwag.ph",
  supportHours: "Mon–Sat, 9am–6pm (PHT)",
};

function coerce(data: Partial<SiteSettings> | null): SiteSettings {
  return {
    messengerUrl: typeof data?.messengerUrl === "string" ? data.messengerUrl : DEFAULT_SITE_SETTINGS.messengerUrl,
    supportEmail: typeof data?.supportEmail === "string" ? data.supportEmail : DEFAULT_SITE_SETTINGS.supportEmail,
    supportHours: typeof data?.supportHours === "string" ? data.supportHours : DEFAULT_SITE_SETTINGS.supportHours,
  };
}

/**
 * Server-only fetch of the singleton site settings. Shares the single
 * `storefront` ISR tag (revalidated after admin saves). Never throws: a
 * settings outage must not blank the layout — callers get built-in defaults.
 */
export async function fetchSiteSettings(): Promise<SiteSettings> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/settings"), {
      next: { revalidate: 300, tags: STOREFRONT_TAGS },
    });
    if (!res.ok) return DEFAULT_SITE_SETTINGS;
    return coerce((await res.json()) as Partial<SiteSettings>);
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}
```

- [ ] **Step 2: 新建 context provider**

创建目录与文件 `frontend/src/components/site/SiteSettingsProvider.tsx`：

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";

const SiteSettingsContext = createContext<SiteSettings>(DEFAULT_SITE_SETTINGS);

/** Supplies admin-edited contact settings to client components. */
export function SiteSettingsProvider({
  settings,
  children,
}: {
  settings: SiteSettings;
  children: ReactNode;
}) {
  return (
    <SiteSettingsContext.Provider value={settings}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings(): SiteSettings {
  return useContext(SiteSettingsContext);
}
```

- [ ] **Step 3: Providers 增加 settings 透传**

完整替换 `frontend/src/components/auth/Providers.tsx`：

```tsx
"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import { CartProvider } from "@/components/cart/CartContext";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import type { SiteSettings } from "@/lib/site-settings";

/** Client providers that wrap the whole storefront shell. */
export function Providers({
  settings,
  children,
}: {
  settings: SiteSettings;
  children: ReactNode;
}) {
  return (
    <AuthProvider>
      <CartProvider>
        <SiteSettingsProvider settings={settings}>{children}</SiteSettingsProvider>
      </CartProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 4: layout 取 settings 并下发**

完整替换 `frontend/src/app/(storefront)/layout.tsx`：

```tsx
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { MetaPixelInit } from "@/components/tracking/MetaPixelInit";
import { Providers } from "@/components/auth/Providers";
import { MessengerChat } from "@/components/chat/MessengerChat";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { buildNav } from "@/lib/nav";
import { serverApiUrl, type Category, type Collection } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";
import { DEFAULT_SITE_SETTINGS, fetchSiteSettings, type SiteSettings } from "@/lib/site-settings";

async function getLayoutData(): Promise<{
  roots: Category[];
  collections: Collection[];
  settings: SiteSettings;
}> {
  try {
    const [categoriesRes, collectionsRes, settings] = await Promise.all([
      fetch(serverApiUrl("/api/v1/storefront/categories"), { next: { revalidate: 300, tags: STOREFRONT_TAGS } }),
      // All ACTIVE collections: buildNav only surfaces flat links whose backing
      // collection exists; the footer receives the NAVIGATION slice.
      fetch(serverApiUrl("/api/v1/storefront/collections"), { next: { revalidate: 300, tags: STOREFRONT_TAGS } }),
      fetchSiteSettings(),
    ]);
    const roots = categoriesRes.ok ? ((await categoriesRes.json()) as Category[]) : [];
    const collections = collectionsRes.ok
      ? ((await collectionsRes.json()) as { items: Collection[] }).items
      : [];
    return { roots, collections, settings };
  } catch {
    // Navigation is enhancement; a backend outage must not blank the site.
    return { roots: [], collections: [], settings: DEFAULT_SITE_SETTINGS };
  }
}

export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { roots, collections, settings } = await getLayoutData();
  const navItems = buildNav(roots, collections);
  const footerCollections = collections.filter((c) => c.type === "NAVIGATION");

  return (
    <Providers settings={settings}>
      <MetaPixelInit />
      <AnnouncementBar />
      <Header navItems={navItems} />
      <main className="flex-1">{children}</main>
      <Footer
        collections={footerCollections}
        supportEmail={settings.supportEmail}
        supportHours={settings.supportHours}
      />
      <CartDrawer />
      <MessengerChat />
    </Providers>
  );
}
```

说明：原代码 `collectionsRes ?` 恒真判定顺手修为 `collectionsRes.ok`（同行已有 categories 的 `.ok` 先例；这是取值通路任务必须触碰的行，不扩大其他改动）。除此之外不重构本文件。

- [ ] **Step 5: Footer 联系信息改 props（只动 Contact 块与签名）**

`frontend/src/components/layout/Footer.tsx`：

把组件签名：

```tsx
export function Footer({ collections }: { collections: { id: string; slug: string; name: string }[] }) {
```

改为：

```tsx
export function Footer({
  collections,
  supportEmail,
  supportHours,
}: {
  collections: { id: string; slug: string; name: string }[];
  supportEmail: string;
  supportHours: string;
}) {
```

把 Contact 块中的两行：

```tsx
            <li>Mon–Sat, 9am–6pm (PHT)</li>
            <li>support@luwag.ph</li>
```

改为：

```tsx
            <li>{supportHours}</li>
            <li>{supportEmail}</li>
```

其余一字不动。

- [ ] **Step 6: 前端门禁**

```bash
cd frontend && npx tsc --noEmit && npx eslint src && npm run build
```

期望 0 error / 0 warning。注意：此时 MessengerChat 仍 import `@/lib/siteConfig`（T5 才删），不受本任务影响。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/lib/site-settings.ts frontend/src/components/site/SiteSettingsProvider.tsx frontend/src/components/auth/Providers.tsx "frontend/src/app/(storefront)/layout.tsx" frontend/src/components/layout/Footer.tsx
git commit -m "feat(storefront): site settings provider and data-driven footer contact"
```

---

## Task 4: 后台 /admin/settings 页（admin-api + 导航 + 页面）

**Files:**
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/components/admin/AdminShell.tsx`
- Create: `frontend/src/app/admin/(shell)/settings/page.tsx`

**Interfaces:**
- Produces:
  - `adminApi.getSettings(): Promise<AdminSiteSettings>`
  - `adminApi.updateSettings(input: UpdateSiteSettingsInput): Promise<AdminSiteSettings>`
  - 导航项「站点设置」→ `/admin/settings`，permission `SYSTEM_SETTINGS_EDIT`

- [ ] **Step 1: admin-api 类型与方法**

在 `frontend/src/lib/admin-api.ts` 的 interface 区（例如 `export interface AdminCategoryNode {` 之前）插入：

```ts
export interface AdminSiteSettings {
  id: string;
  messengerUrl: string;
  supportEmail: string;
  supportHours: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSiteSettingsInput {
  messengerUrl: string;
  supportEmail: string;
  supportHours: string;
}
```

在 `adminApi` 对象里 `presignUpload: (` 方法之前插入：

```ts
  // --- site settings (singleton, SYSTEM_SETTINGS_EDIT = SUPER_ADMIN) ------

  getSettings: (): Promise<AdminSiteSettings> =>
    adminAuthedFetch<AdminSiteSettings>("/api/v1/admin/settings"),

  updateSettings: (
    input: UpdateSiteSettingsInput,
  ): Promise<AdminSiteSettings> =>
    adminAuthedFetch<AdminSiteSettings>("/api/v1/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

```

- [ ] **Step 2: AdminShell 导航项**

`frontend/src/components/admin/AdminShell.tsx` 的 NAV_ITEMS，在 Single Pages 那一行之后加：

```tsx
  { href: "/admin/single-pages", label: "Single Pages", permission: "PRODUCT_MANAGE" },
  { href: "/admin/settings", label: "站点设置", permission: "SYSTEM_SETTINGS_EDIT" },
```

- [ ] **Step 3: 设置页（完整文件）**

创建 `frontend/src/app/admin/(shell)/settings/page.tsx`：

```tsx
"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Field, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { adminApi, type AdminSiteSettings } from "@/lib/admin-api";
import { errorStatus } from "@/lib/admin-auth";

interface SettingsForm {
  messengerUrl: string;
  supportEmail: string;
  supportHours: string;
}

type SettingsErrors = Partial<Record<keyof SettingsForm, string>>;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Same rules as the backend Zod schema (backend trims before validating). */
function validateSettings(values: SettingsForm): SettingsErrors {
  const errors: SettingsErrors = {};
  const messengerUrl = values.messengerUrl.trim();
  if (
    messengerUrl.length > 500 ||
    (messengerUrl !== "" &&
      !(messengerUrl.startsWith("https://") && isHttpsUrl(messengerUrl)))
  ) {
    errors.messengerUrl =
      "Messenger 链接需留空，或以 https:// 开头的有效网址（不超过 500 个字符）。";
  }
  const email = values.supportEmail.trim();
  if (email.length === 0 || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.supportEmail = "请输入有效的客服邮箱（不超过 200 个字符）。";
  }
  const hours = values.supportHours.trim();
  if (hours.length < 1 || hours.length > 100) {
    errors.supportHours = "服务时间需为 1–100 个字符。";
  }
  return errors;
}

function toForm(row: AdminSiteSettings): SettingsForm {
  return {
    messengerUrl: row.messengerUrl,
    supportEmail: row.supportEmail,
    supportHours: row.supportHours,
  };
}

export default function SiteSettingsPage(): ReactNode {
  const [data, setData] = useState<SettingsForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminApi
      .getSettings()
      .then((row) => {
        if (!active) return;
        setData(toForm(row));
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(
          errorStatus(err) === 403
            ? "没有系统设置权限。"
            : err instanceof Error
              ? err.message
              : "无法加载站点设置。",
        );
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const updateField = (key: keyof SettingsForm, value: string): void => {
    setData((current) => (current ? { ...current, [key]: value } : current));
    setSaved(false);
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!data || pending) return;
    const found = validateSettings(data);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setPending(true);
    setError(null);
    setSaved(false);
    adminApi
      .updateSettings({
        messengerUrl: data.messengerUrl.trim(),
        supportEmail: data.supportEmail.trim(),
        supportHours: data.supportHours.trim(),
      })
      .then((row) => {
        setData(toForm(row));
        setSaved(true);
        setPending(false);
      })
      .catch((err: unknown) => {
        setError(
          errorStatus(err) === 403
            ? "没有系统设置权限。"
            : err instanceof Error
              ? err.message
              : "保存失败，请重试。",
        );
        setPending(false);
      });
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <PageHeader title="站点设置" />

      {loadError ? (
        <div role="alert" className="mt-4 rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-semibold text-ink">无法加载站点设置。</p>
          <p className="mt-1 text-sm text-ink-muted">{loadError}</p>
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setLoadError(null);
              setNonce((n) => n + 1);
            }}
            className="mt-4"
          >
            重试
          </Button>
        </div>
      ) : data === null ? (
        <div className="mt-4 h-64 animate-pulse rounded-xl border border-border bg-card" aria-hidden />
      ) : (
        <form
          onSubmit={handleSubmit}
          className="mt-4 max-w-2xl rounded-xl border border-border bg-card p-6"
        >
          <div className="flex flex-col gap-5">
            <Field
              label="Messenger 链接"
              htmlFor="settings-messenger-url"
              error={errors.messengerUrl}
              hint={
                <>
                  留空则全站隐藏 Messenger 客服入口；需以 https:// 开头，例如
                  <span className="font-mono"> https://m.me/luwag</span>
                </>
              }
            >
              <TextInput
                id="settings-messenger-url"
                value={data.messengerUrl}
                onChange={(e) => updateField("messengerUrl", e.target.value)}
                placeholder="https://m.me/luwag"
                autoComplete="off"
              />
            </Field>

            <Field
              label="客服邮箱"
              htmlFor="settings-support-email"
              error={errors.supportEmail}
              hint="显示在结账页、页脚与产品详情页。"
            >
              <TextInput
                id="settings-support-email"
                type="email"
                value={data.supportEmail}
                onChange={(e) => updateField("supportEmail", e.target.value)}
                autoComplete="off"
              />
            </Field>

            <Field
              label="服务时间"
              htmlFor="settings-support-hours"
              error={errors.supportHours}
              hint="显示在结账页与页脚，例如 Mon–Sat, 9am–6pm (PHT)。"
            >
              <TextInput
                id="settings-support-hours"
                value={data.supportHours}
                onChange={(e) => updateField("supportHours", e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button type="submit" size="md" disabled={pending}>
              {pending ? "保存中…" : "保存设置"}
            </Button>
            {saved ? (
              <p role="status" data-testid="settings-saved" className="text-sm font-medium text-cta">
                已保存
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 前端门禁**

```bash
cd frontend && npx tsc --noEmit && npx eslint src && npm run build
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/lib/admin-api.ts frontend/src/components/admin/AdminShell.tsx "frontend/src/app/admin/(shell)/settings/page.tsx"
git commit -m "feat(admin): site settings screen for messenger and support configuration"
```

---

## Task 5: MessengerChat 换源 + 45 秒闲置气泡 + checkout Need help?

**Files:**
- Modify: `frontend/src/components/chat/MessengerChat.tsx`（整体重写，保留原有拖拽/滚动行为）
- Delete: `frontend/src/lib/siteConfig.ts`
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx`

**Interfaces:**
- Consumes: `useSiteSettings()`（T3）
- Produces: testid `messenger-chat`（FAB，沿用）、`chat-nudge`（卡片）、`chat-nudge-cta`（Chat now）、`chat-nudge-dismiss`（×）；checkout `checkout-need-help`。

行为规格（spec §6，要点）：45 秒无 `pointerdown/keydown/touchstart/scroll` 且页面可见、无 `[role="dialog"]`、本会话未 dismiss → 弹一次；`document.hidden` 暂停计时；× / Esc / Chat now 写 `sessionStorage["luwag_chat_nudge_dismissed"]="1"` 且本会话不再弹；卡片 `role="status"` 不抢焦点；messengerUrl 为空时整组件（含气泡）不渲染。监听器在 effect 中对称挂载/清理。

- [ ] **Step 1: 完整重写 MessengerChat.tsx**

完整替换 `frontend/src/components/chat/MessengerChat.tsx`：

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";

/**
 * Floating Facebook Messenger button (Castlery-style):
 * - hides while the page scrolls and fades back shortly after scrolling stops;
 * - press-and-drag moves it anywhere inside the viewport (5px click threshold);
 * - after 45s without interaction (tab visible, no dialog open) it shows a
 *   one-shot "Have questions? / Chat now" nudge, dismissible for the session;
 * - a plain click opens the business Page chat in a new tab.
 * Renders nothing (nudge included) until a Messenger URL is configured.
 */
const SIZE = 56;
const MARGIN = 12;
const SCROLL_IDLE_DELAY_MS = 600;
const NUDGE_DELAY_MS = 45_000;
const DRAG_THRESHOLD_PX = 5;
const NUDGE_DISMISS_KEY = "luwag_chat_nudge_dismissed";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

function readNudgeDismissed(): boolean {
  try {
    return sessionStorage.getItem(NUDGE_DISMISS_KEY) === "1";
  } catch {
    // Storage unavailable (private mode etc.): the in-memory refs still apply.
    return false;
  }
}

function writeNudgeDismissed(): void {
  try {
    sessionStorage.setItem(NUDGE_DISMISS_KEY, "1");
  } catch {
    // Ignore: memory fallback (firedRef/dismissedRef) covers this tab.
  }
}

export function MessengerChat() {
  const { messengerUrl } = useSiteSettings();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  // A drag-ending click must not open the chat; reset once it has fired.
  const suppressClickRef = useRef(false);
  // Seeded from sessionStorage so a dismissal earlier in this tab never revives.
  const firedRef = useRef(readNudgeDismissed());
  const dismissedRef = useRef(readNudgeDismissed());

  const dismissNudge = useCallback(() => {
    firedRef.current = true;
    dismissedRef.current = true;
    writeNudgeDismissed();
    setNudgeVisible(false);
  }, []);

  const openChat = useCallback(() => {
    window.open(messengerUrl, "_blank", "noopener,noreferrer");
  }, [messengerUrl]);

  // Scroll hide/show. capture:true also catches scrolling inside containers.
  // Hidden imperatively (inline opacity) so the result never depends on a
  // transition being ticked while the page scrolls. The fade-back uses a
  // short transition with a forced end-state commit, which also lands
  // immediately on renderers that never advance the animation clock.
  useEffect(() => {
    if (!messengerUrl) return;
    const el = buttonRef.current;
    if (!el) return;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(commitTimer);
      el.style.transition = "";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
    };
    const show = () => {
      el.style.pointerEvents = "";
      el.style.transition = "opacity 180ms ease-out";
      void el.offsetWidth; // commit the before-change style first
      el.style.opacity = "1";
      // Guarantee the visible end state even if the transition isn't ticked.
      commitTimer = setTimeout(() => {
        el.style.transition = "";
      }, 240);
    };
    const onScroll = () => {
      if (dragRef.current) return;
      hide();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(show, SCROLL_IDLE_DELAY_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      clearTimeout(idleTimer);
      clearTimeout(commitTimer);
    };
  }, [messengerUrl]);

  // Keep a dragged button on-screen after resize/rotation.
  useEffect(() => {
    if (!messengerUrl) return;
    const onResize = () =>
      setPos((p) =>
        p
          ? {
              x: clamp(p.x, MARGIN, window.innerWidth - SIZE - MARGIN),
              y: clamp(p.y, MARGIN, window.innerHeight - SIZE - MARGIN),
            }
          : p,
      );
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [messengerUrl]);

  // One-shot 45s inactivity nudge. Setup/cleanup are symmetric so StrictMode
  // dev replay (mount -> cleanup -> mount) simply re-arms the same timer.
  useEffect(() => {
    if (!messengerUrl) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (firedRef.current || dismissedRef.current || document.hidden) return;
      timer = setTimeout(() => {
        if (firedRef.current || dismissedRef.current || document.hidden) return;
        // Cart drawer / pickers / mobile menu are role="dialog" — never compete.
        if (document.querySelector("[role='dialog']")) {
          schedule();
          return;
        }
        firedRef.current = true;
        setNudgeVisible(true);
      }, NUDGE_DELAY_MS);
    };

    // Any of these counts as activity and restarts the 45s window.
    const onActivity = () => schedule();
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
      } else {
        schedule();
      }
    };

    schedule();
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("scroll", onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("scroll", onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [messengerUrl]);

  // Esc dismisses the nudge. Capture + stopPropagation so a drawer that
  // opened behind the nudge doesn't also react to the same keypress.
  useEffect(() => {
    if (!nudgeVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      dismissNudge();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [nudgeVisible, dismissNudge]);

  if (!messengerUrl) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }
    setPos({
      x: clamp(drag.originX + dx, MARGIN, window.innerWidth - SIZE - MARGIN),
      y: clamp(drag.originY + dy, MARGIN, window.innerHeight - SIZE - MARGIN),
    });
  };

  const onPointerUp = () => {
    if (dragRef.current?.moved) suppressClickRef.current = true;
    dragRef.current = null;
  };

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    openChat();
  };

  // When the FAB sits in the left half (dragged), anchor the card to its left.
  const nudgeSideClass =
    pos && typeof window !== "undefined" && pos.x + SIZE / 2 < window.innerWidth / 2
      ? "left-0"
      : "right-0";

  return (
    <div
      data-testid="messenger-chat-anchor"
      className="fixed z-40"
      style={{
        left: pos ? pos.x : undefined,
        top: pos ? pos.y : undefined,
        right: pos ? undefined : 16,
        bottom: pos ? undefined : 16,
        width: SIZE,
        height: SIZE,
      }}
    >
      {nudgeVisible ? (
        <div
          role="status"
          data-testid="chat-nudge"
          className={`absolute bottom-full mb-3 w-60 rounded-xl border border-border bg-card p-3 shadow-xl ${nudgeSideClass}`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Have questions?</p>
            <button
              type="button"
              aria-label="Dismiss"
              data-testid="chat-nudge-dismiss"
              onClick={dismissNudge}
              className="-mr-1 -mt-1 rounded p-0.5 text-ink-muted hover:text-ink"
            >
              <svg
                viewBox="0 0 20 20"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            data-testid="chat-nudge-cta"
            onClick={() => {
              dismissNudge();
              openChat();
            }}
            className="mt-1 text-sm font-semibold text-cta hover:underline"
          >
            Chat now
          </button>
        </div>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="Chat with us on Messenger"
        title="Chat with us on Messenger"
        data-testid="messenger-chat"
        style={{ width: SIZE, height: SIZE, touchAction: "none" }}
        className="flex h-full w-full items-center justify-center rounded-full bg-cta text-white shadow-lg hover:bg-cta-hover"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
          <path d="M12 0C5.27 0 0 4.93 0 12c0 3.63 1.86 6.54 4.78 8.5V24l4.38-2.4c.9.25 1.85.38 2.84.38 6.73 0 12-4.93 12-12S18.73 0 12 0zm1.2 16.1l-3.06-3.26-5.99 3.26 6.59-7.01 3.13 3.26 5.88-3.26-6.55 7.01z" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 删除 siteConfig.ts**

确认唯一引用已在本任务消除：

```bash
grep -rn "siteConfig" frontend/src
```

期望：无输出。然后删除并暂存删除：

```bash
git rm frontend/src/lib/siteConfig.ts
```

- [ ] **Step 3: CheckoutForm 接入 settings（3 处小编辑）**

`frontend/src/components/checkout/CheckoutForm.tsx`：

(a) 顶部 import 区（在 `import { useCart } ...` 之后）加：

```tsx
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
```

(b) 组件内 `const { cart, loading: cartLoading, removeItems } = useCart();` 这一行之后加：

```tsx
  const { messengerUrl, supportEmail, supportHours } = useSiteSettings();
```

(c) 把标题行：

```tsx
      <h1 className="mb-6 text-3xl font-semibold text-ink">Checkout</h1>
```

替换为：

```tsx
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-3xl font-semibold text-ink">Checkout</h1>
        <p
          data-testid="checkout-need-help"
          className="text-xs leading-relaxed text-ink-secondary sm:max-w-[420px] sm:text-right"
        >
          <span className="font-semibold text-ink">Need help? </span>
          {messengerUrl ? (
            <>
              <a
                href={messengerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cta hover:underline"
              >
                Chat on Messenger
              </a>
              {" · "}
            </>
          ) : null}
          <a href={`mailto:${supportEmail}`} className="text-cta hover:underline">
            {supportEmail}
          </a>
          {" · "}
          {supportHours}
        </p>
      </div>
```

（messengerUrl 为空时不渲染该链接，不存在死链；邮箱与时间恒在。）

- [ ] **Step 4: 前端门禁**

```bash
cd frontend && npx tsc --noEmit && npx eslint src && npm run build
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/chat/MessengerChat.tsx frontend/src/components/checkout/CheckoutForm.tsx frontend/src/lib/siteConfig.ts
git commit -m "feat(chat): wire messenger FAB to site settings, add idle nudge and checkout help line"
```

---

## Task 6: PDP 三处硬编码替换（PdpClient hook + PdpInfoSections props + PdpView async）

**Files:**
- Modify: `frontend/src/components/product/PdpClient.tsx`
- Modify: `frontend/src/components/product/PdpInfoSections.tsx`
- Modify: `frontend/src/components/product/PdpView.tsx`

**Interfaces:**
- `PdpInfoSections` 新增必传 props `{ supportEmail: string; supportHours: string }`
- `PdpView` 改为 **async server component**，签名/props 不变；两个调用页（`products/[slug]/page.tsx`、`lp/[slug]/page.tsx`）以 `<PdpView ... />` JSX 形式使用，RSC 原生支持 async 子组件，**调用页零改动**。

> 共享文件闸：动刀前由控制器确认线 A 无冲突。全部为取值替换，冻结文案句式不动（仅把邮箱/时间两个值换成设置值）。

- [ ] **Step 1: PdpClient 改用 hook**

`frontend/src/components/product/PdpClient.tsx`：

(a) 删除第 14 行常量：

```tsx
const SUPPORT_EMAIL = "support@luwag.ph";
```

(b) import 区（在 `import { useCart } ...` 之后）加：

```tsx
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
```

(c) 组件函数体内，在第 60 行 `const { addItem } = useCart();` 之后加：

```tsx
  const { supportEmail, supportHours } = useSiteSettings();
```

(d) `restockHref` 中 `SUPPORT_EMAIL` 改为 `supportEmail`：

```tsx
  const restockHref = `mailto:${supportEmail}?subject=${encodeURIComponent(
```

(e) 缺货块尾部的：

```tsx
                {SUPPORT_EMAIL} · Mon–Sat, 9am–6pm PHT
```

改为：

```tsx
                {supportEmail} · {supportHours}
```

确认文件内不再有 `SUPPORT_EMAIL`：

```bash
grep -n "SUPPORT_EMAIL" frontend/src/components/product/PdpClient.tsx
```

期望无输出。

- [ ] **Step 2: PdpInfoSections 改用 props**

`frontend/src/components/product/PdpInfoSections.tsx`：

(a) 删除：

```tsx
const SUPPORT_EMAIL = "support@luwag.ph";
```

(b) 把：

```tsx
export function PdpInfoSections() {
  const mailto = `mailto:${SUPPORT_EMAIL}`;
```

改为：

```tsx
export function PdpInfoSections({
  supportEmail,
  supportHours,
}: {
  supportEmail: string;
  supportHours: string;
}) {
  const mailto = `mailto:${supportEmail}`;
```

(c) Delivery FAQ 中：

```tsx
            </a>{" "}
            (Mon–Sat, 9am–6pm PHT).
```

改为：

```tsx
            </a>{" "}
            ({supportHours}).
```

(d) 该文件内其余两处 `{SUPPORT_EMAIL}`（Returns 段、change/cancel 段）全部替换为 `{supportEmail}`。

确认：

```bash
grep -n "SUPPORT_EMAIL" frontend/src/components/product/PdpInfoSections.tsx
```

期望无输出。冻结句式（"Questions about your delivery?"、"within 48 hours of delivery" 等）一字不动。

- [ ] **Step 3: PdpView 改 async 并下发**

`frontend/src/components/product/PdpView.tsx`：

(a) import 区加：

```tsx
import { fetchSiteSettings } from "@/lib/site-settings";
```

(b) 把函数声明：

```tsx
export function PdpView({
  product,
  category,
  delivery,
  related,
  jsonLd,
  promoSlot,
  productPath,
}: {
  product: Product;
  category: { name: string; slug: string } | null;
  delivery: DeliveryWindows;
  related: Product[];
  jsonLd: unknown;
  promoSlot?: ReactNode;
  productPath?: string;
}) {
  return (
```

改为：

```tsx
export async function PdpView({
  product,
  category,
  delivery,
  related,
  jsonLd,
  promoSlot,
  productPath,
}: {
  product: Product;
  category: { name: string; slug: string } | null;
  delivery: DeliveryWindows;
  related: Product[];
  jsonLd: unknown;
  promoSlot?: ReactNode;
  productPath?: string;
}): Promise<ReactNode> {
  // Request-deduped with the layout's identical fetch (same URL + ISR tag).
  const settings = await fetchSiteSettings();
  return (
```

(c) 把底部：

```tsx
        <PdpInfoSections />
```

改为：

```tsx
        <PdpInfoSections
          supportEmail={settings.supportEmail}
          supportHours={settings.supportHours}
        />
```

不改动 `<PdpClient ... />`（它经 context 自取）。两个调用页（products/[slug]、lp/[slug]）无需修改——若 tsc 报错说明其以非 JSX 方式调用了 PdpView，上报而不是自行改造调用页。

- [ ] **Step 4: 前端门禁**

```bash
cd frontend && npx tsc --noEmit && npx eslint src && npm run build
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/product/PdpClient.tsx frontend/src/components/product/PdpInfoSections.tsx frontend/src/components/product/PdpView.tsx
git commit -m "feat(pdp): replace hardcoded support contact with admin site settings"
```

---

## Task 7: 端到端浏览器验收（:3003，spec §10 全场景）

**Files:** 无代码改动；如发现缺陷，走 SDD fix loop，不允许在验收中直接改代码。

前置：3003 前端（如未运行）：`cd frontend && PORT=3003 npm run dev`（后台运行；这是线 B 自己的进程，可自由启停）。后端 3000 不动。

- [ ] **Step 1: 后台默认值与权限**
  1. SUPER_ADMIN 登录 `/admin`，侧栏出现「站点设置」；进入 `/admin/settings`，三字段为默认值（Messenger 空 / `support@luwag.ph` / `Mon–Sat, 9am–6pm (PHT)`）。
  2. （如环境中有 ADMIN 角色账号）ADMIN 登录看不到入口，直访 `/admin/settings` 加载/保存被拒；无账号则记录为未执行项，不造账号。

- [ ] **Step 2: 配置后 FAB 全站出现**
  1. 保存 `https://m.me/luwag-test`，出现「已保存」。
  2. 硬刷新（dev fetch 缓存粘连，必须硬刷新/Cmd+Shift+R）后依次访问：首页、某类目页、某 PDP、`/checkout`、购物车抽屉打开态——右下均有 `[data-testid="messenger-chat"]`。
  3. 点击在**新标签**打开 `https://m.me/luwag-test`。
  4. 拖拽到左侧后松手，按钮停在左边；刷新页面宽度/旋转模拟（resize）不越界。
  5. 滚动页面时按钮淡出，停滚约 600ms 后淡回。

- [ ] **Step 3: 闲置气泡（真实等待 45s，不许改小常量取巧）**
  1. 刷新一个类目页，不动鼠标/键盘，45s 后出现 `[data-testid="chat-nudge"]`：文案 Have questions? / Chat now / ×（aria-label Dismiss）。
  2. 切换到别的标签页（hidden）停留 50s，再切回：隐藏期间不弹；切回后重新计 45s。
  3. 打开购物车抽屉（role=dialog）状态下到点不弹；关闭抽屉后活动重置计时。
  4. 点 × 关闭后，站内导航到其他页、再等 60s，不再弹；开新标签页（同一会话仍共享 sessionStorage 的情况以浏览器实际为准）——关键断言：当前标签会话内不复活。
  5. Esc 可关闭卡片；卡片出现时焦点未被抢走（role=status 礼貌播报）。
  6. 点 Chat now：新标签打开 + 卡片消失 + 后续不再弹。
  7. DevTools Application 中确认 key `luwag_chat_nudge_dismissed` = `1`。

- [ ] **Step 4: checkout Need help? 两形态**
  1. Messenger 已配置：`/checkout`（从购物车带 items 进入）标题右侧 `[data-testid="checkout-need-help"]` 含 Chat on Messenger（新标签 noopener）、邮箱 mailto、服务时间；375px 视口不错位、不遮挡下单按钮。
  2. 后台清空 Messenger 保存并硬刷新：FAB 与气泡全站消失；checkout 只剩邮箱+时间，无 Messenger 死链；console 无新增 error（fbevents 假 ID 既有噪音忽略）。

- [ ] **Step 5: 三处硬编码同步**
  1. 后台改邮箱为 `qa@example.com`、时间为 `QA hours 9–9`，保存硬刷新。
  2. Footer Contact 块、PDP 缺货提示区（找一个缺货商品；无缺货商品时用 m.me 链接保持配置并在 PDP FAQ 核对邮箱/时间）、PDP「Delivery, Returns & FAQs」两处邮箱与 FAQ 括号时间全部更新。
  3. checkout Need help 同步。

- [ ] **Step 6: 后端校验**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3000/api/v1/admin/settings \
  -H 'content-type: application/json' \
  -d '{"messengerUrl":"javascript:alert(1)","supportEmail":"bad","supportHours":""}'
```

期望 `401`（匿名被拦；需登录态时通过后台界面试非法值：Messenger 填 `http://x`、邮箱填 `bad`、时间清空——前端与后端都应拒绝，出现字段级错误 / 400）。

- [ ] **Step 7: 恢复默认值（强制，不留测试数据）**

后台保存回：Messenger 空、`support@luwag.ph`、`Mon–Sat, 9am–6pm (PHT)`。硬刷新确认 FAB 消失、Footer/PDP/checkout 全部恢复。curl 复核：

```bash
curl -s http://localhost:3000/api/v1/storefront/settings
```

期望与默认值完全一致。

- [ ] **Step 8: 终检与收尾信息**
  - `git status --short` 干净（3003 dev 进程产物、`.next` 已被 ignore）。
  - 汇总七步结果（PASS/FAIL + 证据），FAIL 项交控制器走 fix loop。
  - 全绿后由控制器执行终审（whole-branch review）+ 分支保留不 merge（用户既定偏好）。
