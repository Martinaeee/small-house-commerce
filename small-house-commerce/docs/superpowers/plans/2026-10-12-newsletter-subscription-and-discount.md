# 订阅与订阅优惠（A 块）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 storefront 增加邮件订阅（弹窗 + footer 通栏）与订阅优惠——后台以稳定 ID 的优惠活动配置单一优惠码，订阅后展示该码，结算输入即真实减价（含并发安全的名额占用、有效期、每人限用与取消释放）。

**Architecture:** 新增 `newsletter` 后端模块（订阅端点 + 活动管理 + 核销）与 `email` 薄网关；优惠金额复用既有 `Order.discountTotal` 链路（`orders.service.ts:138` 的 `const discount = 0` 改为按活动计算）；名额用 `promo_code_redemptions` 表计数，占用时对活动 ID 取事务级咨询锁；取消释放用条件更新幂等。前台复用单一 `SubscribeEmailForm` 组件承载弹窗与通栏，优惠码输入接入既有结账草稿与 `api.createOrder` 白名单。

**Tech Stack:** NestJS 12 + Prisma 7 + Zod 4 + PostgreSQL 18（后端）；Next.js 16 App Router + React 19 + Tailwind 4 + Vitest + Playwright（前端）。

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-10-12-newsletter-subscription-and-discount-design.md`

## Global Constraints

- 不 commit / push / merge / PR / deploy（本轮约束）；不触碰生产数据、`backend/uploads/`、用户 3000/3001、peer 3210/3211。
- 共享 PostgreSQL 5432 的 migration 必须与其他并行工作线**串行**执行。
- 后台文案中文（默认），前台文案英文。
- **折扣一律服务端计算**；客户端只传码字符串，绝不接受客户端传入的折扣金额或总价。
- **订阅数据绝不进入订单、归因快照或 Meta Pixel 事件**；优惠码可进订单快照，但不得进入 Pixel 事件字段。
- 新增环境变量一律 `.optional()`（`EMAIL_API_KEY` / `EMAIL_FROM` / `STOREFRONT_BASE_URL`）；退订 token 从既有 `JWT_SECRET` 派生，**不新增必填变量**。
- migration 风格：首行 `SET lock_timeout = '5s';` + `ALTER TABLE`；新迁移时间戳紧随 `20261014180000`。
- 后端 Zod 校验统一走 `ZodValidationPipe`；节流走 `@UseGuards(ThrottleGuard)` + `@Throttle({...})`。

## Review Focus

以下输入/失败模式是规格隐含、但各任务测试未必覆盖、最可能伤到真实用户的，已在本计划中各自配了测试：

1. **码的大小写与空白**：`" welcome10 "` / `"WELCOME10"` / `"welcome10"` 必须归一化为同一码并成功（Task 7/8）。
2. **订单创建中途失败**：结账事务回滚后**不得**残留核销行（不占名额）（Task 8）。
3. **`FIXED` 折扣大于小计**：折扣夹到小计，`grandTotal` 为 0 而非负数，`Payment.amount` 不为负（Task 7/8）。
4. **活动被编辑/归档后的旧码**：购物车草稿里留着旧码 → 结算给可读错误、不崩溃（Task 8）。
5. **手机号归一化一致性**：`0917…` 与 `+63917…` 归一化后必须视为同一人，每人限用正确计数（Task 8）。

---

### Task 1: Prisma 模型与迁移

**Files:**
- Modify: `small-house-commerce/backend/prisma/schema/identity.prisma`（`PermissionCode` enum 加两个值）
- Modify: `small-house-commerce/backend/prisma/schema/order.prisma`（`Order.promoCode`）
- Modify: `small-house-commerce/backend/prisma/schema/settings.prisma`（`SiteSetting` 加展示列）
- Create: `small-house-commerce/backend/prisma/schema/newsletter.prisma`
- Create: `small-house-commerce/backend/prisma/migrations/20261014190000_add_newsletter_subscriptions/migration.sql`
- Test: `small-house-commerce/backend/prisma/newsletter-schema.spec.ts`

**Interfaces:**
- Consumes: 既有 `Order` / `SiteSetting` / `PermissionCode` 模型。
- Produces: Prisma 客户端模型 `NewsletterSubscriber`、`NewsletterPromotion`、`PromoCodeRedemption`；枚举 `SubscriberStatus`、`SubscribeSource`、`NewsletterDiscountType`、`PromotionStatus`、`PermissionCode.NEWSLETTER_READ` / `NEWSLETTER_WRITE`；`SiteSetting` 新列 `newsletterBandEnabled/newsletterPopupEnabled/newsletterPopupDelaySeconds/newsletterOfferTitle/newsletterOfferBody`；`Order.promoCode`。

- [ ] **Step 1: 写 schema 片段**

`identity.prisma` 的 `enum PermissionCode` 内追加（放在 `SYSTEM_SETTINGS_EDIT` 之后）：
```prisma
  NEWSLETTER_READ
  NEWSLETTER_WRITE
```

`order.prisma` 的 `Order` 模型内，紧跟 `customerNote` 之后追加：
```prisma
  promoCode              String?            @map("promo_code")
```

`settings.prisma` 的 `SiteSetting` 模型内追加：
```prisma
  newsletterBandEnabled     Boolean @default(true)  @map("newsletter_band_enabled")
  newsletterPopupEnabled    Boolean @default(false) @map("newsletter_popup_enabled")
  newsletterPopupDelaySeconds Int   @default(5)     @map("newsletter_popup_delay_seconds")
  newsletterOfferTitle      String  @default("")    @map("newsletter_offer_title")
  newsletterOfferBody       String  @default("")    @map("newsletter_offer_body")
```

新建 `newsletter.prisma`：
```prisma
// Newsletter subscriptions and the single subscribe-exclusive discount
// promotion. Counts and redemptions hang off the promotion's STABLE id, so
// editing the code never resets usage limits (spec §3.2 / §3.3).

enum SubscriberStatus {
  SUBSCRIBED
  UNSUBSCRIBED
}

