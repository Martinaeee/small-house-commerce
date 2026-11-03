# Checkout 自动保存与后台草稿订单实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消费者一进入 Checkout，就把当前选购和已填写的结账字段自动保存为后台可查看的草稿订单；退出不丢失，正式下单后标记为已转订单，草稿全程不影响库存、ERP 和成交统计。

**Architecture:** 新增独立的 `checkout_drafts` 表与公开草稿接口（能力令牌鉴权），前台用 600ms 防抖 + 本地暂存同步；正式下单事务内把同一令牌的草稿原子转换为 CONVERTED；后台新增只读草稿列表与详情页。

**Tech Stack:** NestJS 12 + Prisma 7 + Zod 4 + PostgreSQL；Next.js 16 App Router + React 19 + Vitest 4。

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-11-03-checkout-autosave-drafts-design.md`

## Global Constraints

- 所有面向用户的回复用中文；代码、路径、字段名保持英文原样。
- 不改 Header / Footer / 全局 admin shell / 全局导航；新增入口只放在订单页标题操作区。
- 不改 `SkuPackagingAssist.tsx`、`ProductDimensionsAssist.tsx` 及任何尺寸解析逻辑。
- 草稿不得进入 `OrdersService` 的正式订单创建路径之外的业务：不占库存、不建 Customer、不推千易、不发 Meta Purchase。
- 草稿保留：从未主动填写的空草稿 24 小时；含用户输入或已转订单最多 30 天（从令牌创建时间起算，不续期）。
- 输入上限：姓名 120、手机号 24、省/市/Barangay 各 120、邮编 20、详细地址 255、备注 200、优惠码 32 字符；商品最多 100 行、每行数量 1–99；请求体 64 KiB。
- 令牌 30 天绝对有效期；服务端只存 SHA-256，不落原始令牌。
- 后台草稿读取权限统一为 `ORDER_VIEW_ALL`；本期后台只读。
- 生产迁移、启用自动采集、发布必须另行获得确认；本计划只在本地分支执行。
- 后端 `pnpm build` 不生成 Prisma Client，任何后端构建前必须 `pnpm exec prisma generate`。
- 生产不得整体重跑 seed。

## Review Focus

- **半填手机号 / 空姓名**：草稿接口必须接受并保存原始值，不能被正式下单校验拒绝。
- **多标签或乱序请求**：旧的自动保存响应到达时不得覆盖更新内容；客户端收到 409 应静默放弃。
- **下单与自动保存竞态**：正式订单成功后，迟到的保存请求不得把草稿重新打开或改挂第二张订单。
- **存储/网络不可用**：`localStorage` 抛错或接口失败时，表单仍可填写、可下单，不清空用户输入。
- **越权读取**：只有持有高熵令牌的人能读取草稿；后台 UUID、手机号、订单号都不能读取。

---

### Task 1: 草稿数据模型与能力令牌

**Files:**
- Create: `small-house-commerce/backend/prisma/schema/checkout-draft.prisma`
- Modify: `small-house-commerce/backend/prisma/schema/order.prisma:227-246`
- Create: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-draft-token.ts`
- Test: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-draft-token.spec.ts`

**Interfaces:**
- Produces: `hashCheckoutDraftToken(raw: string, now?: Date): { hash: string; issuedAt: Date }`
- Produces: `CHECKOUT_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000`
- Produces: `CheckoutDraftTokenError`、`CheckoutDraftExpiredError`
- Produces: Prisma model `CheckoutDraft`、enum `CheckoutDraftStatus`

- [ ] **Step 1: 写失败测试**

```ts
// backend/src/modules/checkout-drafts/checkout-draft-token.spec.ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_DRAFT_MAX_AGE_MS,
  CheckoutDraftExpiredError,
  CheckoutDraftTokenError,
  hashCheckoutDraftToken,
} from './checkout-draft-token.js';

const NOW = new Date('2026-11-03T00:00:00.000Z');
const RANDOM = 'A'.repeat(43);

function tokenAt(ms: number): string {
  return `${ms.toString(36)}.${RANDOM}`;
}

describe('hashCheckoutDraftToken', () => {
  it('hashes the whole token and keeps its issued time', () => {
    const raw = tokenAt(NOW.getTime());
    const parsed = hashCheckoutDraftToken(raw, NOW);
    expect(parsed.issuedAt.toISOString()).toBe(NOW.toISOString());
    expect(parsed.hash).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('rejects a token without the random half', () => {
    expect(() => hashCheckoutDraftToken('abc', NOW)).toThrow(CheckoutDraftTokenError);
    expect(() => hashCheckoutDraftToken(`${NOW.getTime().toString(36)}.short`, NOW)).toThrow(
      CheckoutDraftTokenError,
    );
  });

  it('rejects a token dated in the future', () => {
    const future = NOW.getTime() + 10 * 60_000;
    expect(() => hashCheckoutDraftToken(tokenAt(future), NOW)).toThrow(CheckoutDraftTokenError);
  });

  it('rejects a token at the 30 day edge', () => {
    const old = NOW.getTime() - CHECKOUT_DRAFT_MAX_AGE_MS;
    expect(() => hashCheckoutDraftToken(tokenAt(old), NOW)).toThrow(CheckoutDraftExpiredError);
  });

  it('accepts a token one millisecond inside the window', () => {
    const old = NOW.getTime() - CHECKOUT_DRAFT_MAX_AGE_MS + 1;
    expect(() => hashCheckoutDraftToken(tokenAt(old), NOW)).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd small-house-commerce/backend && pnpm vitest run src/modules/checkout-drafts/checkout-draft-token.spec.ts`
Expected: FAIL，提示找不到 `./checkout-draft-token.js`。

- [ ] **Step 3: 写 Prisma 模型**

```prisma
// backend/prisma/schema/checkout-draft.prisma
enum CheckoutDraftStatus {
  OPEN
  CONVERTED
  EXPIRED
}

/// 未完成的结账草稿。与 orders 完全分离：不占库存、不建 Customer。
model CheckoutDraft {
  id              String              @id @default(uuid(7)) @db.Uuid
  /// sha256(raw token)；原始能力令牌永不落库。
  tokenHash       String              @unique @map("token_hash") @db.VarChar(64)
  tokenIssuedAt   DateTime            @map("token_issued_at") @db.Timestamptz(3)
  status          CheckoutDraftStatus @default(OPEN)
  /// 顾客是否主动填写或选择过；系统默认值不计入。
  hasUserInput    Boolean             @default(false) @map("has_user_input")
  /// 客户端单调递增序号；用于幂等重试与旧请求防覆盖。
  clientRevision  Int                 @default(0) @map("client_revision")
  contactName     String?             @map("contact_name") @db.VarChar(120)
  contactPhone    String?             @map("contact_phone") @db.VarChar(24)
  snapshot        Json                @default("{}")
  productSnapshot Json                @default("[]") @map("product_snapshot")
  orderId         String?             @unique @map("order_id") @db.Uuid
  createdAt       DateTime            @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime            @updatedAt @map("updated_at") @db.Timestamptz(3)
  expiresAt       DateTime            @map("expires_at") @db.Timestamptz(3)

  order Order? @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([status, updatedAt])
  @@index([expiresAt])
  @@index([contactPhone])
  @@map("checkout_drafts")
}
```

在 `order.prisma` 的 `Order` 关系区追加一行：

```prisma
  checkoutDraft          CheckoutDraft?
```

- [ ] **Step 4: 实现令牌工具**

```ts
// backend/src/modules/checkout-drafts/checkout-draft-token.ts
import { createHash } from 'node:crypto';

export const CHECKOUT_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60_000;
const TOKEN_PATTERN = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{43})$/;

export class CheckoutDraftTokenError extends Error {
  constructor() {
    super('Invalid checkout draft token.');
    this.name = 'CheckoutDraftTokenError';
  }
}

export class CheckoutDraftExpiredError extends Error {
  constructor() {
    super('This checkout draft has expired.');
    this.name = 'CheckoutDraftExpiredError';
  }
}

export interface ParsedCheckoutDraftToken {
  hash: string;
  issuedAt: Date;
}

export function hashCheckoutDraftToken(
  raw: string,
  now: Date = new Date(),
): ParsedCheckoutDraftToken {
  const match = TOKEN_PATTERN.exec(raw.trim());
  if (!match) throw new CheckoutDraftTokenError();
  const issuedAtMs = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
    throw new CheckoutDraftTokenError();
  }
  if (issuedAtMs > now.getTime() + CLOCK_SKEW_MS) throw new CheckoutDraftTokenError();
  if (now.getTime() - issuedAtMs >= CHECKOUT_DRAFT_MAX_AGE_MS) {
    throw new CheckoutDraftExpiredError();
  }
  return {
    hash: createHash('sha256').update(raw.trim()).digest('hex'),
    issuedAt: new Date(issuedAtMs),
  };
}

/** Orders path: a malformed/expired token must never block a real order. */
export function tryHashCheckoutDraftToken(
  raw: string | null | undefined,
  now: Date = new Date(),
): ParsedCheckoutDraftToken | null {
  if (!raw) return null;
  try {
    return hashCheckoutDraftToken(raw, now);
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 生成 Client 并迁移**

Run:
```bash
cd small-house-commerce/backend
pnpm exec prisma generate
pnpm exec prisma migrate dev --name add_checkout_drafts
```
Expected: 生成 `src/generated/prisma`，新增 `prisma/migrations/*_add_checkout_drafts/migration.sql`，包含 `checkout_drafts` 表、唯一索引和 `Order.checkout_draft` 反向关系所需外键。
若 CLI 未自动读取配置，追加 `--config prisma7.config.ts` 后重跑。

- [ ] **Step 6: 运行测试与类型检查**

Run:
```bash
cd small-house-commerce/backend
pnpm vitest run src/modules/checkout-drafts/checkout-draft-token.spec.ts
pnpm exec tsc --noEmit
```
Expected: 5 项通过，tsc exit 0。

- [ ] **Step 7: 提交**

```bash
git add small-house-commerce/backend/prisma/schema/checkout-draft.prisma \
  small-house-commerce/backend/prisma/schema/order.prisma \
  small-house-commerce/backend/prisma/migrations \
  small-house-commerce/backend/src/modules/checkout-drafts/checkout-draft-token.ts \
  small-house-commerce/backend/src/modules/checkout-drafts/checkout-draft-token.spec.ts
git commit -m "feat(checkout): add checkout draft schema and capability token"
```

---

### Task 2: 草稿快照与读写服务

**Files:**
- Create: `small-house-commerce/backend/src/modules/checkout-drafts/dto/checkout-draft.dto.ts`
- Create: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-draft-snapshot.ts`
- Create: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-drafts.service.ts`
- Test: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-drafts.service.spec.ts`

**Interfaces:**
- Consumes: `hashCheckoutDraftToken`、`CheckoutDraftExpiredError`
- Produces: `checkoutDraftSaveSchema`、`type CheckoutDraftSaveInput`
- Produces: `emptyDraftSnapshot()`、`buildCheckoutDraftSnapshot(input)`
- Produces: `CheckoutDraftsService.save(rawToken, input, now?)`、`.read(rawToken, now?)`
- Produces: `CheckoutDraftConflictError(currentRevision)`、`CheckoutDraftGoneError()`

- [ ] **Step 1: 写失败测试**

```ts
// backend/src/modules/checkout-drafts/checkout-drafts.service.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CheckoutDraftConflictError,
  CheckoutDraftGoneError,
  CheckoutDraftsService,
} from './checkout-drafts.service.js';
import type { CheckoutDraftSaveInput } from './dto/checkout-draft.dto.js';

const NOW = new Date('2026-11-03T00:00:00.000Z');
const TOKEN = `${NOW.getTime().toString(36)}.${'B'.repeat(43)}`;
const EMPTY_INPUT: CheckoutDraftSaveInput = {
  revision: 1,
  hasUserInput: false,
  customer: {
    name: '', phone: '', province: '', city: '', barangay: '',
    postalCode: '', streetAddress: '', landmark: '',
  },
  items: [],
  preferredDeliveryDate: null,
  promoCodeInput: '',
  promoCodeApplied: null,
  customerNote: '',
};

function harness(row: Record<string, unknown> | null = null) {
  const state = { row };
  const prisma = {
    checkoutDraft: {
      findUnique: vi.fn(async () => state.row),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.row = { id: 'draft-1', createdAt: NOW, updatedAt: NOW, ...data };
        return state.row;
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!state.row) return { count: 0 };
        state.row = { ...state.row, ...data };
        return { count: 1 };
      }),
    },
    sku: { findMany: vi.fn(async () => []) },
  };
  const service = new CheckoutDraftsService(prisma as never);
  return { service, prisma, state };
}

describe('CheckoutDraftsService.save', () => {
  it('creates an empty draft on first visit', async () => {
    const { service, prisma } = harness();
    const result = await service.save(TOKEN, EMPTY_INPUT, NOW);
    expect(result).toEqual({ status: 'OPEN', revision: 1, converted: false });
    expect(prisma.checkoutDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'OPEN', hasUserInput: false, clientRevision: 1 }),
      }),
    );
  });

  it('accepts an incomplete phone and name without validating them', async () => {
    const { service, state } = harness();
    await service.save(
      TOKEN,
      {
        ...EMPTY_INPUT,
        hasUserInput: true,
        customer: { ...EMPTY_INPUT.customer, name: 'Ma', phone: '0917' },
      },
      NOW,
    );
    expect(state.row?.contactPhone).toBe('0917');
    expect(state.row?.contactName).toBe('Ma');
  });

  it('treats an equal revision as an idempotent retry', async () => {
    const { service, prisma } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 3, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot: {}, productSnapshot: [],
    });
    const result = await service.save(TOKEN, { ...EMPTY_INPUT, revision: 3 }, NOW);
    expect(result).toEqual({ status: 'OPEN', revision: 3, converted: false });
    expect(prisma.checkoutDraft.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an older revision instead of overwriting newer input', async () => {
    const { service } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 5, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot: {}, productSnapshot: [],
    });
    await expect(service.save(TOKEN, { ...EMPTY_INPUT, revision: 4 }, NOW)).rejects.toBeInstanceOf(
      CheckoutDraftConflictError,
    );
  });

  it('stops writing once the draft has converted', async () => {
    const { service, prisma } = harness({
      id: 'draft-1', status: 'CONVERTED', clientRevision: 9, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot: {}, productSnapshot: [],
    });
    const result = await service.save(TOKEN, { ...EMPTY_INPUT, revision: 10 }, NOW);
    expect(result).toEqual({ status: 'CONVERTED', revision: 9, converted: true });
    expect(prisma.checkoutDraft.updateMany).not.toHaveBeenCalled();
  });

  it('keeps hasUserInput true once the shopper typed', async () => {
    const { service, state } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 1, hasUserInput: true, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot: {}, productSnapshot: [],
    });
    await service.save(TOKEN, { ...EMPTY_INPUT, revision: 2, hasUserInput: false }, NOW);
    expect(state.row?.hasUserInput).toBe(true);
  });
});

