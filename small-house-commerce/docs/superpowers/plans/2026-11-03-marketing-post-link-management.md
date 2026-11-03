# 投放工作台：按商品收纳的帖子链接管理 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每条 Facebook 帖子拥有独立的投放链接与人工登记资料，同时让后台按商品收纳管理，旧链接与既有归因口径保持兼容。

**Architecture:** 扩展现有 `campaign_links` 表（发帖日期、原帖地址、归档时间），不新建归因系统；后端在现有 `CampaignLinksService` 与 `MarketingReportService` 上增加筛选、分组和元资料；前端在现有投放链接页增加“按商品 / 全部链接”双视图、商品帖子抽屉和结果弹窗。所有工作只在隔离 worktree 与隔离本地数据库中进行，不推送、不部署、不写生产。

**Tech Stack:** Next.js 16.3.4、React 19、TypeScript、NestJS 12、Prisma 7.10、PostgreSQL 18、Zod 4、Vitest 4、Testing Library、Playwright（本地浏览器验收）。

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-11-03-marketing-post-link-management-design.md`

## Global Constraints

- 生产基线核验为 `staging/luwag-shop-domain` / `72711978e7fbafac274f59f61064b11ebf02c05b`；实施前再执行 `git fetch prod staging/luwag-shop-domain` 并确认未前进。
- 所有产品代码只在 `/private/tmp/luwag-post-links-20261103` 的独立 worktree 中修改；不得动共享脏工作树、用户 3000/3001 服务、`small_house` 共享库或生产 `/opt/small-house-commerce`。
- 本阶段禁止 `git push`、生产部署、生产迁移、生产 seed、真实 Facebook/Pixel/CAPI/邮件/千问 ERP 外发。
- 迁移只允许新增可空列与索引，禁止回填 `post_date`、禁止把 `created_at` 当作发帖日期、禁止迁移历史事实表。
- 归档与停用必须独立：归档只改 `archived_at`，不得改 `status`、短链目标、订单、访问、事件或费用；停用沿用现有 `status = DISABLED`。
- 每次新增/克隆必须生成新的 `CampaignLink.id` 与 `code`；同一商品、同一日期、同名也不能复用链接身份。
- 发帖日期是人工登记日期；统计区间继续沿用既有 `visit_day` / `event_day` / 订单触达 cohort 口径，不得合并两种日期。
- 商品/来源层访问必须跨链接去重；不得把每帖访问直接相加。
- 权限必须在分组、计数、搜索、日期聚合和分页之前生效；查看全部不等于管理全部。
- 后台文案中文，i18n key 英文；不得新增一级导航，不得改 Header/Footer/店面设计。
- 本地数据库名必须匹配现有 `seed-e2e` 安全守卫：使用 `luwag_post_links_local_e2e_20261103`。
- 本地端口：前端 4023、后端 4104；启动前检查占用，不停止其他进程。Next 开发预览用 `localhost`。
- 前端所有新增 API 请求保持 `cache: "no-store"` 与 `referrerPolicy: "no-referrer"`；复制统一走 `@/lib/clipboard` 的 `copyText`。
- 每个任务结束必须运行对应定向测试并提交；提交只落在本 worktree 的 feature 分支。
- 不提交 Prisma 生成客户端；后端构建前必须 `pnpm prisma generate`。

## Review Focus

1. **旧链接无发帖日期**：必须仍出现在“按商品/全部链接/核算”中；日期排序时排最后；不得用 `created_at` 回填或伪造发布日期。
2. **归档与停用独立性**：归档后链接与短链仍可建立新触达、核算仍计入；停用后再取消归档不得重新启用。
3. **分组计数与分页**：商品计数、帖子数、最近发帖日期必须基于权限过滤后的完整集合，而不是当前子列表分页；商品页与抽屉筛选必须一致。
4. **核算日期筛选**：发帖日期条件只筛已登记的 `FB_POST` 链接；不得改变统计区间、订单 cohort 或跨链接访问去重；启用时 `otherSources` 必须为空而不是混入无法判断日期的来源。
5. **写入边界与并发**：他人记录返回 404、只读账号 403、版本冲突 409；客户端不能伪造 owner/AID/code/archivedAt；克隆不得继承旧帖日期、原帖地址或归档状态。

---

### Task 0: 建立隔离工作区与本地数据库

**Files:**
- Create: `/private/tmp/luwag-post-links-20261103`（worktree）
- Local DB: `luwag_post_links_local_e2e_20261103`

**Interfaces:**
- Produces: 后续所有任务使用的 worktree 路径、分支名、数据库 URL。

- [ ] **Step 1: 核验生产基线并创建 worktree**

Run:

```bash
cd /Users/Admin1/Desktop/菲律宾家居/建站/codex建站/.claude/worktrees/homepage-builder
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 fetch prod staging/luwag-shop-domain
git rev-parse prod/staging/luwag-shop-domain
git worktree add /private/tmp/luwag-post-links-20261103 -b feat/marketing-post-links prod/staging/luwag-shop-domain
cd /private/tmp/luwag-post-links-20261103
git rev-parse --short HEAD
git status --short
```

Expected: `git rev-parse --short HEAD` 为 `7271197` 或用户确认后的更新生产基线；`git status --short` 为空。若生产基线已前进，先停止并把新提交列给用户确认，不在旧基线上继续。

- [ ] **Step 2: 创建隔离数据库**

Run:

```bash
psql "postgresql://postgres:postgres@localhost:5432/postgres" -v ON_ERROR_STOP=1 -c "CREATE DATABASE luwag_post_links_local_e2e_20261103;"
psql "postgresql://postgres:postgres@localhost:5432/luwag_post_links_local_e2e_20261103" -v ON_ERROR_STOP=1 -c "SELECT current_database();"
```

Expected: 第二条查询只返回 `luwag_post_links_local_e2e_20261103`。数据库已存在时不要删除，先确认是否为本任务上一次运行；不是则换一个带 `_e2e_` 的唯一名称并同步后续命令。

- [ ] **Step 3: 安装依赖并生成 Prisma 客户端**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce
pnpm install --frozen-lockfile
cd backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/luwag_post_links_local_e2e_20261103?schema=public" pnpm prisma generate
```

Expected: 依赖安装成功、Prisma Client 生成成功。若 `pnpm install` 需要网络代理，按仓库既有方式设置 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7897`。

- [ ] **Step 4: 提交空基线检查**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103
git status --short
git log -1 --oneline
```

Expected: 无改动；提交为生产基线。无代码提交。

---

### Task 1: 帖子资料领域函数、数据库迁移与 DTO

**Files:**
- Create: `small-house-commerce/backend/src/modules/marketing/marketing-post.ts`
- Create: `small-house-commerce/backend/src/modules/marketing/marketing-post.spec.ts`
- Modify: `small-house-commerce/backend/prisma/schema/marketing.prisma`
- Create: `small-house-commerce/backend/prisma/migrations/20261103120000_add_campaign_post_metadata/migration.sql`
- Modify: `small-house-commerce/backend/src/modules/marketing/dto/campaign-link.dto.ts`
- Create: `small-house-commerce/backend/src/modules/marketing/dto/campaign-link.dto.spec.ts`

**Interfaces:**
- Produces:
  - `isFacebookPostUrl(raw: string): boolean`
  - `postDateToDb(value: string): Date`
  - `postDateFromDb(value: Date | null): string | null`
  - `autoPostName(postDate: string, productName: string, code: string): string`
  - `CampaignLinkCreateInput`（Zod 输出类型，含 `name?: string; postDate?: string | null; postUrl?: string | null`）
  - `CampaignLinkUpdateInput`（`{ name?: string; postDate?: string | null; postUrl?: string | null; expectedVersion: number }`）
  - `CampaignLinkQuery`（含 `sourceType`、`archiveState`、`postDateFrom`、`postDateTo`、`postDateMissingOnly`、`orderBy`）
  - `CampaignLinkGroupQuery`

- [ ] **Step 1: 写领域函数失败测试**

Create `backend/src/modules/marketing/marketing-post.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { autoPostName, isFacebookPostUrl, postDateFromDb, postDateToDb } from './marketing-post.js';

describe('marketing post metadata', () => {
  it('accepts only https Facebook post hosts', () => {
    for (const value of [
      'https://www.facebook.com/luwag/posts/123',
      'https://facebook.com/luwag/posts/123',
      'https://fb.watch/abc123/',
    ]) expect(isFacebookPostUrl(value)).toBe(true);
    for (const value of [
      'http://www.facebook.com/luwag/posts/123',
      'https://facebook.com.example.com/luwag/posts/123',
      'https://user:pass@facebook.com/luwag/posts/123',
      'https://notfacebook.com/luwag/posts/123',
      'javascript:alert(1)',
    ]) expect(isFacebookPostUrl(value)).toBe(false);
  });

  it('round-trips a calendar date without shifting it through a timezone', () => {
    expect(postDateToDb('2026-11-03').toISOString()).toBe('2026-11-03T00:00:00.000Z');
    expect(postDateFromDb(postDateToDb('2026-11-03'))).toBe('2026-11-03');
    expect(postDateFromDb(null)).toBeNull();
  });

  it('auto-names with the date, product and a short link discriminator under 120 characters', () => {
    const name = autoPostName('2026-11-03', 'Expandable Transparent Shoe Cabinet', 'AbCdEfGhIjKlMnOp');
    expect(name).toBe('11-03｜Expandable Transparent Shoe Cabinet｜帖子 KlMnOp');
    expect(name.length).toBeLessThanOrEqual(120);
    expect(autoPostName('2026-11-03', 'X'.repeat(300), 'AbCdEfGhIjKlMnOp').length).toBe(120);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/marketing-post.spec.ts
```

Expected: FAIL，模块 `marketing-post.js` 不存在。

- [ ] **Step 3: 实现领域函数**

Create `backend/src/modules/marketing/marketing-post.ts`:

```ts
export const POST_NAME_MAX = 120;

export function isFacebookPostUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch';
}

export function postDateToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function postDateFromDb(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function autoPostName(postDate: string, productName: string, code: string): string {
  const prefix = `${postDate.slice(5)}｜`;
  const suffix = `｜帖子 ${code.slice(-6)}`;
  const room = Math.max(1, POST_NAME_MAX - prefix.length - suffix.length);
  return `${prefix}${productName.slice(0, room)}${suffix}`.slice(0, POST_NAME_MAX);
}
```

- [ ] **Step 4: 运行领域函数测试确认通过**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/marketing-post.spec.ts
```

Expected: PASS（3 tests）。

- [ ] **Step 5: 扩展 Prisma 模型与迁移**

Modify `backend/prisma/schema/marketing.prisma` inside `model CampaignLink` after `name`:

```prisma
  postDate            DateTime?          @map("post_date") @db.Date
  postUrl             String?            @map("post_url") @db.VarChar(2048)
  archivedAt          DateTime?          @map("archived_at") @db.Timestamptz(3)
```

Add indexes after the existing `@@index([landingPageId])`:

```prisma
  @@index([ownerUserId, archivedAt, productId])
  @@index([productId, sourceType, postDate])
```

Create `backend/prisma/migrations/20261103120000_add_campaign_post_metadata/migration.sql`:

```sql
ALTER TABLE "campaign_links"
  ADD COLUMN "post_date" DATE,
  ADD COLUMN "post_url" VARCHAR(2048),
  ADD COLUMN "archived_at" TIMESTAMPTZ(3);

CREATE INDEX "campaign_links_owner_user_id_archived_at_product_id_idx"
  ON "campaign_links" ("owner_user_id", "archived_at", "product_id");

CREATE INDEX "campaign_links_product_id_source_type_post_date_idx"
  ON "campaign_links" ("product_id", "source_type", "post_date");
```

Do not run `prisma format` on unrelated schema files.

- [ ] **Step 6: 写 DTO 失败测试**

Create `backend/src/modules/marketing/dto/campaign-link.dto.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { campaignLinkCreateSchema, campaignLinkQuerySchema, campaignLinkUpdateSchema } from './campaign-link.dto.js';

const base = { productId: '11111111-1111-4111-a111-111111111111', sourceType: 'FB_POST' as const };