enum SubscribeSource {
  POPUP
  FOOTER
}

enum NewsletterDiscountType {
  PERCENT
  FIXED
}

enum PromotionStatus {
  ACTIVE
  ARCHIVED
}

/// One row per normalized email; re-subscribing upserts (spec §3.1).
model NewsletterSubscriber {
  id             String           @id @default(uuid(7)) @db.Uuid
  email          String           @unique
  status         SubscriberStatus @default(SUBSCRIBED)
  source         SubscribeSource
  createdAt      DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime         @updatedAt @map("updated_at") @db.Timestamptz(3)
  unsubscribedAt DateTime?        @map("unsubscribed_at") @db.Timestamptz(3)

  @@map("newsletter_subscribers")
}

/// At most one ACTIVE row (partial unique index in the migration).
model NewsletterPromotion {
  id             String                 @id @default(uuid(7)) @db.Uuid
  code           String                 @unique
  discountType   NewsletterDiscountType @map("discount_type")
  discountValue  Decimal                @map("discount_value") @db.Decimal(10, 2)
  minSpend       Decimal                @default(0) @map("min_spend") @db.Decimal(10, 2)
  maxUses        Int?                   @map("max_uses")
  perCustomerLimit Int?                 @map("per_customer_limit")
  validFrom      DateTime?              @map("valid_from") @db.Timestamptz(3)
  validUntil     DateTime?              @map("valid_until") @db.Timestamptz(3)
  status         PromotionStatus        @default(ACTIVE)
  archivedAt     DateTime?              @map("archived_at") @db.Timestamptz(3)
  createdAt      DateTime               @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime               @updatedAt @map("updated_at") @db.Timestamptz(3)

  redemptions PromoCodeRedemption[]

  @@map("newsletter_promotions")
}

/// One row per successful redemption. Counts are derived from rows where
/// released_at IS NULL (spec §3.3).
model PromoCodeRedemption {
  id              String    @id @default(uuid(7)) @db.Uuid
  promotionId     String    @map("promotion_id") @db.Uuid
  orderId         String    @unique @map("order_id") @db.Uuid
  codeSnapshot    String    @map("code_snapshot")
  normalizedPhone String    @map("normalized_phone")
  discountAmount  Decimal   @map("discount_amount") @db.Decimal(10, 2)
  releasedAt      DateTime? @map("released_at") @db.Timestamptz(3)
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  promotion NewsletterPromotion @relation(fields: [promotionId], references: [id], onDelete: Restrict)
  order     Order               @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([promotionId, releasedAt])
  @@index([promotionId, normalizedPhone, releasedAt])
  @@map("promo_code_redemptions")
}
```

在 `order.prisma` 的 `Order` 模型关系区追加：
```prisma
  promoRedemption PromoCodeRedemption?
```

- [ ] **Step 2: 写迁移 SQL**

`migration.sql`：
```sql
SET lock_timeout = '5s';

ALTER TABLE "orders" ADD COLUMN "promo_code" TEXT;

ALTER TABLE "site_settings" ADD COLUMN "newsletter_band_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "site_settings" ADD COLUMN "newsletter_popup_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "site_settings" ADD COLUMN "newsletter_popup_delay_seconds" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "site_settings" ADD COLUMN "newsletter_offer_title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "site_settings" ADD COLUMN "newsletter_offer_body" TEXT NOT NULL DEFAULT '';

ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'NEWSLETTER_READ';
ALTER TYPE "PermissionCode" ADD VALUE IF NOT EXISTS 'NEWSLETTER_WRITE';

CREATE TYPE "SubscriberStatus" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED');
CREATE TYPE "SubscribeSource" AS ENUM ('POPUP', 'FOOTER');
CREATE TYPE "NewsletterDiscountType" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "PromotionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "newsletter_subscribers" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "source" "SubscribeSource" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "unsubscribed_at" TIMESTAMPTZ(3),
    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

CREATE TABLE "newsletter_promotions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" "NewsletterDiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "min_spend" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "max_uses" INTEGER,
    "per_customer_limit" INTEGER,
    "valid_from" TIMESTAMPTZ(3),
    "valid_until" TIMESTAMPTZ(3),
    "status" "PromotionStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "newsletter_promotions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "newsletter_promotions_code_key" ON "newsletter_promotions"("code");
-- At most one ACTIVE promotion at a time (spec §3.2).
CREATE UNIQUE INDEX "newsletter_promotions_single_active"
    ON "newsletter_promotions"("status") WHERE "status" = 'ACTIVE';

CREATE TABLE "promo_code_redemptions" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "code_snapshot" TEXT NOT NULL,
    "normalized_phone" TEXT NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "promo_code_redemptions_order_id_key" ON "promo_code_redemptions"("order_id");
CREATE INDEX "promo_code_redemptions_promotion_id_released_at_idx"
    ON "promo_code_redemptions"("promotion_id", "released_at");
CREATE INDEX "promo_code_redemptions_promotion_id_normalized_phone_released_at_idx"
    ON "promo_code_redemptions"("promotion_id", "normalized_phone", "released_at");
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_promotion_id_fkey"
    FOREIGN KEY ("promotion_id") REFERENCES "newsletter_promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: 生成客户端并应用迁移到专用测试库**

Run: `cd small-house-commerce/backend && pnpm exec prisma generate && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/small_house_variant_test?schema=public" pnpm exec prisma migrate deploy`
Expected: `prisma generate` 成功；`migrate deploy` 输出应用了 `20261014190000_add_newsletter_subscriptions`。

- [ ] **Step 4: 写 schema 行为测试（RED 前置）**

