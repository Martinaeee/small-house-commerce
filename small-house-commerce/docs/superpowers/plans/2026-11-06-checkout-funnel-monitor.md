# 商品漏斗监控与结账失败埋点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后台按商品展示「访问 → 浏览 → 加购 → 发起结账 → 提交尝试 → 失败（带原因）→ 下单」全链路，并把结账提交失败（前端校验/库存/网络/5xx）首次记录成第一方事件。

**Architecture:** 复用现有 `analytics_events`（只加两个枚举值，不加表）；前端在结账两处提交点发 `CHECKOUT_SUBMIT_ATTEMPT` / `CHECKOUT_SUBMIT_FAILED`，失败原因按后端错误码分类；后端新增一个只读漏斗服务（两条聚合 SQL + 一个会话明细接口），投放工作台新增「商品漏斗」页签，异常步骤按「近 7 天中位数 × 50%、基数 ≥ 20」自动标红。

**Tech Stack:** Next.js 16 / React 19 / TypeScript、NestJS 12 / Prisma 7.10 / PostgreSQL 18、Vitest（前端 3.2.7、后端 4）、Testing Library。

**Spec:** `small-house-commerce/docs/superpowers/specs/2026-11-06-checkout-funnel-monitor-design.md`

## Global Constraints

- 所有面向用户的文案中英双写：`frontend/src/i18n/zh.ts`（中文）与 `frontend/src/i18n/en.ts`（英文），键名相同；`TKey = keyof typeof zh`，缺键会编译失败。
- 分析埋点永远不能影响购物流程：所有埋点调用包在 try/catch 内，失败静默。
- 客户信息（姓名/电话/地址/备注/完整幂等键）只能写在 `CHECKOUT_SUBMIT_FAILED` 的 `metadata.customer`；漏斗主表与明细接口一律不返回；服务端日志不打印。
- `analytics_events.metadata` 服务端上限 4096 字节，超出整块丢弃（`analytics.service.ts` `boundedMetadata`）；前端必须裁剪后再发。
- `entity_id` 列上限 120 字符，大购物车会被截断；新事件的完整 SKU 列表放 `metadata.skuIds`，报表优先读 metadata、回退读 `entity_id`。
- 日期一律按 Asia/Manila 日历日；聚合按 `analytics_events.event_day` 过滤，与现有报表口径一致。
- 迁移目录命名 `prisma/migrations/YYYYMMDDHHMMSS_<snake_case>/`；后端构建前必须 `pnpm prisma generate`。
- 不改全局 Header/Footer/shell；只加投放工作台内部页签。
- 不新增第三方依赖。

---

### Task 1: 新增两个埋点事件的枚举值

**Files:**
- Modify: `backend/prisma/schema/analytics.prisma`
- Create: `backend/prisma/migrations/20261106120000_add_checkout_submit_events/migration.sql`
- Modify: `backend/src/modules/analytics/dto/analytics-event.dto.ts`
- Test: `backend/src/modules/analytics/dto/analytics-event.dto.spec.ts`（若无则新建）

**Interfaces:**
- Produces: `analyticsEventNames` 增加 `'CHECKOUT_SUBMIT_ATTEMPT' | 'CHECKOUT_SUBMIT_FAILED'`，供 Task 4 的前端上报与 Task 6 的报表查询使用。

- [ ] **Step 1: 写失败测试**

新建 `backend/src/modules/analytics/dto/analytics-event.dto.spec.ts`：

```ts
import { analyticsEventSchema, analyticsEventNames } from './analytics-event.dto.js';

const base = {
  sessionId: 'session-abc-123456',
  pageUrl: 'https://luwag.shop/checkout/confirm',
  pagePath: '/checkout/confirm',
  deviceType: 'mobile' as const,
};

describe('analytics event names', () => {
  it('accepts the checkout submit events', () => {
    for (const eventName of ['CHECKOUT_SUBMIT_ATTEMPT', 'CHECKOUT_SUBMIT_FAILED'] as const) {
      expect(analyticsEventNames).toContain(eventName);
      expect(analyticsEventSchema.safeParse({ ...base, eventName }).success).toBe(true);
    }
  });

  it('keeps rejecting names outside the list', () => {
    expect(analyticsEventSchema.safeParse({ ...base, eventName: 'CHECKOUT_SUBMIT' }).success).toBe(false);
  });

  it('passes a failure metadata blob through unchanged', () => {
    const parsed = analyticsEventSchema.parse({
      ...base,
      eventName: 'CHECKOUT_SUBMIT_FAILED',
      entityId: 'sku-1,sku-2',
      metadata: {
        step: 'confirm',
        reason: 'STOCK',
        httpStatus: 400,
        skuIds: ['sku-1', 'sku-2'],
        customer: { name: 'Ana', phone: '+639171234567' },
        idempotencyKey: 'key-1',
      },
    });
    expect(parsed.metadata).toMatchObject({ reason: 'STOCK', step: 'confirm' });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && pnpm vitest run src/modules/analytics/dto/analytics-event.dto.spec.ts`
Expected: FAIL —— `analyticsEventSchema.safeParse(... eventName: 'CHECKOUT_SUBMIT_ATTEMPT')` 返回 `success: false`。

- [ ] **Step 3: 加枚举值与迁移**

`backend/prisma/schema/analytics.prisma` 的 `enum AnalyticsEventName` 末尾加两行：

```prisma
  CHECKOUT_SUBMIT_ATTEMPT
  CHECKOUT_SUBMIT_FAILED
```

`backend/prisma/migrations/20261106120000_add_checkout_submit_events/migration.sql`：

```sql
-- Two events that close the checkout blind spot: an attempt records that the
-- shopper pressed a submit control and the browser let the request through;
-- the failure twin records why it did not become an order.
ALTER TYPE "AnalyticsEventName" ADD VALUE IF NOT EXISTS 'CHECKOUT_SUBMIT_ATTEMPT';
ALTER TYPE "AnalyticsEventName" ADD VALUE IF NOT EXISTS 'CHECKOUT_SUBMIT_FAILED';
```

`backend/src/modules/analytics/dto/analytics-event.dto.ts` 的 `analyticsEventNames` 数组加两项：

```ts
  'CHECKOUT_SUBMIT_ATTEMPT',
  'CHECKOUT_SUBMIT_FAILED',
```

- [ ] **Step 4: 生成客户端并跑测试**

Run: `cd backend && pnpm prisma generate && pnpm vitest run src/modules/analytics/dto/analytics-event.dto.spec.ts`
Expected: PASS 3/3。

- [ ] **Step 5: 提交**

```bash
git add backend/prisma/schema/analytics.prisma backend/prisma/migrations/20261106120000_add_checkout_submit_events backend/src/modules/analytics/dto
git commit -m "feat(analytics): add checkout submit attempt and failure events"
```

---

### Task 2: 给结账失败加稳定错误码

**Files:**
- Modify: `backend/src/modules/orders/orders.service.ts:400-410,449-482`
- Test: `backend/src/modules/orders/orders.service.spec.ts`（已存在，追加用例）