describe('campaign link post DTOs', () => {
  it('allows a Facebook post without a name when the server can auto-name it', () => {
    expect(campaignLinkCreateSchema.parse({ ...base, postDate: '2026-11-03' })).toMatchObject({ postDate: '2026-11-03' });
  });

  it('still requires a name for a non-post link and rejects post fields on non-post links', () => {
    expect(campaignLinkCreateSchema.safeParse({ ...base, sourceType: 'META_AD' }).success).toBe(false);
    expect(campaignLinkCreateSchema.safeParse({ ...base, sourceType: 'META_AD', postDate: '2026-11-03' }).success).toBe(false);
  });

  it('rejects invalid calendar dates and unsafe Facebook URLs', () => {
    for (const postDate of ['2026-02-30', '2026-13-01', '11-03-2026']) {
      expect(campaignLinkCreateSchema.safeParse({ ...base, postDate }).success).toBe(false);
    }
    for (const postUrl of ['https://facebook.com.example.com/x', 'http://facebook.com/x', 'https://evil.test/x']) {
      expect(campaignLinkCreateSchema.safeParse({ ...base, postDate: '2026-11-03', postUrl }).success).toBe(false);
    }
  });

  it('edits metadata with expectedVersion and at least one field', () => {
    expect(campaignLinkUpdateSchema.parse({ name: 'New', expectedVersion: 0 })).toMatchObject({ name: 'New', expectedVersion: 0 });
    expect(campaignLinkUpdateSchema.parse({ postDate: null, expectedVersion: 0 })).toMatchObject({ postDate: null });
    expect(campaignLinkUpdateSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
  });

  it('rejects conflicting date filters and non-post date filters', () => {
    expect(campaignLinkQuerySchema.safeParse({ postDateFrom: '2026-11-03', postDateTo: '2026-11-02' }).success).toBe(false);
    expect(campaignLinkQuerySchema.safeParse({ postDateMissingOnly: 'true', postDateFrom: '2026-11-01' }).success).toBe(false);
    expect(campaignLinkQuerySchema.safeParse({ sourceType: 'META_AD', postDateFrom: '2026-11-01' }).success).toBe(false);
  });
});
```

- [ ] **Step 7: 运行 DTO 测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/dto/campaign-link.dto.spec.ts
```

Expected: FAIL，字段/校验尚不存在。

- [ ] **Step 8: 实现 DTO**

Replace `backend/src/modules/marketing/dto/campaign-link.dto.ts` with:

```ts
import { z } from 'zod';
import { SourceType } from '../../../generated/prisma/client.js';
import { isFacebookPostUrl } from '../marketing-post.js';

const adField = z.string().trim().max(64).nullable().default(null);
const utmField = z.string().trim().max(120).nullable().default(null);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date.');
const postUrlField = z.string().trim().max(2048).refine(isFacebookPostUrl, 'Use an HTTPS Facebook post URL.').nullable();
const postFields = { postDate: calendarDate.nullable().optional(), postUrl: postUrlField.optional() };
const archiveState = z.enum(['UNARCHIVED', 'ARCHIVED', 'ALL']).default('ALL');
const missingOnly = z.enum(['true', 'false']).transform((value) => value === 'true').optional();

const campaignLinkCreateBase = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  landingPageId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  sourceType: z.nativeEnum(SourceType),
  campaignId: adField,
  adsetId: adField,
  adId: adField,
  utmSource: utmField,
  utmMedium: utmField,
  utmCampaign: utmField,
  utmContent: utmField,
  utmTerm: utmField,
  ...postFields,
}).strict();

export const campaignLinkCreateSchema = campaignLinkCreateBase.superRefine((value, ctx) => {
  const hasPostField = value.postDate !== undefined || value.postUrl !== undefined;
  if (hasPostField && value.sourceType !== 'FB_POST') {
    ctx.addIssue({ code: 'custom', path: ['postDate'], message: 'Post fields require FB_POST.' });
  }
  if (!value.name && !(value.sourceType === 'FB_POST' && value.postDate)) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'Name is required.' });
  }
});
export type CampaignLinkCreateInput = z.infer<typeof campaignLinkCreateSchema>;

export const campaignLinkUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  ...postFields,
  expectedVersion: z.number().int().nonnegative(),
}).strict().refine((value) => value.name !== undefined || value.postDate !== undefined || value.postUrl !== undefined, {
  message: 'At least one editable field is required.',
});
export type CampaignLinkUpdateInput = z.infer<typeof campaignLinkUpdateSchema>;

export const campaignLinkVersionSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();

export const campaignLinkCloneSchema = campaignLinkCreateBase.extend({
  campaignId: adField.removeDefault(),
  adsetId: adField.removeDefault(),
  adId: adField.removeDefault(),
  utmSource: utmField.removeDefault(),
  utmMedium: utmField.removeDefault(),
  utmCampaign: utmField.removeDefault(),
  utmContent: utmField.removeDefault(),
  utmTerm: utmField.removeDefault(),
}).partial();
export type CampaignLinkCloneInput = z.infer<typeof campaignLinkCloneSchema>;

function refinePostFilters(value: {
  sourceType?: SourceType;
  postDateFrom?: string;
  postDateTo?: string;
  postDateMissingOnly?: boolean;
}, ctx: z.RefinementCtx) {
  if (value.postDateMissingOnly && (value.postDateFrom || value.postDateTo)) {
    ctx.addIssue({ code: 'custom', path: ['postDateMissingOnly'], message: 'Missing-only excludes a date range.' });
  }
  if (value.postDateFrom && value.postDateTo && value.postDateFrom > value.postDateTo) {
    ctx.addIssue({ code: 'custom', path: ['postDateTo'], message: 'Post date range must be ordered.' });
  }
  const hasPostDate = Boolean(value.postDateFrom || value.postDateTo || value.postDateMissingOnly);
  if (hasPostDate && value.sourceType && value.sourceType !== 'FB_POST') {
    ctx.addIssue({ code: 'custom', path: ['sourceType'], message: 'Post date filters require FB_POST.' });
  }
}

const campaignLinkFilterBase = z.object({
  ownerUserId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  landingPageId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  sourceType: z.nativeEnum(SourceType).optional(),
  archiveState,
  postDateFrom: calendarDate.optional(),
  postDateTo: calendarDate.optional(),
  postDateMissingOnly: missingOnly,
  orderBy: z.enum(['CREATED_AT_DESC', 'POST_DATE_DESC']).default('CREATED_AT_DESC'),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const campaignLinkQuerySchema = campaignLinkFilterBase.superRefine(refinePostFilters);
export type CampaignLinkQuery = z.infer<typeof campaignLinkQuerySchema>;

export const campaignLinkGroupQuerySchema = campaignLinkFilterBase.omit({ orderBy: true }).superRefine(refinePostFilters);
export type CampaignLinkGroupQuery = z.infer<typeof campaignLinkGroupQuerySchema>;
```

- [ ] **Step 9: 运行 DTO 与领域测试**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/marketing-post.spec.ts src/modules/marketing/dto/campaign-link.dto.spec.ts
```

Expected: PASS（8 tests）。

- [ ] **Step 10: 提交**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/backend/src/modules/marketing/marketing-post.ts small-house-commerce/backend/src/modules/marketing/marketing-post.spec.ts small-house-commerce/backend/src/modules/marketing/dto/campaign-link.dto.ts small-house-commerce/backend/src/modules/marketing/dto/campaign-link.dto.spec.ts small-house-commerce/backend/prisma/schema/marketing.prisma small-house-commerce/backend/prisma/migrations/20261103120000_add_campaign_post_metadata/migration.sql
git commit -m "feat(marketing): add post metadata and archive schema"
```

---

### Task 2: 链接服务的创建、编辑、归档、筛选与商品分组

**Files:**
- Modify: `small-house-commerce/backend/src/modules/marketing/campaign-links.service.ts`
- Modify: `small-house-commerce/backend/src/modules/marketing/campaign-links.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 DTO 与领域函数；`scopeFor`、`assertVisible`、`assertManage`。
- Produces:
  - `listLinks(query: CampaignLinkQuery, account): Promise<{ items: CampaignLinkRow[]; total; page; pageSize }>`
  - `listProductGroups(query: CampaignLinkGroupQuery, account): Promise<{ items: CampaignLinkProductGroup[]; total; page; pageSize }>`
  - `updateLink(id, input: CampaignLinkUpdateInput, account)`
  - `archiveLink(id, expectedVersion, account)` / `unarchiveLink(id, expectedVersion, account)`
  - `CampaignLinkProductGroup = { product: { id; name; productCode; thumbnailUrl }; recordCount; postCount; lastPostDate: string | null; latestCreatedAt: string }`

- [ ] **Step 1: 扩展服务测试替身与失败用例**

在 `campaign-links.service.spec.ts` 的 `setup()` mock 中补充：

```ts
campaignLink: {
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = {
      id: `link-${rows.size}`, version: 0, status: 'ACTIVE', archivedAt: null,
      postDate: null, postUrl: null, createdAt: new Date(), updatedAt: new Date(),
      ...data, product, landingPage: data.landingPageId ? page : null,
      owner: { name: 'Operator', optimizerProfile: profile },
    };
    rows.set(row.id, row); return structuredClone(row);
  }),
  findUnique: vi.fn(async ({ where }: { where: { id?: string; code?: string } }) => structuredClone(where.id ? rows.get(where.id) ?? null : [...rows.values()].find((row) => row.code === where.code) ?? null)),
  findMany: vi.fn(async () => []),
  groupBy: vi.fn(async () => []),
  count: vi.fn(async () => 0),
  updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const row = rows.get(String(where.id));
    if (!row || row.version !== where.version || row.ownerUserId !== where.ownerUserId) return { count: 0 };
    rows.set(String(where.id), { ...row, ...data, version: Number(row.version) + 1 }); return { count: 1 };
  }),
},
product: { findUnique: vi.fn(async () => product), findMany: vi.fn(async () => [product]) },
```

Add tests to the same file:

```ts
it('creates a dated Facebook post with a server-generated name and normalized date', async () => {
  const { service } = setup();
  const link = await service.createLink({ productId: P1, sourceType: 'FB_POST', postDate: '2026-11-03', postUrl: 'https://www.facebook.com/luwag/posts/1' }, owner);
  expect(link.postDate).toBe('2026-11-03');
  expect(link.postUrl).toBe('https://www.facebook.com/luwag/posts/1');
  expect(link.name).toMatch(/^11-03｜Chair｜帖子 /);
  expect(link.archivedAt).toBeNull();
});

it('edits post metadata without changing the code and clears fields explicitly', async () => {
  const { service } = setup();
  const link = await service.createLink({ productId: P1, sourceType: 'FB_POST', name: 'Post', postDate: '2026-11-03' }, owner);
  const updated = await service.updateLink(link.id, { postDate: '2026-11-02', postUrl: null, expectedVersion: 0 }, owner);
  expect(updated).toMatchObject({ code: link.code, postDate: '2026-11-02', postUrl: null, version: 1 });
  await expect(service.updateLink(link.id, { postDate: '2026-11-01', expectedVersion: 0 }, owner)).rejects.toMatchObject({ status: 409 });
});

it('rejects post metadata on a non-post link', async () => {
  const { service } = setup();
  const link = await service.createLink(base, owner);
  await expect(service.updateLink(link.id, { postDate: '2026-11-03', expectedVersion: 0 }, owner)).rejects.toMatchObject({ status: 400 });
});

it('archives and restores without changing status, code or touch resolution', async () => {
  const { service } = setup();
  const link = await service.createLink({ productId: P1, sourceType: 'FB_POST', name: 'Post', postDate: '2026-11-03' }, owner);
  const archived = await service.archiveLink(link.id, 0, owner);
  expect(archived).toMatchObject({ archivedAt: expect.any(String), status: 'ACTIVE', code: link.code, version: 1 });
  const same = await service.archiveLink(link.id, 1, owner);
  expect(same.version).toBe(1);
  const restored = await service.unarchiveLink(link.id, 1, owner);
  expect(restored).toMatchObject({ archivedAt: null, status: 'ACTIVE', version: 2 });
  expect(await service.resolveTouch(link.code)).toMatchObject({ disabled: false, id: link.id });
});

it('clones a post as a new identity without inheriting its date, post URL or archive state', async () => {
  const { service } = setup();
  const link = await service.createLink({ productId: P1, sourceType: 'FB_POST', name: 'Post', postDate: '2026-11-03', postUrl: 'https://www.facebook.com/luwag/posts/1' }, owner);
  await service.archiveLink(link.id, 0, owner);
  const copy = await service.cloneLink(link.id, { name: 'Copy', postDate: '2026-11-04' }, owner);
  expect(copy).toMatchObject({ name: 'Copy', postDate: '2026-11-04', postUrl: null, archivedAt: null, sourceType: 'FB_POST' });
  expect(copy.code).not.toBe(link.code);
});

it('counts records and posts across the full filtered set before paging', async () => {
  const { service, prisma } = setup();
  prisma.campaignLink.groupBy
    .mockResolvedValueOnce([{ productId: P1, _count: { _all: 3 }, _max: { createdAt: new Date('2026-11-03T01:00:00Z') } }])
    .mockResolvedValueOnce([{ productId: P1, _count: { _all: 2 }, _max: { postDate: new Date('2026-11-03T00:00:00Z') } }]);
  prisma.product.findMany.mockResolvedValue([{ id: P1, name: 'Chair', productCode: 'LUW-001', images: [{ url: '/uploads/chair.jpg' }] }]);
  const result = await service.listProductGroups({ archiveState: 'UNARCHIVED', page: 1, pageSize: 20 }, owner);
  expect(result).toMatchObject({ total: 1, page: 1, pageSize: 20 });
  expect(result.items[0]).toMatchObject({
    recordCount: 3, postCount: 2, lastPostDate: '2026-11-03',
    product: { id: P1, name: 'Chair', productCode: 'LUW-001', thumbnailUrl: '/uploads/chair.jpg' },
  });
  expect(prisma.campaignLink.groupBy).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: 运行服务测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/campaign-links.service.spec.ts
```

Expected: FAIL，`archiveLink`/`listProductGroups` 不存在或字段缺失。

- [ ] **Step 3: 在服务中引入领域函数与分组类型**

At the top of `campaign-links.service.ts` add:

```ts
import { autoPostName, isFacebookPostUrl, postDateFromDb, postDateToDb } from './marketing-post.js';
import type { CampaignLinkGroupQuery } from './dto/campaign-link.dto.js';

export interface CampaignLinkProductGroup {
  product: { id: string; name: string; productCode: string | null; thumbnailUrl: string | null };
  recordCount: number;
  postCount: number;
  lastPostDate: string | null;
  latestCreatedAt: string;
}
```

- [ ] **Step 4: 改写创建与克隆**

Replace `mint` body with:

```ts
private async mint(input: CampaignLinkCreateInput, account: MarketingAccount, existingOwner?: string) {
  const scope = scopeFor(account);
  const page = input.landingPageId ? await this.prisma.productLandingPage.findUnique({ where: { id: input.landingPageId } }) : null;
  if (input.landingPageId && !page) throw new NotFoundException('Marketing page not found.');
  if (page) {
    assertVisible(scope, page.ownerUserId);
    if (!page.ownerUserId) throw new BadRequestException('Assign the page owner before creating a link.');
    if (page.productId !== input.productId || !page.publishedContent || page.status !== 'ACTIVE' || effectiveStatus(page) === 'ENDED')
      throw new BadRequestException('The target must be a published page of this product.');
  }
  const ownerUserId = page?.ownerUserId ?? existingOwner ?? account.id;
  if (existingOwner && existingOwner !== ownerUserId) throw new BadRequestException('The target page owner changed.');
  assertManage(scope, ownerUserId);
  const product = await this.prisma.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true, status: true } });
  if (!product || product.status !== 'ACTIVE') throw new BadRequestException('The parent product must be active.');
  const variant = input.variantId ? await this.prisma.productVariant.findUnique({ where: { id: input.variantId }, select: { productId: true, name: true, sku: { select: { status: true, price: true } } } }) : null;
  if (input.variantId && (!variant || variant.productId !== input.productId || variant.sku?.status !== 'ACTIVE' || variant.sku.price === null))
    throw new BadRequestException('The target variant is not available for this product.');
  const hasPostField = input.postDate != null || input.postUrl != null;
  if (hasPostField && input.sourceType !== 'FB_POST') throw new BadRequestException('Post fields require a Facebook post source.');
  if (input.postUrl && !isFacebookPostUrl(input.postUrl)) throw new BadRequestException('Use an HTTPS Facebook post URL.');
  const code = randomBytes(12).toString('base64url');
  const postDate = input.postDate ? postDateToDb(input.postDate) : null;
  if (!input.name && (!input.postDate || input.sourceType !== 'FB_POST')) throw new BadRequestException('Name is required.');
  const name = input.name ?? autoPostName(input.postDate!, product.name, code);
  const profile = await this.optimizers.ensureProfileForUser(ownerUserId);
  const row = await this.prisma.campaignLink.create({
    data: {
      code, ownerUserId, aidSnapshot: profile.aid,
      productId: input.productId, variantId: input.variantId ?? null, variantNameSnapshot: variant?.name ?? null,
      landingPageId: input.landingPageId ?? null, name, sourceType: input.sourceType,
      postDate, postUrl: input.postUrl || null,
      ...Object.fromEntries(attributionFields.map((field) => [field, input[field] || null])),
    },
    include: details,
  });
  return this.serialize(row);
}
```

Replace `cloneLink` with:

```ts
async cloneLink(id: string, input: CampaignLinkCloneInput, account: MarketingAccount) {
  const row = await this.getLink(id, account);
  assertManage(scopeFor(account), row.ownerUserId);
  const sourceType = input.sourceType ?? row.sourceType;
  const postDate = input.postDate === undefined ? null : input.postDate;
  const postUrl = input.postUrl === undefined ? null : input.postUrl;
  return this.mint({
    productId: input.productId ?? row.productId,
    variantId: input.variantId === undefined ? row.variantId : input.variantId,
    landingPageId: input.landingPageId === undefined ? row.landingPageId : input.landingPageId,
    sourceType,
    name: input.name ?? (postDate ? undefined : `${row.name.slice(0, 115)} copy`),
    postDate,
    postUrl,
    ...Object.fromEntries(attributionFields.map((field) => [field, input[field] === undefined ? row[field] : input[field]])),
  }, account, row.ownerUserId);
}
```

- [ ] **Step 5: 改写编辑与归档**

Replace `updateLink` and `disableLink` block with:

```ts
async updateLink(id: string, input: CampaignLinkUpdateInput, account: MarketingAccount) {
  const current = await this.prisma.campaignLink.findUnique({ where: { id }, select: { sourceType: true } });
  if (!current) throw new NotFoundException('Campaign link not found.');
  if ((input.postDate !== undefined || input.postUrl !== undefined) && current.sourceType !== 'FB_POST')
    throw new BadRequestException('Post metadata is only editable on Facebook post links.');
  const data: Prisma.CampaignLinkUpdateManyMutationInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.postDate !== undefined) data.postDate = input.postDate === null ? null : postDateToDb(input.postDate);
  if (input.postUrl !== undefined) data.postUrl = input.postUrl || null;
  return this.mutate(id, input.expectedVersion, account, data);
}