`newsletter-schema.spec.ts`：断言「同一时刻只能有一个 ACTIVE 活动」由数据库强制。
```ts
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Requires the test database migrated (see bootstrap). Uses the real client.
const prisma = new PrismaService();

describe('newsletter schema invariants', () => {
  it('rejects a second ACTIVE promotion at the database level', async () => {
    await prisma.newsletterPromotion.deleteMany();
    await prisma.newsletterPromotion.create({
      data: { code: 'FIRST', discountType: 'PERCENT', discountValue: 10, status: 'ACTIVE' },
    });
    await expect(
      prisma.newsletterPromotion.create({
        data: { code: 'SECOND', discountType: 'PERCENT', discountValue: 5, status: 'ACTIVE' },
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd small-house-commerce/backend && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/small_house_variant_test?schema=public" pnpm exec vitest run prisma/newsletter-schema.spec.ts`
Expected: PASS（第二条插入被唯一索引拒绝）。

- [ ] **Step 6: 提交**

```bash
git add small-house-commerce/backend/prisma
git commit -m "feat(newsletter): add subscription, promotion and redemption schema"
```

---

### Task 2: RBAC 权限种子

**Files:**
- Modify: `small-house-commerce/backend/prisma/rbac.ts`
- Test: `small-house-commerce/backend/prisma/rbac.spec.ts`（若不存在则新建；存在则追加用例）

**Interfaces:**
- Consumes: Task 1 的 `PermissionCode.NEWSLETTER_READ` / `NEWSLETTER_WRITE`。
- Produces: 权限被 `RBAC_PERMISSIONS` 声明，并被 `RBAC_ROLES` 授予 ADMIN + SUPER_ADMIN。

- [ ] **Step 1: 写失败测试**

在 `rbac.spec.ts` 追加：
```ts
it('grants newsletter read/write to ADMIN and SUPER_ADMIN', () => {
  const codes = RBAC_PERMISSIONS.map((p) => p.code);
  expect(codes).toContain('NEWSLETTER_READ');
  expect(codes).toContain('NEWSLETTER_WRITE');
  for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
    const granted = RBAC_ROLES.find((r) => r.code === role)?.permissions ?? [];
    expect(granted).toContain('NEWSLETTER_READ');
    expect(granted).toContain('NEWSLETTER_WRITE');
  }
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/backend && pnpm exec vitest run prisma/rbac.spec.ts`
Expected: FAIL（`NEWSLETTER_READ` 不在数组中）。

- [ ] **Step 3: 最小实现**

`rbac.ts` 的 `RBAC_PERMISSIONS` 追加：
```ts
  { code: PermissionCode.NEWSLETTER_READ, description: 'View newsletter subscribers.' },
  { code: PermissionCode.NEWSLETTER_WRITE, description: 'Manage newsletter subscribers.' },
```
并在 `RBAC_ROLES` 中 ADMIN 与 SUPER_ADMIN 的 `permissions` 数组各追加 `PermissionCode.NEWSLETTER_READ, PermissionCode.NEWSLETTER_WRITE`（沿用该文件既有写法）。

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/backend && pnpm exec vitest run prisma/rbac.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/backend/prisma/rbac.ts small-house-commerce/backend/prisma/rbac.spec.ts
git commit -m "feat(newsletter): grant newsletter read/write to admin roles"
```

---

### Task 3: 邮件网关模块

**Files:**
- Create: `small-house-commerce/backend/src/modules/email/email.gateway.ts`
- Create: `small-house-commerce/backend/src/modules/email/log-email.gateway.ts`
- Create: `small-house-commerce/backend/src/modules/email/resend-email.gateway.ts`
- Create: `small-house-commerce/backend/src/modules/email/email.module.ts`
- Modify: `small-house-commerce/backend/src/config/env.validation.ts`
- Modify: `small-house-commerce/backend/src/app.module.ts`
- Test: `small-house-commerce/backend/src/modules/email/email.gateway.spec.ts`

**Interfaces:**
- Produces: `EMAIL_GATEWAY` 注入令牌；接口 `EmailGateway { sendWelcome(to, opts); sendBackInStock(to, opts) }`；`LogEmailGateway`（无密钥）、`ResendEmailGateway`（有密钥）。B 块将注入同一令牌调用 `sendBackInStock`。

- [ ] **Step 1: 写失败测试**

`email.gateway.spec.ts`：
```ts
import { describe, expect, it, vi } from 'vitest';
import { LogEmailGateway } from './log-email.gateway.js';