**Interfaces:**
- Produces: 结账接口在库存/不可售/未定价时返回 HTTP 400，body 形如
  `{ statusCode: 400, message: string, code: 'INSUFFICIENT_STOCK' | 'SKU_UNAVAILABLE' | 'SKU_NOT_PRICED' }`；
  Task 3 的前端 `ApiError.code` 依赖这三个值。

- [ ] **Step 1: 写失败测试**

在 `backend/src/modules/orders/orders.service.spec.ts` 追加：

```ts
it('tags stock shortages with a machine-readable code', async () => {
  await expect(service.checkout({ /* 复用文件里已有的缺货请求构造 */ ...stockShortInput }))
    .rejects.toMatchObject({ response: { statusCode: 400, code: 'INSUFFICIENT_STOCK' } });
});

it('tags an unavailable SKU with SKU_UNAVAILABLE', async () => {
  await expect(service.checkout({ /* 指向一个 INACTIVE 的 sku */ ...unavailableInput }))
    .rejects.toMatchObject({ response: { statusCode: 400, code: 'SKU_UNAVAILABLE' } });
});
```

（沿用该文件已有的 prisma mock 与 fixture 构造函数；若文件中现金不足用的 fixture 不可见，则直接断言拦截器：`BadRequestException` 的 `getResponse()` 含 `code`。）

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && pnpm vitest run src/modules/orders/orders.service.spec.ts -t "machine-readable"`
Expected: FAIL —— `response.code` 为 `undefined`。

- [ ] **Step 3: 改异常体**

`orders.service.ts` 三处：

```ts
      if (!sku || sku.status !== 'ACTIVE' || sku.variant.product.status !== 'ACTIVE') {
        throw new BadRequestException({
          statusCode: 400,
          code: 'SKU_UNAVAILABLE',
          message: `SKU ${item.skuId} is not available for purchase`,
        });
      }
      if (sku.price === null) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'SKU_NOT_PRICED',
          message: `SKU ${sku.skuCode} is not priced`,
        });
      }
```

两处库存不足：

```ts
      if (available < line.quantity) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock for ${line.skuCode}: available ${available}, requested ${line.quantity}`,
        });
      }
```
与 Bundle 聚合那处：

```ts
        throw new BadRequestException({
          statusCode: 400,
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock for ${owner.skuCode}: this order needs ${requirement.quantity} of ${component.skuCode}, but only ${available} are available`,
        });
```

- [ ] **Step 4: 跑测试**

Run: `cd backend && pnpm vitest run src/modules/orders`
Expected: 全部通过（新增 2 个用例 + 原有用例不回归）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/orders
git commit -m "feat(orders): tag stock and availability failures with error codes"
```

---

### Task 3: 前端 `ApiError` 携带状态码与错误码

**Files:**
- Modify: `frontend/src/lib/api.ts:684-703`
- Test: `frontend/src/lib/api.error.spec.ts`（新建）

**Interfaces:**
- Produces: `export class ApiError extends Error { status: number; code: string | null }`，`assertOk` 抛出它；Task 5 用它分类。

- [ ] **Step 1: 写失败测试**

`frontend/src/lib/api.error.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })));
}

describe('ApiError', () => {
  it('carries the status and the backend code', async () => {
    stubFetch(400, { statusCode: 400, code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock for TB001' });
    const error = await api.createOrder({ customer: {} as never, items: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock for TB001' });
  });

  it('has a null code when the backend sends none', async () => {
    stubFetch(400, { statusCode: 400, message: 'Validation failed: phone: Invalid' });
    const error = await api.createOrder({ customer: {} as never, items: [] }).catch((e) => e);
    expect(error).toMatchObject({ status: 400, code: null });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd frontend && pnpm vitest run src/lib/api.error.spec.ts`
Expected: FAIL —— `ApiError` 未导出 / `error.toMatchObject({status})` 不成立。

- [ ] **Step 3: 实现**

`frontend/src/lib/api.ts` 顶部（`assertOk` 之前）：

```ts
/**
 * A failed storefront request. The checkout funnel needs to tell a stock
 * rejection apart from a network error, so the status and the backend's
 * machine-readable code travel with the message the shopper sees.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
```

`assertOk` 改为：

```ts
async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = `Request failed: ${res.status}`;
  let code: string | null = null;
  try {
    const body = (await res.json()) as { message?: string | string[]; code?: string };
    if (typeof body.message === 'string') message = body.message;
    else if (Array.isArray(body.message)) message = body.message.join('; ');
    if (typeof body.code === 'string') code = body.code;
  } catch {
    /* keep default message */
  }
  throw new ApiError(message, res.status, code);
}
```

- [ ] **Step 4: 跑测试与类型检查**

Run: `cd frontend && pnpm vitest run src/lib/api.error.spec.ts && pnpm tsc --noEmit`
Expected: 2/2 通过，`tsc` 无输出。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.error.spec.ts
git commit -m "feat(checkout): expose status and code on storefront API errors"
```

---

### Task 4: 前端失败埋点模块

**Files:**
- Create: `frontend/src/lib/checkout-events.ts`
- Modify: `frontend/src/lib/analytics.ts`（事件名 + `metadata` 字段）
- Test: `frontend/src/lib/checkout-events.spec.ts`

**Interfaces:**
- Consumes: `trackFirstParty`, `analyticsSessionId`, `flushAnalytics` from `@/lib/analytics`；`ApiError` from `@/lib/api`。
- Produces:
  - `checkoutFailureReason(error: unknown): FailureReason`
  - `recordSubmitAttempt(input: SubmitAttemptInput): void`
  - `recordSubmitFailure(input: SubmitFailureInput): void`
  - `type FailureReason = 'VALIDATION' | 'STOCK' | 'NETWORK' | 'SERVER' | 'UNKNOWN'`
  - `type SubmitStep = 'form' | 'confirm'`

- [ ] **Step 1: 写失败测试**

`frontend/src/lib/checkout-events.spec.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { checkoutFailureReason, recordSubmitFailure } from './checkout-events';
import * as analytics from './analytics';

const customer = { name: 'Ana Cruz', phone: '+639171234567', province: 'Cebu', city: 'Cebu City', barangay: null, postalCode: '6000', streetAddress: '12 Mabini St', landmark: null, note: null };
const items = [{ skuId: '11111111-1111-4111-8111-111111111111', quantity: 2, variantName: 'Walnut' }];

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('checkoutFailureReason', () => {
  it('maps backend codes to stock failures', () => {
    expect(checkoutFailureReason(new ApiError('x', 400, 'INSUFFICIENT_STOCK'))).toBe('STOCK');
    expect(checkoutFailureReason(new ApiError('x', 400, 'SKU_UNAVAILABLE'))).toBe('STOCK');
    expect(checkoutFailureReason(new ApiError('x', 400, null))).toBe('VALIDATION');
  });
  it('maps transport and server faults', () => {
    expect(checkoutFailureReason(new TypeError('Failed to fetch'))).toBe('NETWORK');
    expect(checkoutFailureReason(new DOMException('aborted', 'AbortError'))).toBe('NETWORK');
    expect(checkoutFailureReason(new ApiError('x', 502, null))).toBe('SERVER');
    expect(checkoutFailureReason(new ApiError('x', 409, null))).toBe('UNKNOWN');
  });
});