async disableLink(id: string, expectedVersion: number, account: MarketingAccount) {
  return this.mutate(id, expectedVersion, account, { status: 'DISABLED' });
}

async archiveLink(id: string, expectedVersion: number, account: MarketingAccount) {
  return this.setArchived(id, expectedVersion, account, true);
}

async unarchiveLink(id: string, expectedVersion: number, account: MarketingAccount) {
  return this.setArchived(id, expectedVersion, account, false);
}

private async setArchived(id: string, expectedVersion: number, account: MarketingAccount, archived: boolean) {
  const scope = scopeFor(account);
  return this.prisma.$transaction(async (tx) => {
    const row = await tx.campaignLink.findUnique({ where: { id }, include: details });
    if (!row) throw new NotFoundException('Campaign link not found.');
    assertVisible(scope, row.ownerUserId);
    assertManage(scope, row.ownerUserId);
    if (row.version !== expectedVersion) throw new ConflictException({ code: 'CAMPAIGN_LINK_VERSION_CONFLICT', message: 'The link changed. Reload the saved version.' });
    if ((row.archivedAt !== null) === archived) return this.serialize(row);
    const result = await tx.campaignLink.updateMany({
      where: { id, ownerUserId: row.ownerUserId, version: expectedVersion },
      data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException({ code: 'CAMPAIGN_LINK_VERSION_CONFLICT', message: 'The link changed. Reload the saved version.' });
    return this.serialize((await tx.campaignLink.findUnique({ where: { id }, include: details }))!);
  });
}
```

- [ ] **Step 6: 改写列表筛选与排序**

Replace `listLinks` with:

```ts
async listLinks(query: CampaignLinkQuery, account: MarketingAccount) {
  const scope = scopeFor(account);
  const where = this.listWhere(query, scope);
  const orderBy: Prisma.CampaignLinkOrderByWithRelationInput[] = query.orderBy === 'POST_DATE_DESC'
    ? [{ postDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }]
    : [{ createdAt: 'desc' }, { id: 'desc' }];
  const [rows, total] = await Promise.all([
    this.prisma.campaignLink.findMany({ where, include: details, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    this.prisma.campaignLink.count({ where }),
  ]);
  return { items: rows.map((row) => this.serialize(row)), total, page: query.page, pageSize: query.pageSize };
}

private listWhere(query: CampaignLinkQuery | CampaignLinkGroupQuery, scope: ReturnType<typeof scopeFor>): Prisma.CampaignLinkWhereInput {
  const where: Prisma.CampaignLinkWhereInput = scope.all ? {} : { ownerUserId: scope.ownerUserId! };
  if (query.ownerUserId) { assertVisible(scope, query.ownerUserId); where.ownerUserId = query.ownerUserId; }
  if (query.productId) where.productId = query.productId;
  if (query.landingPageId) where.landingPageId = query.landingPageId;
  if (query.status) where.status = query.status;
  if (query.sourceType) where.sourceType = query.sourceType;
  if (query.archiveState === 'UNARCHIVED') where.archivedAt = null;
  if (query.archiveState === 'ARCHIVED') where.archivedAt = { not: null };
  const dateFilter = Boolean(query.postDateFrom || query.postDateTo || query.postDateMissingOnly);
  if (dateFilter) where.sourceType = 'FB_POST';
  if (query.postDateMissingOnly) where.postDate = null;
  else if (query.postDateFrom || query.postDateTo) {
    where.postDate = {
      ...(query.postDateFrom ? { gte: postDateToDb(query.postDateFrom) } : {}),
      ...(query.postDateTo ? { lte: postDateToDb(query.postDateTo) } : {}),
    };
  }
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { aidSnapshot: { contains: query.search, mode: 'insensitive' } },
      { adId: { contains: query.search, mode: 'insensitive' } },
      { code: { contains: query.search } },
      { postUrl: { contains: query.search, mode: 'insensitive' } },
      { product: { name: { contains: query.search, mode: 'insensitive' } } },
      { product: { productCode: { contains: query.search, mode: 'insensitive' } } },
    ];
  }
  return where;
}
```

- [ ] **Step 7: 实现商品分组**

Add after `listLinks`:

```ts
async listProductGroups(query: CampaignLinkGroupQuery, account: MarketingAccount) {
  const scope = scopeFor(account);
  const where = this.listWhere(query, scope);
  const [groups, posts] = await Promise.all([
    this.prisma.campaignLink.groupBy({ by: ['productId'], where, _count: { _all: true }, _max: { createdAt: true } }),
    this.prisma.campaignLink.groupBy({
      by: ['productId'],
      where: { ...where, sourceType: 'FB_POST' },
      _count: { _all: true },
      _max: { postDate: true },
    }),
  ]);
  const postMap = new Map(posts.map((row) => [row.productId, row]));
  const all = groups.map((row): CampaignLinkProductGroup & { latest: Date } => {
    const post = postMap.get(row.productId);
    return {
      product: { id: row.productId, name: '', productCode: null, thumbnailUrl: null },
      recordCount: row._count._all,
      postCount: post?._count._all ?? 0,
      lastPostDate: postDateFromDb(post?._max.postDate ?? null),
      latestCreatedAt: (row._max.createdAt ?? new Date(0)).toISOString(),
      latest: row._max.createdAt ?? new Date(0),
    };
  });
  all.sort((a, b) => {
    if (a.lastPostDate && b.lastPostDate) {
      const byDate = b.lastPostDate.localeCompare(a.lastPostDate);
      if (byDate) return byDate;
    } else if (a.lastPostDate) return -1;
    else if (b.lastPostDate) return 1;
    const byCreated = b.latest.getTime() - a.latest.getTime();
    return byCreated || a.product.id.localeCompare(b.product.id);
  });
  const total = all.length;
  const pageRows = all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  const products = await this.prisma.product.findMany({
    where: { id: { in: pageRows.map((row) => row.product.id) } },
    select: {
      id: true, name: true, productCode: true,
      images: { where: { type: 'IMAGE', variantId: null, optionValueId: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { url: true } },
    },
  });
  const productMap = new Map(products.map((product) => [product.id, product]));
  const items = pageRows.map((row) => {
    const product = productMap.get(row.product.id);
    return {
      product: {
        id: row.product.id,
        name: product?.name ?? row.product.id,
        productCode: product?.productCode ?? null,
        thumbnailUrl: product?.images[0]?.url ?? null,
      },
      recordCount: row.recordCount,
      postCount: row.postCount,
      lastPostDate: row.lastPostDate,
      latestCreatedAt: row.latestCreatedAt,
    };
  });
  return { items, total, page: query.page, pageSize: query.pageSize };
}
```

- [ ] **Step 8: 序列化帖子资料**

Update `serialize` return:

```ts
private serialize(row: LinkWithDetails) {
  const { owner, product, landingPage, ...link } = row;
  return {
    ...link,
    postDate: postDateFromDb(row.postDate),
    postUrl: row.postUrl ?? null,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    aid: row.aidSnapshot,
    ownerName: owner.optimizerProfile?.displayName ?? owner.name,
    productName: product.name,
    productCode: product.productCode,
    productThumbnailUrl: product.images?.[0]?.url ?? null,
    pageName: landingPage?.name ?? null,
    path: linkPath(row),
  };
}
```

- [ ] **Step 9: 运行服务与 DTO 测试**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/campaign-links.service.spec.ts src/modules/marketing/marketing-post.spec.ts src/modules/marketing/dto/campaign-link.dto.spec.ts
```

Expected: PASS。若 Prisma 类型不接受 `orderBy.postDate.nulls`，改用 `{ postDate: 'desc' }` 并在读取后对当前页做空值后置排序；但必须保留稳定分页测试，不能让未登记日期的旧链接被分页隐藏。优先使用 Prisma 7 的 `{ sort, nulls }` 形式。

- [ ] **Step 10: 提交**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/backend/src/modules/marketing/campaign-links.service.ts small-house-commerce/backend/src/modules/marketing/campaign-links.service.spec.ts
git commit -m "feat(marketing): manage campaign post metadata and product groups"
```

---

### Task 3: 控制器路由与权限边界

**Files:**
- Modify: `small-house-commerce/backend/src/modules/marketing/admin/campaign-links.controller.ts`
- Modify: `small-house-commerce/backend/src/modules/marketing/admin/campaign-links.controller.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `listProductGroups`、`archiveLink`、`unarchiveLink`。
- Produces:
  - `GET /api/v1/admin/campaign-links/product-groups`
  - `POST /api/v1/admin/campaign-links/:id/archive`
  - `POST /api/v1/admin/campaign-links/:id/unarchive`

- [ ] **Step 1: 扩展控制器测试**

Append to `campaign-links.controller.spec.ts`:

```ts
it('exposes product groups before the id route and archive endpoints without delete or retarget', () => {
  const getPaths = Reflect.getMetadata(PATH_METADATA, CampaignLinksController.prototype.listProductGroups);
  expect(getPaths).toBe('product-groups');
  expect(CampaignLinksController.prototype).toHaveProperty('archive');
  expect(CampaignLinksController.prototype).toHaveProperty('unarchive');
  expect(CampaignLinksController.prototype).not.toHaveProperty('remove');
});
```

- [ ] **Step 2: 运行控制器测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/admin/campaign-links.controller.spec.ts
```

Expected: FAIL，方法不存在。

- [ ] **Step 3: 实现控制器**

Replace `campaign-links.controller.ts` imports and add routes:

```ts
import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CurrentMarketingAccount, MarketingGuard } from '../marketing.guard.js';
import type { MarketingAccount } from '../marketing-access.js';
import { CampaignLinksService } from '../campaign-links.service.js';
import {
  campaignLinkCloneSchema, campaignLinkCreateSchema, campaignLinkGroupQuerySchema, campaignLinkQuerySchema,
  campaignLinkUpdateSchema, campaignLinkVersionSchema,
  type CampaignLinkCreateInput, type CampaignLinkGroupQuery, type CampaignLinkQuery, type CampaignLinkUpdateInput,
} from '../dto/campaign-link.dto.js';
```

Add before `@Get(':id')`:

```ts
@Get('product-groups')
@Header('Cache-Control', 'private, no-store')
productGroups(@Query(new ZodValidationPipe(campaignLinkGroupQuerySchema)) query: CampaignLinkGroupQuery, @CurrentMarketingAccount() account: MarketingAccount) {
  return this.links.listProductGroups(query, account);
}
```

Add after `disable`:

```ts
@Post(':id/archive')
archive(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(campaignLinkVersionSchema)) input: z.infer<typeof campaignLinkVersionSchema>, @CurrentMarketingAccount() account: MarketingAccount) {
  return this.links.archiveLink(id, input.expectedVersion, account);
}

@Post(':id/unarchive')
unarchive(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(campaignLinkVersionSchema)) input: z.infer<typeof campaignLinkVersionSchema>, @CurrentMarketingAccount() account: MarketingAccount) {
  return this.links.unarchiveLink(id, input.expectedVersion, account);
}
```

- [ ] **Step 4: 运行控制器与相关服务测试**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/admin/campaign-links.controller.spec.ts src/modules/marketing/campaign-links.service.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/backend/src/modules/marketing/admin/campaign-links.controller.ts small-house-commerce/backend/src/modules/marketing/admin/campaign-links.controller.spec.ts
git commit -m "feat(marketing): expose post groups and archive routes"
```

---

### Task 4: 核算后端的发帖日期筛选与帖子元资料

**Files:**
- Modify: `small-house-commerce/backend/src/modules/marketing/dto/marketing-report.dto.ts`
- Modify: `small-house-commerce/backend/src/modules/marketing/dto/marketing-report.dto.spec.ts`
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-report.service.ts`
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-report-metrics.ts`
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-report-tree.ts`
- Modify: `small-house-commerce/backend/src/modules/marketing/marketing-report.integration.spec.ts`
- Modify: `small-house-commerce/backend/test/marketing-test-prisma.ts`

**Interfaces:**
- Produces:
  - `MarketingReportRow.postDate: string | null`
  - `MarketingReportRow.postUrl: string | null`
  - `MarketingReportRow.archivedAt: string | null`
  - `MarketingReportQuery.postDateFrom/postDateTo/postDateMissingOnly`

- [ ] **Step 1: 写 DTO 失败测试**

Append to `marketing-report.dto.spec.ts`:

```ts
it('parses post date filters and rejects conflicts', () => {
  expect(marketingReportQuerySchema.parse({ postDateFrom: '2026-11-03' })).toMatchObject({ postDateFrom: '2026-11-03' });
  expect(marketingReportQuerySchema.safeParse({ postDateMissingOnly: 'true', postDateFrom: '2026-11-01' }).success).toBe(false);
  expect(marketingReportQuerySchema.safeParse({ postDateFrom: '2026-11-03', postDateTo: '2026-11-02' }).success).toBe(false);
});
```

- [ ] **Step 2: 运行 DTO 测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/dto/marketing-report.dto.spec.ts
```