describe('LogEmailGateway', () => {
  it('logs a structured line and never throws', async () => {
    const log = vi.fn();
    const gateway = new LogEmailGateway({ log } as never);
    await expect(
      gateway.sendWelcome('a@b.com', { promoCode: 'WELCOME10' }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls[0])).toContain('a@b.com');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/email/email.gateway.spec.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`email.gateway.ts`：
```ts
export const EMAIL_GATEWAY = Symbol('EMAIL_GATEWAY');

export interface WelcomeEmailOptions {
  offerTitle?: string;
  offerBody?: string;
  promoCode?: string | null;
  unsubscribeUrl: string;
}

export interface BackInStockEmailOptions {
  productName: string;
  productUrl: string;
  unsubscribeUrl: string;
}

export interface EmailGateway {
  sendWelcome(to: string, options: WelcomeEmailOptions): Promise<void>;
  sendBackInStock(to: string, options: BackInStockEmailOptions): Promise<void>;
}
```

`log-email.gateway.ts`：
```ts
import { Injectable, Logger } from '@nestjs/common';
import type {
  BackInStockEmailOptions,
  EmailGateway,
  WelcomeEmailOptions,
} from './email.gateway.js';

/**
 * Default gateway when EMAIL_API_KEY is unset: logs the intended message so
 * dev and e2e exercise the whole flow without a provider (spec §4.2).
 */
@Injectable()
export class LogEmailGateway implements EmailGateway {
  constructor(private readonly logger: Logger = new Logger('EmailGateway')) {}

  async sendWelcome(to: string, options: WelcomeEmailOptions): Promise<void> {
    this.logger.log(JSON.stringify({ kind: 'welcome', to, ...options }));
  }

  async sendBackInStock(to: string, options: BackInStockEmailOptions): Promise<void> {
    this.logger.log(JSON.stringify({ kind: 'back-in-stock', to, ...options }));
  }
}
```

`resend-email.gateway.ts`：实现同一接口，`POST https://api.resend.com/emails`，header `Authorization: Bearer ${apiKey}`，body `{ from, to, subject, html }`；失败时抛错（由调用方 best-effort 捕获）。构造函数注入 `ConfigService`，从 `EMAIL_API_KEY` / `EMAIL_FROM` 取值。

`email.module.ts`：
```ts
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_GATEWAY } from './email.gateway.js';
import { LogEmailGateway } from './log-email.gateway.js';
import { ResendEmailGateway } from './resend-email.gateway.js';

@Module({
  providers: [
    {
      provide: EMAIL_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('EMAIL_API_KEY')
          ? new ResendEmailGateway(config, new Logger('EmailGateway'))
          : new LogEmailGateway(new Logger('EmailGateway')),
    },
  ],
  exports: [EMAIL_GATEWAY],
})
export class EmailModule {}
```

`env.validation.ts` 追加（optional）：
```ts
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  STOREFRONT_BASE_URL: z.string().url().optional(),
```

`app.module.ts` 的 imports 追加 `EmailModule`（放在 `SettingsModule` 之后）。

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/email/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/backend/src/modules/email small-house-commerce/backend/src/config/env.validation.ts small-house-commerce/backend/src/app.module.ts
git commit -m "feat(newsletter): add key-gated email gateway"
```

---

### Task 4: 订阅端点与退订 token

**Files:**
- Create: `small-house-commerce/backend/src/modules/newsletter/newsletter.module.ts`
- Create: `small-house-commerce/backend/src/modules/newsletter/newsletter.service.ts`
- Create: `small-house-commerce/backend/src/modules/newsletter/unsubscribe-token.ts`
- Create: `small-house-commerce/backend/src/modules/newsletter/dto/newsletter.dto.ts`
- Create: `small-house-commerce/backend/src/modules/newsletter/storefront/newsletter.controller.ts`
- Modify: `small-house-commerce/backend/src/app.module.ts`
- Test: `small-house-commerce/backend/src/modules/newsletter/newsletter.service.spec.ts`
- Test: `small-house-commerce/backend/src/modules/newsletter/unsubscribe-token.spec.ts`

**Interfaces:**
- Consumes: Task 1 模型；Task 3 `EMAIL_GATEWAY`。
- Produces: `NewsletterService.subscribe({ email, source }): Promise<{ ok: true; promoCode: string | null; offerTitle: string; offerBody: string }>`；`NewsletterService.unsubscribeByToken(token): Promise<boolean>`；`signUnsubscribeToken(email, secret)` / `verifyUnsubscribeToken(token, secret): string | null`；`normalizeEmail(value: string): string`。路由 `POST /storefront/newsletter/subscribe`、`GET /storefront/newsletter/unsubscribe`。

- [ ] **Step 1: 写失败测试**

`unsubscribe-token.spec.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js';

const SECRET = 'x'.repeat(32);

describe('unsubscribe token', () => {
  it('round-trips a normalized email', () => {
    const token = signUnsubscribeToken('a@b.com', SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe('a@b.com');
  });
  it('rejects a tampered token', () => {
    const token = signUnsubscribeToken('a@b.com', SECRET);
    expect(verifyUnsubscribeToken(`${token}x`, SECRET)).toBeNull();
  });
  it('rejects a token signed with another secret', () => {
    const token = signUnsubscribeToken('a@b.com', 'y'.repeat(32));
    expect(verifyUnsubscribeToken(token, SECRET)).toBeNull();
  });
});
```

`newsletter.service.spec.ts`（用 Prisma 测试库 + 假网关）：
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsletterService, normalizeEmail } from './newsletter.service.js';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  A@B.COM ')).toBe('a@b.com');
  });
});

describe('NewsletterService.subscribe', () => {
  it('upserts idempotently and keeps the first source', async () => { /* 见 Step 3 断言 */ });
  it('returns the active promotion code, or null when none is active', async () => { /* ... */ });
});
```
（测试用真实 `PrismaService` 指向专用测试库，`beforeEach` 清空 `newsletterSubscribers`/`newsletterPromotions`；网关用 `{ sendWelcome: vi.fn() }` 注入。）

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/newsletter/`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`unsubscribe-token.ts`：
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'newsletter-unsubscribe:';

export function signUnsubscribeToken(normalizedEmail: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(PREFIX + normalizedEmail).digest('base64url');
  return `${Buffer.from(normalizedEmail).toString('base64url')}.${mac}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const email = Buffer.from(payload, 'base64url').toString('utf8');
  const expected = createHmac('sha256', secret).update(PREFIX + email).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return email;
}
```

`newsletter.service.ts`：
```ts
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
```
`subscribe()`：归一化 → `prisma.newsletterSubscriber.upsert`（`create` 带 source；`update` 置 `status: 'SUBSCRIBED'`、`unsubscribedAt: null`，**不动 source**）→ 读当前 `ACTIVE` 活动 → best-effort `gateway.sendWelcome(email, { offerTitle, offerBody, promoCode, unsubscribeUrl })`（`try/catch` 吞错）→ 返回 `{ ok: true, promoCode, offerTitle, offerBody }`。
`unsubscribeByToken(token)`：`verifyUnsubscribeToken` → 命中则 `updateMany({ where: { email }, data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() } })` → 返回是否命中。

`newsletter.controller.ts`（storefront）：
```ts
@Controller('storefront/newsletter')
export class StorefrontNewsletterController {
  @Post('subscribe')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'newsletter-subscribe:ip', bucket: 'ip', limit: 20, windowMs: 60 * 60_000 })
  subscribe(@Body(new ZodValidationPipe(subscribeSchema)) body: SubscribeInput) { ... }

  @Get('unsubscribe')
  unsubscribe(@Query('token') token: string, @Res() res: Response) { /* 返回极简 HTML 确认页 */ }
}
```
`subscribeSchema`：`{ email: z.string().trim().email().max(200), source: z.enum(['POPUP', 'FOOTER']) }`。

`newsletter.module.ts`：imports `[AuthModule, EmailModule]`，providers `[NewsletterService]`，controllers `[StorefrontNewsletterController]`；注册进 `app.module.ts`。

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/newsletter/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/backend/src/modules/newsletter small-house-commerce/backend/src/app.module.ts
git commit -m "feat(newsletter): add subscribe and unsubscribe endpoints"
```

---

### Task 5: 优惠活动管理与共享折扣计算

**Files:**
- Create: `small-house-commerce/backend/src/modules/newsletter/promotion.service.ts`
- Create: `small-house-commerce/backend/src/modules/newsletter/promotion-pricing.ts`
- Create: `small-house-commerce/backend/src/modules/newsletter/dto/promotion.dto.ts`
- Create: `small-house-commerce/backend/src/modules/newsletter/admin/promotions.controller.ts`
- Modify: `small-house-commerce/backend/src/modules/newsletter/newsletter.module.ts`
- Test: `small-house-commerce/backend/src/modules/newsletter/promotion-pricing.spec.ts`
- Test: `small-house-commerce/backend/src/modules/newsletter/promotion.service.spec.ts`

**Interfaces:**
- Produces: 纯函数 `computeDiscount(promotion, subtotal): number` 与 `validatePromotionForSubtotal(...)`；`PromotionService`（`create`/`update`/`list`/`usage`）；后台路由 `GET|PATCH|POST /admin/newsletter/promotions`（`@Permissions('SYSTEM_SETTINGS_EDIT')`）。

- [ ] **Step 1: 写失败测试**

`promotion-pricing.spec.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { computeDiscount } from './promotion-pricing.js';

describe('computeDiscount', () => {
  it('applies a percentage', () => {
    expect(computeDiscount({ discountType: 'PERCENT', discountValue: 10 }, 250)).toBe(25);
  });
  it('applies a fixed amount', () => {
    expect(computeDiscount({ discountType: 'FIXED', discountValue: 200 }, 500)).toBe(200);
  });
  it('clamps a fixed amount larger than the subtotal', () => {
    expect(computeDiscount({ discountType: 'FIXED', discountValue: 999 }, 100)).toBe(100);
  });
  it('rounds a percentage to 2 decimals', () => {
    expect(computeDiscount({ discountType: 'PERCENT', discountValue: 7.5 }, 33.33)).toBe(2.5);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/newsletter/promotion-pricing.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`promotion-pricing.ts`：
```ts
export interface DiscountRule {
  discountType: 'PERCENT' | 'FIXED';
  discountValue: number;
}

/** Money math shared by the preview endpoint and the authoritative checkout. */
export function computeDiscount(rule: DiscountRule, subtotal: number): number {
  const raw =
    rule.discountType === 'PERCENT'
      ? (subtotal * rule.discountValue) / 100
      : rule.discountValue;
  const rounded = Math.round(raw * 100) / 100;
  return Math.max(0, Math.min(rounded, subtotal));
}
```

`promotion.service.ts`：`create()` 在同一事务内把原 ACTIVE 置 `ARCHIVED`（`archivedAt: now()`）再建新 ACTIVE；`update(id, input)` 只改字段、**不触碰计数**；`usage(id)` 用 `count({ where: { promotionId: id, releasedAt: null } })` 与每人分组计数。DTO 校验（`promotion.dto.ts`）按规格 §3.2 的规则（码 `^[A-Z0-9-]{3,32}$`、`PERCENT ≤ 100`、`maxUses/perCustomerLimit ≥ 1`、`validUntil > validFrom`）。

`promotions.controller.ts`：
```ts
@Controller('admin/newsletter/promotions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class AdminPromotionsController { ... }
```

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/newsletter/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/backend/src/modules/newsletter
git commit -m "feat(newsletter): add promotion management and discount pricing"
```

---

### Task 6: 结账链路减价（并发安全）

**Files:**
- Modify: `small-house-commerce/backend/src/modules/orders/dto/order.dto.ts`（`checkoutSchema` 加 `promoCode`）
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.ts:128-175`（折扣计算 + 核销插入）
- Modify: `small-house-commerce/backend/src/modules/orders/orders.module.ts`（import `NewsletterModule` 或直接注入 `PromotionService`）
- Test: `small-house-commerce/backend/src/modules/orders/orders.service.promo.spec.ts`

**Interfaces:**
- Consumes: Task 5 `computeDiscount` / `PromotionService`；Task 1 `PromoCodeRedemption`。
- Produces: `checkout()` 在 `input.promoCode` 非空时写入 `discountTotal`、`Order.promoCode` 与一条 `PromoCodeRedemption`；失败路径抛 `BadRequestException`。

- [ ] **Step 1: 写失败测试**

`orders.service.promo.spec.ts` 覆盖（真实事务，专用测试库）：
```ts
it('applies no discount when no code is sent (regression)', async () => { /* discountTotal 0, promoCode null */ });
it('applies a percentage discount and records the redemption', async () => { /* ... */ });
it('rejects an unknown / archived code with a readable message', async () => { /* ... */ });
it('rejects when below the minimum spend', async () => { /* ... */ });
it('rejects when the total usage limit is reached', async () => { /* ... */ });
it('rejects a second use by the same normalized phone', async () => { /* 0917… 与 +63917… 视为同一人 */ });
it('lets exactly one of two concurrent checkouts claim the last slot', async () => {
  // maxUses = 1；Promise.allSettled 两个 checkout；恰好一个 fulfilled
});
it('rolls the redemption back when order creation fails', async () => { /* 库存不足 → 无核销行 */ });
```

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/orders/orders.service.promo.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`order.dto.ts` 的 `checkoutSchema` 追加：
```ts
  promoCode: z
    .string()
    .trim()
    .max(32)
    .transform((v) => (v === '' ? null : v.toUpperCase()))
    .nullable()
    .default(null),
```

`orders.service.ts` 中把 `:138` 的 `const discount = 0;` 替换为（在既有事务内、`lines` 与 `subtotal` 已算出之后）：
```ts
    const promo = input.promoCode
      ? await this.promotions.resolveForCheckout(tx, input.promoCode, subtotal, normalizedPhone)
      : null;
    const discount = promo ? computeDiscount(promo.rule, subtotal) : 0;
```
其中 `PromotionService.resolveForCheckout(tx, code, subtotal, phone)`：
1. 读 `ACTIVE` 活动；码不匹配 → 抛 `That promo code isn't valid.`
2. 有效期校验 → 未开始 / 已结束文案
3. `subtotal < minSpend` → 抛最低消费文案
4. `await tx.$queryRaw\`SELECT pg_advisory_xact_lock(hashtext(${'promo:' + promotion.id}))\``（**按活动 ID 加锁**）
5. 计数：总有效核销数 `< maxUses`（若有）；该手机号有效核销数 `< perCustomerLimit`（若有）
6. 返回活动

`order.create` 的 data 追加 `promoCode: input.promoCode ?? null`；创建订单后（同一事务内）插入核销行：
```ts
        if (promo) {
          await tx.promoCodeRedemption.create({
            data: {
              promotionId: promo.id,
              orderId: created.id,
              codeSnapshot: promo.code,
              normalizedPhone,
              discountAmount: new Prisma.Decimal(discount),
            },
          });
        }
```

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/orders/orders.service.promo.spec.ts src/modules/orders/`
Expected: PASS（含既有订单测试全绿）

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/backend/src/modules/orders
git commit -m "feat(newsletter): apply promo discount at checkout with slot locking"
```

---

### Task 7: 取消订单释放名额

**Files:**
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.ts:375-400`（`cancel` 内 `releaseForOrder` 之后）
- Test: `small-house-commerce/backend/src/modules/orders/orders.service.cancel-release.spec.ts`

**Interfaces:**
- Consumes: Task 6 的核销行。
- Produces: `cancel()` 在订单终止后释放核销名额；`releaseRedemptionForOrder(tx, orderId)`（可复用于后续路径）。

- [ ] **Step 1: 写失败测试**

```ts
it('releases the redemption slot when an order is cancelled before shipping', async () => { /* releasedAt 非空 */ });
it('is idempotent: a second cancel attempt does not change releasedAt', async () => { /* 第二次 cancel 抛错但 releasedAt 不变 */ });
it('does not release for an order that never had a code', async () => { /* 无核销行，正常取消 */ });
```

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/orders/orders.service.cancel-release.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

在 `cancel()` 的 `await this.inventory.releaseForOrder(tx, orderId);` 之后追加：
```ts
      // Release the promo slot only here: pre-shipment cancellation is the
      // single release path (spec §4.4). The conditional update makes repeat
      // cancels and any retry idempotent.
      await tx.$executeRaw`
        UPDATE promo_code_redemptions SET released_at = now()
        WHERE order_id = ${orderId}::uuid AND released_at IS NULL
      `;
```

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/orders/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/backend/src/modules/orders
git commit -m "feat(newsletter): release promo slot on pre-shipment cancellation"
```

---

### Task 8: 订阅表单与 footer 通栏

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/site-settings.ts`
- Create: `small-house-commerce/frontend/src/components/newsletter/SubscribeEmailForm.tsx`
- Create: `small-house-commerce/frontend/src/components/newsletter/SubscribeBand.tsx`
- Modify: `small-house-commerce/frontend/src/components/layout/Footer.tsx`（如通栏作为独立组件则由布局挂载）
- Modify: `small-house-commerce/frontend/src/app/(storefront)/layout.tsx`
- Test: `small-house-commerce/frontend/src/components/newsletter/SubscribeEmailForm.spec.tsx`
- Test: `small-house-commerce/frontend/src/components/newsletter/SubscribeBand.spec.tsx`

**Interfaces:**
- Consumes: `SiteSettings`；`POST /api/v1/storefront/newsletter/subscribe`。
- Produces: `SubscribeEmailForm({ source, variant?, onSuccess? })`；`SubscribeBand`；`SiteSettings` 新增字段 `newsletterBandEnabled/newsletterPopupEnabled/newsletterPopupDelaySeconds/newsletterOfferTitle/newsletterOfferBody/newsletterOfferAvailable`。

- [ ] **Step 1: 写失败测试**

`SubscribeEmailForm.spec.tsx`：提交成功显示优惠码与复制按钮；无优惠码时只显示订阅成功；非法邮箱不发请求；提交中禁用。
`SubscribeBand.spec.tsx`：`newsletterBandEnabled` 为假时不渲染；有优惠文案时渲染 `offerTitle`；**无优惠文案时不渲染任何优惠承诺文本**。

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/frontend && pnpm exec vitest run src/components/newsletter/`
Expected: FAIL

- [ ] **Step 3: 实现**

`site-settings.ts`：`SiteSettings` 接口、`DEFAULT_SITE_SETTINGS`（`newsletterBandEnabled: true`、其余按 spec 默认）与 `coerce()` 加 `newsletterBandEnabled/newsletterPopupEnabled/newsletterPopupDelaySeconds/newsletterOfferTitle/newsletterOfferBody/newsletterOfferAvailable`（布尔/数字/字符串分别做类型守卫）。弹窗/优惠文案是否出现必须读服务端计算的 `newsletterOfferAvailable`，**不得以标题非空作代理**。

`SubscribeEmailForm.tsx`：受控邮箱输入 + 提交按钮；`fetch('/api/v1/storefront/newsletter/subscribe', ...)`（沿用项目既有前端请求封装；若 `lib/api.ts` 有 `request` 则复用）；成功态渲染 `offerTitle`/`offerBody` 与可复制的优惠码。

`SubscribeBand.tsx`：`useSiteSettings()` 读开关与文案；`newsletterBandEnabled` 为假返回 `null`；有 `offerTitle` 时渲染优惠文案，否则只渲染邮箱框。

`layout.tsx`：在 `<Footer ... />` **之前**插入 `<SubscribeBand />`。

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/frontend && pnpm exec vitest run src/components/newsletter/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/frontend/src/lib/site-settings.ts small-house-commerce/frontend/src/components/newsletter small-house-commerce/frontend/src/app/\(storefront\)/layout.tsx
git commit -m "feat(newsletter): add subscribe form and site-wide band"
```

---

### Task 9: 进站弹窗

**Files:**
- Create: `small-house-commerce/frontend/src/components/newsletter/NewsletterPopup.tsx`
- Modify: `small-house-commerce/frontend/src/app/(storefront)/layout.tsx`
- Test: `small-house-commerce/frontend/src/components/newsletter/NewsletterPopup.spec.tsx`

**Interfaces:**
- Consumes: Task 8 `SubscribeEmailForm`；`SiteSettings` 弹窗字段。
- Produces: `NewsletterPopup`（客户端组件）。

- [ ] **Step 1: 写失败测试**

```ts
it('does not open when the popup is disabled or no offer is configured', ...);
it('opens after the configured delay when enabled with an offer', ...);  // vi.useFakeTimers
it('writes the seen key on close so a reload never reopens it', ...);
it('writes the seen key on a successful subscribe', ...);
```

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/frontend && pnpm exec vitest run src/components/newsletter/NewsletterPopup.spec.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

`NewsletterPopup.tsx`：`useSiteSettings()` → 条件 `newsletterPopupEnabled && newsletterOfferAvailable && localStorage.getItem('luwag_newsletter_popup_seen') === null`；`setTimeout(delaySeconds * 1000)` 后 `setOpen(true)`；关闭（X / 背景 / Esc）与 `onSuccess` 都写 seen 键。弹层结构复用既有前台弹层模式（`role="dialog"`、`aria-modal`、焦点陷阱、Esc、关闭后焦点归位，参照 `CartDrawer`）。

`layout.tsx`：挂载 `<NewsletterPopup />`（放在 `Providers` 内、`MessengerChat` 附近）。

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/frontend && pnpm exec vitest run src/components/newsletter/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/frontend/src/components/newsletter/NewsletterPopup.tsx small-house-commerce/frontend/src/app/\(storefront\)/layout.tsx
git commit -m "feat(newsletter): add first-visit subscribe popup"
```

---

### Task 10: 优惠码输入（结账页 + PDP）与确认页折扣行

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/checkoutDraft.ts`
- Modify: `small-house-commerce/frontend/src/lib/api.ts`（`createOrder` 白名单加 `promoCode`）
- Modify: `small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx`
- Modify: `small-house-commerce/frontend/src/components/product/PdpQuickCodOrder.tsx`
- Modify: `small-house-commerce/frontend/src/components/checkout/CheckoutConfirmView.tsx`
- Test: `small-house-commerce/frontend/src/lib/checkoutDraft.spec.ts`（追加）
- Test: `small-house-commerce/frontend/src/lib/api.spec.ts`（追加）
- Test: `small-house-commerce/frontend/src/components/checkout/CheckoutConfirmView.spec.tsx`（追加）

**Interfaces:**
- Consumes: `POST /api/v1/storefront/checkout/promo-code/preview`（Task 11 提供，见下）。
- Produces: `CheckoutDraft.promoCode?: string | null`；`api.createOrder` 请求体含 `promoCode`；Confirm 页 `Promo discount` 行。

- [ ] **Step 1: 写失败测试**

- `checkoutDraft.spec.ts`：`promoCode` 往返、旧草稿无该字段时为 `null`、非字符串归一化为 `null`、超长截断/大写化。
- `api.spec.ts`：`createOrder` 在请求体 root 发送 `promoCode`，缺省发 `null`（沿用既有 `vi.fn<typeof fetch>()` 模式）。
- `CheckoutConfirmView.spec.tsx`：有 `promoCode` 时 totals 出现 `Promo discount` 行且 Total (COD) 为折后金额；无码时不出现该行。

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/frontend && pnpm exec vitest run src/lib/checkoutDraft.spec.ts src/lib/api.spec.ts src/components/checkout/CheckoutConfirmView.spec.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

`checkoutDraft.ts`：`CheckoutDraft` 加 `promoCode?: string | null`；`readCheckoutDraft` 归一化（非字符串/空白 → `null`，`trim().toUpperCase().slice(0, 32)`）；`writeCheckoutDraft` 增加对应参数（保持既有参数顺序兼容，新参数追加在末尾）。

`api.ts`：`createOrder` 输入类型与 `body` 各加 `promoCode?: string | null` / `promoCode: input.promoCode ?? null`（**白名单必须显式加，否则被静默丢弃**）。

`CheckoutForm.tsx` / `PdpQuickCodOrder.tsx`：加可选 `Promo code` 输入 + `Apply` 按钮，调用 preview 端点显示折扣金额或可读错误；码写入草稿与请求体。

`CheckoutConfirmView.tsx`：totals 中在 `You save` 之后、`Total (COD)` 之前插入 `Promo discount` 行（有码才显示），Total 用折后金额。

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/frontend && pnpm exec vitest run src/lib src/components/checkout src/components/product/PdpQuickCodOrder.spec.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/frontend/src/lib/checkoutDraft.ts small-house-commerce/frontend/src/lib/api.ts small-house-commerce/frontend/src/components/checkout small-house-commerce/frontend/src/components/product/PdpQuickCodOrder.tsx
git commit -m "feat(newsletter): add promo code entry to both checkout forms"
```

---

### Task 11: 优惠预览端点

**Files:**
- Modify: `small-house-commerce/backend/src/modules/newsletter/storefront/newsletter.controller.ts`
- Test: `small-house-commerce/backend/src/modules/newsletter/promo-preview.spec.ts`

**Interfaces:**
- Consumes: Task 5 `computeDiscount` / `PromotionService`。
- Produces: `POST /storefront/checkout/promo-code/preview` → `{ valid: boolean; discountAmount: number; message: string }`。

- [ ] **Step 1: 写失败测试**

```ts
it('returns the discount amount for a valid code', ...);
it('returns valid:false with a readable message for an unknown code', ...);
it('returns valid:false when below the minimum spend', ...);
it('returns valid:false when the usage limit is reached', ...);
it('does not create a redemption row (no slot consumed)', ...);
```

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/newsletter/promo-preview.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

在 storefront newsletter controller 加路由（`@UseGuards(ThrottleGuard)` + `@Throttle`）；service 方法 `previewPromo(code, subtotal)` 复用与结账**相同**的校验顺序与 `computeDiscount`，但**只读不写**（不插核销行、不加锁）。

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/backend && pnpm exec vitest run src/modules/newsletter/`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/backend/src/modules/newsletter
git commit -m "feat(newsletter): add promo code preview endpoint"
```

---

### Task 12: 后台订阅者名单与优惠活动 UI

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts`（订阅者/活动/用量类型与调用）
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/newsletter/page.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/newsletter/SubscribersTable.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/newsletter/PromotionPanel.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/AdminShell.tsx`（导航项）
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/settings/page.tsx`（展示字段）
- Modify: `small-house-commerce/frontend/src/lib/admin-i18n.tsx`（中文文案键）
- Test: `small-house-commerce/frontend/src/components/admin/newsletter/PromotionPanel.spec.tsx`

**Interfaces:**
- Consumes: Task 4/5/11 的后台端点。
- Produces: 导航项 `/admin/newsletter`（权限 `NEWSLETTER_READ`）；优惠活动 Tab（`SYSTEM_SETTINGS_EDIT`）。

- [ ] **Step 1: 写失败测试**

`PromotionPanel.spec.tsx`：无活动时提示「前台不会展示优惠」；保存非法码/百分比 > 100 显示校验错误；「开始新一轮」提示旧活动历史保留。

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/frontend && pnpm exec vitest run src/components/admin/newsletter/`
Expected: FAIL

- [ ] **Step 3: 实现**

`AdminShell.tsx` 的 NAV 追加 `{ kind: 'item', href: '/admin/newsletter', labelKey: 'nav_newsletter', permission: 'NEWSLETTER_READ' }`。
`admin-i18n.tsx` 加 `nav_newsletter` 与订阅页全部中文键。
订阅页两个 Tab：订阅者（列表 + 退订/恢复 + 导出）与优惠活动（仅 `SYSTEM_SETTINGS_EDIT` 可见）。
设置页加通栏/弹窗/延迟/标题/正文字段。

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/frontend && pnpm exec vitest run src/components/admin/newsletter/ && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/frontend/src/lib/admin-api.ts small-house-commerce/frontend/src/app/admin small-house-commerce/frontend/src/components/admin small-house-commerce/frontend/src/lib/admin-i18n.tsx
git commit -m "feat(newsletter): add admin subscribers page and promotion panel"
```

---

### Task 13: 浏览器端到端验收

**Files:**
- Create: `small-house-commerce/frontend/e2e/newsletter-discount.spec.ts`
- Test: 同上

**Interfaces:**
- Consumes: 全部前序任务；既有 `e2e/e2e-origins.ts`（`E2E_API` / `E2E_FRONTEND_ORIGIN`）与 `e2e/bootstrap.ts`。

- [ ] **Step 1: 写 e2e**

覆盖：首访弹窗出现 → 订阅 → 拿到码 → 关闭 → 刷新不再弹；footer 通栏订阅；**结算输入码 → 折扣生效 → Total (COD) 减少 → 下单后后台订单显示码与折扣**；无效码 / 未达门槛 / 已用尽的错误提示；后台「开始新一轮」后旧活动计数保留、新活动从零；375 / 768 / 1440 三宽度无横向溢出、无 console error。

- [ ] **Step 2: 运行验证失败**

Run: `cd small-house-commerce/frontend && E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/newsletter-discount.spec.ts --project=chromium; echo "EXIT=$?"`
Expected: FAIL（功能未实现/未接线）

- [ ] **Step 3: 修复至通过（只改必要源码）**

- [ ] **Step 4: 运行验证通过**

Run: `cd small-house-commerce/frontend && E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/newsletter-discount.spec.ts --project=chromium; echo "EXIT=$?"`
Expected: PASS（`EXIT=0`）

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/frontend/e2e/newsletter-discount.spec.ts
git commit -m "test(newsletter): cover subscription and discount lifecycle"
```

---

## 最终门禁

```bash
cd small-house-commerce/backend && pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm run lint
cd small-house-commerce/frontend && pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm run lint
cd small-house-commerce/frontend && E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test e2e/newsletter-discount.spec.ts --project=chromium
```

- 后端全量：0 failed（既有 42 skipped 不计）。
- 前端全量：本计划新增用例全绿；marketing 线既有失败（若仍在）单独记账，不算本计划失败。
- 未 commit / push / merge / PR / deploy；未触碰生产、`backend/uploads/`、3000/3001、peer 3210/3211。

## 自审记录

- **规格覆盖**：§3 数据模型 → Task 1；§4.1 订阅/退订 → Task 4；§4.2 邮件网关 → Task 3；§4.3 结账减价与并发 → Task 6；§4.4 取消释放 → Task 7；§4.5 权限 → Task 2/5/12；§4.6 公开设置 → Task 8；§4.7 后台端点 → Task 5/12；§5 前台 → Task 8/9/10/12；§7 测试 → 各任务 + Task 13；§8 迁移 → Task 1。**无遗漏。**
- **占位符扫描**：无 TBD/TODO；所有步骤给出文件路径与命令。
- **类型一致性**：`promoCode`（Draft / api / DTO / Order）命名一致；`computeDiscount(rule, subtotal)` 在 Task 5 定义、Task 6/11 消费；`EMAIL_GATEWAY` 令牌在 Task 3 定义、Task 4 消费。
- **Review Focus 落点**：①码归一化 → Task 6 测试；②创建失败不占名额 → Task 6 测试；③固定额夹取 → Task 5/6 测试；④旧码失效 → Task 6 测试；⑤手机号归一化 → Task 6 测试。