describe('recordSubmitFailure', () => {
  it('sends one failed event carrying the customer snapshot and the full key', () => {
    const spy = vi.spyOn(analytics, 'trackFirstParty');
    recordSubmitFailure({ step: 'confirm', reason: 'STOCK', error: new ApiError('Insufficient stock', 400, 'INSUFFICIENT_STOCK'), customer, items, idempotencyKey: 'abc-key' });
    expect(spy).toHaveBeenCalledTimes(1);
    const [name, payload] = spy.mock.calls[0];
    expect(name).toBe('CHECKOUT_SUBMIT_FAILED');
    expect(payload.entityId).toBe(items[0].skuId);
    expect(payload.metadata).toMatchObject({
      step: 'confirm', reason: 'STOCK', httpStatus: 400,
      skuIds: [items[0].skuId], idempotencyKey: 'abc-key',
      customer: { name: 'Ana Cruz', phone: '+639171234567' },
    });
  });

  it('never sends a payload over the server metadata cap', () => {
    const spy = vi.spyOn(analytics, 'trackFirstParty');
    const huge = { ...customer, streetAddress: 'x'.repeat(3000), note: 'y'.repeat(3000) };
    recordSubmitFailure({ step: 'confirm', reason: 'UNKNOWN', error: new Error('boom'), customer: huge, items, idempotencyKey: 'k' });
    const payload = spy.mock.calls[0][1];
    expect(JSON.stringify(payload.metadata).length).toBeLessThanOrEqual(4096);
  });

  it('scrubs phone and email shapes out of the message', () => {
    const spy = vi.spyOn(analytics, 'trackFirstParty');
    recordSubmitFailure({ step: 'confirm', reason: 'SERVER', error: new Error('call +639171234567 a@b.com failed'), customer, items, idempotencyKey: 'k' });
    const metadata = spy.mock.calls[0][1].metadata as Record<string, unknown>;
    expect(String(metadata.message)).not.toContain('+639171234567');
    expect(String(metadata.message)).not.toContain('a@b.com');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd frontend && pnpm vitest run src/lib/checkout-events.spec.ts`
Expected: FAIL —— `checkoutFailureReason is not a function`。

- [ ] **Step 3: 实现**

`frontend/src/lib/analytics.ts` 的 `FirstPartyEventName` 加两项，并在 `FirstPartyEvent` 接口加：

```ts
  /** Structured payload for the checkout failure events; bounded server-side. */
  metadata?: Record<string, unknown>;
```

`frontend/src/lib/checkout-events.ts`：

```ts
"use client";

import { flushAnalytics, trackFirstParty } from "./analytics";

export type FailureReason = "VALIDATION" | "STOCK" | "NETWORK" | "SERVER" | "UNKNOWN";
export type SubmitStep = "form" | "confirm";

export interface CheckoutItemSnapshot {
  skuId: string;
  quantity: number;
  variantName?: string | null;
}

export interface CustomerSnapshot {
  name: string;
  phone: string;
  province: string;
  city: string;
  barangay?: string | null;
  postalCode?: string | null;
  streetAddress: string;
  landmark?: string | null;
  note?: string | null;
}

const ATTEMPT_KEY = "luwag_checkout_attempt_id";
const RETRY_KEY = "luwag_checkout_attempt_retry";
const METADATA_CAP = 4096;
const MESSAGE_CAP = 200;

/** Same attempt id for the whole checkout flow; a refresh must not split it. */
export function checkoutAttemptId(): string {
  try {
    const stored = sessionStorage.getItem(ATTEMPT_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(ATTEMPT_KEY, created);
    sessionStorage.setItem(RETRY_KEY, "0");
    return created;
  } catch {
    return `a-${Date.now()}`;
  }
}

/** Counts submits inside one checkout attempt; reset by a new attempt id. */
function nextRetry(): number {
  try {
    const value = Number(sessionStorage.getItem(RETRY_KEY) ?? "0") + 1;
    sessionStorage.setItem(RETRY_KEY, String(value));
    return value;
  } catch {
    return 1;
  }
}

/** STATUS: 5xx is a server fault; a thrown transport error is a network one. */
export function checkoutFailureReason(error: unknown): FailureReason {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    const code = String((error as { code?: unknown }).code ?? "");
    if (["INSUFFICIENT_STOCK", "SKU_UNAVAILABLE", "SKU_NOT_PRICED"].includes(code)) return "STOCK";
    if (status >= 500) return "SERVER";
    if (status === 400) return "VALIDATION";
    return "UNKNOWN";
    }
  if (error instanceof DOMException && error.name === "AbortError") return "NETWORK";
  if (error instanceof TypeError) return "NETWORK";
  return "UNKNOWN";
}

const PHONE_SHAPE = /(?:\+?\d[\d\s-]{7,}\d)/g;
const EMAIL_SHAPE = /[\w.+-]+@[\w-]+\.[\w.]+/g;

function scrub(message: string): string {
  return message.replace(PHONE_SHAPE, "***").replace(EMAIL_SHAPE, "***").slice(0, MESSAGE_CAP);
}

function trim(value: string | null | undefined, cap: number): string | null {
  if (!value) return null;
  return value.length > cap ? value.slice(0, cap) : value;
}

function basePayload(step: SubmitStep, items: readonly CheckoutItemSnapshot[]) {
  return {
    entityId: items.map((item) => item.skuId).join(",").slice(0, 120) || null,
    metadata: {
      step,
      attemptId: checkoutAttemptId(),
      retry: nextRetry(),
      skuIds: items.map((item) => item.skuId),
      quantities: items.map((item) => item.quantity),
    } satisfies Record<string, unknown>,
  };
}

export function recordSubmitAttempt(input: { step: SubmitStep; items: readonly CheckoutItemSnapshot[] }): void {
  try {
    trackFirstParty("CHECKOUT_SUBMIT_ATTEMPT", basePayload(input.step, input.items));
    flushAnalytics();
  } catch {
    /* analytics never breaks checkout */
  }
}

export function recordSubmitFailure(input: {
  step: SubmitStep;
  reason: FailureReason;
  error: unknown;
  items: readonly CheckoutItemSnapshot[];
  customer: CustomerSnapshot;
  idempotencyKey: string;
  /** First invalid checkout field for form-step validation failures. */
  field?: string;
}): void {
  try {
    const payload = basePayload(input.step, input.items);
    const metadata: Record<string, unknown> = {
      ...payload.metadata,
      reason: input.reason,
      field: input.field ?? null,
      httpStatus: input.error && typeof input.error === "object" && "status" in input.error ? Number((input.error as { status: unknown }).status) : null,
      message: scrub(input.error instanceof Error ? input.error.message : ""),
      variantNames: input.items.map((item) => item.variantName ?? null),
      idempotencyKey: input.idempotencyKey,
      customer: {
        name: trim(input.customer.name, 120),
        phone: trim(input.customer.phone, 32),
        province: trim(input.customer.province, 120),
        city: trim(input.customer.city, 120),
        barangay: trim(input.customer.barangay ?? null, 120),
        postalCode: trim(input.customer.postalCode ?? null, 16),
        streetAddress: trim(input.customer.streetAddress, 300),
        landmark: trim(input.customer.landmark ?? null, 300),
        note: trim(input.customer.note ?? null, 200),
      },
    };
    // The server drops metadata wholesale above 4096 bytes; shrink the
    // longest free-text fields first so the failure is still recorded.
    while (JSON.stringify(metadata).length > METADATA_CAP) {
      const customer = metadata.customer as Record<string, string | null>;
      if (customer.note) { customer.note = null; continue; }
      if (customer.landmark) { customer.landmark = null; continue; }
      if (customer.streetAddress) { customer.streetAddress = customer.streetAddress.slice(0, 150); }
      if (metadata.message) { metadata.message = String(metadata.message).slice(0, 80); continue; }
      break;
    }
    trackFirstParty("CHECKOUT_SUBMIT_FAILED", { ...payload, metadata });
    flushAnalytics();
  } catch {
    /* analytics never breaks checkout */
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `cd frontend && pnpm vitest run src/lib/checkout-events.spec.ts`
Expected: PASS 5/5。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/lib/checkout-events.ts frontend/src/lib/checkout-events.spec.ts frontend/src/lib/analytics.ts
git commit -m "feat(analytics): record checkout submit attempts and failures first-party"
```

---

### Task 5: 把埋点接到结账两个提交点

**Files:**
- Modify: `frontend/src/components/checkout/CheckoutForm.tsx:455-480`
- Modify: `frontend/src/components/checkout/CheckoutConfirmView.tsx:221-324`
- Test: `frontend/src/components/checkout/CheckoutConfirmView.spec.tsx`（追加用例）
- Test: `frontend/src/components/checkout/CheckoutForm.submit-events.spec.tsx`（新建）

**Interfaces:**
- Consumes: `recordSubmitAttempt`, `recordSubmitFailure`, `checkoutFailureReason`（Task 4）。
- Produces: 无新导出；行为契约：结账页校验失败 → 一次 `CHECKOUT_SUBMIT_FAILED{step:'form'}`；确认页每次点击提交 → 一次 `ATTEMPT{step:'confirm'}`，失败再跟一次 `FAILED{step:'confirm'}`，同一 `attemptId` 的 `retry` 递增。

- [ ] **Step 1: 写失败测试**

在既有 `CheckoutConfirmView.spec.tsx` 顶部（其它 mock 之后）加：

```tsx
const eventsMock = vi.hoisted(() => ({
  recordSubmitAttempt: vi.fn(),
  recordSubmitFailure: vi.fn(),
  checkoutFailureReason: vi.fn(() => "STOCK"),
}));
vi.mock("@/lib/checkout-events", () => eventsMock);
```

在 `describe` 末尾追加（沿用文件里已有的 `validDraft`、`apiMock`、`<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />` 渲染方式）：

```tsx
it("records a confirm-step attempt and the STOCK failure", async () => {
  apiMock.createOrder.mockRejectedValue(new ApiError("Insufficient stock for TB001", 400, "INSUFFICIENT_STOCK"));
  draftMock.readCheckoutDraft.mockReturnValue(validDraft);
  render(<CheckoutConfirmView skuId="sku-red-small" qty="1" slug="chair" />);
  const place = await screen.findByRole("button", { name: /place order|提交订单/i });
  await userEvent.click(place);
  expect(eventsMock.recordSubmitAttempt).toHaveBeenCalledWith(expect.objectContaining({ step: "confirm" }));
  await waitFor(() => expect(eventsMock.recordSubmitFailure).toHaveBeenCalledWith(expect.objectContaining({ step: "confirm", reason: "STOCK" })));
});
```

（`ApiError` 从 `@/lib/api` 引入；该文件已 `vi.mock("@/lib/api", () => ({ api: apiMock }))`，需要在 mock 工厂里保留真实类：改成 `vi.mock("@/lib/api", async () => { const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api"); return { ...actual, api: apiMock }; })`。）

新建 `CheckoutForm.submit-events.spec.tsx`（mock 结构完全照搬 `CheckoutForm.promo.spec.tsx` 的头部，只替换业务断言）：

```tsx
it("records a VALIDATION failure with the first bad field", async () => {
  validationMock.validateCheckoutForm.mockReturnValue({ phone: "Enter a valid mobile number" });
  validationMock.validatePreferredDate.mockReturnValue(null);
  checkoutLinesMock.mockReturnValue({ lines: [...formLines], ready: true, blocked: false });
  render(<SiteSettingsProvider settings={siteSettingsMock.current}><CheckoutForm skuId="sku-red-small" qty="1" slug="chair" /></SiteSettingsProvider>);
  await userEvent.click(await screen.findByRole("button", { name: /continue|继续/i }));
  expect(eventsMock.recordSubmitFailure).toHaveBeenCalledWith(expect.objectContaining({ step: "form", reason: "VALIDATION", field: "phone" }));
  expect(routerMock.push).not.toHaveBeenCalled();
});
```

（`formLines` 直接用 promo 测试里同一个 fixture；`SiteSettingsProvider` / `siteSettingsMock` 同源复制。）

Run: `cd frontend && pnpm vitest run src/components/checkout/CheckoutConfirmView.spec.tsx src/components/checkout/CheckoutForm.submit-events.spec.tsx`
Expected: FAIL —— `recordSubmitAttempt` / `recordSubmitFailure` 未被调用。

- [ ] **Step 3: 接线**

`CheckoutForm.tsx` 引入：

```tsx
import { recordSubmitAttempt, recordSubmitFailure } from "@/lib/checkout-events";
```

`goToReview()` 改为（`checkoutItemsForTracking` 与 `customerSnapshot` 定义在同一组件内，`orderItems` 来自 `useCheckoutLines`，变体名拿不到时传 `null`）：

```tsx
  const checkoutItemsForTracking = orderItems.map((item) => ({
    skuId: item.skuId,
    quantity: item.quantity,
    variantName: item.variantName ?? null,
  }));
  const customerSnapshot = {
    name: form.name, phone: form.phone, province: form.province, city: form.city,
    barangay: form.barangay || null, postalCode: form.postalCode || null,
    streetAddress: form.streetAddress, landmark: form.landmark || null,
    note: form.notes || null,
  };

  function goToReview() {
    if (promoChecking) return;
    const validation = validateCheckoutForm(form);
    const preferredDateError = validatePreferredDate(form.preferredDeliveryDate);
    if (preferredDateError) validation.preferredDeliveryDate = preferredDateError;
    setErrors(validation);
    const firstInvalid = CHECKOUT_FIELD_ORDER.find((field) => validation[field]);
    if (Object.keys(validation).length > 0) {
      const focusId = firstInvalid ? FIELD_ELEMENT_ID[firstInvalid] : undefined;
      if (focusId) document.getElementById(focusId)?.focus();
      recordSubmitFailure({
        step: "form",
        reason: "VALIDATION",
        error: new Error(String(validation[firstInvalid ?? "name"] ?? "Checkout form is incomplete")),
        items: checkoutItemsForTracking,
        customer: customerSnapshot,
        idempotencyKey: "",
        field: firstInvalid,
      });
      return;
    }
    if (orderItems.length === 0) return; // ready 门禁已挡住，双保险
    recordSubmitAttempt({ step: "form", items: checkoutItemsForTracking });
```

`field` 是 Task 4 之外的附加参数：把 `recordSubmitFailure` 的入参类型加可选 `field?: string`，并在 metadata 里写 `field: input.field ?? null`。

`CheckoutConfirmView.tsx` 引入同一模块，`placeOrder()` 改为：

```tsx
  async function placeOrder() {
    if (!draft || inFlightRef.current || promoChecking) return;
    setError(null);
    if (submitting) return;
    if (unresolvedSelection || awaitingBuyNowResolution) {
      recordSubmitFailure({ step: "confirm", reason: "STOCK", error: new Error("Selected items are unavailable"), items: trackingItems, customer: customerSnapshotFromDraft(draft), idempotencyKey: idempotencyKeyRef.current?.key ?? "" });
      return;
    }
    if (checkout.orderItems.length === 0) {
      setError("No items to check out.");
      recordSubmitFailure({ step: "confirm", reason: "VALIDATION", error: new Error("No items to check out."), items: [], customer: customerSnapshotFromDraft(draft), idempotencyKey: "" });
      return;
    }
```

提交前（`const payload = {...}` 之后、`await api.createOrder` 之前）：

```tsx
      recordSubmitAttempt({ step: "confirm", items: trackingItems });
```

`catch (e)` 内、`setError` 之前：

```tsx
      recordSubmitFailure({
        step: "confirm",
        reason: checkoutFailureReason(e),
        error: e,
        items: trackingItems,
        customer: customerSnapshotFromDraft(draft),
        idempotencyKey: payload.idempotencyKey ?? "",
      });
```

`trackingItems` 由 `checkout.orderItems` 映射而来，`variantName` 从 `checkout` 上下文已有的行数据取（拿不到就传 `null`）。`customerSnapshotFromDraft` 放在 `CheckoutConfirmView.tsx` 内部：

```tsx
const customerSnapshotFromDraft = (draft: CheckoutDraft): CustomerSnapshot => ({
  name: draft.customer.name, phone: draft.customer.phone,
  province: draft.customer.province, city: draft.customer.city,
  barangay: draft.customer.barangay ?? null, postalCode: draft.customer.postalCode ?? null,
  streetAddress: draft.customer.streetAddress, landmark: draft.customer.landmark ?? null,
  note: draft.customerNote ?? null,
});
```

- [ ] **Step 4: 跑相关测试**

Run: `cd frontend && pnpm vitest run src/components/checkout && pnpm tsc --noEmit`
Expected: 全部通过；`tsc` 无输出。（`CheckoutForm` 原有的 `goToReview` 用例若断言「校验失败时没有任何副作用」，改为只断言不跳转。）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/checkout frontend/src/lib/checkout-events.ts
git commit -m "feat(checkout): emit submit attempt and failure events at both submit points"
```

---

### Task 6: 后端漏斗聚合服务与接口

**Files:**
- Create: `backend/src/modules/marketing/dto/marketing-funnel.dto.ts`
- Create: `backend/src/modules/marketing/marketing-funnel.sql.ts`
- Create: `backend/src/modules/marketing/marketing-funnel.service.ts`
- Create: `backend/src/modules/marketing/admin/marketing-funnel.controller.ts`
- Modify: `backend/src/modules/marketing/marketing.module.ts`（注册 controller + service）
- Test: `backend/src/modules/marketing/marketing-funnel.service.spec.ts`、`backend/src/modules/marketing/marketing-funnel.integration.spec.ts`

**Interfaces:**
- Consumes: `MarketingAccount`、`scopeFor`、`assertVisible`（`marketing-access.ts`）；`PrismaService`。
- Produces: `GET /api/v1/admin/marketing/funnel` 返回
  `{ from, to, traffic, asOf, page, pageSize, total, rows: FunnelRow[] }`，
  `FunnelRow = { productId, productName, productCode, thumbnailUrl, ownerUserId?, visits, views, addToCarts, checkouts, attempts, failures, orders, steps: { key, rate, baselineRate, flagged }[], failureReasons: Record<FailureReason, number> }`。

- [ ] **Step 1: 写失败的 DTO 测试**

```ts
import { marketingFunnelQuerySchema } from './marketing-funnel.dto.js';

it('defaults to all traffic and the last month sort', () => {
  const parsed = marketingFunnelQuerySchema.parse({ from: '2026-10-01', to: '2026-11-06' });
  expect(parsed).toMatchObject({ traffic: 'ALL', sort: 'ORDER_COUNT', page: 1 });
});
it('rejects a reversed range', () => {
  expect(marketingFunnelQuerySchema.safeParse({ from: '2026-11-06', to: '2026-10-01' }).success).toBe(false);
});
it('rejects an unknown reason filter', () => {
  expect(marketingFunnelSessionsQuerySchema.safeParse({ productId: '11111111-1111-4111-8111-111111111111', from: '2026-10-01', to: '2026-11-06', reason: 'TIMEOUT' }).success).toBe(false);
});
```

Run: `cd backend && pnpm vitest run src/modules/marketing/dto/marketing-funnel.dto.spec.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 2: 实现 DTO**

`marketing-funnel.dto.ts`：

```ts
import { z } from 'zod';

export const funnelTrafficSchema = z.enum(['ALL', 'ADS', 'ORGANIC']);
export const funnelReasonSchema = z.enum(['VALIDATION', 'STOCK', 'NETWORK', 'SERVER', 'UNKNOWN']);
export const funnelSortSchema = z.enum(['ORDER_COUNT', 'VISITS', 'ADD_TO_CART_RATE', 'CHECKOUT_RATE', 'SUBMIT_RATE', 'FAILURE_RATE']);

const range = {
  from: z.iso.date(),
  to: z.iso.date(),
};

export const marketingFunnelQuerySchema = z.object({
  ...range,
  traffic: funnelTrafficSchema.default('ALL'),
  ownerUserId: z.uuid().optional(),
  q: z.string().trim().max(120).optional(),
  onlyAnomaly: z.enum(['true', 'false']).default('false'),
  sort: funnelSortSchema.default('ORDER_COUNT'),
  page: z.coerce.number().int().min(1).max(20).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
}).refine((value) => value.from <= value.to, { message: 'from must be on or before to' }).strict();

export const marketingFunnelSessionsQuerySchema = z.object({
  ...range,
  productId: z.uuid(),
  traffic: funnelTrafficSchema.default('ALL'),
  reason: funnelReasonSchema.optional(),
  device: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  source: z.enum(['ADS', 'ORGANIC']).optional(),
  onlyFailures: z.enum(['true', 'false']).default('false'),
  cursor: z.string().max(200).optional(),
}).refine((value) => value.from <= value.to, { message: 'from must be on or before to' }).strict();

export type MarketingFunnelQuery = z.infer<typeof marketingFunnelQuerySchema>;
export type MarketingFunnelSessionsQuery = z.infer<typeof marketingFunnelSessionsQuerySchema>;
```

- [ ] **Step 3: 写失败的聚合测试**

`marketing-funnel.service.spec.ts` 用一个内存假 Prisma（`$queryRaw` 返回预置行）测窗口换算与中位数：

```ts
it('converts Manila days to a UTC window', async () => {
  // 2026-10-30 Manila day starts 2026-10-29T16:00Z
  const window = funnelWindow('2026-10-30', '2026-11-05');
  expect(window.from.toISOString()).toBe('2026-10-29T16:00:00.000Z');
  expect(window.end.toISOString()).toBe('2026-11-05T16:00:00.000Z');
});
it('flags a step under half its baseline only when the base is large enough', () => {
  expect(flagStep(2, 20, 8, 7)).toBe(true);   // 10% vs 80% baseline
  expect(flagStep(2, 19, 8, 7)).toBe(false);  // sample too small
  expect(flagStep(5, 20, 8, null)).toBe(false); // no baseline
});
```

Run: `cd backend && pnpm vitest run src/modules/marketing/marketing-funnel.service.spec.ts`
Expected: FAIL —— `funnelWindow` 未导出。

- [ ] **Step 4: 实现聚合**

`marketing-funnel.sql.ts`（只导出 SQL 常量，便于单测断言）：

```ts
import { Prisma } from '../../generated/prisma/client.js';

/** Manila day range → UTC instant range (UTC+8, no DST). */
export function funnelWindow(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  return {
    from: new Date(start.getTime() - 8 * 3600_000),
    end: new Date(end.getTime() + 16 * 3600_000),
  };
}

export const funnelTrafficSql = (traffic: 'ALL' | 'ADS' | 'ORGANIC') =>
  traffic === 'ADS' ? Prisma.sql`AND e.campaign_link_id IS NOT NULL`
    : traffic === 'ORGANIC' ? Prisma.sql`AND e.campaign_link_id IS NULL`
    : Prisma.empty;

/** Orders carry their traffic source on the attribution row, not on `o`. */
export const funnelOrdersTrafficSql = (traffic: 'ALL' | 'ADS' | 'ORGANIC') =>
  traffic === 'ADS' ? Prisma.sql`AND EXISTS (SELECT 1 FROM order_attributions a WHERE a.order_id = o.id AND a.link_id IS NOT NULL)`
    : traffic === 'ORGANIC' ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM order_attributions a WHERE a.order_id = o.id AND a.link_id IS NOT NULL)`
    : Prisma.empty;
```

`marketing-funnel.service.ts` 的范围查询（一次范围查询 + 一次基线查询，形状相同）：

```ts
  async funnel(query: MarketingFunnelQuery, account: MarketingAccount) {
    const scope = scopeFor(account);
    if (query.ownerUserId) assertVisible(scope, query.ownerUserId);
    const owner = scope.all ? query.ownerUserId ?? null : account.id;
    const range = funnelWindow(query.from, query.to);
    const baselineWindow = funnelWindow(shiftDay(query.from, -7), shiftDay(query.from, -1));

    const rows = await this.prisma.$queryRaw<StepCountRow[]>(Prisma.sql`
      WITH page_visits AS (
        SELECT p.id AS product_id, e.session_id
        FROM analytics_events e
        JOIN products p ON p.slug = split_part(e.page_path, '/', 3)
        WHERE e.event_name = 'PAGE_VIEW' AND e.page_path LIKE '/products/%'
          AND e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
          ${funnelTrafficSql(query.traffic)}
        UNION ALL
        SELECT lp.product_id, e.session_id
        FROM analytics_events e
        JOIN product_landing_pages lp ON lp.slug = split_part(e.page_path, '/', 3)
        WHERE e.event_name = 'PAGE_VIEW' AND e.page_path LIKE '/lp/%'
          AND e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
          ${funnelTrafficSql(query.traffic)}
      ), product_steps AS (
        SELECT e.product_id, e.session_id, e.event_name
        FROM analytics_events e
        WHERE e.event_name IN ('PRODUCT_VIEW', 'ADD_TO_CART')
          AND e.product_id IS NOT NULL
          AND e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
          ${funnelTrafficSql(query.traffic)}
      ), sku_steps AS (
        SELECT s.product_id, e.session_id, e.event_name
        FROM analytics_events e
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(e.metadata -> 'skuIds') = 'array'
               THEN e.metadata -> 'skuIds'
               ELSE to_jsonb(string_to_array(coalesce(e.entity_id, ''), ','))
          END
        ) AS sku_id
        JOIN skus s ON s.id::text = sku_id
        WHERE e.event_name IN ('BEGIN_CHECKOUT', 'CHECKOUT_SUBMIT_ATTEMPT', 'CHECKOUT_SUBMIT_FAILED')
          AND e.event_day BETWEEN ${query.from}::date AND ${query.to}::date
          ${funnelTrafficSql(query.traffic)}
      ), step_counts AS (
        SELECT product_id, event_name, COUNT(DISTINCT session_id) AS sessions
        FROM (
          SELECT product_id, session_id, 'PAGE_VIEW' AS event_name FROM page_visits
          UNION ALL SELECT product_id, session_id, event_name FROM product_steps
          UNION ALL SELECT product_id, session_id, event_name FROM sku_steps
        ) all_steps
        GROUP BY product_id, event_name
      ), order_counts AS (
        SELECT oi.product_id, COUNT(DISTINCT o.id) AS orders
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= ${range.from} AND o.created_at < ${range.end}
          AND oi.product_id IS NOT NULL
          ${funnelOrdersTrafficSql(query.traffic)}
        GROUP BY oi.product_id
      )
      SELECT p.id AS "productId", p.name AS "productName", p.product_code AS "productCode",
        (SELECT i.url FROM product_images i
          WHERE i.product_id = p.id AND i.option_value_id IS NULL AND i.variant_id IS NULL
          ORDER BY i.sort_order ASC, i.id ASC LIMIT 1) AS "thumbnailUrl",
        sc.event_name AS "eventName", sc.sessions,
        COALESCE(oc.orders, 0) AS orders
      FROM products p
      LEFT JOIN step_counts sc ON sc.product_id = p.id
      LEFT JOIN order_counts oc ON oc.product_id = p.id
      WHERE p.status = 'ACTIVE'
        ${owner ? Prisma.sql`AND EXISTS (SELECT 1 FROM campaign_links l WHERE l.product_id = p.id AND l.owner_user_id = ${owner}::uuid)` : Prisma.empty}
        ${query.q ? Prisma.sql`AND (p.name ILIKE ${'%' + query.q + '%'} OR p.product_code ILIKE ${'%' + query.q + '%'})` : Prisma.empty}
      ORDER BY p.name ASC
    `);
```

返回行形状是「一商品 × 一步骤一行」；服务层按 `productId` 折叠成 `FunnelRow`（`PAGE_VIEW→visits`、`PRODUCT_VIEW→views`、`ADD_TO_CART→addToCarts`、`BEGIN_CHECKOUT→checkouts`、`CHECKOUT_SUBMIT_ATTEMPT→attempts`、`CHECKOUT_SUBMIT_FAILED→failures`）。失败原因分布另用一条按 `reason` 分组的同构查询。基线窗口复用同一段 SQL（把两个日期参数换掉），把每日数字交给下面的 `medianRate` 计算。

基线查询复用同一段 SQL，只把 `BETWEEN ${from}::date AND ${to}::date` 换成基线窗口，返回每个商品每天的步数；服务层按商品算每日转化率中位数：

```ts
  /** Median of the per-day rates; null when no day carried a base. */
  function medianRate(days: Array<{ step: string; base: number; hit: number }>, step: string, baseStep: string): number | null {
    const rates = days.filter((d) => d.step === step && d.base >= 5).map((d) => d.hit / d.base);
    if (rates.length === 0) return null;
    rates.sort((a, b) => a - b);
    const mid = Math.floor(rates.length / 2);
    return rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  }

  export function flagStep(hits: number, base: number, baseline: number | null, minimumBase = 20): boolean {
    if (base < minimumBase || baseline === null) return false;
    return hits / base < baseline * 0.5;
  }
```

- [ ] **Step 5: 控制器**

```ts
@Controller('admin/marketing/funnel')
@UseGuards(JwtAuthGuard, MarketingGuard)
export class MarketingFunnelController {
  constructor(@Inject(MarketingFunnelService) private readonly funnel: MarketingFunnelService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query(new ZodValidationPipe(marketingFunnelQuerySchema)) query: MarketingFunnelQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.funnel.funnel(query, account);
  }

  @Get(':productId/detail')
  @Header('Cache-Control', 'private, no-store')
  detail(@Param('productId', new ParseUUIDPipe()) productId: string, @Query(new ZodValidationPipe(marketingFunnelQuerySchema)) query: MarketingFunnelQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.funnel.detail(productId, query, account);
  }

  @Get('sessions')
  @Header('Cache-Control', 'private, no-store')
  sessions(@Query(new ZodValidationPipe(marketingFunnelSessionsQuerySchema)) query: MarketingFunnelSessionsQuery, @CurrentMarketingAccount() account: MarketingAccount) {
    return this.funnel.sessions(query, account);
  }
}
```

（`@Get(':productId/detail')` 与 `@Get('sessions')` 的静态优先规则：Nest 按声明顺序匹配，把 `sessions` 声明在 `:productId/detail` 之前。）

- [ ] **Step 6: 写集成测试并跑**

`marketing-funnel.integration.spec.ts` 种入：某商品 3 个会话访问、2 个浏览、1 个加购、1 个结账、1 次提交失败（reason STOCK）、1 个订单；断言 `rows[0]` 的数字与 `failureReasons.STOCK === 1`，且 `traffic=ORGANIC` 时投放事件被排除。Run: `cd backend && pnpm vitest run src/modules/marketing/marketing-funnel`
Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add backend/src/modules/marketing
git commit -m "feat(marketing): product funnel aggregation endpoints"
```

---

### Task 7: 会话时间线接口（唯一返回客户信息的接口）

**Files:**
- Modify: `backend/src/modules/marketing/marketing-funnel.service.ts`（`sessions()`）
- Modify: `backend/src/modules/marketing/admin/marketing-funnel.controller.ts`
- Test: `backend/src/modules/marketing/marketing-funnel.sessions.spec.ts`

**Interfaces:**
- Produces: `GET /api/v1/admin/marketing/funnel/sessions` 返回
  `{ nextCursor: string | null, items: Array<{ sessionId, device, source: 'ADS'|'ORGANIC', entryPath, startedAt, events: Array<{ eventName, at, reason?, httpStatus?, message?, items?, customer? }> }> }`。

- [ ] **Step 1: 写失败测试**

```ts
it('returns customer details only inside a failure event', async () => {
  const result = await service.sessions({ productId, from: '2026-10-30', to: '2026-11-05', traffic: 'ALL', onlyFailures: 'true' }, account);
  expect(result.items[0].events[0].customer).toMatchObject({ phone: '+639171234567' });
});
it('scopes the list endpoint away from other owners', async () => {
  await expect(service.funnel({ ...query, ownerUserId: 'other-owner' }, nonAdminAccount)).rejects.toBeInstanceOf(NotFoundException);
});
it('filters by failure reason', async () => {
  const result = await service.sessions({ ...query, reason: 'STOCK' }, account);
  expect(result.items.every((s) => s.events.some((e) => e.reason === 'STOCK'))).toBe(true);
});
```

Run: `cd backend && pnpm vitest run src/modules/marketing/marketing-funnel.sessions.spec.ts`
Expected: FAIL —— `sessions` 未实现。

- [ ] **Step 2: 实现**

`sessions()` 两步：先按会话分页（`session_id`、`MIN(created_at)` 游标），再拉这些会话在窗口内的全部事件；只有 `CHECKOUT_SUBMIT_FAILED` 的 metadata 才映射出 `customer`、`idempotencyKey`，其它事件只映射 `reason/httpStatus/message/items`。筛选 `onlyFailures` 用 `EXISTS (...event_name='CHECKOUT_SUBMIT_FAILED')`。

- [ ] **Step 3: 跑测试**

Run: `cd backend && pnpm vitest run src/modules/marketing`
Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add backend/src/modules/marketing
git commit -m "feat(marketing): checkout session timeline for the funnel drawer"
```

---

### Task 8: 前端漏斗页签

**Files:**
- Modify: `frontend/src/lib/marketing-api.ts`（三个 fetch 方法 + 类型）
- Modify: `frontend/src/components/admin/marketing/MarketingWorkbench.tsx`（`view` 联合类型、页签、分支）
- Create: `frontend/src/app/admin/(shell)/marketing/funnel/page.tsx`
- Create: `frontend/src/components/admin/marketing/ProductFunnel.tsx`
- Create: `frontend/src/components/admin/marketing/ProductFunnelDrawer.tsx`
- Modify: `frontend/src/i18n/zh.ts`、`frontend/src/i18n/en.ts`
- Test: `frontend/src/components/admin/marketing/ProductFunnel.spec.tsx`

**Interfaces:**
- Consumes: `GET /admin/marketing/funnel`、`/funnel/:productId/detail`、`/funnel/sessions`（Task 6/7）；`DateRangePicker`（`components/admin/marketing/DateRangePicker`）。
- Produces: `/admin/marketing/funnel` 页面。

- [ ] **Step 1: 写失败测试**

```tsx
it('renders one row per product with the seven step counts', async () => {
  const row = { productId: 'p1', productName: 'Shoe cabinet', thumbnailUrl: null, visits: 40, views: 33, addToCarts: 12, checkouts: 6, attempts: 5, failures: 2, orders: 3, steps: [], failureReasons: { STOCK: 2 } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rows: [row], total: 1, page: 1, pageSize: 50 }), { status: 200 })));
  render(<AdminI18nProvider><ProductFunnel /></AdminI18nProvider>);
  expect(await screen.findByText('Shoe cabinet')).toBeInTheDocument();
  expect(screen.getByTestId(`funnel-failures-p1`)).toHaveTextContent('2');
});
it('marks a flagged step in red and explains the baseline', async () => {
  // steps: [{ key: 'CHECKOUT', rate: 0.021, baselineRate: 0.084, flagged: true }]
  expect(screen.getByTestId('funnel-flag-CHECKOUT')).toHaveAttribute('title', expect.stringContaining('8.4%'));
});
```

Run: `cd frontend && pnpm vitest run src/components/admin/marketing/ProductFunnel.spec.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 2: 实现页面**

`marketing-api.ts` 增加：

```ts
export interface FunnelStep { key: 'VISIT' | 'VIEW' | 'ADD_TO_CART' | 'CHECKOUT' | 'ATTEMPT' | 'FAILURE' | 'ORDER'; rate: number; baselineRate: number | null; flagged: boolean }
export interface FunnelRow {
  productId: string; productName: string; productCode: string | null; thumbnailUrl: string | null;
  visits: number; views: number; addToCarts: number; checkouts: number; attempts: number; failures: number; orders: number;
  steps: FunnelStep[]; failureReasons: Record<string, number>;
}
export const funnel: {
  list: (query: Record<string, string>) => adminAuthedFetch<{ rows: FunnelRow[]; total: number; page: number; pageSize: number }>(`/api/v1/admin/marketing/funnel?${new URLSearchParams(query)}`, { cache: 'no-store' }),
  sessions: (query: Record<string, string>) => adminAuthedFetch<FunnelSessions>(`/api/v1/admin/marketing/funnel/sessions?${new URLSearchParams(query)}`, { cache: 'no-store' }),
};
```

`ProductFunnel.tsx` 用现有筛选卡样式（与 `ReportTable` 同款 `DateRangePicker`），表格每行：缩略图+名称+SKU、访问、浏览、加购、结账、提交、失败、下单、转化率；标红步骤渲染 `data-testid={`funnel-flag-${step.key}`}` + `title` 写明当前值与基线；点行打开 `ProductFunnelDrawer`。

`ProductFunnelDrawer.tsx` 三页签：步骤明细、失败原因分布、会话时间线（原因/设备/来源筛选 + 只看失败）；客户信息默认打码：

```tsx
const maskPhone = (phone: string) => phone.replace(/\d(?=\d{4})/g, '*');
const maskAddress = (customer: CustomerSnapshot) => [customer.province, customer.city].filter(Boolean).join(' / ');
```

i18n 键：`marketing_funnel`（页签）、`marketing_funnel_visits / views / add_to_carts / checkouts / attempts / failures / orders / conversion`、`marketing_funnel_flag_hint`（`{current} / {baseline}` 占位）、`marketing_funnel_reason_validation / stock / network / server / unknown`、`marketing_funnel_sessions`、`marketing_funnel_show_pii`、`marketing_funnel_empty`。

`MarketingWorkbench.tsx`：

```tsx
export type MarketingWorkbenchView = "pages" | "links" | "costs" | "reports" | "shortLinks" | "compare" | "optimizers" | "funnel";
```

页签加在「核算」之后：

```tsx
<Link className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm ${view === "funnel" ? "border-cta font-semibold text-cta" : "border-transparent text-admin-muted"}`} aria-current={view === "funnel" ? "page" : undefined} href="/admin/marketing/funnel">{t("marketing_funnel")}</Link>
```

分支：

```tsx
: view === "funnel" ? <ProductFunnel />
```

`src/app/admin/(shell)/marketing/funnel/page.tsx`：

```tsx
import type { Metadata } from "next";
import MarketingWorkbench from "@/components/admin/marketing/MarketingWorkbench";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function MarketingFunnelPage() {
  return <MarketingWorkbench view="funnel" />;
}
```

- [ ] **Step 3: 跑测试与类型检查**

Run: `cd frontend && pnpm vitest run src/components/admin/marketing && pnpm tsc --noEmit`
Expected: 全部通过；`tsc` 无输出。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/admin/marketing frontend/src/app/admin frontend/src/lib/marketing-api.ts frontend/src/i18n
git commit -m "feat(marketing): product funnel tab with anomaly flags and session drill-down"
```

---

### Task 9: 全链路验证与文档

**Files:**
- Create: `small-house-commerce/docs/releases/2026-11-0X-checkout-funnel.md`（实际日期按发布日）
- Test: 无新代码

- [ ] **Step 1: 本地端到端**

Run: `cd frontend && pnpm vitest run && pnpm tsc --noEmit`
Run: `cd backend && pnpm prisma generate && pnpm vitest run`
Expected: 前端全绿；后端全绿（已知无关失败 `uploads.service.spec.ts` 大 mp4 超时，单独跑该文件应通过——记录在发布文档里）。

- [ ] **Step 2: 本地浏览器验证**

用本地 dev（`localhost` 端口，不用 `127.0.0.1`）：
1. 结账页留空手机号点「继续」→ 断言 `CHECKOUT_SUBMIT_FAILED`（`step=form, reason=VALIDATION, field=phone`）出现在 `/api/v1/storefront/events` 的 POST body 里；
2. 确认页对一个缺货 SKU 点提交 → `FAILED{step=confirm, reason=STOCK, httpStatus:400}`，`metadata.customer` 与 `idempotencyKey` 都在；
3. `/admin/marketing/funnel` 打开，能看到该商品行、失败列 +1、抽屉里能筛出这条会话。

- [ ] **Step 3: 写发布文档**

记录：改动范围（后端迁移 + 前端）、上线顺序（先后端后前端）、回滚点、验收证据、已知限制（失败事件只从前端上线时刻开始积累）。

- [ ] **Step 4: 提交**

```bash
git add small-house-commerce/docs/releases
git commit -m "docs(marketing): record the checkout funnel release"
```

---

## Review Focus

1. **同一结账多次重试** —— 用户连点提交 3 次全部失败，必须只算 1 个失败会话、`retry` 依次为 1/2/3；Task 4 的 `attemptId`/`retry` 测试与 Task 6 的 `COUNT(DISTINCT session_id)` 各钉一次。
2. **大购物车被 120 字符截断** —— 5 个 SKU 的结账 `entity_id` 会丢商品；Task 4 的 `metadata.skuIds` 测试、Task 6 的「优先读 metadata、回退 entity_id」SQL 必须两种输入都覆盖（集成测试加一条只有 `entity_id` 的历史事件）。
3. **离线或超时** —— fetch 抛 `TypeError`/`AbortError` 必须是 `NETWORK`，不能落进 `UNKNOWN`；Task 4 测试已覆盖，Task 8 的失败原因分布要显示这一类。
4. **基线缺失/新商品** —— 新品没有前 7 天数据时不能标红、不能显示 `NaN`；Task 6 的 `flagStep(…, null)` 用例 + Task 8 空基线渲染用例。
5. **PII 泄漏到列表** —— 漏斗主表与明细接口任何字段都不含客户信息；Task 7 测试断言 list/detail 的 JSON 里没有 `phone`/`streetAddress` 键。
6. **马尼拉换日** —— 16:00 UTC 之后的事件属于第二天；Task 6 的 `funnelWindow` 测试固定该边界。
7. **同一会话浏览两个商品** —— 两个商品各算一次会话，不互相吞掉；集成测试种入一个双商品会话并断言两行都 +1。