Expected: FAIL，未知字段被 strict 拒绝。

- [ ] **Step 3: 扩展报表 DTO**

Add to `marketing-report.dto.ts` before `page`:

```ts
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date.');
```

Add fields:

```ts
postDateFrom: calendarDate.optional(),
postDateTo: calendarDate.optional(),
postDateMissingOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
```

Extend the existing `.refine(...)` with a second `.superRefine((query, ctx) => { ... })`:

```ts
.superRefine((query, ctx) => {
  if (query.postDateMissingOnly && (query.postDateFrom || query.postDateTo)) {
    ctx.addIssue({ code: 'custom', path: ['postDateMissingOnly'], message: 'Missing-only excludes a date range.' });
  }
  if (query.postDateFrom && query.postDateTo && query.postDateFrom > query.postDateTo) {
    ctx.addIssue({ code: 'custom', path: ['postDateTo'], message: 'Post date range must be ordered.' });
  }
})
```

- [ ] **Step 4: 扩展指标类型与序列化**

In `marketing-report-metrics.ts` add to `MarketingReportRawRow`:

```ts
postDate?: Date | null; postUrl?: string | null; archivedAt?: Date | null;
```

Add to `MarketingReportSerializedRow`:

```ts
postDate: string | null; postUrl: string | null; archivedAt: string | null;
```

Add to `serializeMarketingReportRow` return:

```ts
postDate: row.postDate ? row.postDate.toISOString().slice(0, 10) : null,
postUrl: row.postUrl ?? null,
archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
```

- [ ] **Step 5: 扩展树合成行**

In `toRaw` in `marketing-report-tree.ts`, add:

```ts
postDate: null, postUrl: null, archivedAt: null,
```

- [ ] **Step 6: 扩展报表 SQL**

In `marketing-report.service.ts`, in `groups` CTE after `sourceType`:

```sql
          CASE WHEN COUNT(DISTINCT s.id) = 1 THEN MIN(s.post_date) END AS "postDate",
          CASE WHEN COUNT(DISTINCT s.id) = 1 THEN MIN(s.post_url) END AS "postUrl",
          CASE WHEN COUNT(DISTINCT s.id) = 1 THEN MIN(s.archived_at) END AS "archivedAt"
```

In the `SELECT 'REGISTERED'` list, insert after `g."sourceType"`:

```sql
        g."postDate", g."postUrl", g."archivedAt",
```

In the `UNION ALL` `other_orders` select list, add three matching NULLs after `NULL::text` for sourceType:

```sql
        NULL::date, NULL::text, NULL::timestamptz,
```

Verify the UNION column counts by running the query in the local integration database; a mismatch raises `each UNION query must have the same number of columns`.

- [ ] **Step 7: 扩展链接筛选**

In `scopedLinksWhere`, add:

```ts
${query.sourceType ? Prisma.sql`AND l.source_type = ${query.sourceType}::"SourceType"` : Prisma.empty}
${query.postDateMissingOnly ? Prisma.sql`AND l.source_type = 'FB_POST' AND l.post_date IS NULL` : Prisma.empty}
${query.postDateFrom ? Prisma.sql`AND l.source_type = 'FB_POST' AND l.post_date >= ${query.postDateFrom}::date` : Prisma.empty}
${query.postDateTo ? Prisma.sql`AND l.source_type = 'FB_POST' AND l.post_date <= ${query.postDateTo}::date` : Prisma.empty}
```

Update `otherSources`:

```ts
const postDateFiltered = Boolean(query.postDateFrom || query.postDateTo || query.postDateMissingOnly);
const otherSources = postDateFiltered ? [] : rows.filter(row => row.kind !== 'REGISTERED').map(row => serializeMarketingReportRow(row));
```

- [ ] **Step 8: 写真库集成测试**

In `marketing-report.integration.spec.ts` add:

```ts
it('filters registered Facebook posts by registered date without changing the metric cohort', async () => {
  const t = await target();
  await prisma.campaignLink.update({ where: { id: t.link.id }, data: { postDate: new Date('2026-10-04T00:00:00.000Z') } });
  await prisma.campaignLinkVisit.create({ data: { linkId: t.link.id, visitKey: 'post-date-1', visitDay: new Date('2026-10-05T00:00:00.000Z') } });
  await order(t);
  const hit = await report.report(query({ postDateFrom: '2026-10-04', postDateTo: '2026-10-04', linkIds: [t.link.id] }), own());
  expect(hit.rows[0]).toMatchObject({ postDate: '2026-10-04', submittedOrders: 1, visits: 1 });
  const miss = await report.report(query({ postDateFrom: '2026-10-03', postDateTo: '2026-10-03', linkIds: [t.link.id] }), own());
  expect(miss.rows).toHaveLength(0);
  expect(miss.otherSources).toHaveLength(0);
});

it('keeps links without a post date out of date filters but visible when unfiltered', async () => {
  const t = await target();
  const unfiltered = await report.report(query({ linkIds: [t.link.id] }), own());
  expect(unfiltered.rows[0]).toMatchObject({ postDate: null });
  const missing = await report.report(query({ postDateMissingOnly: true, linkIds: [t.link.id] }), own());
  expect(missing.rows[0]).toMatchObject({ postDate: null });
  const ranged = await report.report(query({ postDateFrom: '2026-10-01', linkIds: [t.link.id] }), own());
  expect(ranged.rows).toHaveLength(0);
});
```

Add the local test database allowlist entry in `backend/test/marketing-test-prisma.ts`:

```ts
  public: 'luwag_post_links_local_e2e_20261103',
```

This maps only the explicitly owned disposable database above; the guard still rejects any other database name. The app and the integration tests both use its `public` schema.

- [ ] **Step 9: 运行报表单测与真库测试**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing/dto/marketing-report.dto.spec.ts src/modules/marketing/marketing-report-metrics.spec.ts src/modules/marketing/marketing-report-tree.spec.ts src/modules/marketing/marketing-report.service.spec.ts
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/luwag_post_links_local_e2e_20261103?schema=public" \
MARKETING_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/luwag_post_links_local_e2e_20261103?schema=public" \
MARKETING_TEST_DATABASE_SCHEMA="public" \
pnpm vitest run src/modules/marketing/marketing-report.integration.spec.ts
```

Expected: 单测 PASS；真库测试在迁移完成前 SKIP 或失败。先执行 Task 1 迁移后再跑真库测试（见 Task 9 Step 1），此步记录真实结果，不伪造通过。

- [ ] **Step 10: 提交**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/backend/src/modules/marketing/dto/marketing-report.dto.ts small-house-commerce/backend/src/modules/marketing/dto/marketing-report.dto.spec.ts small-house-commerce/backend/src/modules/marketing/marketing-report.service.ts small-house-commerce/backend/src/modules/marketing/marketing-report-metrics.ts small-house-commerce/backend/src/modules/marketing/marketing-report-tree.ts small-house-commerce/backend/src/modules/marketing/marketing-report.integration.spec.ts small-house-commerce/backend/test/marketing-test-prisma.ts
git commit -m "feat(marketing): filter and expose post metadata in reports"
```

---

### Task 5: 前端 API 合同

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/marketing-api.ts`
- Modify: `small-house-commerce/frontend/src/lib/marketing-api.spec.ts`（若无该文件则创建）
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.tsx`（仅改名调用签名）
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx`（仅改名断言）

**Interfaces:**
- Produces:
  - `CampaignLinkInput.postDate?`, `.postUrl?`
  - `CampaignLinkRow.postDate: string | null`, `.postUrl: string | null`, `.archivedAt: string | null`
  - `CampaignLinkQuery.sourceType?`, `.archiveState?`, `.postDateFrom?`, `.postDateTo?`, `.postDateMissingOnly?`, `.orderBy?`
  - `CampaignLinkProductGroup`、`CampaignLinkGroupQuery`
  - `marketingApi.listProductGroups(query)`
  - `marketingApi.updateLink(id, input)`（签名改为对象）
  - `marketingApi.archiveLink(id, expectedVersion)`、`unarchiveLink(id, expectedVersion)`
  - `MarketingReportQuery.postDateFrom?` 等与 `MarketingReportRow.postDate/postUrl/archivedAt`

- [ ] **Step 1: 写 API 失败测试**

Create or append to `frontend/src/lib/marketing-api.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { marketingApi } from './marketing-api';

vi.mock('@/lib/admin-auth', () => ({
  adminAuthedFetch: vi.fn(async (url: string, init?: RequestInit) => ({ url, init })),
  AdminApiError: class extends Error {},
}));

describe('marketing api post contracts', () => {
  it('sends archive state, source and post-date filters', async () => {
    const result = await marketingApi.listLinks({ archiveState: 'UNARCHIVED', sourceType: 'FB_POST', postDateMissingOnly: true, orderBy: 'POST_DATE_DESC' });
    const url = String((result as unknown as { url: string }).url);
    expect(url).toContain('archiveState=UNARCHIVED');
    expect(url).toContain('sourceType=FB_POST');
    expect(url).toContain('postDateMissingOnly=true');
    expect(url).toContain('orderBy=POST_DATE_DESC');
  });

  it('updates metadata with one object and archives by version', async () => {
    await marketingApi.updateLink('id', { name: 'Post', postDate: '2026-11-03', expectedVersion: 2 });
    await marketingApi.archiveLink('id', 2);
    await marketingApi.unarchiveLink('id', 3);
  });
});
```

Adjust the mock shape to whatever `adminAuthedFetch` actually returns; if it unwraps JSON, spy on it and assert the URL/body arguments instead of return value.

- [ ] **Step 2: 运行 API 测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/lib/marketing-api.spec.ts
```

Expected: FAIL，类型/方法不存在。

- [ ] **Step 3: 扩展类型**

In `marketing-api.ts`:

```ts
export interface CampaignLinkInput {
  productId: string;
  variantId?: string | null;
  landingPageId?: string | null;
  name: string;
  sourceType: MarketingSourceType;
  postDate?: string | null;
  postUrl?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}

export interface CampaignLinkRow extends CampaignLinkInput {
  id: string;
  code: string;
  ownerUserId: string;
  ownerName: string;
  aid: string;
  variantId: string | null;
  variantNameSnapshot: string | null;
  landingPageId: string | null;
  productName: string;
  productCode: string | null;
  productThumbnailUrl: string | null;
  pageName: string | null;
  path: string;
  status: "ACTIVE" | "DISABLED";
  postDate: string | null;
  postUrl: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type CampaignLinkArchiveState = "UNARCHIVED" | "ARCHIVED" | "ALL";
export type CampaignLinkOrder = "CREATED_AT_DESC" | "POST_DATE_DESC";

export interface CampaignLinkQuery {
  search?: string;
  ownerUserId?: string;
  productId?: string;
  landingPageId?: string;
  status?: "ACTIVE" | "DISABLED";
  sourceType?: MarketingSourceType;
  archiveState?: CampaignLinkArchiveState;
  postDateFrom?: string;
  postDateTo?: string;
  postDateMissingOnly?: boolean;
  orderBy?: CampaignLinkOrder;
  page?: number;
  pageSize?: number;
}

export interface CampaignLinkProductGroup {
  product: { id: string; name: string; productCode: string | null; thumbnailUrl: string | null };
  recordCount: number;
  postCount: number;
  lastPostDate: string | null;
  latestCreatedAt: string;
}

export interface CampaignLinkGroupQuery {
  search?: string;
  ownerUserId?: string;
  productId?: string;
  landingPageId?: string;
  status?: "ACTIVE" | "DISABLED";
  sourceType?: MarketingSourceType;
  archiveState?: CampaignLinkArchiveState;
  postDateFrom?: string;
  postDateTo?: string;
  postDateMissingOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CampaignLinkUpdateInput {
  name?: string;
  postDate?: string | null;
  postUrl?: string | null;
  expectedVersion: number;
}
```

Add to `MarketingReportQuery` and `MarketingReportRow`:

```ts
postDateFrom?: string;
postDateTo?: string;
postDateMissingOnly?: boolean;
```

```ts
postDate: string | null;
postUrl: string | null;
archivedAt: string | null;
```

- [ ] **Step 4: 扩展方法**

In `marketingApi`:

```ts
listProductGroups: (query: CampaignLinkGroupQuery = {}) => linkRequest<Paged<CampaignLinkProductGroup>>(`/product-groups${queryString(query)}`),
updateLink: (id: string, input: CampaignLinkUpdateInput) => linkRequest<CampaignLinkRow>(pagePath(id), { method: "PATCH", body: JSON.stringify(input) }),
archiveLink: (id: string, expectedVersion: number) => linkRequest<CampaignLinkRow>(`${pagePath(id)}/archive`, { method: "POST", body: JSON.stringify({ expectedVersion }) }),
unarchiveLink: (id: string, expectedVersion: number) => linkRequest<CampaignLinkRow>(`${pagePath(id)}/unarchive`, { method: "POST", body: JSON.stringify({ expectedVersion }) }),
```

- [ ] **Step 5: 修正现有改名调用与测试夹具**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
rg -l "CampaignLinkRow" src | sort
rg -n "CampaignLinkRow =" src | sort
```

For every literal typed `CampaignLinkRow` (at least `CampaignLinksList.spec.tsx`, `MarketingPageEdit.spec.tsx`, `PerformancePageTable.spec.tsx`, `AdCostsList.spec.tsx`, and any report fixtures that build links), add:

```ts
postDate: null, postUrl: null, archivedAt: null,
```

Do not remove existing fields or weaken the type with `as unknown as CampaignLinkRow`.

In `CampaignLinksList.tsx` change:

```ts
await marketingApi.updateLink(row.id, { name: renaming!.name.trim(), expectedVersion: row.version });
```

In `CampaignLinksList.spec.tsx` change the assertion:

```ts
expect(marketingApi.updateLink).toHaveBeenCalledWith("link-1", { name: "Unsaved name", expectedVersion: 2 });
```

- [ ] **Step 6: 运行 API 与链接列表测试**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/lib/marketing-api.spec.ts src/components/admin/marketing/CampaignLinksList.spec.tsx
```

Expected: PASS。若 `Paged<T>` 未导出，使用现有分页接口的返回类型或直接内联 `{ items; total; page; pageSize }`。