describe('CheckoutDraftsService.read', () => {
  it('returns null for an unknown token', async () => {
    const { service } = harness();
    await expect(service.read(TOKEN, NOW)).resolves.toBeNull();
  });

  it('refuses an expired draft even before cleanup runs', async () => {
    const { service } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 1, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() - 1), snapshot: {}, productSnapshot: [],
    });
    await expect(service.read(TOKEN, NOW)).rejects.toBeInstanceOf(CheckoutDraftGoneError);
  });

  it('returns the snapshot to the token holder', async () => {
    const snapshot = { ...EMPTY_INPUT, customer: { ...EMPTY_INPUT.customer, name: 'Ana' } };
    const { service } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 2, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot, productSnapshot: [],
    });
    await expect(service.read(TOKEN, NOW)).resolves.toEqual({
      status: 'OPEN', revision: 2, snapshot,
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd small-house-commerce/backend && pnpm vitest run src/modules/checkout-drafts/checkout-drafts.service.spec.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 定义 DTO**

```ts
// backend/src/modules/checkout-drafts/dto/checkout-draft.dto.ts
import { z } from 'zod';

export const checkoutDraftCustomerSchema = z.object({
  name: z.string().max(120),
  phone: z.string().max(24),
  province: z.string().max(120),
  city: z.string().max(120),
  barangay: z.string().max(120),
  postalCode: z.string().max(20),
  streetAddress: z.string().max(255),
  landmark: z.string().max(255),
}).strict();

export const checkoutDraftSaveSchema = z.object({
  revision: z.number().int().min(1).max(1_000_000),
  hasUserInput: z.boolean(),
  customer: checkoutDraftCustomerSchema,
  items: z.array(z.object({
    skuId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99),
  })).max(100),
  preferredDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  promoCodeInput: z.string().max(32),
  promoCodeApplied: z.string().max(32).nullable(),
  customerNote: z.string().max(200),
}).strict();

export type CheckoutDraftSaveInput = z.infer<typeof checkoutDraftSaveSchema>;

export const checkoutDraftQuerySchema = z.object({
  search: z.string().max(255).optional(),
  status: z.enum(['OPEN', 'CONVERTED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CheckoutDraftQuery = z.infer<typeof checkoutDraftQuerySchema>;
```

- [ ] **Step 4: 写快照工具**

```ts
// backend/src/modules/checkout-drafts/checkout-draft-snapshot.ts
import type { CheckoutDraftSaveInput } from './dto/checkout-draft.dto.js';

export interface CheckoutDraftCustomerSnapshot {
  name: string; phone: string; province: string; city: string;
  barangay: string; postalCode: string; streetAddress: string; landmark: string;
}

export interface CheckoutDraftSnapshot {
  customer: CheckoutDraftCustomerSnapshot;
  items: { skuId: string; quantity: number }[];
  preferredDeliveryDate: string | null;
  promoCodeInput: string;
  promoCodeApplied: string | null;
  customerNote: string;
}

export interface CheckoutDraftProductLine {
  skuId: string;
  skuCode: string | null;
  productId: string | null;
  productName: string | null;
  productSlug: string | null;
  variantName: string | null;
  thumbnailUrl: string | null;
  unitPrice: string | null;
  quantity: number;
}

export function buildCheckoutDraftSnapshot(input: CheckoutDraftSaveInput): CheckoutDraftSnapshot {
  return {
    customer: {
      name: input.customer.name.slice(0, 120),
      phone: input.customer.phone.slice(0, 24),
      province: input.customer.province.slice(0, 120),
      city: input.customer.city.slice(0, 120),
      barangay: input.customer.barangay.slice(0, 120),
      postalCode: input.customer.postalCode.slice(0, 20),
      streetAddress: input.customer.streetAddress.slice(0, 255),
      landmark: input.customer.landmark.slice(0, 255),
    },
    items: input.items.slice(0, 100).map((item) => ({ skuId: item.skuId, quantity: item.quantity })),
    preferredDeliveryDate: input.preferredDeliveryDate,
    promoCodeInput: input.promoCodeInput.slice(0, 32),
    promoCodeApplied: input.promoCodeApplied ? input.promoCodeApplied.slice(0, 32).toUpperCase() : null,
    customerNote: input.customerNote.slice(0, 200),
  };
}

export function contactOf(snapshot: CheckoutDraftSnapshot): { name: string | null; phone: string | null } {
  const name = snapshot.customer.name.trim();
  const phone = snapshot.customer.phone.trim();
  return { name: name === '' ? null : name, phone: phone === '' ? null : phone };
}
```

- [ ] **Step 5: 实现服务**

```ts
// backend/src/modules/checkout-drafts/checkout-drafts.service.ts
import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CHECKOUT_DRAFT_MAX_AGE_MS,
  CheckoutDraftExpiredError,
  hashCheckoutDraftToken,
} from './checkout-draft-token.js';
import type { CheckoutDraftSaveInput } from './dto/checkout-draft.dto.js';
import {
  buildCheckoutDraftSnapshot,
  contactOf,
  type CheckoutDraftProductLine,
  type CheckoutDraftSnapshot,
} from './checkout-draft-snapshot.js';

const EMPTY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PRODUCT_LINES = 100;

export class CheckoutDraftConflictError extends ConflictException {
  constructor(readonly currentRevision: number) {
    super({ statusCode: 409, message: 'A newer checkout draft revision was saved.', currentRevision });
  }
}

export class CheckoutDraftGoneError extends GoneException {
  constructor() {
    super({ statusCode: 410, message: 'This checkout draft has expired.' });
  }
}

@Injectable()
export class CheckoutDraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    rawToken: string,
    input: CheckoutDraftSaveInput,
    now: Date = new Date(),
  ): Promise<{ status: 'OPEN' | 'CONVERTED' | 'EXPIRED'; revision: number; converted: boolean }> {
    const token = this.parseToken(rawToken, now);
    const existing = await this.prisma.checkoutDraft.findUnique({ where: { tokenHash: token.hash } });

    if (existing?.status === 'CONVERTED') {
      return { status: 'CONVERTED', revision: existing.clientRevision, converted: true };
    }
    if (existing?.status === 'EXPIRED') throw new CheckoutDraftGoneError();
    if (existing && now >= existing.expiresAt) {
      await this.prisma.checkoutDraft.updateMany({
        where: { id: existing.id },
        data: { status: 'EXPIRED', snapshot: {}, productSnapshot: [], contactName: null, contactPhone: null },
      });
      throw new CheckoutDraftGoneError();
    }

    const snapshot = buildCheckoutDraftSnapshot(input);
    const contact = contactOf(snapshot);
    const hasUserInput = Boolean(input.hasUserInput || existing?.hasUserInput);
    const tokenExpiresAt = new Date(token.issuedAt.getTime() + CHECKOUT_DRAFT_MAX_AGE_MS);

    if (!existing) {
      const emptyExpiresAt = new Date(
        Math.min(now.getTime() + EMPTY_TTL_MS, tokenExpiresAt.getTime()),
      );
      try {
        const created = await this.prisma.checkoutDraft.create({
          data: {
            tokenHash: token.hash,
            tokenIssuedAt: token.issuedAt,
            clientRevision: input.revision,
            hasUserInput,
            contactName: contact.name,
            contactPhone: contact.phone,
            snapshot,
            productSnapshot: await this.productSnapshot(input.items),
            expiresAt: hasUserInput ? tokenExpiresAt : emptyExpiresAt,
          },
        });
        return { status: 'OPEN', revision: created.clientRevision, converted: false };
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        return this.save(rawToken, input, now);
      }
    }

    if (input.revision < existing.clientRevision) {
      throw new CheckoutDraftConflictError(existing.clientRevision);
    }
    if (input.revision === existing.clientRevision) {
      return { status: 'OPEN', revision: existing.clientRevision, converted: false };
    }

    let productSnapshot: CheckoutDraftProductLine[] = [];
    try {
      productSnapshot = await this.productSnapshot(input.items);
    } catch {
      productSnapshot = [];
    }

    const updated = await this.prisma.checkoutDraft.updateMany({
      where: {
        id: existing.id,
        status: 'OPEN',
        clientRevision: { lt: input.revision },
      },
      data: {
        clientRevision: input.revision,
        hasUserInput,
        contactName: contact.name,
        contactPhone: contact.phone,
        snapshot,
        productSnapshot,
        expiresAt: hasUserInput ? tokenExpiresAt : existing.expiresAt,
      },
    });
    if (updated.count === 0) {
      const latest = await this.prisma.checkoutDraft.findUnique({ where: { tokenHash: token.hash } });
      if (latest?.status === 'CONVERTED') {
        return { status: 'CONVERTED', revision: latest.clientRevision, converted: true };
      }
      throw new CheckoutDraftConflictError(latest?.clientRevision ?? existing.clientRevision);
    }
    return { status: 'OPEN', revision: input.revision, converted: false };
  }

  async read(
    rawToken: string,
    now: Date = new Date(),
  ): Promise<{ status: 'OPEN'; revision: number; snapshot: CheckoutDraftSnapshot } | null> {
    const token = this.parseToken(rawToken, now);
    const draft = await this.prisma.checkoutDraft.findUnique({ where: { tokenHash: token.hash } });
    if (!draft) return null;
    if (draft.status === 'EXPIRED' || now >= draft.expiresAt) throw new CheckoutDraftGoneError();
    if (draft.status === 'CONVERTED') {
      throw new NotFoundException({ statusCode: 404, message: 'This checkout was completed.' });
    }
    return {
      status: 'OPEN',
      revision: draft.clientRevision,
      snapshot: draft.snapshot as CheckoutDraftSnapshot,
    };
  }

  private parseToken(rawToken: string, now: Date) {
    try {
      return hashCheckoutDraftToken(rawToken, now);
    } catch (error) {
      if (error instanceof CheckoutDraftExpiredError) throw new CheckoutDraftGoneError();
      throw new NotFoundException({ statusCode: 404, message: 'Checkout draft not found.' });
    }
  }

  private async productSnapshot(
    items: { skuId: string; quantity: number }[],
  ): Promise<CheckoutDraftProductLine[]> {
    if (items.length === 0) return [];
    const skus = await this.prisma.sku.findMany({
      where: { id: { in: items.map((item) => item.skuId).slice(0, MAX_PRODUCT_LINES) } },
      select: {
        id: true,
        skuCode: true,
        price: true,
        variant: {
          select: {
            name: true,
            images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: {
              where: { variantId: null },
              select: { url: true },
              orderBy: { sortOrder: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
    const byId = new Map(skus.map((sku) => [sku.id, sku]));
    return items.slice(0, MAX_PRODUCT_LINES).map((item) => {
      const sku = byId.get(item.skuId);
      return {
        skuId: item.skuId,
        skuCode: sku?.skuCode ?? null,
        productId: sku?.product.id ?? null,
        productName: sku?.product.name ?? null,
        productSlug: sku?.product.slug ?? null,
        variantName: sku?.variant.name ?? null,
        thumbnailUrl: sku?.variant.images[0]?.url ?? sku?.product.images[0]?.url ?? null,
        unitPrice: sku?.price == null ? null : sku.price.toString(),
        quantity: item.quantity,
      };
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd small-house-commerce/backend && pnpm vitest run src/modules/checkout-drafts/`
Expected: Task 1 + Task 2 全部通过。

- [ ] **Step 7: 提交**

```bash
git add small-house-commerce/backend/src/modules/checkout-drafts
git commit -m "feat(checkout): persist incomplete checkout drafts"
```

---

### Task 3: 公开草稿接口与限流

**Files:**
- Create: `small-house-commerce/backend/src/modules/checkout-drafts/storefront/checkout-drafts.controller.ts`
- Create: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-drafts.module.ts`
- Modify: `small-house-commerce/backend/src/app.module.ts:26-28,49-65`
- Test: `small-house-commerce/backend/src/modules/checkout-drafts/storefront/checkout-drafts.controller.spec.ts`

**Interfaces:**
- Consumes: `CheckoutDraftsService.save/read`
- Produces: `PUT /api/v1/storefront/checkout-drafts/current`
- Produces: `GET /api/v1/storefront/checkout-drafts/current`
- Produces: `CheckoutDraftsModule`

- [ ] **Step 1: 写失败测试**

```ts
// .../storefront/checkout-drafts.controller.spec.ts
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StorefrontCheckoutDraftsController } from './checkout-drafts.controller.js';

const INPUT = {
  revision: 1, hasUserInput: true,
  customer: { name: 'A', phone: '0917', province: '', city: '', barangay: '', postalCode: '', streetAddress: '', landmark: '' },
  items: [], preferredDeliveryDate: null, promoCodeInput: '', promoCodeApplied: null, customerNote: '',
};

describe('StorefrontCheckoutDraftsController', () => {
  it('requires the capability header on write', async () => {
    const service = { save: vi.fn(), read: vi.fn() };
    const controller = new StorefrontCheckoutDraftsController(service as never);
    await expect(controller.save(undefined, INPUT)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.save).not.toHaveBeenCalled();
  });

  it('passes the raw token through and never accepts a client status', async () => {
    const service = { save: vi.fn(async () => ({ status: 'OPEN', revision: 1, converted: false })), read: vi.fn() };
    const controller = new StorefrontCheckoutDraftsController(service as never);
    await controller.save('tok', INPUT);
    expect(service.save).toHaveBeenCalledWith('tok', INPUT);
  });

  it('returns 404 when the token has no draft', async () => {
    const service = { save: vi.fn(), read: vi.fn(async () => null) };
    const controller = new StorefrontCheckoutDraftsController(service as never);
    await expect(controller.read('tok')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd small-house-commerce/backend && pnpm vitest run src/modules/checkout-drafts/storefront/`
Expected: FAIL，controller 不存在。

- [ ] **Step 3: 实现 controller 与模块**

```ts
// .../storefront/checkout-drafts.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottleGuard } from '../../../common/throttle.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CheckoutDraftsService } from '../checkout-drafts.service.js';
import {
  checkoutDraftSaveSchema,
  type CheckoutDraftSaveInput,
} from '../dto/checkout-draft.dto.js';

const HEADER = 'x-checkout-draft-token';

function requireToken(token: string | undefined): string {
  if (!token || token.trim() === '') {
    throw new BadRequestException('The checkout draft token header is required.');
  }
  return token.trim();
}

@Controller('storefront/checkout-drafts')
@UseGuards(ThrottleGuard)
export class StorefrontCheckoutDraftsController {
  constructor(private readonly drafts: CheckoutDraftsService) {}

  @Put('current')
  @HttpCode(200)
  @Throttle({ key: 'checkout-draft-save:ip', bucket: 'ip', limit: 120, windowMs: 60_000 })
  save(
    @Headers(HEADER) token: string | undefined,
    @Body(new ZodValidationPipe(checkoutDraftSaveSchema)) body: CheckoutDraftSaveInput,
  ) {
    return this.drafts.save(requireToken(token), body);
  }

  @Get('current')
  @Throttle({ key: 'checkout-draft-read:ip', bucket: 'ip', limit: 240, windowMs: 60_000 })
  async read(@Headers(HEADER) token: string | undefined) {
    const draft = await this.drafts.read(requireToken(token));
    if (!draft) throw new NotFoundException({ statusCode: 404, message: 'Checkout draft not found.' });
    return draft;
  }
}
```

```ts
// .../checkout-drafts.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CheckoutDraftsService } from './checkout-drafts.service.js';
import { AdminCheckoutDraftsController } from './admin/checkout-drafts.controller.js';
import { StorefrontCheckoutDraftsController } from './storefront/checkout-drafts.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [StorefrontCheckoutDraftsController, AdminCheckoutDraftsController],
  providers: [CheckoutDraftsService],
  exports: [CheckoutDraftsService],
})
export class CheckoutDraftsModule {}
```

Task 4 会创建 `AdminCheckoutDraftsController`；若先执行 Task 3，暂时只注册 `StorefrontCheckoutDraftsController`，并在 Task 4 补上。

在 `app.module.ts` 导入并加入 `imports`：

```ts
import { CheckoutDraftsModule } from './modules/checkout-drafts/checkout-drafts.module.js';
```

```ts
    CartModule,
    CheckoutDraftsModule,
```

- [ ] **Step 4: 运行测试**

Run: `cd small-house-commerce/backend && pnpm vitest run src/modules/checkout-drafts/storefront/ && pnpm exec tsc --noEmit`
Expected: 3 项通过，tsc exit 0。

- [ ] **Step 5: 提交**

```bash
git add small-house-commerce/backend/src/modules/checkout-drafts \
  small-house-commerce/backend/src/app.module.ts
git commit -m "feat(checkout): expose token-scoped checkout draft API"
```

---

### Task 4: 后台草稿列表与详情接口

**Files:**
- Create: `small-house-commerce/backend/src/modules/checkout-drafts/admin/checkout-drafts.controller.ts`
- Modify: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-drafts.service.ts`
- Test: `small-house-commerce/backend/src/modules/checkout-drafts/admin/checkout-drafts.controller.spec.ts`
- Test: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-drafts.service.admin.spec.ts`

**Interfaces:**
- Consumes: `checkoutDraftQuerySchema`
- Produces: `GET /api/v1/admin/checkout-drafts`（`ORDER_VIEW_ALL`）
- Produces: `GET /api/v1/admin/checkout-drafts/:id`（`ORDER_VIEW_ALL`）
- Produces: `CheckoutDraftsService.list(query)`、`.detail(id, now?)`

> API 路径使用 `admin/checkout-drafts` 而不是 `admin/orders/drafts`，避免与现有 `admin/orders/:id` 动态路由的注册顺序冲突；后台页面路径仍是 `/admin/orders/drafts`。

- [ ] **Step 1: 写失败测试（权限元数据）**

```ts
// .../admin/checkout-drafts.controller.spec.ts
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { AdminCheckoutDraftsController } from './checkout-drafts.controller.js';

describe('AdminCheckoutDraftsController', () => {
  it('sits behind JWT and permission guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminCheckoutDraftsController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
    );
  });

  it('requires ORDER_VIEW_ALL on both reads', () => {
    const permissionOf = (method: 'list' | 'detail'): string[] =>
      Reflect.getMetadata(PERMISSIONS_KEY, AdminCheckoutDraftsController.prototype[method] as object);
    expect(permissionOf('list')).toEqual(['ORDER_VIEW_ALL']);
    expect(permissionOf('detail')).toEqual(['ORDER_VIEW_ALL']);
  });

  it('delegates without exposing a write route', () => {
    const service = { list: vi.fn(async () => ({ items: [], total: 0 })), detail: vi.fn(async () => ({})) };
    const controller = new AdminCheckoutDraftsController(service as never);
    expect(Object.getOwnPropertyNames(AdminCheckoutDraftsController.prototype).sort()).toEqual(
      ['constructor', 'detail', 'list'].sort(),
    );
  });
});
```

- [ ] **Step 2: 写失败测试（列表与详情数据）**

```ts
// .../checkout-drafts.service.admin.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { CheckoutDraftsService } from './checkout-drafts.service.js';

function serviceWith(rows: unknown[], total = rows.length) {
  const prisma = {
    checkoutDraft: {
      findMany: vi.fn(async () => rows),
      count: vi.fn(async () => total),
      findUnique: vi.fn(async () => rows[0] ?? null),
    },
  };
  return new CheckoutDraftsService(prisma as never);
}

describe('CheckoutDraftsService admin reads', () => {
  it('searches name or phone and never includes EXPIRED rows by default', async () => {
    const service = serviceWith([]);
    const prisma = (service as unknown as { prisma: { checkoutDraft: { findMany: ReturnType<typeof vi.fn> } } }).prisma;
    await service.list({ search: '0917', page: 2, pageSize: 20 });
    expect(prisma.checkoutDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['OPEN', 'CONVERTED'] },
          OR: [{ contactName: { contains: '0917', mode: 'insensitive' } }, { contactPhone: { contains: '0917' } }],
        },
        skip: 20,
        take: 20,
        orderBy: { updatedAt: 'desc' },
      }),
    );
  });

  it('returns the order number of a converted draft', async () => {
    const service = serviceWith([{
      id: 'draft-1', status: 'CONVERTED', hasUserInput: true, clientRevision: 4,
      contactName: 'Ana', contactPhone: '0917', snapshot: {}, productSnapshot: [],
      orderId: 'order-1', createdAt: new Date('2026-11-01'), updatedAt: new Date('2026-11-02'),
      expiresAt: new Date('2026-12-01'), order: { orderNumber: 'PH100020', id: 'order-1' },
    }]);
    await expect(service.detail('draft-1')).resolves.toMatchObject({
      id: 'draft-1', status: 'CONVERTED', orderNumber: 'PH100020',
    });
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd small-house-commerce/backend && pnpm vitest run src/modules/checkout-drafts/admin/ src/modules/checkout-drafts/checkout-drafts.service.admin.spec.ts`
Expected: FAIL。

- [ ] **Step 4: 实现后台读取**

在 `checkout-drafts.service.ts` 追加：

```ts
import type { CheckoutDraftQuery } from './dto/checkout-draft.dto.js';
import type { CheckoutDraftProductLine } from './checkout-draft-snapshot.js';

export interface AdminCheckoutDraftSummary {
  id: string;
  status: 'OPEN' | 'CONVERTED';
  hasUserInput: boolean;
  contactName: string | null;
  contactPhone: string | null;
  itemCount: number;
  firstItemName: string | null;
  firstItemThumbnail: string | null;
  orderId: string | null;
  orderNumber: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface AdminCheckoutDraftDetail extends AdminCheckoutDraftSummary {
  snapshot: CheckoutDraftSnapshot;
  productSnapshot: CheckoutDraftProductLine[];
}

function toSummary(row: {
  id: string; status: 'OPEN' | 'CONVERTED'; hasUserInput: boolean;
  contactName: string | null; contactPhone: string | null;
  productSnapshot: unknown; orderId: string | null;
  order: { id: string; orderNumber: string } | null;
  createdAt: Date; updatedAt: Date; expiresAt: Date;
}): AdminCheckoutDraftSummary {
  const products = Array.isArray(row.productSnapshot)
    ? (row.productSnapshot as CheckoutDraftProductLine[])
    : [];
  return {
    id: row.id,
    status: row.status,
    hasUserInput: row.hasUserInput,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    itemCount: products.length,
    firstItemName: products[0]?.productName ?? null,
    firstItemThumbnail: products[0]?.thumbnailUrl ?? null,
    orderId: row.order?.id ?? row.orderId ?? null,
    orderNumber: row.order?.orderNumber ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

async list(query: CheckoutDraftQuery) {
  const where = {
    status: query.status ? query.status : { in: ['OPEN', 'CONVERTED'] as const },
    ...(query.search
      ? {
          OR: [
            { contactName: { contains: query.search, mode: 'insensitive' as const } },
            { contactPhone: { contains: query.search } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    this.prisma.checkoutDraft.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, status: true, hasUserInput: true, contactName: true, contactPhone: true,
        productSnapshot: true, orderId: true, createdAt: true, updatedAt: true, expiresAt: true,
        order: { select: { id: true, orderNumber: true } },
      },
    }),
    this.prisma.checkoutDraft.count({ where }),
  ]);
  return {
    items: rows.map((row) => toSummary(row as never)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

async detail(id: string, now: Date = new Date()) {
  const row = await this.prisma.checkoutDraft.findUnique({
    where: { id },
    include: { order: { select: { id: true, orderNumber: true } } },
  });
  if (!row || row.status === 'EXPIRED' || (row.status === 'OPEN' && now >= row.expiresAt)) {
    throw new NotFoundException({ statusCode: 404, message: 'Checkout draft not found.' });
  }
  return {
    ...toSummary(row),
    snapshot: row.snapshot as CheckoutDraftSnapshot,
    productSnapshot: Array.isArray(row.productSnapshot)
      ? (row.productSnapshot as CheckoutDraftProductLine[])
      : [],
    orderId: row.orderId,
  };
}
```

> `toSummary` 的类型参数用 `as never` 只出现在 Prisma 返回值与手写类型存在可选字段差异处；实现后若 tsc 报错，改成显式 `Prisma.CheckoutDraftGetPayload<...>` 类型，不要放宽返回结构。

- [ ] **Step 5: 实现 controller**

```ts
// .../admin/checkout-drafts.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CheckoutDraftsService } from '../checkout-drafts.service.js';
import { checkoutDraftQuerySchema, type CheckoutDraftQuery } from '../dto/checkout-draft.dto.js';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/checkout-drafts')
export class AdminCheckoutDraftsController {
  constructor(private readonly drafts: CheckoutDraftsService) {}

  @Get()
  @Permissions('ORDER_VIEW_ALL')
  list(@Query(new ZodValidationPipe(checkoutDraftQuerySchema)) query: CheckoutDraftQuery) {
    return this.drafts.list(query);
  }

  @Get(':id')
  @Permissions('ORDER_VIEW_ALL')
  detail(@Param('id') id: string) {
    return this.drafts.detail(id);
  }
}
```

- [ ] **Step 6: 运行测试**

Run:
```bash
cd small-house-commerce/backend
pnpm vitest run src/modules/checkout-drafts
pnpm exec tsc --noEmit
```
Expected: 全部通过，tsc exit 0。

- [ ] **Step 7: 提交**

```bash
git add small-house-commerce/backend/src/modules/checkout-drafts
git commit -m "feat(checkout): let the order team inspect checkout drafts"
```

---

### Task 5: 正式下单关联草稿

**Files:**
- Modify: `small-house-commerce/backend/src/modules/orders/dto/order.dto.ts:4-16,60-70`
- Create: `small-house-commerce/backend/src/modules/checkout-drafts/converted-draft.ts`
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.ts:608-634`
- Test: `small-house-commerce/backend/src/modules/checkout-drafts/converted-draft.spec.ts`
- Test: `small-house-commerce/backend/src/modules/orders/order-idempotency.spec.ts`

**Interfaces:**
- Consumes: `tryHashCheckoutDraftToken`
- Produces: `persistConvertedDraft(tx, args): Promise<void>`
- Produces: `CheckoutInput.checkoutDraftToken?: string | null`

- [ ] **Step 1: 写失败测试**

```ts
// .../converted-draft.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { persistConvertedDraft } from './converted-draft.js';

const ARGS = {
  rawToken: `${Date.now().toString(36)}.${'C'.repeat(43)}`,
  orderId: '11111111-1111-4111-8111-111111111111',
  customerName: 'Ana',
  customerPhone: '09171234567',
  now: new Date('2026-11-03T00:00:00.000Z'),
};

describe('persistConvertedDraft', () => {
  it('converts an existing open draft in the order transaction', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const createMany = vi.fn(async () => ({ count: 0 }));
    await persistConvertedDraft({ checkoutDraft: { updateMany, createMany } } as never, ARGS);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), status: 'OPEN' },
      data: expect.objectContaining({ status: 'CONVERTED', orderId: ARGS.orderId }),
    }));
    expect(createMany).not.toHaveBeenCalled();
  });

  it('creates a converted tombstone when the first autosave never arrived', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const createMany = vi.fn(async () => ({ count: 1 }));
    await persistConvertedDraft({ checkoutDraft: { updateMany, createMany } } as never, ARGS);
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        status: 'CONVERTED', orderId: ARGS.orderId, hasUserInput: true,
      })],
      skipDuplicates: true,
    });
  });

  it('never touches the draft for a malformed token', async () => {
    const updateMany = vi.fn();
    const createMany = vi.fn();
    await persistConvertedDraft({ checkoutDraft: { updateMany, createMany } } as never, {
      ...ARGS, rawToken: 'not-a-token',
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});
```

```ts
// backend/src/modules/orders/order-idempotency.spec.ts 追加
// 若文件已导入 idempotencyFingerprint，不要重复导入；只追加下面这个 it。
it('ignores the draft token when fingerprinting an order', () => {
  const base = {
    customer: { name: 'Ana', phone: '09171234567', province: 'Bulacan', city: 'Meycauayan', streetAddress: '1 St' },
    items: [{ skuId: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
  } as never;
  const withToken = { ...base, checkoutDraftToken: `${Date.now().toString(36)}.${'D'.repeat(43)}` } as never;
  expect(idempotencyFingerprint(withToken)).toBe(idempotencyFingerprint(base));
});
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
cd small-house-commerce/backend
pnpm vitest run src/modules/checkout-drafts/converted-draft.spec.ts src/modules/orders/order-idempotency.spec.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现转换工具**

```ts
// .../converted-draft.ts
import {
  CHECKOUT_DRAFT_MAX_AGE_MS,
  tryHashCheckoutDraftToken,
} from './checkout-draft-token.js';

interface DraftTx {
  checkoutDraft: {
    updateMany: (args: unknown) => Promise<{ count: number }>;
    createMany: (args: unknown) => Promise<{ count: number }>;
  };
}

export async function persistConvertedDraft(
  tx: DraftTx,
  args: {
    rawToken: string | null | undefined;
    orderId: string;
    customerName: string;
    customerPhone: string;
    now?: Date;
  },
): Promise<void> {
  const now = args.now ?? new Date();
  const token = tryHashCheckoutDraftToken(args.rawToken, now);
  if (!token) return;

  const expiresAt = new Date(token.issuedAt.getTime() + CHECKOUT_DRAFT_MAX_AGE_MS);
  const update = await tx.checkoutDraft.updateMany({
    where: { tokenHash: token.hash, status: 'OPEN' },
    data: {
      status: 'CONVERTED',
      hasUserInput: true,
      orderId: args.orderId,
      contactName: args.customerName.slice(0, 120) || null,
      contactPhone: args.customerPhone.slice(0, 24) || null,
      expiresAt,
    },
  });
  if (update.count > 0) return;

  await tx.checkoutDraft.createMany({
    data: [{
      tokenHash: token.hash,
      tokenIssuedAt: token.issuedAt,
      status: 'CONVERTED',
      hasUserInput: true,
      clientRevision: 1,
      contactName: args.customerName.slice(0, 120) || null,
      contactPhone: args.customerPhone.slice(0, 24) || null,
      snapshot: {},
      productSnapshot: [],
      orderId: args.orderId,
      expiresAt,
    }],
    skipDuplicates: true,
  });
}
```

- [ ] **Step 4: 接入 DTO 与订单事务**

在 `checkoutSchema` 末尾追加：

```ts
  // Optional capability token from the checkout autosave layer. It links the
  // order to its draft; it never changes what was bought and is excluded from
  // the idempotency fingerprint.
  checkoutDraftToken: z.string().min(20).max(200).nullable().optional(),
```

在 `orders.service.ts` 顶部导入：

```ts
import { persistConvertedDraft } from '../checkout-drafts/converted-draft.js';
```

在事务内 `orderStatusHistory.create` 之后、`return {` 之前插入：

```ts
      await persistConvertedDraft(tx, {
        rawToken: input.checkoutDraftToken,
        orderId: created.id,
        customerName: input.customer.name,
        customerPhone: input.customer.phone,
      });
```

- [ ] **Step 5: 运行测试与类型检查**

Run:
```bash
cd small-house-commerce/backend
pnpm vitest run src/modules/checkout-drafts/converted-draft.spec.ts src/modules/orders/order-idempotency.spec.ts
pnpm exec tsc --noEmit
```
Expected: 4 项通过，tsc exit 0。

- [ ] **Step 6: 提交**

```bash
git add small-house-commerce/backend/src/modules/orders \
  small-house-commerce/backend/src/modules/checkout-drafts
git commit -m "feat(checkout): convert the draft when its order is placed"
```

---

### Task 6: 保留期限与清理任务

**Files:**
- Modify: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-drafts.service.ts`
- Create: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-drafts-cleanup.ts`
- Modify: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-drafts.module.ts`
- Test: `small-house-commerce/backend/src/modules/checkout-drafts/checkout-drafts-cleanup.spec.ts`

**Interfaces:**
- Produces: `CheckoutDraftsService.prune(now?)`
- Produces: `CheckoutDraftsCleanup.onModuleInit/onModuleDestroy`

- [ ] **Step 1: 写失败测试**

```ts
// .../checkout-drafts-cleanup.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutDraftsCleanup } from './checkout-drafts-cleanup.js';

describe('CheckoutDraftsCleanup', () => {
  afterEach(() => vi.useRealTimers());

  it('runs once at start and then on the interval, unref-ing the timer', async () => {
    vi.useFakeTimers();
    const drafts = { prune: vi.fn(async () => ({ expired: 0, deleted: 0 })) };
    const timer = { unref: vi.fn() } as never;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue(timer);
    const cleanup = new CheckoutDraftsCleanup(drafts as never);
    cleanup.onModuleInit();
    expect(drafts.prune).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60_000);
    expect(drafts.prune).toHaveBeenCalledTimes(2);
    expect((timer as unknown as { unref: ReturnType<typeof vi.fn> }).unref).toHaveBeenCalled();
    cleanup.onModuleDestroy();
    expect(globalThis.clearInterval).toBeDefined();
    setIntervalSpy.mockRestore();
  });

  it('does not crash the app when a prune tick fails', async () => {
    vi.useFakeTimers();
    const drafts = { prune: vi.fn(async () => { throw new Error('db down'); }) };
    vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref: vi.fn() } as never);
    const cleanup = new CheckoutDraftsCleanup(drafts as never);
    expect(() => cleanup.onModuleInit()).not.toThrow();
    await vi.runOnlyPendingTimersAsync();
    cleanup.onModuleDestroy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd small-house-commerce/backend && pnpm vitest run src/modules/checkout-drafts/checkout-drafts-cleanup.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 prune**

在 `checkout-drafts.service.ts` 追加：

```ts
  /** 24h 空草稿抹掉内容；30 天令牌到期后删除整行。分批执行，可重复运行。 */
  async prune(now: Date = new Date()): Promise<{ expired: number; deleted: number }> {
    const deleted = await this.prisma.checkoutDraft.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    const emptyCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    let expired = 0;
    for (let batch = 0; batch < 10; batch += 1) {
      const rows = await this.prisma.checkoutDraft.findMany({
        where: {
          status: 'OPEN',
          hasUserInput: false,
          createdAt: { lte: emptyCutoff },
          expiresAt: { gt: now },
        },
        select: { id: true, tokenIssuedAt: true },
        take: 200,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const tombstoneExpiry = new Date(row.tokenIssuedAt.getTime() + CHECKOUT_DRAFT_MAX_AGE_MS);
        await this.prisma.checkoutDraft.updateMany({
          where: { id: row.id, status: 'OPEN', hasUserInput: false },
          data: {
            status: 'EXPIRED',
            snapshot: {},
            productSnapshot: [],
            contactName: null,
            contactPhone: null,
            expiresAt: tombstoneExpiry,
          },
        });
        expired += 1;
        // 已经到令牌寿命的空草稿直接删除，不留墓碑。
        if (tombstoneExpiry <= now) {
          await this.prisma.checkoutDraft.deleteMany({ where: { id: row.id } });
        }
      }
      if (rows.length < 200) break;
    }
    return { expired, deleted: deleted.count };
  }
```

- [ ] **Step 4: 实现清理任务**

```ts
// .../checkout-drafts-cleanup.ts
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CheckoutDraftsService } from './checkout-drafts.service.js';

const TICK_MS = 60 * 60_000;

@Injectable()
export class CheckoutDraftsCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckoutDraftsCleanup.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly drafts: CheckoutDraftsService) {}

  onModuleInit(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    void this.drafts
      .prune()
      .then(({ expired, deleted }) => {
        if (expired > 0 || deleted > 0) {
          this.logger.log(`checkout drafts: expired=${expired} deleted=${deleted}`);
        }
      })
      .catch((error: unknown) => {
        this.logger.error(`checkout draft cleanup failed: ${String(error)}`);
      });
  }
}
```

在模块 `providers` 加入 `CheckoutDraftsCleanup`。

- [ ] **Step 5: 运行测试**

Run:
```bash
cd small-house-commerce/backend
pnpm vitest run src/modules/checkout-drafts
pnpm exec tsc --noEmit
```
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add small-house-commerce/backend/src/modules/checkout-drafts
git commit -m "feat(checkout): expire and clean up abandoned checkout drafts"
```

---

### Task 7: 前台自动保存基础库与同步 Hook

**Files:**
- Create: `small-house-commerce/frontend/src/lib/checkoutAutosave.ts`
- Create: `small-house-commerce/frontend/src/components/checkout/useCheckoutDraftAutosave.ts`
- Test: `small-house-commerce/frontend/src/lib/checkoutAutosave.spec.ts`
- Test: `small-house-commerce/frontend/src/components/checkout/useCheckoutDraftAutosave.spec.tsx`

**Interfaces:**
- Produces: `checkoutAttemptKey({ skuId, qty, itemsParam, slug }): string`
- Produces: `createCheckoutDraftToken(now?: number): string`
- Produces: `resolveCheckoutAttempt(key: string, now?: number): CheckoutAttempt`
- Produces: `readAutosave(attempt): { revision, snapshot } | null`
- Produces: `writeAutosave(attempt, revision, snapshot): void`
- Produces: `clearAutosave(attempt?): void`
- Produces: `restoreCheckoutDraft(key: string): Promise<CheckoutAutosaveSnapshot | null>`
- Produces: `type CheckoutAutosaveStatus`
- Produces: `buildCheckoutSnapshot(form, items, promo): CheckoutAutosaveSnapshot`
- Produces: `autosaveStatusLabel(status): string`
- Produces: `useCheckoutDraftAutosave({ attempt, snapshot, active, hasUserInput }): { status, flush }`

- [ ] **Step 1: 写失败测试（存储与令牌）**

```ts
// frontend/src/lib/checkoutAutosave.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkoutAttemptKey,
  clearAutosave,
  createCheckoutDraftToken,
  readAutosave,
  resolveCheckoutAttempt,
  writeAutosave,
  type CheckoutAutosaveSnapshot,
} from './checkoutAutosave';

const SNAPSHOT: CheckoutAutosaveSnapshot = {
  customer: { name: 'Ana', phone: '0917', province: '', city: '', barangay: '', postalCode: '', streetAddress: '', landmark: '' },
  items: [], preferredDeliveryDate: null, promoCodeInput: '', promoCodeApplied: null, customerNote: '',
};

describe('checkoutAttemptKey', () => {
  it('separates buy-now from the cart and is stable across review', () => {
    expect(checkoutAttemptKey({ skuId: 'sku-1', qty: '2', slug: 'chair' })).toBe('buy:sku-1:2:chair');
    expect(checkoutAttemptKey({ itemsParam: 'b,a', slug: 'chair' })).toBe('cart:a,b');
    expect(checkoutAttemptKey({ slug: 'chair' })).toBe('cart:all');
  });
});

describe('checkout draft token', () => {
  it('encodes its creation time and 32 random bytes', () => {
    const now = Date.parse('2026-11-03T00:00:00.000Z');
    const token = createCheckoutDraftToken(now);
    expect(token.split('.')[0]).toBe(now.toString(36));
    expect(token.split('.')[1]).toHaveLength(43);
    expect(createCheckoutDraftToken(now)).not.toBe(token);
  });
});

describe('local autosave', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the token while the same checkout is resumed', () => {
    const first = resolveCheckoutAttempt('cart:a', 1000);
    const second = resolveCheckoutAttempt('cart:a', 2000);
    expect(second.token).toBe(first.token);
  });

  it('starts a new attempt for a different checkout', () => {
    const first = resolveCheckoutAttempt('cart:a', 1000);
    const second = resolveCheckoutAttempt('cart:b', 2000);
    expect(second.token).not.toBe(first.token);
  });

  it('round-trips the last snapshot and clears it', () => {
    const attempt = resolveCheckoutAttempt('cart:a', 1000);
    writeAutosave(attempt, 3, SNAPSHOT);
    expect(readAutosave(attempt)).toEqual({ revision: 3, snapshot: SNAPSHOT });
    clearAutosave(attempt);
    expect(readAutosave(attempt)).toBeNull();
  });

  it('never throws when storage is disabled', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => writeAutosave({ token: 'x', key: 'k', createdAt: 1 }, 1, SNAPSHOT)).not.toThrow();
    expect(readAutosave({ token: 'x', key: 'k', createdAt: 1 })).toBeNull();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd small-house-commerce/frontend && pnpm vitest run src/lib/checkoutAutosave.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现存储库**

```ts
// frontend/src/lib/checkoutAutosave.ts
export const CHECKOUT_AUTOSAVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT_KEY = "luwag_checkout_attempt_v1";
const DATA_KEY = "luwag_checkout_autosave_v1";
export const CHECKOUT_DRAFT_HEADER = "x-checkout-draft-token";

export type CheckoutAutosaveStatus =
  | "idle" | "saving" | "saved" | "offline" | "expired" | "converted";

export interface CheckoutAutosaveSnapshot {
  customer: {
    name: string; phone: string; province: string; city: string;
    barangay: string; postalCode: string; streetAddress: string; landmark: string;
  };
  items: { skuId: string; quantity: number }[];
  preferredDeliveryDate: string | null;
  promoCodeInput: string;
  promoCodeApplied: string | null;
  customerNote: string;
}

export interface CheckoutAttempt {
  token: string;
  key: string;
  createdAt: number;
}

interface StoredAutosave {
  token: string;
  revision: number;
  snapshot: CheckoutAutosaveSnapshot;
  savedAt: number;
}

export function checkoutAttemptKey(input: {
  skuId?: string; qty?: string; itemsParam?: string; slug?: string;
}): string {
  if (input.skuId) return `buy:${input.skuId}:${input.qty ?? "1"}:${input.slug ?? ""}`;
  if (input.itemsParam) {
    const ids = Array.from(new Set(input.itemsParam.split(",").map((id) => id.trim()).filter(Boolean))).sort();
    return ids.length === 0 ? "cart:all" : `cart:${ids.join(",")}`;
  }
  return "cart:all";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createCheckoutDraftToken(now: number = Date.now()): string {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  return `${now.toString(36)}.${base64Url(random)}`;
}

export function tokenCreatedAt(token: string): number | null {
  const [time] = token.split(".");
  const ms = Number.parseInt(time ?? "", 36);
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

export function resolveCheckoutAttempt(key: string, now: number = Date.now()): CheckoutAttempt {
  const stored = readAttempt();
  if (
    stored &&
    stored.key === key &&
    now - stored.createdAt < CHECKOUT_AUTOSAVE_MAX_AGE_MS
  ) {
    return stored;
  }
  const attempt = { token: createCheckoutDraftToken(now), key, createdAt: now };
  writeAttempt(attempt);
  return attempt;
}

function readAttempt(): CheckoutAttempt | null {
  try {
    const raw = localStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckoutAttempt;
    return typeof parsed.token === "string" && typeof parsed.key === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeAttempt(attempt: CheckoutAttempt): void {
  try {
    localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    /* storage disabled: sync degrades, form keeps working */
  }
}

export function readAutosave(
  attempt: CheckoutAttempt,
): { revision: number; snapshot: CheckoutAutosaveSnapshot } | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAutosave;
    if (parsed.token !== attempt.token || !parsed.snapshot) return null;
    return { revision: parsed.revision, snapshot: parsed.snapshot };
  } catch {
    return null;
  }
}

export function readAutosaveRevision(attempt: CheckoutAttempt): number {
  return readAutosave(attempt)?.revision ?? 0;
}

export function writeAutosave(
  attempt: CheckoutAttempt,
  revision: number,
  snapshot: CheckoutAutosaveSnapshot,
): void {
  try {
    const stored: StoredAutosave = { token: attempt.token, revision, snapshot, savedAt: Date.now() };
    localStorage.setItem(DATA_KEY, JSON.stringify(stored));
  } catch {
    /* see writeAttempt */
  }
}

export function clearAutosave(attempt?: CheckoutAttempt): void {
  try {
    localStorage.removeItem(DATA_KEY);
    const stored = readAttempt();
    if (!attempt || !stored || stored.token === attempt.token) {
      localStorage.removeItem(ATTEMPT_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** Restore local first, then prefer the server revision when it is newer. */
export async function restoreCheckoutDraft(
  key: string,
  now: number = Date.now(),
): Promise<CheckoutAutosaveSnapshot | null> {
  const attempt = resolveCheckoutAttempt(key, now);
  if (now - attempt.createdAt >= CHECKOUT_AUTOSAVE_MAX_AGE_MS) {
    clearAutosave(attempt);
    return null;
  }
  const local = readAutosave(attempt);
  try {
    const res = await fetch("/api/v1/storefront/checkout-drafts/current", {
      headers: { [CHECKOUT_DRAFT_HEADER]: attempt.token },
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as {
        revision: number;
        snapshot: CheckoutAutosaveSnapshot;
      };
      if (!local || body.revision >= local.revision) {
        writeAutosave(attempt, body.revision, body.snapshot);
        return body.snapshot;
      }
    }
  } catch {
    /* offline: local copy still restores */
  }
  return local?.snapshot ?? null;
}

export function readCheckoutAttemptToken(key: string): string | null {
  const stored = readAttempt();
  if (!stored || stored.key !== key) return null;
  if (Date.now() - stored.createdAt >= CHECKOUT_AUTOSAVE_MAX_AGE_MS) return null;
  return stored.token;
}

export interface CheckoutAutosaveForm {
  name: string;
  phone: string;
  province: string;
  city: string;
  barangay: string;
  postalCode: string;
  streetAddress: string;
  landmark: string;
  preferredDeliveryDate: string;
  notes: string;
}

export function buildCheckoutSnapshot(
  form: CheckoutAutosaveForm,
  items: { skuId: string; quantity: number }[],
  promo: { input: string; applied: string | null },
): CheckoutAutosaveSnapshot {
  return {
    customer: {
      name: form.name.slice(0, 120),
      phone: form.phone.slice(0, 24),
      province: form.province.slice(0, 120),
      city: form.city.slice(0, 120),
      barangay: form.barangay.slice(0, 120),
      postalCode: form.postalCode.slice(0, 20),
      streetAddress: form.streetAddress.slice(0, 255),
      landmark: form.landmark.slice(0, 255),
    },
    items: items.slice(0, 100).map((item) => ({ skuId: item.skuId, quantity: item.quantity })),
    preferredDeliveryDate: form.preferredDeliveryDate.trim() || null,
    promoCodeInput: promo.input.slice(0, 32),
    promoCodeApplied: promo.applied ? promo.applied.slice(0, 32).toUpperCase() : null,
    customerNote: form.notes.slice(0, 200),
  };
}

export function autosaveStatusLabel(status: CheckoutAutosaveStatus): string {
  if (status === "saving") return "Saving your details…";
  if (status === "saved") return "Your details are saved. You can come back to this checkout.";
  if (status === "offline") {
    return "We could not save to the shop yet. Your details stay on this device and will retry.";
  }
  if (status === "expired") return "This saved checkout has expired. Please continue with a new one.";
  if (status === "converted") return "This checkout was already placed.";
  return "Your details are saved as you type.";
}
```

- [ ] **Step 4: 写 Hook 的失败测试**

```tsx
// frontend/src/components/checkout/useCheckoutDraftAutosave.spec.tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCheckoutAttempt, type CheckoutAutosaveSnapshot } from "@/lib/checkoutAutosave";
import { useCheckoutDraftAutosave } from "./useCheckoutDraftAutosave";

const SNAPSHOT: CheckoutAutosaveSnapshot = {
  customer: { name: "", phone: "", province: "", city: "", barangay: "", postalCode: "", streetAddress: "", landmark: "" },
  items: [{ skuId: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
  preferredDeliveryDate: null, promoCodeInput: "", promoCodeApplied: null, customerNote: "",
};

describe("useCheckoutDraftAutosave", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("creates the draft on entry and saves after the debounce", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "OPEN", revision: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const attempt = resolveCheckoutAttempt("cart:all");
    const { result } = renderHook(() =>
      useCheckoutDraftAutosave({ attempt, snapshot: SNAPSHOT, active: true, hasUserInput: false }),
    );
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("saved");
  });

  it("keeps the user input and marks offline when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const attempt = resolveCheckoutAttempt("cart:all");
    const { result } = renderHook(() =>
      useCheckoutDraftAutosave({ attempt, snapshot: SNAPSHOT, active: true, hasUserInput: true }),
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.status).toBe("offline");
  });

  it("stops syncing after 410 and after conversion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 410 })));
    const attempt = resolveCheckoutAttempt("cart:all");
    const { result, rerender } = renderHook(
      ({ name }) => useCheckoutDraftAutosave({
        attempt,
        snapshot: { ...SNAPSHOT, customer: { ...SNAPSHOT.customer, name } },
        active: true,
        hasUserInput: true,
      }),
      { initialProps: { name: "" } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.status).toBe("expired");
    rerender({ name: "Ana" });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(result.current.status).toBe("expired");
  });
});
```

- [ ] **Step 5: 实现 Hook**

```ts
// frontend/src/components/checkout/useCheckoutDraftAutosave.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHECKOUT_DRAFT_HEADER,
  readAutosaveRevision,
  writeAutosave,
  type CheckoutAttempt,
  type CheckoutAutosaveSnapshot,
  type CheckoutAutosaveStatus,
} from "@/lib/checkoutAutosave";

const DEBOUNCE_MS = 600;
const BACKOFF_MS = [2_000, 5_000, 15_000];
const ENDPOINT = "/api/v1/storefront/checkout-drafts/current";

export function useCheckoutDraftAutosave({
  attempt, snapshot, active, hasUserInput,
}: {
  attempt: CheckoutAttempt;
  snapshot: CheckoutAutosaveSnapshot;
  active: boolean;
  hasUserInput: boolean;
}) {
  const [status, setStatus] = useState<CheckoutAutosaveStatus>("idle");
  const revisionRef = useRef(0);
  const lastQueuedRef = useRef("");
  const inFlightRef = useRef(false);
  const stoppedRef = useRef(false);
  const backoffRef = useRef(0);
  const bodyRef = useRef("");
  const snapshotRef = useRef(snapshot);
  const hasInputRef = useRef(hasUserInput);
  const timerRef = useRef<number | null>(null);

  snapshotRef.current = snapshot;
  hasInputRef.current = hasUserInput;

  useEffect(() => { revisionRef.current = readAutosaveRevision(attempt); }, [attempt]);

  const send = useCallback(async () => {
    if (inFlightRef.current || stoppedRef.current) return;
    inFlightRef.current = true;
    setStatus("saving");
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json", [CHECKOUT_DRAFT_HEADER]: attempt.token },
        body: bodyRef.current,
        cache: "no-store",
      });
      if (res.status === 410) { stoppedRef.current = true; setStatus("expired"); return; }
      if (res.status === 409) { setStatus("saved"); return; } // a newer revision already won
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { status?: string };
      if (body.status === "CONVERTED") { stoppedRef.current = true; setStatus("converted"); return; }
      backoffRef.current = 0;
      setStatus("saved");
    } catch {
      if (stoppedRef.current) return;
      setStatus("offline");
      const delay = BACKOFF_MS[Math.min(backoffRef.current, BACKOFF_MS.length - 1)];
      backoffRef.current += 1;
      window.setTimeout(() => { if (!stoppedRef.current) void send(); }, delay);
    } finally {
      inFlightRef.current = false;
    }
  }, [attempt]);

  useEffect(() => {
    if (!active || stoppedRef.current) return;
    const serialized = JSON.stringify({
      hasUserInput,
      customer: snapshot.customer,
      items: snapshot.items,
      preferredDeliveryDate: snapshot.preferredDeliveryDate,
      promoCodeInput: snapshot.promoCodeInput,
      promoCodeApplied: snapshot.promoCodeApplied,
      customerNote: snapshot.customerNote,
    });
    if (serialized === lastQueuedRef.current) return;
    lastQueuedRef.current = serialized;
    revisionRef.current += 1;
    writeAutosave(attempt, revisionRef.current, snapshot);
    bodyRef.current = JSON.stringify({ revision: revisionRef.current, ...JSON.parse(serialized) });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void send(); }, DEBOUNCE_MS);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [active, attempt, snapshot, hasUserInput, send]);

  useEffect(() => {
    if (!active) return;
    const flush = () => {
      if (stoppedRef.current || bodyRef.current === "" || inFlightRef.current) return;
      void fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json", [CHECKOUT_DRAFT_HEADER]: attempt.token },
        body: bodyRef.current,
        keepalive: true,
      }).catch(() => undefined);
      writeAutosave(attempt, revisionRef.current, snapshotRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [active, attempt]);

  const flush = useCallback(() => { void send(); }, [send]);
  return { status, flush, stopped: stoppedRef.current };
}
```

> `flush` 在点击 Review order 前调用；`keepalive` 只补充退出场景。若 `bodyRef.current` 仍为空（用户尚未改动、初始请求未排队），`send` 发空体会被 400，因此 `flush` 只在 `bodyRef.current !== ""` 时调用。

- [ ] **Step 6: 运行测试**

Run:
```bash
cd small-house-commerce/frontend
pnpm vitest run src/lib/checkoutAutosave.spec.ts src/components/checkout/useCheckoutDraftAutosave.spec.tsx
```
Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add small-house-commerce/frontend/src/lib/checkoutAutosave.ts \
  small-house-commerce/frontend/src/lib/checkoutAutosave.spec.ts \
  small-house-commerce/frontend/src/components/checkout/useCheckoutDraftAutosave.ts \
  small-house-commerce/frontend/src/components/checkout/useCheckoutDraftAutosave.spec.tsx
git commit -m "feat(checkout): autosave checkout input in the browser"
```

---

### Task 8: 结账表单与确认页接入

**Files:**
- Modify: `small-house-commerce/frontend/src/components/checkout/PromoCodeField.tsx:25-51,217-231,246-254`
- Modify: `small-house-commerce/frontend/src/components/checkout/CheckoutForm.tsx:1-30,90-175,369-393,760-830`
- Modify: `small-house-commerce/frontend/src/components/checkout/CheckoutConfirmView.tsx:1-280`
- Test: `small-house-commerce/frontend/src/lib/checkoutAutosave.form.spec.ts`

**Interfaces:**
- Consumes: `checkoutAttemptKey`、`resolveCheckoutAttempt`、`restoreCheckoutDraft`、`readCheckoutAttemptToken`、`clearAutosave`
- Consumes: `useCheckoutDraftAutosave`
- Produces: `PromoCodeFieldProps.onInputChange?: (value: string) => void`

- [ ] **Step 1: 写失败测试（表单快照映射）**

```ts
// frontend/src/lib/checkoutAutosave.form.spec.ts
import { describe, expect, it } from "vitest";
import { autosaveStatusLabel, buildCheckoutSnapshot, type CheckoutAutosaveForm } from "./checkoutAutosave";

const FORM: CheckoutAutosaveForm = {
  name: "", phone: "", province: "", city: "", barangay: "", postalCode: "",
  streetAddress: "", landmark: "", preferredDeliveryDate: "", notes: "",
};

describe("buildCheckoutSnapshot", () => {
  it("keeps a half-typed phone and an empty name", () => {
    const snapshot = buildCheckoutSnapshot(
      { ...FORM, name: "Ma", phone: "0917" },
      [{ skuId: "11111111-1111-4111-8111-111111111111", quantity: 2 }],
      { input: "", applied: null },
    );
    expect(snapshot.customer.name).toBe("Ma");
    expect(snapshot.customer.phone).toBe("0917");
    expect(snapshot.items).toEqual([{ skuId: "11111111-1111-4111-8111-111111111111", quantity: 2 }]);
  });

  it("turns a blank date into null but keeps an unapplied promo input", () => {
    const snapshot = buildCheckoutSnapshot(
      { ...FORM, preferredDeliveryDate: "  " },
      [],
      { input: "SAVE10", applied: null },
    );
    expect(snapshot.preferredDeliveryDate).toBeNull();
    expect(snapshot.promoCodeInput).toBe("SAVE10");
    expect(snapshot.promoCodeApplied).toBeNull();
  });

  it("never claims the shop saved while offline", () => {
    expect(autosaveStatusLabel("offline")).not.toMatch(/saved\./i);
    expect(autosaveStatusLabel("offline")).toMatch(/retry/i);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd small-house-commerce/frontend && pnpm vitest run src/lib/checkoutAutosave.form.spec.ts`
Expected: FAIL，`buildCheckoutSnapshot` 未导出。

- [ ] **Step 3: 实现 PromoCodeField 原始输入回调**

在 `PromoCodeFieldProps` 增加：

```ts
  /** Raw text in the code box, before it is validated. Autosave only. */
  onInputChange?: (value: string) => void;
```

解构参数增加 `onInputChange`，并用 ref 保持最新：

```ts
  const onInputChangeRef = useRef(onInputChange);
  useEffect(() => { onInputChangeRef.current = onInputChange; }, [onInputChange]);
```

在 `handleCodeChange` 的 `setCode(value)` 后加：

```ts
    onInputChangeRef.current?.(value);
```

在 seed 与订阅发放设置代码的两处 `setCode(...)` 后同样调用 `onInputChangeRef.current?.(...)`。

- [ ] **Step 4: 接入 CheckoutForm**

顶部导入：

```ts
import {
  autosaveStatusLabel,
  buildCheckoutSnapshot,
  checkoutAttemptKey,
  resolveCheckoutAttempt,
  restoreCheckoutDraft,
} from "@/lib/checkoutAutosave";
import { useCheckoutDraftAutosave } from "./useCheckoutDraftAutosave";
```

组件内、`useCheckoutLines` 之后：

```ts
  const attemptKey = useMemo(
    () => checkoutAttemptKey({ skuId, qty, itemsParam, slug }),
    [skuId, qty, itemsParam, slug],
  );
  const attempt = useMemo(() => resolveCheckoutAttempt(attemptKey), [attemptKey]);
  const [promoInput, setPromoInput] = useState("");
  const [draftTouched, setDraftTouched] = useState(false);
```

现有 restore effect 之后追加一次服务端/本地恢复（只在首次挂载）：

```ts
  useEffect(() => {
    let alive = true;
    void restoreCheckoutDraft(attemptKey).then((restored) => {
      if (!alive || !restored) return;
      setForm((f) => ({
        ...f,
        ...restored.customer,
        preferredDeliveryDate: restored.preferredDeliveryDate ?? "",
        notes: restored.customerNote,
      }));
      setInitialPromoCode(restored.promoCodeApplied ?? restored.promoCodeInput);
      setPromoInput(restored.promoCodeInput);
    });
    return () => { alive = false; };
  }, [attemptKey]);
```

每次表单变化标记 `draftTouched`：

```ts
  const set = (field: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraftTouched(true);
    setForm((f) => ({ ...f, [field]: event.target.value }));
  };
```

如果现有 `set` 已是这个形状，只在函数体首行加 `setDraftTouched(true)`；`PsgcAddressSelects` 的三个 change handler 也加同样的标记。

构造快照并启用 Hook：

```ts
  const autosaveSnapshot = useMemo(
    () => buildCheckoutSnapshot(
      { ...form, preferredDeliveryDate: form.preferredDeliveryDate, notes: form.notes },
      orderItems,
      { input: promoInput, applied: appliedPromo?.code ?? null },
    ),
    [form, orderItems, promoInput, appliedPromo],
  );
  const { status: autosaveStatus, flush: flushAutosave } = useCheckoutDraftAutosave({
    attempt,
    snapshot: autosaveSnapshot,
    active: !cartLoading && !cartBlocked,
    hasUserInput: draftTouched,
  });
```

`goToReview` 在 `writeCheckoutDraft(...)` 之后、`router.push(...)` 之前追加：

```ts
    flushAutosave();
```

`goToReview` 现有 `writeCheckoutDraft` 之后追加 `setDraftTouched(true);`（保证只有默认值时不延长保留期）。

Delivery 卡片标题下加状态：

```tsx
        <p
          data-testid="checkout-autosave-status"
          aria-live="polite"
          className="mb-2 text-xs text-ink-muted"
        >
          {autosaveStatusLabel(autosaveStatus)}
        </p>
```

在 `PromoCodeField` 传入 `onInputChange={setPromoInput}`。

- [ ] **Step 5: 接入 CheckoutConfirmView**

- 用 `useMemo` 计算 `attemptKey`（同样的 query 字段）。
- 用 `readCheckoutAttemptToken(attemptKey)` 取 token；把它加入创建订单 payload：

```ts
        checkoutDraftToken: readCheckoutAttemptToken(attemptKey),
```

- 创建订单成功后调用 `clearAutosave(resolveCheckoutAttempt(attemptKey))`（放在现有 `clearCheckoutDraft()` 旁）。
- 用只读快照驱动 `useCheckoutDraftAutosave`，`active` 为 true、`hasUserInput` 为 true，使确认页停留期间也保持同步：

```ts
  const attemptKey = useMemo(
    () => checkoutAttemptKey({ skuId, qty, itemsParam, slug }),
    [skuId, qty, itemsParam, slug],
  );
  const attempt = useMemo(() => resolveCheckoutAttempt(attemptKey), [attemptKey]);
  const confirmSnapshot = useMemo(
    () => buildCheckoutSnapshot(
      {
        name: draft?.customer.name ?? "",
        phone: draft?.customer.phone ?? "",
        province: draft?.customer.province ?? "",
        city: draft?.customer.city ?? "",
        barangay: draft?.customer.barangay ?? "",
        postalCode: draft?.customer.postalCode ?? "",
        streetAddress: draft?.customer.streetAddress ?? "",
        landmark: draft?.customer.landmark ?? "",
        preferredDeliveryDate: draft?.preferredDeliveryDate ?? "",
        notes: draft?.customerNote ?? "",
      },
      orderItems,
      { input: draft?.promoCode ?? "", applied: draft?.promoCode ?? null },
    ),
    [draft, orderItems],
  );
  const confirmAutosave = useCheckoutDraftAutosave({
    attempt,
    snapshot: confirmSnapshot,
    active: draft !== null,
    hasUserInput: true,
  });
```

创建订单成功后，在现有 `clearCheckoutDraft()` 旁调用 `clearAutosave(attempt)`；确认页的自动保存状态可用 `confirmAutosave.status` 显示在 Place order 按钮附近，文字复用 `autosaveStatusLabel`。

- [ ] **Step 6: 确认页 token 传递的验证方式**

`checkoutDraftToken` 的接线由 Task 11 的浏览器脚本断言（检查 `POST /api/v1/storefront/orders` 请求体）。不在本任务新增 mock 掉整个确认页的弱单测；若现有 `CheckoutConfirmView.spec.tsx` 已有可复用的请求捕获 harness，则在该文件追加一条真实断言，而不是新建空壳测试。

- [ ] **Step 7: 运行测试与类型检查**

Run:
```bash
cd small-house-commerce/frontend
pnpm vitest run src/lib/checkoutAutosave.form.spec.ts
pnpm vitest run src/components/checkout/CheckoutConfirmView.spec.tsx
pnpm exec tsc --noEmit
```
Expected: 通过，tsc exit 0。

> `confirmAutosave` 用到的 `skuId`、`qty`、`itemsParam`、`slug` 若在 `CheckoutConfirmView` 中尚未定义为独立变量，从现有的 `useSearchParams()` 读取同名查询参数；不要改变现有解析函数的行为。

- [ ] **Step 8: 提交**

```bash
git add small-house-commerce/frontend/src/components/checkout
git commit -m "feat(checkout): autosave form input and carry the draft into the order"
```

---

### Task 9: 后台草稿列表、详情与入口

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts`（类型区 + `adminApi` 对象）
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/orders/drafts/page.tsx`
- Create: `small-house-commerce/frontend/src/app/admin/(shell)/orders/drafts/[id]/page.tsx`
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/orders/page.tsx:1-60,854-871`
- Modify: `small-house-commerce/frontend/src/i18n/zh.ts`
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`
- Test: `small-house-commerce/frontend/src/app/admin/(shell)/orders/drafts/page.spec.tsx`
- Test: `small-house-commerce/frontend/src/app/admin/(shell)/orders/drafts/[id]/page.spec.tsx`

**Interfaces:**
- Produces: `AdminCheckoutDraftSummary`、`AdminCheckoutDraftDetail`
- Produces: `adminApi.listCheckoutDrafts(p)`、`adminApi.getCheckoutDraft(id)`

- [ ] **Step 1: 写失败测试**

```tsx
// .../orders/drafts/page.spec.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutDraftsPage from "./page";

const listCheckoutDrafts = vi.fn(async () => ({
  items: [{
    id: "draft-1", status: "OPEN", hasUserInput: true, contactName: "Ana", contactPhone: "0917",
    itemCount: 2, firstItemName: "Oak Chair", firstItemThumbnail: null, orderNumber: null,
    createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:05:00.000Z",
    expiresAt: "2026-12-03T00:00:00.000Z",
  }],
  total: 1, page: 1, pageSize: 20,
}));

vi.mock("@/lib/admin-api", () => ({
  adminApi: { listCheckoutDrafts: () => listCheckoutDrafts() },
}));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ hasPermission: () => true }),
}));

describe("CheckoutDraftsPage", () => {
  beforeEach(() => listCheckoutDrafts.mockClear());

  it("lists partially filled drafts with their saved contact", async () => {
    render(<CheckoutDraftsPage />);
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("0917")).toBeInTheDocument();
    expect(screen.getByText("未填写完成")).toBeInTheDocument();
  });

  it("hides the page from operators without ORDER_VIEW_ALL", async () => {
    vi.resetModules();
    vi.doMock("@/components/admin/AdminAuthProvider", () => ({
      useAdminAuth: () => ({ hasPermission: () => false }),
    }));
    const { default: Page } = await import("./page");
    render(<Page />);
    expect(await screen.findByText("没有查看草稿订单的权限。")).toBeInTheDocument();
    expect(listCheckoutDrafts).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd small-house-commerce/frontend && pnpm vitest run src/app/admin/\(shell\)/orders/drafts`
Expected: FAIL。

- [ ] **Step 3: 添加 admin API 类型与方法**

在 `admin-api.ts` 的类型区追加：

```ts
export interface AdminCheckoutDraftSummary {
  id: string;
  status: "OPEN" | "CONVERTED";
  hasUserInput: boolean;
  contactName: string | null;
  contactPhone: string | null;
  itemCount: number;
  firstItemName: string | null;
  firstItemThumbnail: string | null;
  orderNumber: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface AdminCheckoutDraftDetail extends AdminCheckoutDraftSummary {
  snapshot: {
    customer: Record<"name" | "phone" | "province" | "city" | "barangay" | "postalCode" | "streetAddress" | "landmark", string>;
    items: { skuId: string; quantity: number }[];
    preferredDeliveryDate: string | null;
    promoCodeInput: string;
    promoCodeApplied: string | null;
    customerNote: string;
  };
  productSnapshot: {
    skuId: string; skuCode: string | null; productName: string | null;
    productSlug: string | null; variantName: string | null;
    thumbnailUrl: string | null; unitPrice: string | null; quantity: number;
  }[];
  orderId: string | null;
}
```

在 `adminApi` 对象内追加：

```ts
  listCheckoutDrafts: (p: {
    search?: string; status?: "OPEN" | "CONVERTED"; page?: number; pageSize?: number;
  }): Promise<Paged<AdminCheckoutDraftSummary>> =>
    adminAuthedFetch<Paged<AdminCheckoutDraftSummary>>(
      `/api/v1/admin/checkout-drafts${buildQuery({
        search: p.search,
        status: p.status,
        page: p.page,
        pageSize: p.pageSize,
      })}`,
    ),

  getCheckoutDraft: (id: string): Promise<AdminCheckoutDraftDetail> =>
    adminAuthedFetch<AdminCheckoutDraftDetail>(
      `/api/v1/admin/checkout-drafts/${encodeURIComponent(id)}`,
    ),
```

- [ ] **Step 4: 添加 i18n 键**

`zh.ts` 末尾追加：

```ts
  orders_drafts_link: "草稿订单",
  checkout_drafts_title: "草稿订单",
  checkout_drafts_subtitle: "顾客已进入结账但尚未提交的订单。草稿不占库存，也不进入正式订单。",
  checkout_drafts_search: "搜索姓名或手机号",
  checkout_drafts_status_all: "全部状态",
  checkout_drafts_status_open: "未完成",
  checkout_drafts_status_converted: "已转订单",
  checkout_drafts_empty: "还没有草稿订单。",
  checkout_drafts_no_permission: "没有查看草稿订单的权限。",
  checkout_drafts_col_contact: "顾客",
  checkout_drafts_col_items: "商品",
  checkout_drafts_col_status: "状态",
  checkout_drafts_col_updated: "最近保存",
  checkout_drafts_col_order: "正式订单",
  checkout_drafts_not_filled: "尚未填写",
  checkout_drafts_not_filled_yet: "尚未填写任何信息",
  checkout_drafts_stale: "未完成（30 分钟未更新）",
  checkout_drafts_item_count: "{count} 件",
  checkout_drafts_detail_title: "草稿详情",
  checkout_drafts_detail_back: "返回草稿列表",
  checkout_drafts_detail_fields: "已保存的结账信息",
  checkout_drafts_detail_products: "选购商品",
  checkout_drafts_detail_timeline: "保存时间",
  checkout_drafts_detail_created: "创建时间",
  checkout_drafts_detail_updated: "最近保存",
  checkout_drafts_detail_expires: "保留至",
  checkout_drafts_detail_order: "查看正式订单",
  checkout_drafts_field_name: "姓名",
  checkout_drafts_field_phone: "手机号",
  checkout_drafts_field_address: "地址",
  checkout_drafts_field_note: "订单备注",
  checkout_drafts_field_promo: "优惠码",
  checkout_drafts_field_date: "配送日期",
  checkout_drafts_unavailable_item: "商品已下架或不可用",
```

`en.ts` 同步追加对应英文：

```ts
  orders_drafts_link: "Checkout drafts",
  checkout_drafts_title: "Checkout drafts",
  checkout_drafts_subtitle: "Shoppers who started checkout but did not submit. Drafts hold no stock and are not orders.",
  checkout_drafts_search: "Search name or phone",
  checkout_drafts_status_all: "All statuses",
  checkout_drafts_status_open: "Unfinished",
  checkout_drafts_status_converted: "Converted",
  checkout_drafts_empty: "No checkout drafts yet.",
  checkout_drafts_no_permission: "You do not have permission to view checkout drafts.",
  checkout_drafts_col_contact: "Customer",
  checkout_drafts_col_items: "Items",
  checkout_drafts_col_status: "Status",
  checkout_drafts_col_updated: "Last saved",
  checkout_drafts_col_order: "Order",
  checkout_drafts_not_filled: "Not filled in",
  checkout_drafts_not_filled_yet: "Nothing filled in yet",
  checkout_drafts_stale: "Unfinished (no update for 30 minutes)",
  checkout_drafts_item_count: "{count} items",
  checkout_drafts_detail_title: "Draft detail",
  checkout_drafts_detail_back: "Back to drafts",
  checkout_drafts_detail_fields: "Saved checkout details",
  checkout_drafts_detail_products: "Items",
  checkout_drafts_detail_timeline: "Saved at",
  checkout_drafts_detail_created: "Created",
  checkout_drafts_detail_updated: "Last saved",
  checkout_drafts_detail_expires: "Kept until",
  checkout_drafts_detail_order: "Open order",
  checkout_drafts_field_name: "Name",
  checkout_drafts_field_phone: "Mobile number",
  checkout_drafts_field_address: "Address",
  checkout_drafts_field_note: "Order notes",
  checkout_drafts_field_promo: "Promo code",
  checkout_drafts_field_date: "Delivery date",
  checkout_drafts_unavailable_item: "Item is no longer available",
```

- [ ] **Step 5: 实现列表页**

```tsx
// .../orders/drafts/page.tsx
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminCheckoutDraftSummary } from "@/lib/admin-api";

const PAGE_SIZE = 20;

export default function CheckoutDraftsPage() {
  const { hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const canView = hasPermission("ORDER_VIEW_ALL");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "OPEN" | "CONVERTED">("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AdminCheckoutDraftSummary[]; total: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    adminApi
      .listCheckoutDrafts({
        search: search.trim() || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((result) => { if (alive) setData({ items: result.items, total: result.total }); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [canView, search, status, page]);

  if (!canView) {
    return <p className="px-4 py-6 text-sm text-ink-secondary md:px-8">{t("checkout_drafts_no_permission")}</p>;
  }

  return (
    <div className="w-full max-w-none px-4 py-5 md:px-8">
      <PageHeader
        title={t("checkout_drafts_title")}
        count={data?.total}
        subtitle={t("checkout_drafts_subtitle")}
        actions={<Link href="/admin/orders" className="text-sm font-medium text-cta hover:underline">{t("checkout_drafts_detail_back")}</Link>}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          placeholder={t("checkout_drafts_search")}
          aria-label={t("checkout_drafts_search")}
          className="h-9 w-full max-w-xs rounded-lg border border-border bg-card px-3 text-sm"
        />
        <select
          value={status}
          aria-label={t("checkout_drafts_col_status")}
          onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm"
        >
          <option value="">{t("checkout_drafts_status_all")}</option>
          <option value="OPEN">{t("checkout_drafts_status_open")}</option>
          <option value="CONVERTED">{t("checkout_drafts_status_converted")}</option>
        </select>
      </div>
      {error ? <p className="mt-4 text-sm text-sale">{t("checkout_drafts_empty")}</p> : null}
      {!data ? (
        <div className="mt-4"><TableSkeleton /></div>
      ) : data.items.length === 0 ? (
        <div className="mt-4"><EmptyState title={t("checkout_drafts_empty")} /></div>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-ink-muted">
              <th className="py-2 pr-3">{t("checkout_drafts_col_contact")}</th>
              <th className="py-2 pr-3">{t("checkout_drafts_col_items")}</th>
              <th className="py-2 pr-3">{t("checkout_drafts_col_status")}</th>
              <th className="py-2 pr-3">{t("checkout_drafts_col_updated")}</th>
              <th className="py-2">{t("checkout_drafts_col_order")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="py-2 pr-3">
                  <Link href={`/admin/orders/drafts/${row.id}`} className="font-medium text-cta hover:underline">
                    {row.contactName || t("checkout_drafts_not_filled")}
                  </Link>
                  <div className="text-xs text-ink-muted">{row.contactPhone || "—"}</div>
                </td>
                <td className="py-2 pr-3">
                  {row.firstItemName || t("checkout_drafts_not_filled_yet")}
                  <div className="text-xs text-ink-muted">{t("checkout_drafts_item_count").replace("{count}", String(row.itemCount))}</div>
                </td>
                <td className="py-2 pr-3">
                  {row.status === "CONVERTED" ? t("checkout_drafts_status_converted") : t("checkout_drafts_status_open")}
                  {row.status === "OPEN" && Date.now() - Date.parse(row.updatedAt) >= 30 * 60_000 ? (
                    <div className="text-xs text-ink-muted">{t("checkout_drafts_stale")}</div>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-xs text-ink-muted">{new Date(row.updatedAt).toLocaleString()}</td>
                <td className="py-2">
                  {row.orderNumber ? (
                    <Link href={`/admin/orders/${row.orderId ?? ""}`} className="text-cta hover:underline">{row.orderNumber}</Link>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onChange={setPage} />
    </div>
  );
}
```

> `orderId` 已在 Task 4 的 `AdminCheckoutDraftSummary` 与 `toSummary` 中返回；前端类型与列表链接使用同一个字段，不要改成从 `orderNumber` 反查。

- [ ] **Step 6: 实现详情页**

```tsx
// .../orders/drafts/[id]/page.tsx
"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminCheckoutDraftDetail } from "@/lib/admin-api";

export default function CheckoutDraftDetailPage() {
  const params = useParams<{ id: string }>();
  const { hasPermission } = useAdminAuth();
  const { t } = useAdminI18n();
  const [draft, setDraft] = useState<AdminCheckoutDraftDetail | null>(null);
  const canView = hasPermission("ORDER_VIEW_ALL");

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    adminApi.getCheckoutDraft(params.id).then((value) => { if (alive) setDraft(value); });
    return () => { alive = false; };
  }, [canView, params.id]);

  if (!canView) return <p className="px-4 py-6 text-sm text-ink-secondary md:px-8">{t("checkout_drafts_no_permission")}</p>;
  if (!draft) return <div className="px-4 py-6 md:px-8"><TableSkeleton /></div>;

  const c = draft.snapshot.customer;
  return (
    <div className="w-full max-w-none px-4 py-5 md:px-8">
      <PageHeader
        title={t("checkout_drafts_detail_title")}
        subtitle={draft.contactPhone || t("checkout_drafts_not_filled_yet")}
        actions={<Link href="/admin/orders/drafts" className="text-sm font-medium text-cta hover:underline">{t("checkout_drafts_detail_back")}</Link>}
      />
      <section className="mt-4 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">{t("checkout_drafts_detail_fields")}</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <Row label={t("checkout_drafts_field_name")} value={c.name} />
          <Row label={t("checkout_drafts_field_phone")} value={c.phone} />
          <Row label={t("checkout_drafts_field_address")} value={[c.streetAddress, c.barangay, c.city, c.province, c.postalCode, c.landmark].filter(Boolean).join(", ")} />
          <Row label={t("checkout_drafts_field_date")} value={draft.snapshot.preferredDeliveryDate ?? ""} />
          <Row label={t("checkout_drafts_field_promo")} value={draft.snapshot.promoCodeApplied ?? draft.snapshot.promoCodeInput} />
          <Row label={t("checkout_drafts_field_note")} value={draft.snapshot.customerNote} />
        </dl>
      </section>
      <section className="mt-4 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">{t("checkout_drafts_detail_products")}</h2>
        <ul className="mt-3 divide-y divide-border/60 text-sm">
          {draft.productSnapshot.length === 0 ? <li className="py-2 text-ink-muted">{t("checkout_drafts_not_filled_yet")}</li> : null}
          {draft.productSnapshot.map((line) => (
            <li key={line.skuId} className="flex items-center gap-3 py-2">
              {line.thumbnailUrl ? <img src={line.thumbnailUrl} alt="" className="h-10 w-10 rounded object-cover" /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{line.productName ?? t("checkout_drafts_unavailable_item")}</p>
                <p className="text-xs text-ink-muted">{[line.variantName, line.skuCode].filter(Boolean).join(" · ")}</p>
              </div>
              <span className="text-ink-secondary">×{line.quantity}</span>
              <span>{line.unitPrice ? `₱${Number(line.unitPrice).toLocaleString()}` : "—"}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-4 rounded-xl border border-border bg-card p-4 text-sm">
        <h2 className="text-sm font-semibold">{t("checkout_drafts_detail_timeline")}</h2>
        <p className="mt-2 text-ink-secondary">{t("checkout_drafts_detail_created")}: {new Date(draft.createdAt).toLocaleString()}</p>
        <p className="text-ink-secondary">{t("checkout_drafts_detail_updated")}: {new Date(draft.updatedAt).toLocaleString()}</p>
        <p className="text-ink-secondary">{t("checkout_drafts_detail_expires")}: {new Date(draft.expiresAt).toLocaleDateString()}</p>
        {draft.orderId ? (
          <Link href={`/admin/orders/${draft.orderId}`} className="mt-2 inline-block font-medium text-cta hover:underline">
            {t("checkout_drafts_detail_order")} {draft.orderNumber}
          </Link>
        ) : null}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="break-words">{value.trim() === "" ? "—" : value}</dd>
    </div>
  );
}
```

- [ ] **Step 7: 订单页加入口**

`orders/page.tsx` 顶部加 `import Link from "next/link";`，在 `PageHeader` 的 `actions` 中、New Order 按钮前加：

```tsx
          <Link
            href="/admin/orders/drafts"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-ink hover:bg-primary-light/30"
          >
            {t("orders_drafts_link")}
          </Link>
```

仅当 `hasPermission("ORDER_VIEW_ALL")` 时渲染；现有 `actions` 是三元表达式，改为 `canViewAll ? (<div className="flex gap-2">…</div>) : undefined`，其中 `const canViewAll = hasPermission("ORDER_VIEW_ALL");`。不得改变 New Order 的 `canConfirmPerm` 条件。

- [ ] **Step 8: 运行测试**

Run:
```bash
cd small-house-commerce/frontend
pnpm vitest run "src/app/admin/(shell)/orders/drafts"
pnpm exec tsc --noEmit
```
Expected: 通过，tsc exit 0。

- [ ] **Step 9: 提交**

```bash
git add small-house-commerce/frontend/src/lib/admin-api.ts \
  "small-house-commerce/frontend/src/app/admin/(shell)/orders" \
  small-house-commerce/frontend/src/i18n/zh.ts \
  small-house-commerce/frontend/src/i18n/en.ts
git commit -m "feat(admin): show checkout drafts to the order team"
```

---

### Task 10: 隐私说明与结账文档

**Files:**
- Modify: `small-house-commerce/frontend/src/app/(storefront)/privacy/page.tsx`
- Modify: `small-house-commerce/docs/frontend/CHECKOUT_SPEC.md`
- Test: `small-house-commerce/frontend/src/app/(storefront)/privacy/page.spec.tsx`（若不存在则创建）

**Interfaces:**
- 无代码接口；只改文案与文档。

- [ ] **Step 1: 写失败测试**

```tsx
// privacy/page.spec.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PrivacyPage from "./page";

vi.mock("@/components/consent/CookieSettingsButton", () => ({
  CookieSettingsButton: () => <button type="button">Cookie settings</button>,
}));

describe("privacy page", () => {
  it("explains that unfinished checkout input is saved for recovery", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/unfinished checkout/i)).toBeInTheDocument();
    expect(screen.getByText(/24 hours/i)).toBeInTheDocument();
    expect(screen.getByText(/30 days/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd small-house-commerce/frontend && pnpm vitest run "src/app/(storefront)/privacy/page.spec.tsx"`
Expected: FAIL。

- [ ] **Step 3: 更新文案**

在 “What we collect” 正文后追加一段（英文，与现有页面一致）：

```text
When you start checkout, we also save the details you have typed so far — name, mobile number, delivery address, order notes, preferred delivery date, promo code and the items in that checkout — as an unfinished checkout draft, even if you leave before placing the order. This lets you pick up where you left off and lets us help with a checkout you started. A draft is not an order: it reserves no stock, creates no order number and is not sent to our courier or ERP. Drafts with no typed information are deleted within 24 hours; drafts with your input, and drafts that became orders, are kept for at most 30 days.
```

在 “Retention” 正文后追加：

```text
Unfinished checkout drafts follow the periods above: 24 hours when nothing was typed, otherwise no more than 30 days.
```

- [ ] **Step 4: 更新 CHECKOUT_SPEC**

在 `docs/frontend/CHECKOUT_SPEC.md` 末尾新增一节：

```markdown
## Checkout autosave drafts (2026-11-03)

- Entry to `/checkout` creates a token-scoped `checkout_drafts` row (`PUT /api/v1/storefront/checkout-drafts/current`).
- Every field change is written to `luwag_checkout_autosave_v1` immediately and sent to the API after 600 ms.
- The capability token lives in `luwag_checkout_attempt_v1`; it is per checkout selection and never sent in a URL.
- The review page carries `checkoutDraftToken` into `POST /storefront/orders`; the order transaction marks the draft CONVERTED.
- Drafts never reserve stock, create a Customer, push Qianyi, or emit Meta Purchase.
- Empty drafts expire in 24 hours; drafts with input expire at most 30 days after token creation.
- The existing `luwag_checkout_draft` sessionStorage payload is unchanged; it still carries the validated review payload.
```

- [ ] **Step 5: 运行测试**

Run: `cd small-house-commerce/frontend && pnpm vitest run "src/app/(storefront)/privacy/page.spec.tsx"`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add "small-house-commerce/frontend/src/app/(storefront)/privacy" \
  small-house-commerce/docs/frontend/CHECKOUT_SPEC.md
git commit -m "docs(checkout): explain incomplete checkout drafts"
```

---

### Task 11: 全量回归与浏览器验收

**Files:**
- Create: `/tmp/checkout-draft-browser-check.cjs`（临时脚本，不提交）
- No product files.

**Interfaces:**
- 无；验证 Task 1–10 的合并结果。

- [ ] **Step 1: 后端全量测试**

Run:
```bash
cd small-house-commerce/backend
pnpm exec prisma generate
pnpm vitest run --maxWorkers=2
pnpm exec tsc --noEmit
pnpm lint
```
Expected: 全部通过，exit 0。任何失败必须按名字报告，不能以“机器负载”解释。

- [ ] **Step 2: 前端全量测试与构建**

Run:
```bash
cd small-house-commerce/frontend
pnpm vitest run --maxWorkers=2
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```
Expected: 全部通过，构建完成所有静态页。

- [ ] **Step 3: 启动本地应用**

Run:
```bash
cd small-house-commerce/frontend
pnpm dev --port 3028
```
Expected: `http://localhost:3028` 可访问。不要占用用户的 3000/3001 端口。

- [ ] **Step 4: 浏览器脚本验收**

脚本要求（用 Playwright，全部 `/api/v1/**` 用 `page.route` 拦截，数据库零写入）：

1. 打开 `/checkout?items=...`，断言 `PUT checkout-drafts` 在进入后 1 秒内发生。
2. 姓名填 `Ma`、手机填 `0917`，断言请求体包含这两个不完整值且返回 200。
3. 刷新页面，断言恢复出 `Ma` / `0917`。
4. 模拟 503，断言页面显示“We could not save to the shop yet”，输入仍在。
5. 点击 Review order，断言 `POST /storefront/orders` 请求体含 `checkoutDraftToken`。
6. 模拟该请求成功，断言跳转成功页且本地 `luwag_checkout_autosave_v1` 被清除。
7. 390×844 视口重复步骤 2–3，断言无横向溢出。
8. 断言 `pageerror` 为 0。

脚本输出必须包含：

```text
CHECKOUT_DRAFT_QA_OK creates=1 partial-saved=1 restored=1 offline-kept=1 token-forwarded=1 cleared-after-order=1 mobile=1
```

- [ ] **Step 5: 提交验证记录（可选但推荐）**

```bash
git add small-house-commerce/docs/frontend/CHECKOUT_SPEC.md
git commit -m "docs(checkout): record checkout draft verification"
```
仅当 CHECKOUT_SPEC 有新增验证记录时提交；不要把 `/tmp` 脚本提交进仓库。

---

## Self-Review

**Spec coverage**

- 独立草稿、不进入正式订单业务：Task 1、2、5。
- 进入即建立、不完整可保存：Task 3、7、8。
- 修改/清空同步：Task 7 的快照序列化 + Task 8 的 `set` 全量覆盖。
- 600ms 防抖、合并、失败保留、退避、keepalive：Task 7。
- 恢复且不被空表单覆盖：Task 7 `restoreCheckoutDraft` + Task 8 先恢复后启用。
- 版本/乱序/幂等：Task 2、7。
- 能力令牌、不可越权、`no-store`：Task 1、2、3。
- 下单转换、先下单后首次保存、已转换不可重开：Task 5。
- 后台列表/详情/搜索/筛选/权限/只读/30 分钟提示：Task 4、9。
- 保留与清理：Task 6。
- 隐私与文档：Task 10。
- 测试与浏览器验收：Task 11。

**Placeholder scan**：没有 TBD/TODO；所有代码步骤都给出可编译内容。

**Type consistency**

- `CheckoutDraftSaveInput.revision` ↔ Prisma `clientRevision` ↔ API 响应 `revision`：命名映射统一在 `save()` 内完成。
- 后端 `CheckoutDraftSnapshot` 与前端 `CheckoutAutosaveSnapshot` 字段一一对应（customer 八字段、items、preferredDeliveryDate、promoCodeInput、promoCodeApplied、customerNote）。
- 管理员 `orderId` 同时出现在 Task 4 的 `toSummary` 与 Task 9 的前端类型；列表链接统一用 `row.orderId`。
- `checkoutDraftToken` 不进入 `idempotencyFingerprint`（Task 5 测试）；其从确认页进入请求体的接线由 Task 11 的浏览器脚本断言。

**Known follow-ups（不在本计划内）**

- 草稿列表批量导出、自动短信/邮件、一键转正式订单。
- 跨设备按手机号恢复。
- 客户账号体系下的草稿归属。