- [ ] **Step 7: 提交**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/frontend/src/lib/marketing-api.ts small-house-commerce/frontend/src/lib/marketing-api.spec.ts small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.tsx small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx
git commit -m "feat(marketing): add post-link client contracts"
```

---

### Task 6: 中英文文案与发帖日期工具

**Files:**
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`
- Create: `small-house-commerce/frontend/src/lib/marketing-post-date.ts`
- Create: `small-house-commerce/frontend/src/lib/marketing-post-date.spec.ts`

**Interfaces:**
- Produces: `manilaToday(): string`，以及新增 i18n keys。

- [ ] **Step 1: 写 Manila 日期测试**

Create `frontend/src/lib/marketing-post-date.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { manilaToday } from './marketing-post-date';

describe('manilaToday', () => {
  it('uses the Manila calendar day across UTC boundaries', () => {
    expect(manilaToday(new Date('2026-11-02T16:00:00.000Z'))).toBe('2026-11-03');
    expect(manilaToday(new Date('2026-11-03T15:59:59.000Z'))).toBe('2026-11-03');
    expect(manilaToday(new Date('2026-11-03T16:00:00.000Z'))).toBe('2026-11-04');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/lib/marketing-post-date.spec.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现日期工具**

Create `frontend/src/lib/marketing-post-date.ts`:

```ts
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function manilaToday(now: Date = new Date()): string {
  return formatter.format(now);
}
```

- [ ] **Step 4: 增加 i18n keys**

Before the final `} as const;` in `zh.ts` and before the final `};` in `en.ts`, add these keys with identical names:

```ts
  marketing_post_view_products: "按商品",
  marketing_post_view_all_links: "全部链接",
  marketing_post_add: "新增帖子",
  marketing_post_drawer_title: "商品投放记录 / 帖子明细",
  marketing_post_view_records: "查看帖子",
  marketing_post_drawer_note: "按发帖日期倒序排列。归档不会停用链接。",
  marketing_post_count: "{count} 条记录",
  marketing_post_facebook_count: "{count} 条 Facebook 帖子",
  marketing_post_last_post: "最近发帖",
  marketing_post_unregistered: "发布日期未登记",
  marketing_post_date: "发帖日期",
  marketing_post_date_hint: "按菲律宾时间登记，不是核算统计区间。",
  marketing_post_name: "帖子名称 / 内容主题",
  marketing_post_name_auto: "留空则按日期、商品和链接编号自动命名",
  marketing_post_url: "Facebook 原帖地址",
  marketing_post_url_optional: "选填，发帖后再补也可以",
  marketing_post_url_hint: "用于日后回看原帖，不影响生成追踪链接。",
  marketing_post_edit: "编辑帖子资料",
  marketing_post_edit_hint: "修改资料不会创建新帖子，原链接与历史归因不变。",
  marketing_post_archive: "归档这条记录",
  marketing_post_unarchive: "取消归档",
  marketing_post_archive_confirm: "归档只收起记录，旧链接仍可继续访问和归因。",
  marketing_post_unarchive_confirm: "恢复到未归档列表，原链接与统计保持不变。",
  marketing_post_archived: "已归档",
  marketing_post_original: "打开原帖",
  marketing_post_create_result: "专属链接已生成",
  marketing_post_create_result_hint: "这条帖子有自己的独立追踪标识。",
  marketing_post_short_link: "该帖专属短链",
  marketing_post_full_link: "完整投放链接",
  marketing_post_short_failed: "短链生成失败，已创建记录仍保留；可复制长链或重试短链。",
  marketing_post_retry_short: "重试短链",
  marketing_post_continue: "继续新增",
  marketing_post_created_notice: "帖子已创建，链接仅在本地演示/测试环境使用。",
  marketing_post_filter_source: "来源",
  marketing_all_sources: "全部来源",
  marketing_post_filter_archive: "归档状态",
  marketing_post_archive_unarchived: "未归档记录",
  marketing_post_archive_archived: "已归档记录",
  marketing_post_archive_all: "全部归档状态",
  marketing_post_post_date_filter: "发帖日期",
  marketing_post_post_date_from: "发帖起始日",
  marketing_post_post_date_to: "发帖结束日",
  marketing_post_missing_only: "只看发布日期未登记",
  marketing_post_report_hint: "发帖日期与统计区间分开；归档帖子仍计入核算。",
  marketing_post_other_sources_hidden: "当前仅统计符合条件的已登记 Facebook 帖子链接。",
  marketing_post_conflict: "记录已被其他人修改，请刷新后再保存。",
  marketing_post_manage_denied: "没有管理这条记录的权限。",
  common_done: "完成",
```

English equivalents (same keys, English text):

```ts
  marketing_post_view_products: "By product",
  marketing_post_view_all_links: "All links",
  marketing_post_add: "Add post",
  marketing_post_drawer_title: "Product records / post details",
  marketing_post_view_records: "View posts",
  marketing_post_drawer_note: "Newest post date first. Archiving does not disable the link.",
  marketing_post_count: "{count} records",
  marketing_post_facebook_count: "{count} Facebook posts",
  marketing_post_last_post: "Last post",
  marketing_post_unregistered: "Post date not registered",
  marketing_post_date: "Post date",
  marketing_post_date_hint: "Registered in Manila time; it is not the reporting period.",
  marketing_post_name: "Post name / topic",
  marketing_post_name_auto: "Leave blank to name it from the date, product and link code",
  marketing_post_url: "Facebook post URL",
  marketing_post_url_optional: "Optional; you can add it after publishing",
  marketing_post_url_hint: "Used to revisit the post; it does not affect the tracking link.",
  marketing_post_edit: "Edit post details",
  marketing_post_edit_hint: "Editing does not create a new post or change the link identity.",
  marketing_post_archive: "Archive this record",
  marketing_post_unarchive: "Unarchive",
  marketing_post_archive_confirm: "Archiving only hides the record; the link stays live and keeps attributing.",
  marketing_post_unarchive_confirm: "Return it to the unarchived list without changing the link or history.",
  marketing_post_archived: "Archived",
  marketing_post_original: "Open original post",
  marketing_post_create_result: "Dedicated link created",
  marketing_post_create_result_hint: "This post has its own tracking identity.",
  marketing_post_short_link: "Post short link",
  marketing_post_full_link: "Full tracking link",
  marketing_post_short_failed: "Short link failed; the record is saved. Copy the full link or retry the short link.",
  marketing_post_retry_short: "Retry short link",
  marketing_post_continue: "Add another",
  marketing_post_created_notice: "Post created; the link is for the local demo/test environment only.",
  marketing_post_filter_source: "Source",
  marketing_all_sources: "All sources",
  marketing_post_filter_archive: "Archive",
  marketing_post_archive_unarchived: "Unarchived records",
  marketing_post_archive_archived: "Archived records",
  marketing_post_archive_all: "All archive states",
  marketing_post_post_date_filter: "Post date",
  marketing_post_post_date_from: "Post date from",
  marketing_post_post_date_to: "Post date to",
  marketing_post_missing_only: "Only records without a post date",
  marketing_post_report_hint: "Post date and reporting period are separate; archived posts still count.",
  marketing_post_other_sources_hidden: "Showing only registered Facebook post links that match the post-date filter.",
  marketing_post_conflict: "This record changed. Reload before saving again.",
  marketing_post_manage_denied: "You cannot manage this record.",
  common_done: "Done",
```

- [ ] **Step 5: 运行日期测试与类型检查**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/lib/marketing-post-date.spec.ts
pnpm exec tsc --noEmit
```

Expected: 测试 PASS；TypeScript 检查 0 error（i18n key 完整性由 `zh`/`en` 的 `satisfies`/`ZhKey` 约束）。

- [ ] **Step 6: 提交**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/frontend/src/i18n/zh.ts small-house-commerce/frontend/src/i18n/en.ts small-house-commerce/frontend/src/lib/marketing-post-date.ts small-house-commerce/frontend/src/lib/marketing-post-date.spec.ts
git commit -m "feat(marketing): add post management copy and Manila date helper"
```

---

### Task 7: 新增帖子弹窗与结果弹窗（含短链）

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/CreateCampaignLinkDialog.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/marketing/PostLinkResultDialog.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/CreateCampaignLinkDialog.spec.tsx`（若不存在则创建）

**Interfaces:**
- Consumes: `manilaToday()`、`marketingApi.createShortLink`、`copyText`。
- Produces:
  - `<CreateCampaignLinkDialog ... defaultSourceType? onSaved={link => ...} />`
  - `<PostLinkResultDialog link onClose onContinue onCreateShortLink? />`

- [ ] **Step 1: 写创建弹窗失败测试**

Create `CreateCampaignLinkDialog.spec.tsx` with the same auth/linkContext mocks as `CampaignLinksList.spec.tsx`, then:

```tsx
it('creates a Facebook post with today in Manila and lets the server auto-name it', async () => {
  vi.mocked(marketingApi.createLink).mockResolvedValue({ ...row, sourceType: "FB_POST", postDate: "2026-11-03", postUrl: null, archivedAt: null, name: "11-03｜Chair｜帖子 abcdef" });
  render(<AdminI18nProvider><CreateCampaignLinkDialog productId="p1" defaultSourceType="FB_POST" onClose={vi.fn()} onSaved={vi.fn()} /></AdminI18nProvider>);
  await screen.findByTestId("link-builder-product-current");
  expect(screen.getByLabelText("发帖日期")).toHaveValue("2026-11-03");
  fireEvent.click(screen.getByRole("button", { name: "保存并生成链接" }));
  await waitFor(() => expect(marketingApi.createLink).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "FB_POST", postDate: "2026-11-03" })));
  expect(vi.mocked(marketingApi.createLink).mock.calls[0][0]).not.toHaveProperty("name");
});

it('hides post fields for a non-post source', async () => {
  render(<AdminI18nProvider><CreateCampaignLinkDialog productId="p1" defaultSourceType="META_AD" onClose={vi.fn()} onSaved={vi.fn()} /></AdminI18nProvider>);
  await screen.findByTestId("link-builder-product-current");
  expect(screen.queryByLabelText("发帖日期")).not.toBeInTheDocument();
});
```

Use fake timers or `vi.setSystemTime(new Date("2026-11-03T02:00:00.000Z"))` so the default date is deterministic.

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/components/admin/marketing/CreateCampaignLinkDialog.spec.tsx
```

Expected: FAIL，`defaultSourceType` 与帖子字段不存在。

- [ ] **Step 3: 扩展创建弹窗**

In `CreateCampaignLinkDialog.tsx`:

```tsx
import { manilaToday } from "@/lib/marketing-post-date";

export function CreateCampaignLinkDialog({
  productId: initialProductId, landingPageId: initialPageId, copyFrom,
  defaultSourceType = copyFrom?.sourceType ?? "META_AD",
  onClose, onSaved,
}: {
  productId?: string; landingPageId?: string; copyFrom?: CampaignLinkRow;
  defaultSourceType?: MarketingSourceType;
  onClose: () => void; onSaved: (link: CampaignLinkRow) => void;
}) {
```

State:

```tsx
const [sourceType, setSourceType] = useState<MarketingSourceType>(defaultSourceType);
const [postDate, setPostDate] = useState(defaultSourceType === "FB_POST" ? manilaToday() : "");
const [postUrl, setPostUrl] = useState("");
```

When copying an existing post, `postDate` starts at Manila today and `postUrl` starts empty; never inherit the source post's date or URL.

When source changes:

```tsx
onChange={(event) => {
  const next = event.target.value as MarketingSourceType;
  setSourceType(next);
  if (next === "FB_POST" && !postDate) setPostDate(manilaToday());
}}
```

Render post fields between source and metadata:

```tsx
{sourceType === "FB_POST" && <>
  <label className="space-y-1 text-sm">{t("marketing_post_date")}<input type="date" required className={fieldClass} value={postDate} onChange={(event) => setPostDate(event.target.value)} /></label>
  <label className="space-y-1 text-sm sm:col-span-2">{t("marketing_post_url")}<input type="url" maxLength={2048} className={fieldClass} value={postUrl} onChange={(event) => setPostUrl(event.target.value)} placeholder="https://www.facebook.com/..." /><span className="text-xs text-admin-muted">{t("marketing_post_url_hint")}</span></label>
</>}
```

Name field:

```tsx
<label className="space-y-1 text-sm">{t("marketing_internal_name")}<input maxLength={120} className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} placeholder={sourceType === "FB_POST" ? t("marketing_post_name_auto") : ""} /></label>
```

Save guard and input:

```tsx
const postReady = sourceType !== "FB_POST" || Boolean(postDate);
if (!product || (landingPageId && !page) || !postReady || (!name.trim() && sourceType !== "FB_POST") || operation.current) return;
const input = {
  productId, landingPageId: landingPageId || null, variantId: variantId || null,
  sourceType,
  ...(name.trim() ? { name: name.trim() } : {}),
  ...(sourceType === "FB_POST" ? { postDate, postUrl: postUrl.trim() || null } : {}),
  ...Object.fromEntries(metadata.map(([key]) => [key, fields[key]?.trim() || null])),
};
```

Button disabled condition:

```tsx
disabled={busy || !context || unavailable || (sourceType === "FB_POST" ? !postDate : !name.trim())}
```

When copyFrom exists, initialize `postDate`/`postUrl` to empty for new copy (not inherited):

```tsx
const [postDate, setPostDate] = useState(defaultSourceType === "FB_POST" ? manilaToday() : "");
const [postUrl, setPostUrl] = useState("");
```

- [ ] **Step 4: 实现结果弹窗**

Create `PostLinkResultDialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { copyText } from "@/lib/clipboard";
import { marketingApi, type CampaignLinkRow } from "@/lib/marketing-api";

const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-gray-50 px-3 py-2 text-sm";

export function PostLinkResultDialog({ link, onClose, onContinue }: {
  link: CampaignLinkRow;
  onClose: () => void;
  onContinue: () => void;
}) {
  const { t } = useAdminI18n();
  const [shortPath, setShortPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin] = useState(() => typeof window === "undefined" ? "" : window.location.origin);

  async function shorten() {
    if (busy) return;
    setBusy(true); setError(null);
    try { setShortPath((await marketingApi.createShortLink({ url: link.path })).path); }
    catch { setError(t("marketing_post_short_failed")); }
    finally { setBusy(false); }
  }

  useEffect(() => { void shorten(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [link.id]);

  const shortUrl = shortPath ? (origin ? new URL(shortPath, origin).href : shortPath) : "";
  const fullUrl = origin ? new URL(link.path, origin).href : link.path;

  async function copy(value: string) {
    const copied = await copyText(value);
    setNotice(t(copied ? "link_builder_copied" : "common_copy_failed_manual"));
  }

  return <Dialog open initialFocus="first" onClose={onClose} title={t("marketing_post_create_result")}>
    <div className="space-y-4">
      <p className="text-sm text-admin-muted">{t("marketing_post_create_result_hint")}</p>
      <div><p className="text-xs font-medium text-admin-muted">{t("marketing_post_short_link")}</p>
        <div className="mt-1 flex gap-2"><input readOnly className={fieldClass} aria-label={t("marketing_post_short_link")} value={shortUrl || link.path} /><button type="button" className="rounded-lg bg-cta px-3 py-2 text-sm font-semibold text-white" onClick={() => void copy(shortUrl || fullUrl)}>{t("marketing_short_link_copy")}</button></div>
        {error && <p role="alert" className="mt-1 text-xs text-red-700">{error} <button type="button" className="underline" disabled={busy} onClick={() => void shorten()}>{t("marketing_post_retry_short")}</button></p>}
      </div>
      <div><p className="text-xs font-medium text-admin-muted">{t("marketing_post_full_link")}</p><input readOnly className={fieldClass} aria-label={t("marketing_post_full_link")} value={fullUrl} /></div>
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className="rounded-lg border border-admin-border px-3 py-2 text-sm" onClick={onContinue}>{t("marketing_post_continue")}</button><button type="button" className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white" onClick={onClose}>{t("common_done")}</button></div>
    </div>
  </Dialog>;
}
```

If `common_done` does not exist, add it to both dictionaries with `"完成"` / `"Done"`; do not reference a missing key.

- [ ] **Step 5: 运行创建弹窗测试**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/components/admin/marketing/CreateCampaignLinkDialog.spec.tsx
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/frontend/src/components/admin/marketing/CreateCampaignLinkDialog.tsx small-house-commerce/frontend/src/components/admin/marketing/CreateCampaignLinkDialog.spec.tsx small-house-commerce/frontend/src/components/admin/marketing/PostLinkResultDialog.tsx
git commit -m "feat(marketing): create posts with dedicated short links"
```

---

### Task 8: 按商品视图、帖子抽屉、编辑与归档

**Files:**
- Create: `small-house-commerce/frontend/src/components/admin/marketing/ProductLinksTable.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/marketing/ProductPostsDrawer.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/marketing/EditPostDialog.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/MarketingWorkbench.tsx`

**Interfaces:**
- Consumes: Task 5 API、Task 6 copy、Task 7 dialog/result。
- Produces:
  - `<CampaignLinksList workspace?: boolean />`
  - `<ProductLinksTable groups ... />`
  - `<ProductPostsDrawer productId ... />`

- [ ] **Step 1: 写工作区失败测试**

Append to `CampaignLinksList.spec.tsx`:

```tsx
it('defaults the workbench to product tiles and opens a product drawer', async () => {
  vi.mocked(marketingApi.listProductGroups).mockResolvedValue({ items: [{ product: { id: "p1", name: "Chair", productCode: "CHAIR-1", thumbnailUrl: "/uploads/chair.jpg" }, recordCount: 3, postCount: 2, lastPostDate: "2026-11-03", latestCreatedAt: "2026-11-03T01:00:00.000Z" }], total: 1, page: 1, pageSize: 20 });
  mount({ workspace: true });
  expect(await screen.findByText("3 条记录")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看帖子" }));
  expect(marketingApi.listLinks).toHaveBeenLastCalledWith(expect.objectContaining({ productId: "p1", orderBy: "POST_DATE_DESC" }));
});

it('archives and unarchives through the version-aware endpoint', async () => {
  vi.mocked(marketingApi.archiveLink).mockResolvedValue({ ...row, archivedAt: "2026-11-03T02:00:00.000Z", version: 3 });
  mount(); await screen.findByText("Ad A");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "归档这条记录" }));
  await waitFor(() => expect(marketingApi.archiveLink).toHaveBeenCalledWith("link-1", 2));
});
```

Add `listProductGroups`, `archiveLink`, `unarchiveLink`, `createShortLink` to the `vi.mock` object.

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/components/admin/marketing/CampaignLinksList.spec.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现商品表格**

Create `ProductLinksTable.tsx`:

```tsx
"use client";

import { useAdminI18n } from "@/lib/admin-i18n";
import type { CampaignLinkProductGroup } from "@/lib/marketing-api";
import { ProductThumb } from "./ReportColumns";

const buttonClass = "rounded-md border border-admin-border px-2 py-1.5 text-xs";

export function ProductLinksTable({ groups, canCreate, onOpen, onCreate }: {
  groups: CampaignLinkProductGroup[]; canCreate: boolean;
  onOpen: (productId: string) => void; onCreate: (productId: string) => void;
}) {
  const { t } = useAdminI18n();
  return <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
    <table className="w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs text-admin-muted"><tr>{[t("link_builder_product"), t("marketing_links"), t("marketing_post_last_post"), t("common_actions")].map(key => <th key={key} className="whitespace-nowrap px-3 py-2">{key}</th>)}</tr></thead>
      <tbody className="divide-y divide-admin-border">
        {groups.map(group => <tr key={group.product.id}>
          <td className="px-3 py-3"><div className="flex items-center gap-2"><ProductThumb url={group.product.thumbnailUrl} label={group.product.name} /><div><p className="font-medium">{group.product.name}</p><p className="text-xs text-admin-muted">{group.product.productCode ?? "—"}</p></div></div></td>
          <td className="px-3 py-3"><p>{t("marketing_post_count", { count: String(group.recordCount) })}</p><p className="text-xs text-admin-muted">{t("marketing_post_facebook_count", { count: String(group.postCount) })}</p></td>
          <td className="px-3 py-3"><p>{group.lastPostDate ?? t("marketing_post_unregistered")}</p></td>
          <td className="px-3 py-3"><div className="flex flex-wrap justify-end gap-1"><button type="button" className={buttonClass} onClick={() => onOpen(group.product.id)}>{t("marketing_post_view_records")}</button>{canCreate && <button type="button" className={buttonClass} onClick={() => onCreate(group.product.id)}>{t("marketing_post_add")}</button>}</div></td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}
```

`marketing_post_view_records` is added in Task 6; do not derive a button label by splitting another translation string.

- [ ] **Step 4: 实现帖子抽屉**

Create `ProductPostsDrawer.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { copyText } from "@/lib/clipboard";
import { canManageMarketingPage, marketingApi, type CampaignLinkArchiveState, type CampaignLinkRow, type MarketingSourceType } from "@/lib/marketing-api";
import { EditPostDialog } from "./EditPostDialog";

const buttonClass = "rounded-md border border-admin-border px-2 py-1.5 text-xs disabled:opacity-40";

export function ProductPostsDrawer({ productId, productName, filters, onClose, onChanged, onCreate }: {
  productId: string; productName: string;
  filters: { sourceType?: MarketingSourceType; ownerUserId?: string; archiveState: CampaignLinkArchiveState; postDateFrom?: string; postDateTo?: string; postDateMissingOnly?: boolean };
  onClose: () => void; onChanged: () => void; onCreate: () => void;
}) {
  const { admin } = useAdminAuth();
  const { t } = useAdminI18n();
  const { sourceType, ownerUserId, archiveState, postDateFrom, postDateTo, postDateMissingOnly } = filters;
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<{ items: CampaignLinkRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CampaignLinkRow | null>(null);
  const all = Boolean(admin?.permissions.includes("MARKETING_VIEW_ALL"));

  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    marketingApi.listLinks({ productId, page, pageSize: 20, orderBy: "POST_DATE_DESC", archiveState, sourceType, ownerUserId: all ? ownerUserId : undefined, postDateFrom, postDateTo, postDateMissingOnly })
      .then(result => { if (alive) setData(result); })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [productId, page, revision, archiveState, sourceType, ownerUserId, postDateFrom, postDateTo, postDateMissingOnly, all]);

  async function mutate(row: CampaignLinkRow, action: "archive" | "unarchive" | "disable") {
    if (!canManageMarketingPage(admin, row.ownerUserId) || busy) return;
    if (action !== "archive" && !window.confirm(t("marketing_link_disable_confirm"))) return;
    if (action === "archive" && !window.confirm(t("marketing_post_archive_confirm"))) return;
    if (action === "unarchive" && !window.confirm(t("marketing_post_unarchive_confirm"))) return;
    setBusy(true); setError(null);
    try {
      if (action === "archive") await marketingApi.archiveLink(row.id, row.version);
      else if (action === "unarchive") await marketingApi.unarchiveLink(row.id, row.version);
      else await marketingApi.disableLink(row.id, row.version);
      setRevision(value => value + 1); onChanged();
    } catch (reason) {
      setError(reason instanceof AdminApiError && reason.status === 409 ? t("marketing_post_conflict") : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  async function copy(row: CampaignLinkRow) {
    const origin = window.location.origin;
    let url = new URL(row.path, origin).href;
    try {
      const short = await marketingApi.createShortLink({ url: row.path });
      url = new URL(short.path, origin).href;
    } catch {
      // Keep the full tracking link when short-link creation fails.
    }
    const copied = await copyText(url);
    setError(copied ? null : t("common_copy_failed_manual"));
  }

  return <div className="fixed inset-0 z-40 bg-black/30" role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={t("marketing_post_drawer_title")} className="ml-auto flex h-full w-full max-w-5xl flex-col bg-white shadow-xl">
      <header className="flex items-center justify-between gap-3 border-b border-admin-border p-4">
        <div><h2 className="font-semibold">{productName}</h2><p className="text-xs text-admin-muted">{t("marketing_post_drawer_note")}</p></div>
        <div className="flex gap-2"><button type="button" className={buttonClass} onClick={onCreate}>{t("marketing_post_add")}</button><button type="button" className={buttonClass} onClick={onClose}>{t("common_cancel")}</button></div>
      </header>
      {error && <p role="alert" className="p-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="p-4 text-sm text-admin-muted">{t("common_loading")}</p>}
      {data && <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs text-admin-muted"><tr>{[t("marketing_post_date"), t("marketing_internal_name"), t("marketing_owner"), t("common_status"), t("common_actions")].map(key => <th key={key} className="px-3 py-2">{key}</th>)}</tr></thead>
          <tbody className="divide-y divide-admin-border">{data.items.map(row => {
            const owner = canManageMarketingPage(admin, row.ownerUserId);
            return <tr key={row.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-3">{row.postDate ?? (row.sourceType === "FB_POST" ? t("marketing_post_unregistered") : "—")}</td>
              <td className="px-3 py-3"><p className="font-medium">{row.name}</p><p className="text-xs text-admin-muted">{t(`marketing_source_${row.sourceType}` as Parameters<typeof t>[0])}</p>{row.archivedAt && <span className="text-xs text-amber-800">{t("marketing_post_archived")}</span>}{row.postUrl && <a className="ml-2 text-xs underline" href={row.postUrl} target="_blank" rel="noopener noreferrer">{t("marketing_post_original")}</a>}</td>
              <td className="px-3 py-3">{row.ownerName}<p className="text-xs text-admin-muted">{row.aid}</p></td>
              <td className="px-3 py-3">{row.status === "ACTIVE" ? t("marketing_link_active") : t("marketing_status_DISABLED")}</td>
              <td className="px-3 py-3"><div className="flex flex-wrap justify-end gap-1">
                <button type="button" className={buttonClass} onClick={() => void copy(row)}>{t("marketing_link_copy_url")}</button>
                {owner && <button type="button" className={buttonClass} disabled={busy} onClick={() => setEditing(row)}>{t("marketing_post_edit")}</button>}
                {owner && (row.archivedAt
                  ? <button type="button" className={buttonClass} disabled={busy} onClick={() => void mutate(row, "unarchive")}>{t("marketing_post_unarchive")}</button>
                  : <button type="button" className={buttonClass} disabled={busy} onClick={() => void mutate(row, "archive")}>{t("marketing_post_archive")}</button>)}
                <Link className={buttonClass} href={`/admin/marketing/reports?${new URLSearchParams({ productId: row.productId, linkId: row.id })}`}>{t("marketing_reports")}</Link>
                {owner && row.status === "ACTIVE" && <button type="button" className={buttonClass} disabled={busy} onClick={() => void mutate(row, "disable")}>{t("marketing_disable")}</button>}
              </div></td>
            </tr>;
          })}{!data.items.length && <tr><td colSpan={5} className="p-6 text-center text-admin-muted">{t("marketing_links_empty")}</td></tr>}</tbody>
        </table>
      </div>}
      {data && <footer className="flex items-center justify-between border-t border-admin-border p-3 text-xs text-admin-muted"><span>{t("marketing_post_count", { count: String(data.total) })}</span><div className="flex gap-2"><button type="button" className={buttonClass} disabled={page === 1} onClick={() => setPage(value => value - 1)}>{t("marketing_previous")}</button><span>{page}</span><button type="button" className={buttonClass} disabled={page * 20 >= data.total} onClick={() => setPage(value => value + 1)}>{t("marketing_next")}</button></div></footer>}
      {editing && <EditPostDialog link={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision(value => value + 1); onChanged(); }} />}
    </section>
  </div>;
}
```

- [ ] **Step 5: 实现编辑弹窗**

Create `EditPostDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { marketingApi, type CampaignLinkRow } from "@/lib/marketing-api";

const fieldClass = "w-full min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm";

export function EditPostDialog({ link, onClose, onSaved }: { link: CampaignLinkRow; onClose: () => void; onSaved: (row: CampaignLinkRow) => void }) {
  const { t } = useAdminI18n();
  const [name, setName] = useState(link.name);
  const [postDate, setPostDate] = useState(link.postDate ?? "");
  const [postUrl, setPostUrl] = useState(link.postUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy || !name.trim() || (link.sourceType === "FB_POST" && !postDate)) return;
    setBusy(true); setError(null);
    try {
      onSaved(await marketingApi.updateLink(link.id, {
        name: name.trim(),
        ...(link.sourceType === "FB_POST" ? { postDate, postUrl: postUrl.trim() || null } : {}),
        expectedVersion: link.version,
      }));
    } catch (reason) {
      setError(reason instanceof AdminApiError && reason.status === 409 ? t("marketing_post_conflict") : reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  return <Dialog open initialFocus="first" onClose={() => { if (!busy) onClose(); }} title={t("marketing_post_edit")}>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="text-xs text-admin-muted">{t("marketing_post_edit_hint")}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <label className="block space-y-1 text-sm">{t("marketing_internal_name")}<input required maxLength={120} className={fieldClass} value={name} onChange={event => setName(event.target.value)} /></label>
      {link.sourceType === "FB_POST" && <>
        <label className="block space-y-1 text-sm">{t("marketing_post_date")}<input required type="date" className={fieldClass} value={postDate} onChange={event => setPostDate(event.target.value)} /></label>
        <label className="block space-y-1 text-sm">{t("marketing_post_url")}<input type="url" maxLength={2048} className={fieldClass} value={postUrl} onChange={event => setPostUrl(event.target.value)} /></label>
      </>}
      <div className="flex justify-end gap-2"><button type="button" className={fieldClass + " w-auto"} disabled={busy} onClick={onClose}>{t("common_cancel")}</button><button type="submit" className="rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !name.trim()}>{t("common_save")}</button></div>
    </form>
  </Dialog>;
}
```

- [ ] **Step 6: 在 CampaignLinksList 中接入工作区**

Add imports at the top:

```tsx
import { EditPostDialog } from "./EditPostDialog";
import { PostLinkResultDialog } from "./PostLinkResultDialog";
import { ProductLinksTable } from "./ProductLinksTable";
import { ProductPostsDrawer } from "./ProductPostsDrawer";
```

Add props:

```tsx
const sources: MarketingSourceType[] = ["FB_POST", "META_AD", "ORGANIC", "DIRECT", "EMAIL", "OTHER"];

export function CampaignLinksList({ productId, landingPageId, onLoaded, workspace = false }: { productId?: string; landingPageId?: string; onLoaded?: (total: number) => void; workspace?: boolean }) {
```

Add state:

```tsx
const [view, setView] = useState<"products" | "flat">("products");
const [archiveState, setArchiveState] = useState<CampaignLinkArchiveState>("UNARCHIVED");
const [sourceType, setSourceType] = useState<MarketingSourceType | "">("");
const [postDateFrom, setPostDateFrom] = useState("");
const [postDateTo, setPostDateTo] = useState("");
const [postMissingOnly, setPostMissingOnly] = useState(false);
const [groupPage, setGroupPage] = useState(1);
const [groups, setGroups] = useState<{ items: CampaignLinkProductGroup[]; total: number } | null>(null);
const [drawerProduct, setDrawerProduct] = useState<{ id: string; name: string } | null>(null);
const [resultLink, setResultLink] = useState<CampaignLinkRow | null>(null);
```

Add effect for groups when `workspace && view === "products"`:

```tsx
useEffect(() => {
  if (!admin || !workspace || view !== "products") return;
  let alive = true;
  marketingApi.listProductGroups({ productId: productFilter || productId, landingPageId, search: filter || undefined, status: status || undefined, sourceType: sourceType || undefined, archiveState, postDateFrom: postDateFrom || undefined, postDateTo: postDateTo || undefined, postDateMissingOnly: postMissingOnly || undefined, ownerUserId: (all ? ownerFilter : undefined) || undefined, page: groupPage, pageSize: 20 })
    .then(result => { if (alive) setGroups(result); })
    .catch(reason => { if (alive) setActionError(reason instanceof Error ? reason.message : String(reason)); });
  return () => { alive = false; };
}, [admin, workspace, view, productFilter, productId, landingPageId, filter, status, sourceType, archiveState, postDateFrom, postDateTo, postMissingOnly, ownerFilter, all, groupPage, revision]);
```

Extend link query effect with `sourceType`, `archiveState`, `postDateFrom`, `postDateTo`, `postMissingOnly`, and `orderBy` for flat; for products view, skip link fetch. Add all six values to the effect dependency array:

```tsx
if (!admin || (workspace && view === "products")) return;
marketingApi.listLinks({ ..., sourceType: sourceType || undefined, archiveState, postDateFrom: postDateFrom || undefined, postDateTo: postDateTo || undefined, postDateMissingOnly: postMissingOnly || undefined, orderBy: workspace ? "POST_DATE_DESC" : "CREATED_AT_DESC", ... })
```

Render header with view switch when workspace:

```tsx
{workspace && <div className="flex flex-wrap items-center gap-2">
  <div className="inline-flex rounded-lg border border-admin-border bg-slate-50 p-0.5">
    <button type="button" className={view === "products" ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold" : "px-3 py-1.5 text-xs"} onClick={() => setView("products")}>{t("marketing_post_view_products")}</button>
    <button type="button" className={view === "flat" ? "rounded-md bg-white px-3 py-1.5 text-xs font-semibold" : "px-3 py-1.5 text-xs"} onClick={() => setView("flat")}>{t("marketing_post_view_all_links")}</button>
  </div>
</div>}
```

Render filters:

```tsx
<select aria-label={t("marketing_post_filter_source")} value={sourceType} onChange={event => { const next = event.target.value as MarketingSourceType | ""; setSourceType(next); if (next && next !== "FB_POST") { setPostDateFrom(""); setPostDateTo(""); setPostMissingOnly(false); } setGroupPage(1); setPage(1); }}><option value="">{t("marketing_all_sources")}</option>{sources.map(source => <option key={source} value={source}>{t(`marketing_source_${source}`)}</option>)}</select>
<select aria-label={t("marketing_post_filter_archive")} value={archiveState} onChange={event => { setArchiveState(event.target.value as CampaignLinkArchiveState); setGroupPage(1); setPage(1); }}><option value="UNARCHIVED">{t("marketing_post_archive_unarchived")}</option><option value="ARCHIVED">{t("marketing_post_archive_archived")}</option><option value="ALL">{t("marketing_post_archive_all")}</option></select>
<input aria-label={t("marketing_post_post_date_from")} type="date" disabled={Boolean(sourceType && sourceType !== "FB_POST")} className="rounded-lg border border-admin-border px-3 py-2 text-sm" value={postDateFrom} max={postDateTo || undefined} onChange={event => { setPostDateFrom(event.target.value); setPostMissingOnly(false); setGroupPage(1); setPage(1); }} />
<input aria-label={t("marketing_post_post_date_to")} type="date" disabled={Boolean(sourceType && sourceType !== "FB_POST")} className="rounded-lg border border-admin-border px-3 py-2 text-sm" value={postDateTo} min={postDateFrom || undefined} onChange={event => { setPostDateTo(event.target.value); setPostMissingOnly(false); setGroupPage(1); setPage(1); }} />
<label className="flex items-center gap-2 text-xs text-admin-muted"><input type="checkbox" disabled={Boolean(sourceType && sourceType !== "FB_POST")} checked={postMissingOnly} onChange={event => { setPostMissingOnly(event.target.checked); setPostDateFrom(""); setPostDateTo(""); setGroupPage(1); setPage(1); }} />{t("marketing_post_missing_only")}</label>
```

If `marketing_all_sources` does not exist, add it as a key with `"全部来源"` / `"All sources"` in Task 6.

Render body:

```tsx
{workspace && view === "products"
  ? (!groups ? <p className="text-sm text-admin-muted">{t("common_loading")}</p> : <><ProductLinksTable groups={groups.items} canCreate={canCreate} onOpen={id => setDrawerProduct({ id, name: groups.items.find(group => group.product.id === id)?.product.name ?? id })} onCreate={id => setCreating({ scopeKey, productId: id })} />{groups.total > 20 && <div className="flex justify-end gap-2 text-xs"><button type="button" className={buttonClass} disabled={groupPage === 1} onClick={() => setGroupPage(value => value - 1)}>{t("marketing_previous")}</button><span>{groupPage}</span><button type="button" className={buttonClass} disabled={groupPage * 20 >= groups.total} onClick={() => setGroupPage(value => value + 1)}>{t("marketing_next")}</button></div>}</>)
  : <existing table>}
```

Change creating state type to include productId:

```tsx
const [creating, setCreating] = useState<{ scopeKey: string; copyFrom?: CampaignLinkRow; productId?: string; defaultSourceType?: MarketingSourceType } | null>(null);
```

Open dialog:

```tsx
<CreateCampaignLinkDialog
  key={`${scopeKey}:${creating.copyFrom?.id ?? creating.productId ?? "new"}`}
  productId={creating.productId ?? productId || productFilter || undefined}
  landingPageId={landingPageId}
  copyFrom={creating.copyFrom}
  defaultSourceType={creating.defaultSourceType ?? (creating.productId ? "FB_POST" : "META_AD")}
  onClose={() => setCreating(null)}
  onSaved={(link) => { setCreating(null); setResultLink(link); setNotice(t("marketing_link_saved")); setRevision(value => value + 1); }}
/>
```

Render drawer/result:

```tsx
{drawerProduct && <ProductPostsDrawer productId={drawerProduct.id} productName={drawerProduct.name} filters={{ sourceType: sourceType || undefined, ownerUserId: all ? ownerFilter : undefined, archiveState, postDateFrom: postDateFrom || undefined, postDateTo: postDateTo || undefined, postDateMissingOnly: postMissingOnly || undefined }} onClose={() => setDrawerProduct(null)} onChanged={() => setRevision(value => value + 1)} onCreate={() => setCreating({ scopeKey, productId: drawerProduct.id, defaultSourceType: "FB_POST" })} />}
{resultLink && <PostLinkResultDialog link={resultLink} onClose={() => setResultLink(null)} onContinue={() => { const pid = resultLink.productId; setResultLink(null); setCreating({ scopeKey, productId: pid, defaultSourceType: "FB_POST" }); }} />}
```

Keep existing flat table actions, add edit/archive for workspace flat rows:

```tsx
{workspace && canManageMarketingPage(admin, row.ownerUserId) && <>
  <button type="button" className={buttonClass} disabled={busy} onClick={() => setEditing(row)}>{t("marketing_post_edit")}</button>
  <button type="button" className={buttonClass} disabled={busy} onClick={() => void mutateArchive(row)}>{row.archivedAt ? t("marketing_post_unarchive") : t("marketing_post_archive")}</button>
</>}
```

Add `editing` state and `mutateArchive`:

```tsx
const [editing, setEditing] = useState<CampaignLinkRow | null>(null);
async function mutateArchive(row: CampaignLinkRow) {
  if (!canManageMarketingPage(admin, row.ownerUserId) || operation.current) return;
  if (!window.confirm(t(row.archivedAt ? "marketing_post_unarchive_confirm" : "marketing_post_archive_confirm"))) return;
  operation.current = true; setBusy(true); setActionError(null);
  try { row.archivedAt ? await marketingApi.unarchiveLink(row.id, row.version) : await marketingApi.archiveLink(row.id, row.version); setRevision(value => value + 1); setNotice(t("marketing_link_saved")); }
  catch (reason) { setActionError(reason instanceof AdminApiError && reason.status === 409 ? t("marketing_post_conflict") : reason instanceof Error ? reason.message : String(reason)); }
  finally { operation.current = false; setBusy(false); }
}
```

Render `EditPostDialog` when `editing`.

- [ ] **Step 7: 让工作台启用双视图**

In `MarketingWorkbench.tsx`:

```tsx
<CampaignLinksList key={`${productId}:${landingPageId}`} productId={productId} landingPageId={landingPageId} workspace />
```

Other usages (`MarketingPageEdit`, `PerformancePageTable`) remain unchanged and therefore stay flat.

- [ ] **Step 8: 运行工作区测试与相关页面测试**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/components/admin/marketing/CampaignLinksList.spec.tsx src/components/admin/marketing/MarketingPageEdit.spec.tsx src/components/admin/marketing/PerformancePageTable.spec.tsx src/components/admin/marketing/WorkbenchRoutes.spec.tsx
```

Expected: PASS。修正因新增 mock 方法或 `updateLink` 签名变化导致的旧断言；不得删除旧测试覆盖。

- [ ] **Step 9: 提交**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/frontend/src/components/admin/marketing/ProductLinksTable.tsx small-house-commerce/frontend/src/components/admin/marketing/ProductPostsDrawer.tsx small-house-commerce/frontend/src/components/admin/marketing/EditPostDialog.tsx small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.tsx small-house-commerce/frontend/src/components/admin/marketing/CampaignLinksList.spec.tsx small-house-commerce/frontend/src/components/admin/marketing/MarketingWorkbench.tsx
git commit -m "feat(marketing): add product-first post management view"
```

---

### Task 9: 核算页的帖子资料与发帖日期筛选

**Files:**
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/ReportTable.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/ReportTreeTable.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/ReportTable.spec.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/marketing/ReportTreeTable.spec.tsx`

**Interfaces:**
- Consumes: Task 5 report types.
- Produces: 核算页可选择发帖日期范围/未登记；真实链接行显示发帖日期、原帖入口、归档状态。

- [ ] **Step 1: 写报表 UI 失败测试**

Append to `ReportTable.spec.tsx`:

```tsx
it('sends post-date filters separately from the reporting period and shows post metadata', async () => {
  mount();
  fireEvent.change(screen.getByLabelText("发帖起始日"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("发帖结束日"), { target: { value: "2026-11-03" } });
  fireEvent.click(screen.getByRole("button", { name: "查询" }));
  await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ postDateFrom: "2026-11-01", postDateTo: "2026-11-03" })));
});
```

Add a tree fixture link with `postDate:"2026-11-03"`, `postUrl:"https://www.facebook.com/luwag/posts/1"`, `archivedAt:null`; then append to `ReportTreeTable.spec.tsx`:

```tsx
it('shows the registered post date and a safe original-post link on a link row', () => {
  render(<AdminI18nProvider><ReportTreeTable tree={treeWithPost} sortBy="NAME" sortDirection="ASC" onSort={vi.fn()} /></AdminI18nProvider>);
  expect(screen.getByText(/2026-11-03/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "打开原帖" })).toHaveAttribute("rel", "noopener noreferrer");
});
```

Use the existing spec helpers to build the tree; don't duplicate an incompatible fixture.

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/components/admin/marketing/ReportTable.spec.tsx src/components/admin/marketing/ReportTreeTable.spec.tsx
```

Expected: FAIL。

- [ ] **Step 3: 扩展 ReportTable 输入与请求**

Add to `inputs` state:

```tsx
postDateFrom: "",
postDateTo: "",
postDateMissingOnly: false,
```

Add fields in form after the reporting period:

```tsx
<label className="space-y-1 text-xs text-admin-muted">{t("marketing_post_post_date_from")}<input className={fieldClass} type="date" value={inputs.postDateFrom} max={inputs.postDateTo || undefined} onChange={event => changeStatusFields({ postDateFrom: event.target.value, postDateMissingOnly: false })} /></label>
<label className="space-y-1 text-xs text-admin-muted">{t("marketing_post_post_date_to")}<input className={fieldClass} type="date" value={inputs.postDateTo} min={inputs.postDateFrom || undefined} max={dateFormat.format(new Date())} onChange={event => changeStatusFields({ postDateTo: event.target.value, postDateMissingOnly: false })} /></label>
<label className="flex items-center gap-2 pb-2 text-xs text-admin-muted"><input type="checkbox" checked={inputs.postDateMissingOnly} onChange={event => changeStatusFields({ postDateMissingOnly: event.target.checked, postDateFrom: "", postDateTo: "" })} />{t("marketing_post_missing_only")}</label>
```

Pass in `marketingApi.report`:

```tsx
postDateFrom: filters.postDateFrom || undefined,
postDateTo: filters.postDateTo || undefined,
postDateMissingOnly: filters.postDateMissingOnly || undefined,
```

Add a hint:

```tsx
<p className="text-xs text-admin-muted">{t("marketing_post_report_hint")}</p>
```

- [ ] **Step 4: 显示帖子身份**

Update `identity` in `ReportTable.tsx`:

```tsx
function identity(row: MarketingReportRow, t: ReturnType<typeof useAdminI18n>["t"]) {
  return <>{row.kind === "REGISTERED" ? row.label : t(`marketing_report_${row.kind}`)}
    {row.kind === "REGISTERED" && row.postDate && <p className="text-[11px] text-admin-muted">{t("marketing_post_date")}: {row.postDate}{row.archivedAt ? ` · ${t("marketing_post_archived")}` : ""}</p>}
    {row.kind === "REGISTERED" && row.postUrl && <a className="inline-block text-[11px] underline" href={row.postUrl} target="_blank" rel="noopener noreferrer">{t("marketing_post_original")}</a>}
    {row.ownerName && row.kind === "REGISTERED" && <p className="text-xs text-admin-muted">{row.ownerName} · {row.aid ?? "—"}</p>}
    {row.kind !== "REGISTERED" && row.productName && <p className="text-xs text-admin-muted">{row.ownerName ?? ""}</p>}
    {row.productName && row.kind === "REGISTERED" && <p className="text-xs text-admin-muted">{row.productName} · {row.productCode ?? "—"}</p>}
    {row.kind === "REGISTERED" && <p className="mt-1 text-[11px] text-admin-muted">{t("marketing_report_flags", { duplicate: String(row.duplicateOrders), risk: String(row.riskOrders), afterSales: String(row.afterSalesOrders), refund: String(row.refundStatusOrders) })}</p>}</>;
}
```

- [ ] **Step 5: 显示树形链接资料**

In `ReportTreeTable.tsx`, replace the link row identity cell:

```tsx
<td className="px-3 py-3 pl-20 text-admin-muted">
  <p>{link.label}</p>
  {link.postDate && <p className="text-xs text-admin-muted">{t("marketing_post_date")}: {link.postDate}{link.archivedAt ? ` · ${t("marketing_post_archived")}` : ""}</p>}
  {link.postUrl && <a className="text-xs underline" href={link.postUrl} target="_blank" rel="noopener noreferrer">{t("marketing_post_original")}</a>}
  {link.ownerName && <p className="text-xs text-admin-muted">{link.ownerName} · {link.aid ?? "—"}</p>}
</td>
```

- [ ] **Step 6: 处理 otherSources 与筛选提示**

In `ReportTable.tsx` around `data.otherSources`:

```tsx
{data.otherSources.length > 0 ? <existing table> : (filters.postDateFrom || filters.postDateTo || filters.postDateMissingOnly) && <p className="text-xs text-admin-muted">{t("marketing_post_other_sources_hidden")}</p>}
```

Do not render an empty “其他来源” heading when the filter is active.

- [ ] **Step 7: 运行报表 UI 测试**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/components/admin/marketing/ReportTable.spec.tsx src/components/admin/marketing/ReportTreeTable.spec.tsx src/components/admin/marketing/ReportColumns.spec.tsx
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/frontend/src/components/admin/marketing/ReportTable.tsx small-house-commerce/frontend/src/components/admin/marketing/ReportTreeTable.tsx small-house-commerce/frontend/src/components/admin/marketing/ReportTable.spec.tsx small-house-commerce/frontend/src/components/admin/marketing/ReportTreeTable.spec.tsx
git commit -m "feat(marketing): show post dates and links in reports"
```

---

### Task 10: 本地演示数据、迁移与启动

**Files:**
- Create: `small-house-commerce/backend/prisma/post-link-demo.ts`
- Local server env (untracked): `small-house-commerce/backend/.env.local`

**Interfaces:**
- Consumes: `seed.ts` roles、`seed-e2e.ts` catalog/admin、Prisma Client。
- Produces: 隔离本地库中的演示帖子链接。

- [ ] **Step 1: 对隔离库执行迁移与基础 seed**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/luwag_post_links_local_e2e_20261103?schema=public"
pnpm prisma migrate deploy
pnpm exec tsx prisma/seed.ts
pnpm exec tsx prisma/seed-e2e.ts
pnpm prisma migrate status
```

Expected: 所有迁移应用成功，`Database schema is up to date!`；seed 输出 E2E 账号。若 `seed-e2e` 因库名守卫拒绝，确认库名含 `_e2e_`。

- [ ] **Step 2: 写受保护的演示数据脚本**

Create `backend/prisma/post-link-demo.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required.');
const parsed = new URL(url);
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !/(^|[_-])(e2e|test)([_-]|$)/.test(database)) {
  throw new Error(`Refusing to seed non-disposable database "${database}".`);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysAgo = (days: number) => new Date(Date.parse(`${today}T00:00:00.000Z`) - days * 864e5).toISOString().slice(0, 10);

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { email: 'e2e-admin@smallhouse.test' } });
  const aid = `DEMO-${Date.now().toString(36).toUpperCase()}`;
  await prisma.optimizerProfile.upsert({
    where: { userId: owner.id },
    update: {},
    create: { userId: owner.id, aid, displayName: owner.name },
  });
  const products = await prisma.product.findMany({ where: { status: 'ACTIVE' }, take: 2, orderBy: { createdAt: 'asc' } });
  if (products.length < 2) throw new Error('seed-e2e did not create two active products.');
  for (const [index, product] of products.entries()) {
    for (const [postIndex, days] of [0, 1, 4].entries()) {
      const postDate = daysAgo(days);
      const link = await prisma.campaignLink.create({
        data: {
          code: `demo${index}${postIndex}${Date.now().toString(36)}`,
          ownerUserId: owner.id,
          aidSnapshot: aid,
          productId: product.id,
          name: `${postDate.slice(5)}｜${product.name.slice(0, 60)}｜示例帖子 ${postIndex + 1}`,
          sourceType: 'FB_POST',
          postDate: new Date(`${postDate}T00:00:00.000Z`),
          postUrl: postIndex === 0 ? 'https://www.facebook.com/' : null,
        },
      });
      if (index === 0 && postIndex === 1) {
        await prisma.campaignLink.update({ where: { id: link.id }, data: { archivedAt: new Date() } });
      }
    }
  }

  await prisma.campaignLink.create({
    data: {
      code: `legacy${Date.now().toString(36)}`,
      ownerUserId: owner.id,
      aidSnapshot: aid,
      productId: products[0].id,
      name: '历史共用链接（发布日期未登记）',
      sourceType: 'FB_POST',
    },
  });

  await prisma.campaignLink.create({
    data: {
      code: `ad${Date.now().toString(36)}`,
      ownerUserId: owner.id,
      aidSnapshot: aid,
      productId: products[1].id,
      name: '演示 Meta 广告链接',
      sourceType: 'META_AD',
    },
  });
  console.log('Post-link demo seeded.');
}

await main();
await prisma.$disconnect();
```

- [ ] **Step 3: 运行演示数据脚本**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/luwag_post_links_local_e2e_20261103?schema=public"
pnpm exec tsx prisma/post-link-demo.ts
psql "$DATABASE_URL" -c "SELECT count(*) FILTER (WHERE source_type='FB_POST') AS posts, count(*) FILTER (WHERE post_date IS NULL) AS undated FROM campaign_links;"
```

Expected: 至少 7 条 FB_POST（6 条带日期 + 1 条旧链接），其中 1 条 `post_date IS NULL`，以及 1 条 `META_AD` 演示链接。查询输出中 `undated` 至少为 1。

- [ ] **Step 4: 构建后端并启动本地服务**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm prisma generate
pnpm build
lsof -nP -iTCP:4104 -sTCP:LISTEN || true
PORT=4104 HOST=127.0.0.1 \
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/luwag_post_links_local_e2e_20261103?schema=public" \
JWT_SECRET="local-post-links-demo-20261103-please-rotate" \
JWT_ACCESS_TTL=1h JWT_REFRESH_TTL=7d \
NODE_ENV=development \
node dist/main.js
```

Run in a background process. Expected: 监听 `127.0.0.1:4104`。若 4104 被占用，改用 4105 并记录；不要停止占用进程。

- [ ] **Step 5: 启动前端本地服务**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
lsof -nP -iTCP:4023 -sTCP:LISTEN || true
API_TARGET=http://localhost:4104 pnpm dev --port 4023 --hostname localhost
```

Run in a background process. Expected: `http://localhost:4023/admin/marketing/links` 可打开。若 4023 被占用，改用 4024 并记录。

- [ ] **Step 6: 登录并确认页面**

Open `http://localhost:4023/admin/login`, sign in with:

```text
e2e-admin@smallhouse.test
E2eAdminPass123!
```

Expected: 能进入 `/admin/marketing/links`，看到“按商品 / 全部链接”视图开关和商品列表。若登录失败，先查后端启动日志与 E2E seed 输出，不要改生产配置。

- [ ] **Step 7: 提交演示脚本**

```bash
cd /private/tmp/luwag-post-links-20261103
git add small-house-commerce/backend/prisma/post-link-demo.ts
git commit -m "chore(marketing): seed isolated post-link demo data"
```

`.env.local` 不提交。

---

### Task 11: 浏览器验收与整分支验证

**Files:**
- No production files; evidence in `/private/tmp/luwag-post-links-20261103/acceptance/`

**Interfaces:**
- Consumes: 运行中的 4023/4104 本地服务。

- [ ] **Step 1: 浏览器核心场景**

Use Playwright or Chrome DevTools against `http://localhost:4023`:

1. 进入 `/admin/marketing/links`，确认默认“按商品”视图；一个商品一行。
2. 打开一个商品的“查看帖子”，确认按发帖日期倒序，旧的无日期链接显示“发布日期未登记”且排在最后。
3. 新增一条帖子：日期默认今天，名称留空，生成后展示专属短链与完整链接；连续新增第二条，确认两条 `code` 不同。
4. 编辑第一条的日期与原帖地址，确认 `code` 不变；输入 `https://facebook.com.example.com/x` 被拒绝。
5. 归档第一条：从未归档列表消失；在“已归档”中可找回；直接访问其完整链接仍能建立访问并出现在核算。
6. 在核算页按该帖子过滤，确认只显示该链接，归档标记可见；使用发帖日期范围过滤，确认统计区间不变；选择未登记日期，确认只显示无日期帖子。
7. 切换到“全部链接”，确认旧平铺列表仍可用；进入某个落地页编辑页，确认其链接列表仍是平铺且无新增视图开关。
8. 390px 视口检查商品表与帖子抽屉无页面级横向溢出，操作按钮可达。

Record each result as pass/fail; do not claim pass from HTTP 200 alone.

- [ ] **Step 2: 后端定向与真库测试**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/backend
pnpm vitest run src/modules/marketing
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/luwag_post_links_local_e2e_20261103?schema=public" \
MARKETING_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/luwag_post_links_local_e2e_20261103?schema=public" \
MARKETING_TEST_DATABASE_SCHEMA="public" \
pnpm vitest run src/modules/marketing/marketing-report.integration.spec.ts src/modules/marketing/ad-costs.integration.spec.ts
pnpm build
```

Expected: 单元测试全绿；真库测试全绿；build 成功。若真库测试因 schema 名称/Search path 失败，按现有 `marketing-test-prisma.spec.ts` 的驱动方式修复，不要绕过守卫。

- [ ] **Step 3: 前端定向测试与构建**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103/small-house-commerce/frontend
pnpm vitest run src/components/admin/marketing src/lib/marketing-api.spec.ts src/lib/marketing-post-date.spec.ts
pnpm exec tsc --noEmit
pnpm build
```

Expected: 定向测试全绿；tsc 0 error；build 成功。若全量 `pnpm test` 因其他既有套件超时失败，单独记录，不把它伪装成“全量通过”。

- [ ] **Step 4: 回归检查**

Run:

```bash
cd /private/tmp/luwag-post-links-20261103
git diff --stat prod/staging/luwag-shop-domain..HEAD
git diff --name-only prod/staging/luwag-shop-domain..HEAD | grep -E 'globals.css|Header|Footer|Navigation|layout' || true
```

Expected: 无 Header/Footer/导航/全局样式改动；若有，停止并说明原因。确认没有提交 `.env.local`、生成客户端、截图或本地数据库文件。

- [ ] **Step 5: 最终审查与交付**

Review the whole branch against the spec, especially the five Review Focus items. Produce a handoff with:

- 本地地址（4023/4024）和测试账号。
- 执行的测试命令与真实结果（通过数、失败数、跳过数）。
- 未验证项（例如真实 Facebook、CAPI、生产登录、真实短链域名）。
- 已知限制：历史 `campaign_link_id` 为空的事件不回填；旧共用一个链接的历史帖子无法拆分；短链是本地服务生成的临时路径。
- 明确说明：未 push、未部署、未修改生产数据库；是否进入上线阶段等用户决定。

- [ ] **Step 6: 提交验收记录**

```bash
cd /private/tmp/luwag-post-links-20261103
git status --short
```

Expected: 工作树干净（验收截图在 `/private/tmp` 外，不提交）。若只有验收记录文件，按用户是否需要决定是否提交；默认不把临时截图加入仓库。

---

## 自审记录

- **Spec 覆盖**：数据字段/迁移（Task 1）、创建/编辑/克隆/归档/筛选/分组（Task 2）、路由（Task 3）、核算日期口径与元资料（Task 4）、前端 API（Task 5）、文案与 Manila 日期（Task 6）、新增/结果短链（Task 7）、商品视图/抽屉/编辑/归档（Task 8）、核算 UI（Task 9）、本地隔离库与演示数据（Task 10）、浏览器与整分支验证（Task 11）。
- **未覆盖的 spec 项**：>500 链接警告沿用现有 TREE 逻辑，不新增；旧客户端兼容由 DTO 可选字段和默认查询参数覆盖；`otherSources` 在非日期筛选下保持原样。
- **类型一致性**：`CampaignLinkUpdateInput` 在 Task 1 定义、Task 2 消费、Task 5 前端镜像；`CampaignLinkProductGroup` 在 Task 2 与 Task 5 同名同字段；`postDate` 在数据库是 `Date`、API/前端是 `YYYY-MM-DD`，仅在 `postDateToDb/postDateFromDb` 转换。
- **评审重点测试归属**：旧链接无日期（Task 2 服务测试、Task 4 真库、Task 11 浏览器）；归档独立性（Task 2/8/11）；分组计数分页（Task 2/8）；核算日期筛选（Task 4/9/11）；写入边界（Task 2/3/8）。
