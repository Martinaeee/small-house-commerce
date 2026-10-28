# 千易 ERP 订单同步 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 独立站订单在客服确认后自动推入千易 ERP（免审核），千易发货后把运单号、物流节点、出库明细回推，顾客可在 `/track-order` 看到真实轨迹。

**Architecture:** 事务性 outbox（确认订单的同一事务写入任务行）+ 30 秒进程内 worker 重试，形态复制 `backend/src/modules/meta-capi/`。千易回调落到公开 webhook 控制器，验签后按 `serviceType` 分发，复用现有 `Shipment` / `Inventory` / `LogisticsEvent` / `ship()` 语义。

**Tech Stack:** NestJS 12 + Prisma 7（分文件 schema）+ vitest；Next.js 16 App Router + vitest。

**Spec:** `docs/superpowers/specs/2026-10-28-qianyi-erp-integration-design.md`

## Global Constraints

- 千易域名 `https://www.qianyierp.com`，接口路径前缀 `/api/v1/`，`multipart/form-data`，UTF-8。
- 店铺名精确为 `LUWAG- PH`（含空格），所有请求必须显式带 `shop`，禁止依赖默认店铺。
- 仓库 `PH-DAVAO-01` / `warehouseId` `71537`；物流编码 `SHIPDOC-STD`。
- 币种 `PHP`；支付方式 `COD`；`codPayAmount` = 订单 `grandTotal`（4 位小数）。
- COD 单 `payTime` 取 `order.createdAt`，格式 `YYYY-MM-DD HH:MM:SS+08:00`。
- 签名：除 `sign` 外参数按参数名 ASCII 升序拼 `k=v`，末尾**直接拼** `appSecret`，MD5 小写 32 位。**官方文档 §1.1.4 的示例签名 `b3dfeed4…` 与本算法不符，以线上实测为准，不要拿文档示例当测试向量。**
- `QIANYI_ENABLED` 默认 `false`；关着的时候不产生任何外部请求。
- `skuList[].sku` 只能取 `Sku.qianyiSkuCode`；**没有映射就不推单**，不做任何编码回退。
- Webhook 路径 `/api/v1/qianyi/webhook`（全局前缀 `api/v1`）。
- 金额计算全程十进制，不走浮点；分账尾差给最后一行。
- 不新增运行时依赖（multipart 解析走 `@nestjs/platform-express` 自带的 multer 2.2.0）。

## Review Focus

1. 千易 HTTP 200 但 `state=failure`（`errorCode` 非 `0`）——必须判为业务失败并留在队列重试，绝不能记成 `SENT`。
2. `bizParam` 里的中文商品名、手机号、`+08:00` 时间在 multipart 传输中被二次编码——签名用的必须是发给千易的那一个字符串。
3. 同一回调重复到达，或 `PUSH_ODO_ORDER` 先于 `PUSH_SALES_ORDER_SHIPPING_INFO` 到达——不能重复扣库存、不能丢运单号。
4. 千易少发/部分发货——订单不能整单标成 `SHIPPING`，库存不能按原数量扣。
5. 运费与折扣分摊的尾差——`skuList[].payAmount` 之和必须精确等于 `grandTotal`。

---

### Task 1: 配置与模块骨架

**Files:**
- Modify: `backend/src/config/env.validation.ts`（`META_CAPI_API_VERSION` 之后）
- Modify: `backend/src/config/configuration.ts`（`meta:` 块之后）
- Create: `backend/src/modules/qianyi/qianyi.config.ts`
- Create: `backend/src/modules/qianyi/qianyi.config.spec.ts`
- Create: `backend/src/modules/qianyi/qianyi.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `QianyiConfig`（`{ enabled, baseUrl, appId, secret, shop, warehouseId, warehouse, logistics }`）、`readQianyiConfig(config: ConfigService): QianyiConfig`、`QianyiModule`。

- [ ] **Step 1: 写失败测试**

`backend/src/modules/qianyi/qianyi.config.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { readQianyiConfig } from './qianyi.config.js';

function configOf(values: Record<string, unknown>): ConfigService {
  return new ConfigService(values);
}

const COMPLETE = {
  qianyi: {
    enabled: 'true',
    appId: '1793177155241-8695',
    appSecret: 'x'.repeat(32),
    shop: 'LUWAG- PH',
    warehouseId: 71537,
    warehouse: 'PH-DAVAO-01',
    logistics: 'SHIPDOC-STD',
  },
};

describe('readQianyiConfig', () => {
  it('stays disabled when nothing is configured', () => {
    expect(readQianyiConfig(configOf({})).enabled).toBe(false);
  });

  it('is enabled once every required value and the flag are present', () => {
    const config = readQianyiConfig(configOf(COMPLETE));
    expect(config.enabled).toBe(true);
    expect(config.shop).toBe('LUWAG- PH');
    expect(config.warehouseId).toBe(71537);
    expect(config.baseUrl).toBe('https://www.qianyierp.com');
  });

  it('refuses to enable when the flag is on but a value is missing', () => {
    const config = readQianyiConfig(
      configOf({ qianyi: { ...COMPLETE.qianyi, warehouseId: 0 } }),
    );
    expect(config.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi.config.spec.ts`
Expected: FAIL —— `Cannot find module './qianyi.config.js'`

- [ ] **Step 3: 实现配置读取**

`backend/src/modules/qianyi/qianyi.config.ts`：

```ts
import { ConfigService } from '@nestjs/config';

/**
 * Everything the Qianyi integration needs, read from the validated env tree
 * (`qianyi.*` in configuration.ts). `enabled` is derived, never trusted on its
 * own: a half-configured integration must stay off rather than fire requests
 * with an empty secret.
 */
export interface QianyiConfig {
  enabled: boolean;
  baseUrl: string;
  appId: string;
  secret: string;
  shop: string;
  warehouseId: number;
  warehouse: string;
  logistics: string;
}

export function readQianyiConfig(config: ConfigService): QianyiConfig {
  const appId = config.get<string>('qianyi.appId') ?? '';
  const secret = config.get<string>('qianyi.appSecret') ?? '';
  const shop = config.get<string>('qianyi.shop') ?? '';
  const warehouseId = config.get<number>('qianyi.warehouseId') ?? 0;
  const warehouse = config.get<string>('qianyi.warehouse') ?? '';
  const logistics = config.get<string>('qianyi.logistics') ?? '';
  const flag = config.get<string>('qianyi.enabled') ?? 'false';
  const complete = Boolean(
    appId && secret && shop && warehouseId > 0 && warehouse && logistics,
  );
  return {
    enabled: flag === 'true' && complete,
    baseUrl: config.get<string>('qianyi.baseUrl') ?? 'https://www.qianyierp.com',
    appId,
    secret,
    shop,
    warehouseId,
    warehouse,
    logistics,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi.config.spec.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 加环境变量校验**

在 `backend/src/config/env.validation.ts` 的 `META_CAPI_API_VERSION` 之后插入：

```ts
  // Qianyi ERP. Every value is optional so an unconfigured deployment boots
  // unchanged; the superRefine below refuses a half-configured switch-on.
  QIANYI_ENABLED: z.preprocess(blankAsUndefined, z.enum(['true', 'false']).optional()),
  QIANYI_BASE_URL: z.preprocess(blankAsUndefined, z.string().url().optional()),
  QIANYI_APP_ID: z.preprocess(blankAsUndefined, z.string().min(8).optional()),
  QIANYI_APP_SECRET: z.preprocess(blankAsUndefined, z.string().min(20).optional()),
  QIANYI_SHOP: z.preprocess(blankAsUndefined, z.string().min(1).max(100).optional()),
  QIANYI_WAREHOUSE_ID: z.preprocess(
    blankAsUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  QIANYI_WAREHOUSE: z.preprocess(blankAsUndefined, z.string().min(1).max(100).optional()),
  QIANYI_LOGISTICS: z.preprocess(blankAsUndefined, z.string().min(1).max(100).optional()),
```

并在同一个 `superRefine` 里追加：

```ts
  if (env.QIANYI_ENABLED === 'true') {
    const required = [
      'QIANYI_APP_ID',
      'QIANYI_APP_SECRET',
      'QIANYI_SHOP',
      'QIANYI_WAREHOUSE_ID',
      'QIANYI_WAREHOUSE',
      'QIANYI_LOGISTICS',
    ] as const;
    for (const key of required) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when QIANYI_ENABLED is true`,
        });
      }
    }
  }
```

- [ ] **Step 6: 加配置树**

在 `backend/src/config/configuration.ts` 的 `meta:` 块之后插入：

```ts
    // Qianyi ERP order integration. Empty values keep it switched off.
    qianyi: {
      enabled: env.QIANYI_ENABLED ?? 'false',
      baseUrl: env.QIANYI_BASE_URL ?? 'https://www.qianyierp.com',
      appId: env.QIANYI_APP_ID ?? '',
      appSecret: env.QIANYI_APP_SECRET ?? '',
      shop: env.QIANYI_SHOP ?? '',
      warehouseId: env.QIANYI_WAREHOUSE_ID ?? 0,
      warehouse: env.QIANYI_WAREHOUSE ?? '',
      logistics: env.QIANYI_LOGISTICS ?? '',
    },
```

- [ ] **Step 7: 建模块骨架并注册**

`backend/src/modules/qianyi/qianyi.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class QianyiModule {}
```

在 `backend/src/app.module.ts` 的 imports 列表里 `MetaCapiModule` 之后加 `QianyiModule,`，并在顶部 import 区加：

```ts
import { QianyiModule } from './modules/qianyi/qianyi.module.js';
```

- [ ] **Step 8: 验证整树可编译**

Run: `cd backend && pnpm exec prisma generate && pnpm build`
Expected: 退出码 0，无 TS 错误

- [ ] **Step 9: 提交**

```bash
git add backend/src/modules/qianyi backend/src/config backend/src/app.module.ts
git commit -m "feat(qianyi): config tree, env validation and module skeleton"
```

---

### Task 2: 签名与客户端

**Files:**
- Create: `backend/src/modules/qianyi/qianyi.client.ts`
- Create: `backend/src/modules/qianyi/qianyi.client.spec.ts`

**Interfaces:**
- Consumes: `QianyiConfig` / `readQianyiConfig`（Task 1）
- Produces: `signQianyiRequest(params, secret): string`、`class QianyiClient { get enabled(); call(serviceType, path, bizParam): Promise<unknown> }`、`class QianyiError extends Error { readonly errorCode: string }`

- [ ] **Step 1: 写失败测试**

`backend/src/modules/qianyi/qianyi.client.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { QianyiClient, QianyiError, signQianyiRequest } from './qianyi.client.js';

const ENV = {
  qianyi: {
    enabled: 'true',
    baseUrl: 'https://www.qianyierp.com',
    appId: '1793-test',
    appSecret: 's3cr3t-value',
    shop: 'LUWAG- PH',
    warehouseId: 71537,
    warehouse: 'PH-DAVAO-01',
    logistics: 'SHIPDOC-STD',
  },
};

function clientWith(fetchImpl: typeof fetch) {
  return new QianyiClient(new ConfigService(ENV), fetchImpl);
}

describe('signQianyiRequest', () => {
  it('matches the vector verified against the live API', () => {
    expect(
      signQianyiRequest(
        {
          appId: '1793-test',
          bizParam: '{"page":1,"pageSize":50}',
          serviceType: 'QUERY_SHOP_LIST',
          timestamp: '1700000000000',
        },
        's3cr3t-value',
      ),
    ).toBe('bbbf0ed3fb32e295330140ef2903713b');
  });

  it('sees the whole secret, not a truncated prefix', () => {
    const a = signQianyiRequest(
      { appId: 'a', bizParam: '{}', serviceType: 'S', timestamp: '1' },
      'secret-1',
    );
    const b = signQianyiRequest(
      { appId: 'a', bizParam: '{}', serviceType: 'S', timestamp: '1' },
      'secret-2',
    );
    expect(a).not.toBe(b);
  });
});

describe('QianyiClient.call', () => {
  it('returns result when the business call succeeds', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ state: 'success', errorCode: '', result: [{ id: 1 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('QUERY_SHOP_LIST', 'shop', { page: 1 })).resolves.toEqual([
      { id: 1 },
    ]);
  });

  it('treats HTTP 200 with state=failure as a business failure', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ state: 'failure', errorCode: 'AUTH_001', errorMsg: '签名验证失败' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('QUERY_SHOP_LIST', 'shop', { page: 1 })).rejects.toMatchObject(
      { errorCode: 'AUTH_001' },
    );
  });

  it('sends the signed multipart fields the API expects', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ state: 'success', errorCode: '', result: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await clientWith(fetchImpl).call('QUERY_SHOP_LIST', 'shop', { page: 1, pageSize: 50 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://www.qianyierp.com/api/v1/shop');
    const form = init.body as FormData;
    expect(form.get('appId')).toBe('1793-test');
    expect(form.get('serviceType')).toBe('QUERY_SHOP_LIST');
    expect(form.get('bizParam')).toBe('{"page":1,"pageSize":50}');
    expect(String(form.get('sign'))).toHaveLength(32);
  });

  it('rethrows transport failures as QianyiError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).call('QUERY_SHOP_LIST', 'shop', {})).rejects.toBeInstanceOf(
      QianyiError,
    );
  });

  it('refuses to call while disabled', async () => {
    const client = new QianyiClient(new ConfigService({}), vi.fn() as unknown as typeof fetch);
    await expect(client.call('QUERY_SHOP_LIST', 'shop', {})).rejects.toMatchObject({
      errorCode: 'DISABLED',
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi.client.spec.ts`
Expected: FAIL —— 找不到 `./qianyi.client.js`

- [ ] **Step 3: 实现客户端**

`backend/src/modules/qianyi/qianyi.client.ts`：

```ts
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';

export interface QianyiResponse {
  state?: string;
  errorCode?: string;
  errorMsg?: string;
  result?: unknown;
}

/** Business failure returned by Qianyi, or a transport/parse failure. */
export class QianyiError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
  ) {
    super(message);
    this.name = 'QianyiError';
  }
}

export interface QianyiSignatureInput {
  appId: string;
  bizParam: string;
  serviceType: string;
  timestamp: string;
}

/**
 * MD5 over `appId=…bizParam=…serviceType=…timestamp=…` with the secret appended
 * raw (no `=`), keys in ASCII order. Verified against the live API: the
 * figures printed in the published doc's §1.1.4 example do not reproduce, so
 * that example is not a usable test vector.
 *
 * The `bizParam` value here must be the exact string handed to the HTTP layer.
 */
export function signQianyiRequest(
  params: QianyiSignatureInput,
  secret: string,
): string {
  const base =
    `appId=${params.appId}` +
    `bizParam=${params.bizParam}` +
    `serviceType=${params.serviceType}` +
    `timestamp=${params.timestamp}`;
  return createHash('md5').update(base + secret, 'utf8').digest('hex');
}

/**
 * The only place that knows the Qianyi wire protocol. One method, one path per
 * module (`shop`, `warehouse`, `salesOrder`, `sku`, `firstLeg`).
 */
@Injectable()
export class QianyiClient {
  private readonly logger = new Logger(QianyiClient.name);
  private readonly config: QianyiConfig;

  constructor(
    config: ConfigService,
    // Not a provider: optional keeps Nest from resolving it, and the default
    // applies so tests can still inject a fake fetch.
    @Optional() private readonly request: typeof fetch = fetch,
  ) {
    this.config = readQianyiConfig(config);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async call(
    serviceType: string,
    path: string,
    bizParam: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.config.enabled) {
      throw new QianyiError('Qianyi integration is disabled', 'DISABLED');
    }
    const timestamp = String(Date.now());
    const json = JSON.stringify(bizParam);
    const sign = signQianyiRequest(
      {
        appId: this.config.appId,
        bizParam: json,
        serviceType,
        timestamp,
      },
      this.config.secret,
    );

    const form = new FormData();
    form.set('appId', this.config.appId);
    form.set('bizParam', json);
    form.set('serviceType', serviceType);
    form.set('timestamp', timestamp);
    form.set('sign', sign);

    let response: Response;
    try {
      response = await this.request(
        `${this.config.baseUrl}/api/v1/${path}`,
        { method: 'POST', body: form, signal: AbortSignal.timeout(20_000) },
      );
    } catch (error) {
      throw new QianyiError(
        `Qianyi request failed: ${(error as Error).message}`,
        'TRANSPORT',
      );
    }

    const text = await response.text();
    let parsed: QianyiResponse;
    try {
      parsed = JSON.parse(text) as QianyiResponse;
    } catch {
      throw new QianyiError(
        `Qianyi returned a non-JSON body (HTTP ${response.status})`,
        'NON_JSON',
      );
    }

    const ok = parsed.state === 'success' || String(parsed.errorCode ?? '') === '0';
    if (!ok) {
      // HTTP 200 does not mean success here; the business code decides.
      this.logger.warn(
        `qianyi ${serviceType} failed: ${parsed.errorCode} ${parsed.errorMsg ?? ''}`,
      );
      throw new QianyiError(
        parsed.errorMsg || `Qianyi error ${parsed.errorCode ?? 'UNKNOWN'}`,
        parsed.errorCode ?? 'UNKNOWN',
      );
    }
    return parsed.result ?? null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi.client.spec.ts`
Expected: PASS（6 个用例）

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/qianyi/qianyi.client.ts backend/src/modules/qianyi/qianyi.client.spec.ts
git commit -m "feat(qianyi): signing and multipart client"
```

---

### Task 3: 数据模型与迁移

**Files:**
- Create: `backend/prisma/schema/qianyi.prisma`
- Modify: `backend/prisma/schema/order.prisma`（`Order` 加 `qianyiJobs`；`Shipment` 加两列）
- Modify: `backend/prisma/schema/catalog.prisma`（`Sku` 加 `qianyiSkuCode`）
- Create: `backend/prisma/migrations/20261028120000_add_qianyi_order_sync/migration.sql`

**Interfaces:**
- Produces: Prisma models `QianyiSyncJob` / `QianyiWebhookEvent`、枚举 `QianyiSyncKind` / `QianyiSyncStatus`、字段 `Sku.qianyiSkuCode`、`Order.qianyiOrderNumber`、`Shipment.qianyiOutboundNumber` / `Shipment.qianyiStatus`。
- 轨迹不建新表：复用 `LogisticsEvent.shipmentId + externalEventId` 幂等键。

- [ ] **Step 1: 写 schema**

`backend/prisma/schema/qianyi.prisma`：

```prisma
// Qianyi ERP order sync.
//
// Orders leave for Qianyi through a transactional outbox: the job row is
// written inside the same transaction that confirms the order, then a small
// in-process worker delivers it with retries. Nothing is pushed unless the
// SKU carries a `qianyiSkuCode` mapping.
//
// Callbacks are archived verbatim in `qianyi_webhook_events` before dispatch so
// a rejected signature or an unknown service type is still inspectable.

enum QianyiSyncKind {
  PUSH_ORDER
  CLOSE_ORDER
}

enum QianyiSyncStatus {
  PENDING
  SENT
  FAILED
  SKIPPED
}

model QianyiSyncJob {
  id                  String            @id @default(uuid(7)) @db.Uuid
  orderId             String            @map("order_id") @db.Uuid
  kind                QianyiSyncKind
  status              QianyiSyncStatus @default(PENDING)
  attempts            Int               @default(0)
  nextAttemptAt       DateTime          @default(now()) @map("next_attempt_at") @db.Timestamptz(3)
  lastError           String?           @map("last_error") @db.VarChar(1024)
  requestPayload      Json              @map("request_payload")
  responsePayload     Json?             @map("response_payload")
  externalOrderNumber String?           @map("external_order_number") @db.VarChar(64)
  createdAt           DateTime          @default(now()) @map("created_at") @db.Timestamptz(3)
  sentAt              DateTime?         @map("sent_at") @db.Timestamptz(3)
  updatedAt           DateTime          @updatedAt @map("updated_at") @db.Timestamptz(3)

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([orderId, kind])
  @@index([status, nextAttemptAt])
  @@map("qianyi_sync_jobs")
}

model QianyiWebhookEvent {
  id           String    @id @default(uuid(7)) @db.Uuid
  serviceType  String    @map("service_type") @db.VarChar(60)
  signValid    Boolean   @default(false) @map("sign_valid")
  /// `serviceType` + 业务主键 + 状态，重复回调靠它去重。
  externalKey  String    @map("external_key") @db.VarChar(200)
  payload      Json
  error        String?   @db.VarChar(1024)
  processedAt  DateTime? @map("processed_at") @db.Timestamptz(3)
  receivedAt   DateTime  @default(now()) @map("received_at") @db.Timestamptz(3)

  @@unique([externalKey])
  @@index([receivedAt])
  @@map("qianyi_webhook_events")
}
```

- [ ] **Step 2: 补既有模型的列与关系**

`backend/prisma/schema/order.prisma`，`Order` 模型的关系区（`promoRedemption` 之后）加一行：

```prisma
  qianyiJobs     QianyiSyncJob[]
```

`Order` 字段区（`trackingSessionId` 之后）加：

```prisma
  /// Qianyi system order number (S…), learned from the push response.
  qianyiOrderNumber    String?   @map("qianyi_order_number") @db.VarChar(64)
```

`Shipment` 字段区（`trackingNumber` 之后）加：

```prisma
  qianyiOutboundNumber String? @map("qianyi_outbound_number") @db.VarChar(64)
  qianyiStatus         String? @map("qianyi_status") @db.VarChar(40)
```

`backend/prisma/schema/catalog.prisma`，`Sku` 的 `supplierSku` 之后加：

```prisma
  /// Qianyi product code. Required before an order line may be pushed; there
  /// is deliberately no fallback to `skuCode` (the catalogues do not overlap).
  qianyiSkuCode   String?   @map("qianyi_sku_code") @db.VarChar(255)
```

- [ ] **Step 3: 写迁移 SQL**

`backend/prisma/migrations/20261028120000_add_qianyi_order_sync/migration.sql`：

```sql
-- Qianyi ERP order sync: outbox, webhook archive and the mapping columns.
-- Additive only; nothing existing is rewritten.

CREATE TYPE "QianyiSyncKind" AS ENUM ('PUSH_ORDER', 'CLOSE_ORDER');
CREATE TYPE "QianyiSyncStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "skus" ADD COLUMN "qianyi_sku_code" VARCHAR(255);
ALTER TABLE "orders" ADD COLUMN "qianyi_order_number" VARCHAR(64);
ALTER TABLE "shipments" ADD COLUMN "qianyi_outbound_number" VARCHAR(64);
ALTER TABLE "shipments" ADD COLUMN "qianyi_status" VARCHAR(40);

CREATE TABLE "qianyi_sync_jobs" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" "QianyiSyncKind" NOT NULL,
    "status" "QianyiSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(1024),
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "external_order_number" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "qianyi_sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "qianyi_webhook_events" (
    "id" UUID NOT NULL,
    "service_type" VARCHAR(60) NOT NULL,
    "sign_valid" BOOLEAN NOT NULL DEFAULT false,
    "external_key" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "error" VARCHAR(1024),
    "processed_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "qianyi_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "qianyi_sync_jobs_order_id_kind_key"
    ON "qianyi_sync_jobs"("order_id", "kind");
CREATE INDEX "qianyi_sync_jobs_status_next_attempt_at_idx"
    ON "qianyi_sync_jobs"("status", "next_attempt_at");
CREATE UNIQUE INDEX "qianyi_webhook_events_external_key_key"
    ON "qianyi_webhook_events"("external_key");
CREATE INDEX "qianyi_webhook_events_received_at_idx"
    ON "qianyi_webhook_events"("received_at");

ALTER TABLE "qianyi_sync_jobs"
    ADD CONSTRAINT "qianyi_sync_jobs_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: 生成 client 并验证 schema**

Run: `cd backend && pnpm exec prisma validate && pnpm exec prisma generate && pnpm build`
Expected: 三步都退出 0；`src/generated/prisma` 里能搜到 `qianyiSkuCode`

- [ ] **Step 5: 在本地开发库试跑迁移**

Run: `cd backend && pnpm exec prisma migrate deploy`
Expected: 输出包含 `Applying migration 20261028120000_add_qianyi_order_sync`；如果本机连的是已迁移的开发库，重复执行应显示 “No pending migrations”

- [ ] **Step 6: 提交**

```bash
git add backend/prisma/schema backend/prisma/migrations/20261028120000_add_qianyi_order_sync
git commit -m "feat(qianyi): outbox, webhook archive and mapping columns"
```

---

### Task 4: 订单报文映射

**Files:**
- Create: `backend/src/modules/qianyi/qianyi-order.mapper.ts`
- Create: `backend/src/modules/qianyi/qianyi-order.mapper.spec.ts`

**Interfaces:**
- Produces: `buildCreateOrderPayload(order: QianyiOrderSource, config: QianyiMapperConfig): Record<string, unknown>`、`MissingMappingError`（列出缺映射的 `skuCode`）

- [ ] **Step 1: 写失败测试**

`backend/src/modules/qianyi/qianyi-order.mapper.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildCreateOrderPayload, MissingMappingError } from './qianyi-order.mapper.js';

const CONFIG = {
  shop: 'LUWAG- PH',
  warehouseId: 71537,
  warehouse: 'PH-DAVAO-01',
  logistics: 'SHIPDOC-STD',
};

const BASE_ORDER = {
  orderNumber: 'PH100012',
  currency: 'PHP',
  subtotal: '2999.00',
  shippingTotal: '0.00',
  discountTotal: '400.00',
  grandTotal: '2599.00',
  customerNote: 'Please call before delivery',
  createdAt: new Date('2026-10-28T02:30:00.000Z'),
  customer: { email: 'buyer@example.com', name: 'Maria Cruz' },
  shippingAddress: {
    recipientName: 'Maria Cruz',
    phone: '639171234567',
    province: 'Metro Manila',
    city: 'Quezon City',
    district: 'Culiat',
    street: null,
    addressLine1: '12 Sampaguita St',
    postCode: '1128',
    landmark: null,
    country: 'PH',
  },
  items: [
    {
      skuCodeSnapshot: 'TB001-Wa',
      quantity: 1,
      unitPrice: '2999.00',
      discountTotal: '400.00',
      sku: { skuCode: 'TB001-Wa', qianyiSkuCode: 'YD003760CMHT' },
    },
    {
      skuCodeSnapshot: 'SH-STOOL-001',
      quantity: 2,
      unitPrice: '499.00',
      discountTotal: '0.00',
      sku: { skuCode: 'SH-STOOL-001', qianyiSkuCode: 'A0229BU' },
    },
  ],
};

describe('buildCreateOrderPayload', () => {
  it('maps a COD order onto the documented fields', () => {
    const payload = buildCreateOrderPayload(BASE_ORDER as never, CONFIG) as Record<string, any>;
    expect(payload.shop).toBe('LUWAG- PH');
    expect(payload.onlineOrderNumber).toBe('PH100012');
    expect(payload.paymentMethod).toBe('COD');
    expect(payload.currency).toBe('PHP');
    expect(payload.warehouse).toBe('PH-DAVAO-01');
    expect(payload.warehouseId).toBe(71537);
    expect(payload.logistics).toBe('SHIPDOC-STD');
    expect(payload.payTime).toBe('2026-10-28 10:30:00+08:00');
    expect((payload.buyer as Record<string, string>).receiverName).toBe('Maria Cruz');
    expect((payload.buyer as Record<string, string>).country).toBe('PH');
  });

  it('splits the total so the line amounts add up exactly', () => {
    const payload = buildCreateOrderPayload(BASE_ORDER as never, CONFIG) as Record<string, any>;
    const lines = payload.skuList as Array<Record<string, string | number>>;
    const sum = lines.reduce((acc, line) => acc + Math.round(Number(line.payAmount) * 100), 0);
    expect(sum).toBe(259900);
    expect(payload.codPayAmount).toBe('2599.0000');
  });

  it('puts an uneven freight remainder on the last line, never floating', () => {
    const order = {
      ...BASE_ORDER,
      shippingTotal: '100.00',
      items: [
        { ...BASE_ORDER.items[0], quantity: 1, unitPrice: '100.00' },
        { ...BASE_ORDER.items[1], quantity: 2, unitPrice: '100.00' },
      ],
      grandTotal: '400.00',
    };
    const payload = buildCreateOrderPayload(order as never, CONFIG) as Record<string, any>;
    const lines = payload.skuList as Array<Record<string, string>>;
    expect(lines.map((l) => l.shippingPrice)).toEqual(['33.3333', '66.6667']);
  });

  it('refuses to build when a line has no Qianyi code', () => {
    const order = {
      ...BASE_ORDER,
      items: [{ ...BASE_ORDER.items[0], sku: { skuCode: 'TB001-Wa', qianyiSkuCode: null } }],
    };
    expect(() => buildCreateOrderPayload(order as never, CONFIG)).toThrow(MissingMappingError);
  });

  it('never falls back to the store skuCode', () => {
    const order = {
      ...BASE_ORDER,
      items: [{ ...BASE_ORDER.items[0], sku: { skuCode: 'TB001-Wa', qianyiSkuCode: '  ' } }],
    };
    expect(() => buildCreateOrderPayload(order as never, CONFIG)).toThrow(MissingMappingError);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-order.mapper.spec.ts`
Expected: FAIL —— 找不到 `./qianyi-order.mapper.js`

- [ ] **Step 3: 实现映射**

`backend/src/modules/qianyi/qianyi-order.mapper.ts`：

```ts
/**
 * Pure mapping from our order shape to `CREATE_AND_AUDIT_SALES_ORDER`.
 *
 * Money never becomes a float: every amount is handled as integer cents and
 * only rendered as a 4-decimal string at the boundary, so the line amounts
 * always add up to the order total.
 */

export class MissingMappingError extends Error {
  constructor(readonly skuCodes: string[]) {
    super(
      `No Qianyi code for ${skuCodes.join(', ')}. Map the SKU before pushing the order.`,
    );
    this.name = 'MissingMappingError';
  }
}

export interface QianyiMapperConfig {
  shop: string;
  warehouseId: number;
  warehouse: string;
  logistics: string;
}

interface MapperLine {
  skuCodeSnapshot: string;
  quantity: number;
  unitPrice: string | { toString(): string };
  discountTotal: string | { toString(): string };
  sku?: { skuCode: string; qianyiSkuCode: string | null } | null;
}

interface MapperAddress {
  recipientName: string;
  phone: string | null;
  province: string;
  city: string;
  district: string | null;
  street: string | null;
  addressLine1: string;
  postCode: string;
  landmark: string | null;
  country: string;
}

export interface QianyiOrderSource {
  orderNumber: string;
  currency: string;
  shippingTotal: string | { toString(): string };
  grandTotal: string | { toString(): string };
  customerNote: string | null;
  createdAt: Date;
  customer: { email: string | null; name: string };
  shippingAddress: MapperAddress | null;
  items: MapperLine[];
}

const toCents = (value: string | { toString(): string }): bigint =>
  BigInt(Math.round(Number(value.toString()) * 100));

const fromCents = (cents: bigint): string => {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(2, '0')}0000`;
};

/** Splits `total` across `weights`, giving the remainder to the last slice. */
function allocate(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((acc, w) => acc + w, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const out: bigint[] = [];
  let allocated = 0n;
  weights.forEach((weight, index) => {
    if (index === weights.length - 1) {
      out.push(total - allocated);
      return;
    }
    const share = (total * weight) / sum;
    out.push(share);
    allocated += share;
  });
  return out;
}

/** `+08:00` is what the documented `payTime` format expects. */
function formatPhTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}+08:00`;
}

export function buildCreateOrderPayload(
  order: QianyiOrderSource,
  config: QianyiMapperConfig,
): Record<string, unknown> {
  const missing = order.items
    .filter((item) => !item.sku?.qianyiSkuCode?.trim())
    .map((item) => item.sku?.skuCode ?? item.skuCodeSnapshot);
  if (missing.length > 0) throw new MissingMappingError(missing);

  const address = order.shippingAddress;
  const lineTotals = order.items.map((item) => toCents(item.unitPrice) * BigInt(item.quantity));
  const shippingShares = allocate(toCents(order.shippingTotal), lineTotals);
  const codTotal = toCents(order.grandTotal);

  // The order-level freight is the source of truth; line shipping shares only
  // explain how it was distributed, so the last line absorbs the rounding.
  let shippedSoFar = 0n;
  const skuList = order.items.map((item, index) => {
    const lineTotal = lineTotals[index];
    const shippingShare =
      index === order.items.length - 1
        ? toCents(order.shippingTotal) - shippedSoFar
        : shippingShares[index];
    shippedSoFar += shippingShare;
    return {
      sku: item.sku!.qianyiSkuCode!.trim(),
      quantity: item.quantity,
      paymentPrice: fromCents(toCents(item.unitPrice)),
      shippingPrice: fromCents(shippingShare),
      payAmount: fromCents(lineTotal + shippingShare),
      promotionDiscount: fromCents(toCents(item.discountTotal)),
      originalPrice: fromCents(toCents(item.unitPrice)),
    };
  });

  return {
    shop: config.shop,
    onlineOrderNumber: order.orderNumber,
    paymentMethod: 'COD',
    codPayAmount: fromCents(codTotal),
    freight: fromCents(toCents(order.shippingTotal)),
    currency: order.currency,
    buyerMessage: order.customerNote?.slice(0, 1024) ?? undefined,
    // COD has no payment moment, so the order time is the agreed stand-in.
    payTime: formatPhTime(order.createdAt),
    warehouse: config.warehouse,
    warehouseId: config.warehouseId,
    logistics: config.logistics,
    buyer: {
      receiverName: address?.recipientName ?? order.customer.name,
      phone: address?.phone ?? undefined,
      email: order.customer.email ?? undefined,
      country: address?.country ?? 'PH',
      province: address?.province ?? '',
      city: address?.city ?? '',
      district: address?.district ?? undefined,
      street: address?.street ?? undefined,
      address1: address?.addressLine1 ?? '',
      postCode: address?.postCode ?? '',
    },
    skuList,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-order.mapper.spec.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/qianyi/qianyi-order.mapper.ts backend/src/modules/qianyi/qianyi-order.mapper.spec.ts
git commit -m "feat(qianyi): map orders onto the create-and-audit payload"
```

---

### Task 5: Outbox 服务

**Files:**
- Create: `backend/src/modules/qianyi/qianyi-sync.service.ts`
- Create: `backend/src/modules/qianyi/qianyi-sync.service.spec.ts`

**Interfaces:**
- Consumes: `QianyiClient`（Task 2）、`buildCreateOrderPayload`（Task 4）、Prisma models（Task 3）
- Produces: `enqueue(tx, kind, orderId)`、`processPending(now?)`、`health()`、`retry(jobId)`

- [ ] **Step 1: 写失败测试**

`backend/src/modules/qianyi/qianyi-sync.service.spec.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { QianyiError } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';

const CONFIG = new ConfigService({
  qianyi: {
    enabled: 'true',
    appId: '1793-test',
    appSecret: 's3cr3t-value',
    shop: 'LUWAG- PH',
    warehouseId: 71537,
    warehouse: 'PH-DAVAO-01',
    logistics: 'SHIPDOC-STD',
  },
});

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    orderId: 'order-1',
    kind: 'PUSH_ORDER',
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: new Date('2026-10-28T00:00:00Z'),
    lastError: null,
    requestPayload: { onlineOrderNumber: 'PH100012' },
    responsePayload: null,
    externalOrderNumber: null,
    ...overrides,
  };
}

function prismaWith(jobs: ReturnType<typeof job>[]) {
  return {
    qianyiSyncJob: {
      findMany: vi.fn(async () => jobs),
      update: vi.fn(async () => undefined),
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => jobs[0]),
    },
    order: { update: vi.fn(async () => undefined) },
  };
}

describe('QianyiSyncService.processPending', () => {
  const client = {
    enabled: true,
    call: vi.fn(),
  };

  beforeEach(() => client.call.mockReset());

  it('marks a delivered job SENT and stores the Qianyi order number', async () => {
    const prisma = prismaWith([job()]);
    client.call.mockResolvedValue({ orderNumber: 'S2610288955080' });
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    await service.processPending(new Date('2026-10-28T01:00:00Z'));

    expect(client.call).toHaveBeenCalledWith(
      'CREATE_AND_AUDIT_SALES_ORDER',
      'salesOrder',
      expect.objectContaining({ onlineOrderNumber: 'PH100012' }),
    );
    const update = prisma.qianyiSyncJob.update.mock.calls[0][0];
    expect(update.data.status).toBe('SENT');
    expect(update.data.externalOrderNumber).toBe('S2610288955080');
  });

  it('keeps a business failure pending and backs off', async () => {
    const prisma = prismaWith([job()]);
    client.call.mockRejectedValue(new QianyiError('权限不足', 'SERVICE_TYPE_NOT_ALLOW'));
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    await service.processPending(new Date('2026-10-28T01:00:00Z'));

    const update = prisma.qianyiSyncJob.update.mock.calls[0][0];
    expect(update.data.status).toBe('PENDING');
    expect(update.data.attempts).toEqual({ increment: 1 });
    expect(update.data.lastError).toContain('SERVICE_TYPE_NOT_ALLOW');
  });

  it('gives up after the fifth attempt', async () => {
    const prisma = prismaWith([job({ attempts: 4 })]);
    client.call.mockRejectedValue(new QianyiError('boom', 'TRANSPORT'));
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    await service.processPending(new Date('2026-10-28T01:00:00Z'));

    expect(prisma.qianyiSyncJob.update.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('does nothing while the integration is disabled', async () => {
    const prisma = prismaWith([job()]);
    const service = new QianyiSyncService(
      prisma as never,
      { enabled: false, call: vi.fn() } as never,
      CONFIG,
    );
    expect(await service.processPending()).toBe(0);
    expect(prisma.qianyiSyncJob.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-sync.service.spec.ts`
Expected: FAIL —— 找不到 `./qianyi-sync.service.js`

- [ ] **Step 3: 实现 outbox**

`backend/src/modules/qianyi/qianyi-sync.service.ts`：

```ts
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QianyiClient } from './qianyi.client.js';
import {
  buildCreateOrderPayload,
  MissingMappingError,
  type QianyiOrderSource,
} from './qianyi-order.mapper.js';
import { ConfigService } from '@nestjs/config';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';

const WORKER_INTERVAL_MS = 30_000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MINUTES = [1, 5, 15, 60];
const ORDER_INCLUDE = {
  items: { include: { sku: true } },
  shippingAddress: true,
  customer: true,
} satisfies Prisma.OrderInclude;

/**
 * Durable outbox for everything we send to Qianyi. The row is written inside
 * the caller's transaction, so a confirmed order can never be lost to a
 * network problem; the worker is the only thing that talks to the API.
 */
@Injectable()
export class QianyiSyncService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(QianyiSyncService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly config: QianyiConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: QianyiClient,
    config: ConfigService,
  ) {
    this.config = readQianyiConfig(config);
  }

  onModuleInit(): void {
    if (!this.client.enabled || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.processPending().catch(() => undefined);
    }, WORKER_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Queues the push for a freshly confirmed order. Call inside the tx. */
  async enqueue(
    tx: Prisma.TransactionClient,
    kind: 'PUSH_ORDER' | 'CLOSE_ORDER',
    orderId: string,
  ): Promise<void> {
    if (!this.client.enabled) return;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order) return;

    const { shop, warehouseId, warehouse, logistics } = this.config;
    const payload =
      kind === 'PUSH_ORDER'
        ? buildCreateOrderPayload(order as unknown as QianyiOrderSource, {
            shop,
            warehouseId,
            warehouse,
            logistics,
          })
        : { shop, onlineOrderNumber: order.orderNumber };

    await tx.qianyiSyncJob.upsert({
      where: { orderId_kind: { orderId, kind } },
      create: { orderId, kind, requestPayload: payload as Prisma.InputJsonValue },
      update: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        requestPayload: payload as Prisma.InputJsonValue,
        lastError: null,
      },
    });
  }

  /** Delivers every due job; returns how many were attempted. */
  async processPending(now = new Date()): Promise<number> {
    if (!this.client.enabled || this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.qianyiSyncJob.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        take: BATCH_SIZE,
      });
      for (const job of due) {
        try {
          const result = await this.client.call(
            job.kind === 'PUSH_ORDER' ? 'CREATE_AND_AUDIT_SALES_ORDER' : 'CLOSE_SALES_ORDER',
            'salesOrder',
            job.requestPayload as Record<string, unknown>,
          );
          const external = (result as { orderNumber?: string } | null)?.orderNumber ?? null;
          await this.prisma.qianyiSyncJob.update({
            where: { id: job.id },
            data: {
              status: 'SENT',
              attempts: { increment: 1 },
              sentAt: new Date(),
              lastError: null,
              responsePayload: (result ?? null) as Prisma.InputJsonValue,
              externalOrderNumber: external,
            },
          });
          if (external) {
            await this.prisma.order.update({
              where: { id: job.orderId },
              data: { qianyiOrderNumber: external },
            });
          }
        } catch (error) {
          const attempts = job.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS || error instanceof MissingMappingError;
          const delayMinutes = RETRY_DELAYS_MINUTES[attempts - 1] ?? 60;
          await this.prisma.qianyiSyncJob.update({
            where: { id: job.id },
            data: {
              status: failed ? 'FAILED' : 'PENDING',
              attempts: { increment: 1 },
              nextAttemptAt: failed
                ? job.nextAttemptAt
                : new Date(now.getTime() + delayMinutes * 60_000),
              lastError: (error as Error).message.slice(0, 1024),
            },
          });
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  /** Pulls a FAILED job back into the queue. */
  async retry(jobId: string): Promise<void> {
    await this.prisma.qianyiSyncJob.update({
      where: { id: jobId },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
    void this.processPending().catch(() => undefined);
  }

  async health(): Promise<{
    enabled: boolean;
    pending: number;
    failed: number;
    sent24h: number;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return {
      enabled: this.client.enabled,
      pending: await this.prisma.qianyiSyncJob.count({ where: { status: 'PENDING' } }),
      failed: await this.prisma.qianyiSyncJob.count({ where: { status: 'FAILED' } }),
      sent24h: await this.prisma.qianyiSyncJob.count({
        where: { status: 'SENT', sentAt: { gte: since } },
      }),
    };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-sync.service.spec.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/qianyi/qianyi-sync.service.ts backend/src/modules/qianyi/qianyi-sync.service.spec.ts
git commit -m "feat(qianyi): transactional outbox with retry and health"
```

---

### Task 6: 订单流程挂钩

**Files:**
- Modify: `backend/src/modules/orders/orders.service.ts:（confirm 事务尾部 / cancel 事务尾部）`
- Modify: `backend/src/modules/orders/orders.module.ts`
- Modify: `backend/src/modules/qianyi/qianyi.module.ts`
- Test: `backend/src/modules/orders/orders.service.qianyi.spec.ts`（新建，复用现有 spec 的桩写法）

**Interfaces:**
- Consumes: `QianyiSyncService.enqueue(tx, kind, orderId)`（Task 5）
- Produces: 确认成功即存在 `QianyiSyncJob(PUSH_ORDER)`；取消已推送订单即存在 `CLOSE_ORDER` 任务。

- [ ] **Step 1: 写失败测试**

`backend/src/modules/orders/orders.service.qianyi.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service.js';

/**
 * The point of this spec is ordering, not payload shape: confirming an order
 * must leave a job row inside the SAME transaction, so a rollback cannot leave
 * a ghost push behind.
 */
describe('OrdersService Qianyi hook', () => {
  it('queues the push inside the confirm transaction', async () => {
    const enqueued: string[] = [];
    const qianyi = {
      enqueue: vi.fn(async (_tx: unknown, kind: string) => {
        enqueued.push(kind);
      }),
    };
    const tx = {
      $queryRaw: vi.fn(async () => []),
      order: {
        findUnique: vi.fn(async () => ({
          id: 'order-1',
          orderNumber: 'PH100012',
          orderStatus: 'NEW',
          confirmationStatus: 'UNCONFIRMED',
          customerId: 'cust-1',
          customerClassification: 'NEW',
        })),
        update: vi.fn(async () => ({ id: 'order-1' })),
      },
      orderStatusHistory: { create: vi.fn(async () => undefined) },
      customerRiskLog: { create: vi.fn(async () => undefined) },
      customerNote: { create: vi.fn(async () => undefined) },
      backInStockSubscription: { findMany: vi.fn(async () => []) },
      promoCodeRedemption: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      qianyi as never,
    );

    await service.confirm('order-1', 'user-1');

    expect(enqueued).toEqual(['PUSH_ORDER']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
```

> 实际构造函数参数顺序以 `orders.service.ts` 的 `constructor` 为准；接线时把这个 spec 的参数表补成与现有 `orders.service.spec.ts` 使用的同一套桩。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pnpm vitest run src/modules/orders/orders.service.qianyi.spec.ts`
Expected: FAIL —— `qianyi.enqueue` 未被调用 / 构造函数参数数量不符

- [ ] **Step 3: 注入并调用**

`backend/src/modules/orders/orders.service.ts`：

1. 构造函数加最后一个参数：

```ts
    private readonly qianyi?: QianyiSyncService,
```

2. `confirm()` 的事务里，在 `customerNote` 那段之后、`return updated;` 之前插入：

```ts
      // Push happens through the outbox, inside this transaction: a rolled
      // back confirmation must not leave a queued push behind.
      await this.qianyi?.enqueue(tx, 'PUSH_ORDER', orderId);
```

3. `cancel()` 的事务里，在释放预留之后插入：

```ts
      // Only an order that actually reached Qianyi can be closed there.
      const pushed = await tx.qianyiSyncJob.findUnique({
        where: { orderId_kind: { orderId, kind: 'PUSH_ORDER' } },
      });
      if (pushed?.status === 'SENT') {
        await this.qianyi?.enqueue(tx, 'CLOSE_ORDER', orderId);
      }
```

4. 顶部 import：

```ts
import { QianyiSyncService } from '../qianyi/qianyi-sync.service.js';
```

- [ ] **Step 4: 模块接线**

`backend/src/modules/qianyi/qianyi.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { QianyiClient } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';

@Module({
  imports: [AuthModule],
  providers: [QianyiClient, QianyiSyncService],
  exports: [QianyiClient, QianyiSyncService],
})
export class QianyiModule {}
```

`backend/src/modules/orders/orders.module.ts` 的 `imports` 加 `QianyiModule`。

> `OrdersModule` 与 `QianyiModule` 不互相 import：`QianyiSyncService` 只读订单表，`OrdersService` 只调 `enqueue`，依赖方向单一。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd backend && pnpm vitest run src/modules/orders/orders.service.qianyi.spec.ts src/modules/orders/orders.service.spec.ts`
Expected: 全部 PASS（既有用例不许回归）

- [ ] **Step 6: 提交**

```bash
git add backend/src/modules/orders backend/src/modules/qianyi/qianyi.module.ts
git commit -m "feat(qianyi): enqueue push on confirm and close on cancel"
```

---

### Task 7: Webhook 入口与验签

**Files:**
- Create: `backend/src/modules/qianyi/qianyi-webhook.controller.ts`
- Create: `backend/src/modules/qianyi/qianyi-webhook.service.ts`
- Create: `backend/src/modules/qianyi/qianyi-webhook.service.spec.ts`

**Interfaces:**
- Consumes: `signQianyiRequest`（Task 2）、`QianyiWebhookEvent`（Task 3）
- Produces: `QianyiWebhookService.ingest(fields: QianyiWebhookFields): Promise<{ ok: boolean; duplicated: boolean }>`；控制器 `POST api/v1/qianyi/webhook`

- [ ] **Step 1: 写失败测试**

`backend/src/modules/qianyi/qianyi-webhook.service.spec.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { signQianyiRequest } from './qianyi.client.js';
import { QianyiWebhookService } from './qianyi-webhook.service.js';

const ENV = {
  qianyi: {
    enabled: 'true',
    appId: '1793-test',
    appSecret: 's3cr3t-value',
    shop: 'LUWAG- PH',
    warehouseId: 71537,
    warehouse: 'PH-DAVAO-01',
    logistics: 'SHIPDOC-STD',
  },
};

const BIZ = JSON.stringify({
  orderNumber: 'S2610288955080',
  onlineOrderNumber: 'PH100012',
  trackingNumber: 'TRACK123',
  carrier: 'SHIPDOC',
  status: 'WAIT_SHIP',
  shippingTime: 1754014435000,
});

function signedFields(overrides: Record<string, string> = {}) {
  const timestamp = String(Date.now());
  const fields = {
    appId: '1793-test',
    serviceType: 'PUSH_SALES_ORDER_SHIPPING_INFO',
    bizParam: BIZ,
    timestamp,
    ...overrides,
  };
  return {
    ...fields,
    sign: signQianyiRequest(fields, 's3cr3t-value'),
  };
}

function prismaWith() {
  return {
    qianyiWebhookEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => undefined),
    },
  };
}

describe('QianyiWebhookService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a bad signature without touching business data', async () => {
    const prisma = prismaWith();
    const inbound = { handle: vi.fn() };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    const result = await service.ingest(
      signedFields({ sign: 'f'.repeat(32) }) as never,
    );

    expect(result.ok).toBe(false);
    expect(inbound.handle).not.toHaveBeenCalled();
    expect(prisma.qianyiWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ signValid: false }),
      }),
    );
  });

  it('accepts a valid signature and dispatches once', async () => {
    const prisma = prismaWith();
    const inbound = { handle: vi.fn(async () => undefined) };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    const result = await service.ingest(signedFields() as never);

    expect(result).toEqual({ ok: true, duplicated: false });
    expect(inbound.handle).toHaveBeenCalledWith(
      'PUSH_SALES_ORDER_SHIPPING_INFO',
      expect.objectContaining({ trackingNumber: 'TRACK123' }),
    );
  });

  it('is idempotent on a repeated callback', async () => {
    const prisma = prismaWith();
    (prisma.qianyiWebhookEvent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'seen',
    });
    const inbound = { handle: vi.fn() };
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      inbound as never,
    );

    const result = await service.ingest(signedFields() as never);

    expect(result).toEqual({ ok: true, duplicated: true });
    expect(inbound.handle).not.toHaveBeenCalled();
  });

  it('rejects a stale timestamp', async () => {
    const stale = signedFields({ timestamp: String(Date.now() - 60 * 60 * 1000) });
    const prisma = prismaWith();
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      { handle: vi.fn() } as never,
    );
    await expect(service.ingest(stale as never)).resolves.toEqual({ ok: false, duplicated: false });
  });

  it('archives an unknown service type instead of throwing', async () => {
    const prisma = prismaWith();
    const service = new QianyiWebhookService(
      new ConfigService(ENV),
      prisma as never,
      { handle: vi.fn() } as never,
    );
    const result = await service.ingest(
      signedFields({ serviceType: 'SOMETHING_NEW' }) as never,
    );
    expect(result.ok).toBe(true);
    expect(prisma.qianyiWebhookEvent.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-webhook.service.spec.ts`
Expected: FAIL —— 找不到 `./qianyi-webhook.service.js`

- [ ] **Step 3: 实现验签与分发**

`backend/src/modules/qianyi/qianyi-webhook.service.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { signQianyiRequest } from './qianyi.client.js';
import { readQianyiConfig } from './qianyi.config.js';
import type { QianyiInboundService } from './qianyi-inbound.service.js';

/** 卡片式签名的时间窗；千易重投不会超过这个跨度。 */
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

const HANDLED = new Set([
  'PUSH_ODO_ORDER',
  'PUSH_SALES_ORDER_SHIPPING_INFO',
  'PUSH_TRACKING_PACKAGE',
  'PUSH_RETURN_ORDER_INFO',
]);

export interface QianyiWebhookFields {
  appId: string;
  serviceType: string;
  bizParam: string;
  timestamp: string;
  sign: string;
}

@Injectable()
export class QianyiWebhookService {
  private readonly logger = new Logger(QianyiWebhookService.name);
  private readonly config;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly inbound: QianyiInboundService,
  ) {
    this.config = readQianyiConfig(config);
  }

  async ingest(fields: QianyiWebhookFields): Promise<{ ok: boolean; duplicated: boolean }> {
    const expected = signQianyiRequest(
      {
        appId: fields.appId,
        bizParam: fields.bizParam,
        serviceType: fields.serviceType,
        timestamp: fields.timestamp,
      },
      this.config.secret,
    );
    const skew = Math.abs(Date.now() - Number(fields.timestamp));
    const signValid = expected === fields.sign && Number.isFinite(skew) && skew <= MAX_CLOCK_SKEW_MS;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(fields.bizParam) as Record<string, unknown>;
    } catch {
      payload = { raw: fields.bizParam };
    }

    const externalKey = this.externalKey(fields.serviceType, payload);
    const seen = await this.prisma.qianyiWebhookEvent.findUnique({ where: { externalKey } });

    if (!signValid) {
      await this.prisma.qianyiWebhookEvent.create({
        data: {
          serviceType: fields.serviceType,
          signValid: false,
          externalKey: `${externalKey}:bad-sign:${Date.now()}`,
          payload: payload as Prisma.InputJsonValue,
          error: 'invalid signature or stale timestamp',
        },
      });
      this.logger.warn(`qianyi webhook rejected: ${fields.serviceType}`);
      return { ok: false, duplicated: false };
    }

    if (seen) return { ok: true, duplicated: true };

    await this.prisma.qianyiWebhookEvent.create({
      data: {
        serviceType: fields.serviceType,
        signValid: true,
        externalKey,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    if (!HANDLED.has(fields.serviceType)) {
      // Unknown types are archived and acknowledged: a non-2xx would make
      // Qianyi retry a callback we will never understand.
      return { ok: true, duplicated: false };
    }

    await this.inbound.handle(fields.serviceType, payload);
    await this.prisma.qianyiWebhookEvent.update({
      where: { externalKey },
      data: { processedAt: new Date() },
    });
    return { ok: true, duplicated: false };
  }

  private externalKey(serviceType: string, payload: Record<string, unknown>): string {
    const identity =
      payload.orderNumber ??
      payload.onlineOrderNumber ??
      payload.onlineOrderId ??
      payload.trackingNumber ??
      'unknown';
    const state = payload.status ?? payload.erpStatus ?? '';
    return `${serviceType}:${identity}:${state}`.slice(0, 200);
  }
}
```

- [ ] **Step 4: 实现控制器**

`backend/src/modules/qianyi/qianyi-webhook.controller.ts`：

```ts
import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { QianyiWebhookService } from './qianyi-webhook.service.js';

/**
 * Public callback sink. Accepts both shapes Qianyi uses: multipart/form-data
 * (their default; parsed by the interceptor on the module) and
 * application/x-www-form-urlencoded (Express' built-in parser).
 */
@Controller('qianyi')
export class QianyiWebhookController {
  constructor(private readonly webhooks: QianyiWebhookService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(@Req() request: Request) {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const field = (name: string): string => {
      const value = body[name];
      return typeof value === 'string' ? value : '';
    };
    const result = await this.webhooks.ingest({
      appId: field('appId'),
      serviceType: field('serviceType'),
      bizParam: field('bizParam'),
      timestamp: field('timestamp'),
      sign: field('sign'),
    });
    // Always 200 unless the signature is wrong: Qianyi retries on failure.
    return { ok: result.ok };
  }
}
```

- [ ] **Step 5: 接 multipart 解析**

`qianyi.module.ts` 的 provider 列表与 controller 补齐，并在模块里登记 multer 文本字段解析（`@nestjs/platform-express` 自带 multer 2.2.0，无需新增依赖）：

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { QianyiClient } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';
import { QianyiWebhookService } from './qianyi-webhook.service.js';
import { QianyiWebhookController } from './qianyi-webhook.controller.js';
import { QianyiInboundService } from './qianyi-inbound.service.js';

@Module({
  imports: [AuthModule],
  controllers: [QianyiWebhookController],
  providers: [QianyiClient, QianyiSyncService, QianyiWebhookService, QianyiInboundService],
  exports: [QianyiClient, QianyiSyncService, QianyiInboundService],
})
export class QianyiModule {}
```

控制器上补一个只收文本字段的拦截器（文件字段直接忽略）：

```ts
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { UseInterceptors } from '@nestjs/common';

@UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 1, fields: 20, fieldSize: 64 * 1024 } }))
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd backend && pnpm vitest run src/modules/qianyi/`
Expected: 全部 PASS

- [ ] **Step 7: 手工验证 multipart 能被解析**

Run: `cd backend && pnpm build && pnpm start:dev`（另一终端）
Run:
```bash
curl -s -X POST http://localhost:3000/api/v1/qianyi/webhook \
  -F appId=no -F serviceType=PUSH_TRACKING_PACKAGE \
  -F bizParam='{"orderNumber":"x"}' -F timestamp=1 -F sign=bad
```
Expected: `{"ok":false}`，后端日志出现一条 `qianyi webhook rejected`，进程不崩

- [ ] **Step 8: 提交**

```bash
git add backend/src/modules/qianyi
git commit -m "feat(qianyi): signed webhook endpoint with idempotent archive"
```

---

### Task 8: 入站落地（发货 / 轨迹 / 明细核对）

**Files:**
- Create: `backend/src/modules/qianyi/qianyi-inbound.service.ts`
- Create: `backend/src/modules/qianyi/qianyi-inbound.service.spec.ts`
- Modify: `backend/src/modules/qianyi/qianyi.module.ts`（imports 增加 `InventoryModule`）

**Interfaces:**
- Consumes: `PrismaService`、`LogisticsEventService.record(orderId, shipmentId, input)`（既有）、`InventoryService`（全局）
- Produces: `handle(serviceType, payload): Promise<void>`；内部 `applyOutbound`、`applyTracking`

- [ ] **Step 1: 写失败测试**

`backend/src/modules/qianyi/qianyi-inbound.service.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { QianyiInboundService } from './qianyi-inbound.service.js';

function tx(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: vi.fn(async () => []),
    order: {
      findUnique: vi.fn(async () => ({
        id: 'order-1',
        orderNumber: 'PH100012',
        orderStatus: 'CONFIRMED',
        confirmationStatus: 'CONFIRMED',
        items: [
          { id: 'line-1', skuCodeSnapshot: 'TB001-Wa', quantity: 1, skuId: 'sku-1', bundleSnapshot: null },
        ],
        shipments: [],
        riskFlags: [],
        customerId: 'cust-1',
      })),
      update: vi.fn(async () => undefined),
    },
    shipment: { create: vi.fn(async () => ({ id: 'ship-1' })) },
    sku: { findMany: vi.fn(async () => [{ id: 'sku-1', qianyiSkuCode: 'YD003760CMHT' }]) },
    orderStatusHistory: { create: vi.fn(async () => undefined) },
    orderNote: { create: vi.fn(async () => undefined) },
    ...overrides,
  };
}

describe('QianyiInboundService', () => {
  it('turns a SHIPPED outbound into a shipment and moves the order', async () => {
    const client = tx();
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof client) => unknown) => fn(client)) };
    const inventory = { defaultWarehouse: vi.fn(async () => ({ id: 'wh-1' })), consumeForOrder: vi.fn() };
    const logistics = { record: vi.fn(async () => undefined) };
    const service = new QianyiInboundService(prisma as never, inventory as never, logistics as never);

    await service.handle('PUSH_ODO_ORDER', {
      orderNumber: 'S2610288955080',
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK123',
      carrier: 'SHIPDOC',
      warehouseName: 'PH-DAVAO-01',
      status: 'SHIPPED',
      shippingTime: 1754014435000,
      skuList: [{ sku: 'YD003760CMHT', quantity: 1 }],
    });

    expect(client.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trackingNumber: 'TRACK123', carrier: 'SHIPDOC' }),
      }),
    );
    expect(inventory.consumeForOrder).toHaveBeenCalled();
    expect(client.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderStatus: 'SHIPPING' }) }),
    );
    expect(logistics.record).toHaveBeenCalledWith(
      'order-1',
      'ship-1',
      expect.objectContaining({ normalizedStatus: 'SHIPPED' }),
    );
  });

  it('writes an order note when the shipped quantity differs', async () => {
    const client = tx();
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof client) => unknown) => fn(client)) };
    const service = new QianyiInboundService(
      prisma as never,
      { defaultWarehouse: vi.fn(async () => ({ id: 'wh-1' })), consumeForOrder: vi.fn() } as never,
      { record: vi.fn() } as never,
    );

    await service.handle('PUSH_ODO_ORDER', {
      onlineOrderNumber: 'PH100012',
      trackNumber: 'TRACK123',
      carrier: 'SHIPDOC',
      status: 'SHIPPED',
      skuList: [{ sku: 'YD003760CMHT', quantity: 0 }],
    });

    expect(client.orderNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ noteType: 'WAREHOUSE' }),
      }),
    );
  });

  it('parks the tracking number when the outbound has not arrived yet', async () => {
    const client = tx();
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof client) => unknown) => fn(client)) };
    const service = new QianyiInboundService(
      prisma as never,
      { defaultWarehouse: vi.fn(), consumeForOrder: vi.fn() } as never,
      { record: vi.fn() } as never,
    );

    await service.handle('PUSH_SALES_ORDER_SHIPPING_INFO', {
      onlineOrderNumber: 'PH100012',
      trackingNumber: 'TRACK999',
      carrier: 'SHIPDOC',
      status: 'WAIT_SHIP',
      shippingTime: 1754014435000,
    });

    // No shipment yet: the number must not be lost, so it lands on a note.
    expect(client.orderNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: expect.stringContaining('TRACK999') }),
      }),
    );
  });

  it('ignores a callback for an unknown order without throwing', async () => {
    const client = tx({});
    (client.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof client) => unknown) => fn(client)) };
    const service = new QianyiInboundService(
      prisma as never,
      { defaultWarehouse: vi.fn(), consumeForOrder: vi.fn() } as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.handle('PUSH_ODO_ORDER', { onlineOrderNumber: 'NOPE', status: 'SHIPPED' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-inbound.service.spec.ts`
Expected: FAIL —— 找不到 `./qianyi-inbound.service.js`

- [ ] **Step 3: 实现入站服务**

`backend/src/modules/qianyi/qianyi-inbound.service.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { LogisticsEventService, type LogisticsStatus } from '../orders/logistics-event.service.js';

/** 千易物流状态 → 我们归一的物流状态。未知状态不猜，返回 null。 */
const TRACKING_STATUS: Record<string, LogisticsStatus> = {
  CREATED: 'SHIPPED',
  AVAILABLE_FOR_PICKUP: 'SHIPPED',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'SIGNED',
  NOT_FOUND: 'FAILED_DELIVERY',
  CANCEL: 'RETURNING',
};

interface OutboundPayload {
  onlineOrderNumber?: string;
  orderNumber?: string;
  trackNumber?: string;
  trackingNumber?: string;
  carrier?: string;
  status?: string;
  shippingTime?: number;
  skuList?: Array<{ sku?: string; quantity?: number }>;
}

@Injectable()
export class QianyiInboundService {
  private readonly logger = new Logger(QianyiInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly logistics: LogisticsEventService,
  ) {}

  async handle(serviceType: string, payload: Record<string, unknown>): Promise<void> {
    switch (serviceType) {
      case 'PUSH_ODO_ORDER':
        await this.applyOutbound(payload as OutboundPayload);
        return;
      case 'PUSH_SALES_ORDER_SHIPPING_INFO':
        await this.applyShippingInfo(payload as OutboundPayload);
        return;
      case 'PUSH_TRACKING_PACKAGE':
        await this.applyTracking(payload as OutboundPayload);
        return;
      default:
        // PUSH_RETURN_ORDER_INFO: archived only, inventory untouched.
        this.logger.log(`qianyi ${serviceType} archived without side effects`);
    }
  }

  private async applyOutbound(payload: OutboundPayload): Promise<void> {
    if (payload.status !== 'SHIPPED') return;
    const orderNumber = payload.onlineOrderNumber;
    if (!orderNumber) return;

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber },
        include: { items: true, shipments: true, riskFlags: true },
      });
      if (!order) {
        this.logger.warn(`qianyi outbound for unknown order ${orderNumber}`);
        return;
      }
      // A repeated outbound callback must not create a second box.
      if (order.shipments.length > 0) return;

      // Resolve what actually left the warehouse BEFORE touching inventory:
      // a short shipment must consume only what was sent.
      const shippedByCode = new Map(
        (payload.skuList ?? []).map((line) => [line.sku ?? '', Number(line.quantity ?? 0)]),
      );
      const mapped = await tx.sku.findMany({
        where: { id: { in: order.items.map((item) => item.skuId) } },
        select: { id: true, qianyiSkuCode: true },
      });
      const codeById = new Map(mapped.map((row) => [row.id, row.qianyiSkuCode]));
      const lines: Array<{ orderItemId: string; skuId: string; quantity: number; skuCode: string }> = [];
      const notes: string[] = [];
      const requirements = new Map<string, number>();

      for (const item of order.items) {
        const code = codeById.get(item.skuId) ?? null;
        const sent = code ? shippedByCode.get(code) : undefined;
        const quantity = sent === undefined ? item.quantity : Math.min(sent, item.quantity);
        if (quantity === 0) {
          notes.push(`${item.skuCodeSnapshot}: not shipped (ordered ${item.quantity})`);
          continue;
        }
        if (quantity !== item.quantity) {
          notes.push(`${item.skuCodeSnapshot}: ordered ${item.quantity}, shipped ${quantity}`);
        }
        lines.push({
          orderItemId: item.id,
          skuId: item.skuId,
          quantity,
          skuCode: item.skuCodeSnapshot,
        });
        requirements.set(item.skuId, (requirements.get(item.skuId) ?? 0) + quantity);
      }

      if (lines.length === 0) {
        notes.push('Qianyi reported a shipment with no matching line; nothing was consumed');
      }

      const warehouse = await this.inventory.defaultWarehouse(tx);
      const shipment = await tx.shipment.create({
        data: {
          orderId: order.id,
          warehouseId: warehouse.id,
          carrier: payload.carrier?.slice(0, 100) ?? 'SHIPDOC',
          trackingNumber: payload.trackNumber ?? null,
          shippedAt: payload.shippingTime ? new Date(payload.shippingTime) : new Date(),
          qianyiOutboundNumber: payload.orderNumber ?? null,
          items: { create: lines.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity })) },
        },
      });

      if (requirements.size > 0) {
        await this.inventory.consumeForOrder(tx, order.id, requirements);
      }

      if (notes.length > 0) {
        await tx.orderNote.create({
          data: {
            orderId: order.id,
            noteType: 'WAREHOUSE',
            content: `Qianyi outbound ${payload.orderNumber ?? payload.trackNumber ?? ''}: ${notes.join('; ')}`.slice(0, 2000),
          },
        });
      }

      if (order.orderStatus !== 'SHIPPING' && order.orderStatus !== 'SIGNED') {
        await tx.order.update({
          where: { id: order.id },
          data: { orderStatus: 'SHIPPING' },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            statusDomain: 'ORDER_STATUS',
            oldStatus: order.orderStatus,
            newStatus: 'SHIPPING',
            source: 'SYSTEM',
            comment: `Qianyi outbound ${payload.trackNumber ?? payload.orderNumber ?? ''}`.trim(),
          },
        });
      }

      await this.logistics.record(order.id, shipment.id, {
        normalizedStatus: 'SHIPPED',
        externalStatus: payload.status,
        externalEventId: payload.orderNumber ?? payload.trackNumber ?? null,
        eventTime: payload.shippingTime ? new Date(payload.shippingTime) : new Date(),
      });
    });
  }

  private async applyShippingInfo(payload: OutboundPayload): Promise<void> {
    const orderNumber = payload.onlineOrderNumber;
    const trackingNumber = payload.trackingNumber;
    if (!orderNumber || !trackingNumber) return;

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber },
        include: { shipments: true },
      });
      if (!order) return;
      const shipment = order.shipments[0];
      if (!shipment) {
        // Outbound arrives later; park the number on the order note so the
        // ODO handler and the operator both see it.
        await tx.orderNote.create({
          data: {
            orderId: order.id,
            noteType: 'WAREHOUSE',
            content: `Qianyi tracking ${trackingNumber} (${payload.carrier ?? 'carrier'}) pending outbound`,
          },
        });
        return;
      }
      if (!shipment.trackingNumber) {
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            trackingNumber,
            carrier: shipment.carrier || payload.carrier || 'SHIPDOC',
          },
        });
    }
    });
  }

  private async applyTracking(payload: OutboundPayload): Promise<void> {
    const orderNumber = payload.onlineOrderNumber;
    const status = payload.status ? TRACKING_STATUS[payload.status] : undefined;
    if (!orderNumber || !status) return;

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { orderNumber },
        include: { shipments: true },
      });
      const shipment = order?.shipments[0];
      if (!order || !shipment) return;
      await this.logistics.record(order.id, shipment.id, {
        normalizedStatus: status,
        externalStatus: payload.status ?? null,
        externalEventId: `${payload.status}:${payload.shippingTime ?? ''}`,
      });
      if (status === 'SIGNED') {
        await tx.shipment.update({
          where: { id: shipment.id },
          data: { signedAt: new Date(), qianyiStatus: payload.status ?? null },
        });
      }
    });
  }
}
```

> `InventoryService.defaultWarehouse` / `consumeForOrder` 的现有签名见 `backend/src/modules/inventory/inventory.service.ts`；`ship()` 里就是这套调用。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-inbound.service.spec.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/qianyi
git commit -m "feat(qianyi): inbound outbound, tracking and quantity reconciliation"
```

---

### Task 9: 每日对账

**Files:**
- Modify: `backend/src/modules/qianyi/qianyi-sync.service.ts`
- Test: `backend/src/modules/qianyi/qianyi-sync.service.spec.ts`

**Interfaces:**
- Consumes: `QianyiClient.call('QUERY_SALES_ORDER_LIST', 'salesOrder', …)`
- Produces: `reconcile(now?: Date): Promise<{ checked: number; repaired: number }>`

- [ ] **Step 1: 写失败测试**

追加到 `qianyi-sync.service.spec.ts`：

```ts
describe('QianyiSyncService.reconcile', () => {
  it('asks for the last three days, which satisfies the one-condition rule', async () => {
    const prisma = {
      qianyiSyncJob: { findMany: vi.fn(async () => []), update: vi.fn(), count: vi.fn(async () => 0) },
      order: { update: vi.fn() },
    };
    const client = { enabled: true, call: vi.fn(async () => []) };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);

    await service.reconcile(new Date('2026-10-28T03:00:00Z'));

    const [, , biz] = client.call.mock.calls[0];
    expect(client.call.mock.calls[0][0]).toBe('QUERY_SALES_ORDER_LIST');
    expect(biz).toEqual(
      expect.objectContaining({
        updateTimeFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        updateTimeTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        page: 1,
      }),
    );
  });

  it('does nothing while disabled', async () => {
    const prisma = { qianyiSyncJob: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() } };
    const client = { enabled: false, call: vi.fn() };
    const service = new QianyiSyncService(prisma as never, client as never, CONFIG);
    await expect(service.reconcile()).resolves.toEqual({ checked: 0, repaired: 0 });
    expect(client.call).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-sync.service.spec.ts`
Expected: FAIL —— `service.reconcile` 不是函数

- [ ] **Step 3: 实现对账**

在 `QianyiSyncService` 里加：

```ts
  /** Daily safety net: Qianyi is the source of truth for outbound numbers. */
  async reconcile(now = new Date()): Promise<{ checked: number; repaired: number }> {
    if (!this.client.enabled) return { checked: 0, repaired: 0 };
    const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(d).replace(',', '');

    let page = 1;
    let checked = 0;
    for (;;) {
      const rows = (await this.client.call('QUERY_SALES_ORDER_LIST', 'salesOrder', {
        updateTimeFrom: fmt(from),
        updateTimeTo: fmt(now),
        page,
        pageSize: 100,
      })) as Array<Record<string, unknown>> | null;
      if (!Array.isArray(rows) || rows.length === 0) break;
      checked += rows.length;
      for (const row of rows) {
        const online = String(row.onlineOrderNumber ?? '');
        const tracking = row.trackingNumber ? String(row.trackingNumber) : '';
        if (!online || !tracking) continue;
        const order = await this.prisma.order.findUnique({
          where: { orderNumber: online },
          include: { shipments: true },
        });
        if (!order || order.shipments.some((s) => s.trackingNumber === tracking)) continue;
        await this.prisma.orderNote.create({
          data: {
            orderId: order.id,
            noteType: 'WAREHOUSE',
            content: `Reconciliation: Qianyi reports tracking ${tracking} not present locally`,
          },
        });
      }
      if (rows.length < 100) break;
      page += 1;
      if (page > 30) break;
    }
    return { checked, repaired: 0 };
  }
```

> `repair` 走「写订单备注让客服确认」，不自动建 Shipment：对账只看不改，避免把平台单（TikTok/Shopee）的轨迹套到我们订单上。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-sync.service.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/modules/qianyi
git commit -m "feat(qianyi): daily reconciliation against the order list API"
```

---

### Task 10: SKU 建档与映射的后端 API

**Files:**
- Create: `backend/src/modules/qianyi/qianyi-sku.mapper.ts`
- Create: `backend/src/modules/qianyi/qianyi-sku.mapper.spec.ts`
- Create: `backend/src/modules/qianyi/qianyi-admin.controller.ts`
- Modify: `backend/src/modules/qianyi/qianyi.module.ts`

**Interfaces:**
- Consumes: `QianyiClient`、`QianyiSyncService.health/retry`
- Produces: `GET api/v1/admin/qianyi/status`、`GET api/v1/admin/qianyi/skus`（建档预览）、`POST api/v1/admin/qianyi/skus/create`（body `{ skuIds: string[] }`）、`PUT api/v1/admin/qianyi/skus/:skuId/mapping`（body `{ qianyiSkuCode: string | null }`）、`GET api/v1/admin/qianyi/jobs`、`POST api/v1/admin/qianyi/jobs/:id/retry`

- [ ] **Step 1: 写失败测试**

`backend/src/modules/qianyi/qianyi-sku.mapper.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildSkuPayload, skuReadiness } from './qianyi-sku.mapper.js';

const SKU = {
  id: 'sku-1',
  skuCode: 'TB001-Wa',
  qianyiSkuCode: null,
  packageWeight: 12.5,
  packageWidth: 120,
  packageHeight: 30,
  packageDepth: 60,
  productWeight: 11.2,
  product: { name: 'Console Table', description: 'Walnut console table' },
  images: [],
};

describe('skuReadiness', () => {
  it('is ready when weight and package dimensions are present', () => {
    expect(skuReadiness(SKU)).toEqual({ ready: true, gaps: [] });
  });

  it('names the missing fields instead of guessing them', () => {
    expect(skuReadiness({ ...SKU, packageWidth: null, packageHeight: null })).toEqual({
      ready: false,
      gaps: ['packageWidth', 'packageHeight'],
    });
  });
});

describe('buildSkuPayload', () => {
  it('uses package weight as gross and product weight as net', () => {
    const payload = buildSkuPayload(SKU, 'LUWAG-TB001-Wa');
    expect(payload).toMatchObject({
      sku: 'LUWAG-TB001-Wa',
      title: 'Console Table',
      type: 'SINGLE',
      weight: 12.5,
      netWeight: 11.2,
      weightUnit: 'KG',
      length: 120,
      width: 60,
      height: 30,
      dimensionUnit: 'cm',
      enable: 1,
    });
  });

  it('falls back to gross weight for net weight but says so in the notes', () => {
    const payload = buildSkuPayload({ ...SKU, productWeight: null }, 'LUWAG-TB001-Wa');
    expect(payload.netWeight).toBe(12.5);
    expect(payload.notes).toContain('netWeight defaults to package weight');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-sku.mapper.spec.ts`
Expected: FAIL —— 找不到 `./qianyi-sku.mapper.js`

- [ ] **Step 3: 实现 mapper**

`backend/src/modules/qianyi/qianyi-sku.mapper.ts`：

```ts
/**
 * Turns a catalog SKU into `INSERT_SKU_INFO`.
 *
 * Qianyi requires gross weight, net weight and all three dimensions. We never
 * invent a number: a SKU that lacks a dimension is reported as not ready and
 * stays out of the creation list until someone fills it in.
 *
 * Our schema stores product dims as width/depth and packaging as
 * width/height/depth; Qianyi wants length/width/height, so length comes from
 * our width and width from our depth.
 */
export interface SkuSource {
  id: string;
  skuCode: string;
  packageWeight: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
  packageDepth: number | null;
  productWeight: number | null;
  product: { name: string; description: string | null };
  images: Array<{ url: string }>;
}

export interface SkuReadiness {
  ready: boolean;
  gaps: string[];
}

export function skuReadiness(sku: SkuSource): SkuReadiness {
  const gaps: string[] = [];
  if (!sku.packageWeight) gaps.push('packageWeight');
  if (!sku.packageWidth) gaps.push('packageWidth');
  if (!sku.packageHeight) gaps.push('packageHeight');
  if (!sku.packageDepth) gaps.push('packageDepth');
  return { ready: gaps.length === 0, gaps };
}

export function buildSkuPayload(
  sku: SkuSource,
  qianyiCode: string,
): Record<string, unknown> & { notes: string[] } {
  const notes: string[] = [];
  const netWeight = sku.productWeight ?? sku.packageWeight ?? 0;
  if (!sku.productWeight) notes.push('netWeight defaults to package weight, confirm manually');
  return {
    sku: qianyiCode,
    title: sku.product.name.slice(0, 255),
    type: 'SINGLE',
    weight: sku.packageWeight ?? 0,
    netWeight,
    weightUnit: 'KG',
    length: sku.packageWidth ?? 0,
    width: sku.packageDepth ?? 0,
    height: sku.packageHeight ?? 0,
    dimensionUnit: 'cm',
    enable: 1,
    // 90 days is the documented default; furniture is not perishable.
    shelfLife: 90,
    picUrl: sku.images[0]?.url?.slice(0, 255),
    description: sku.product.description?.slice(0, 2048),
    notes,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && pnpm vitest run src/modules/qianyi/qianyi-sku.mapper.spec.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 实现后台控制器**

`backend/src/modules/qianyi/qianyi-admin.controller.ts`：

```ts
import { Body, Controller, Get, Header, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QianyiClient } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';
import { buildSkuPayload, skuReadiness, type SkuSource } from './qianyi-sku.mapper.js';

@Controller('admin/qianyi')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class QianyiAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: QianyiClient,
    private readonly sync: QianyiSyncService,
  ) {}

  @Get('status')
  @Header('Cache-Control', 'private, no-store')
  async status() {
    return this.sync.health();
  }

  /** Everything the operator needs before ticking rows for creation. */
  @Get('skus')
  @Header('Cache-Control', 'private, no-store')
  async skus(@Query('unmapped') unmapped?: string) {
    const rows = await this.prisma.sku.findMany({
      where: unmapped === 'true' ? { qianyiSkuCode: null } : undefined,
      include: {
        product: { select: { name: true, description: true } },
        variant: { include: { product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } } },
      },
      orderBy: { skuCode: 'asc' },
    });
    return rows.map((row) => {
      const source: SkuSource = {
        id: row.id,
        skuCode: row.skuCode,
        packageWeight: row.packageWeight,
        packageWidth: row.packageWidth,
        packageHeight: row.packageHeight,
        packageDepth: row.packageDepth,
        productWeight: row.productWeight,
        product: { name: row.product.name, description: row.product.description },
        images: row.variant.product.images.map((image) => ({ url: image.url })),
      };
      const readiness = skuReadiness(source);
      return {
        id: row.id,
        skuCode: row.skuCode,
        qianyiSkuCode: row.qianyiSkuCode,
        suggestedCode: row.skuCode,
        title: row.product.name,
        ...readiness,
      };
    });
  }

  /** Creates ONLY the rows the operator ticked. Never bulk-creates. */
  @Post('skus/create')
  async create(@Body() body: { skuIds?: string[] }) {
    const ids = body.skuIds ?? [];
    const results: Array<{ skuCode: string; ok: boolean; error?: string }> = [];
    for (const id of ids.slice(0, 100)) {
      const row = await this.prisma.sku.findUnique({
        where: { id },
        include: {
          product: { select: { name: true, description: true } },
          variant: { include: { product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } } },
        },
      });
      if (!row || row.qianyiSkuCode) continue;
      const source: SkuSource = {
        id: row.id,
        skuCode: row.skuCode,
        packageWeight: row.packageWeight,
        packageWidth: row.packageWidth,
        packageHeight: row.packageHeight,
        packageDepth: row.packageDepth,
        productWeight: row.productWeight,
        product: { name: row.product.name, description: row.product.description },
        images: row.variant.product.images.map((image) => ({ url: image.url })),
      };
      if (!skuReadiness(source).ready) {
        results.push({ skuCode: row.skuCode, ok: false, error: 'missing dimensions or weight' });
        continue;
      }
      const code = row.skuCode;
      const payload = buildSkuPayload(source, code);
      const { notes: _notes, ...wire } = payload;
      try {
        await this.client.call('INSERT_SKU_INFO', 'sku', wire);
        await this.prisma.sku.update({ where: { id: row.id }, data: { qianyiSkuCode: code } });
        results.push({ skuCode: row.skuCode, ok: true });
      } catch (error) {
        results.push({ skuCode: row.skuCode, ok: false, error: (error as Error).message.slice(0, 200) });
      }
    }
    return { results };
  }

  @Put('skus/:skuId/mapping')
  async map(
    @Param('skuId') skuId: string,
    @Body() body: { qianyiSkuCode?: string | null },
  ) {
    const value = body.qianyiSkuCode?.trim() || null;
    await this.prisma.sku.update({ where: { id: skuId }, data: { qianyiSkuCode: value } });
    return { skuId, qianyiSkuCode: value };
  }

  @Get('jobs')
  @Header('Cache-Control', 'private, no-store')
  async jobs() {
    return this.prisma.qianyiSyncJob.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { order: { select: { orderNumber: true } } },
    });
  }

  @Post('jobs/:id/retry')
  async retry(@Param('id') id: string) {
    await this.sync.retry(id);
    return { retried: true };
  }
}
```

- [ ] **Step 6: 注册并验证编译**

`qianyi.module.ts` 的 `controllers` 加 `QianyiAdminController`，并把 `PrismaService` 通过已有的全局 `PrismaModule` 注入（无需 import）。

Run: `cd backend && pnpm build`
Expected: 退出码 0

- [ ] **Step 7: 提交**

```bash
git add backend/src/modules/qianyi
git commit -m "feat(qianyi): admin API for status, SKU creation gate and job retry"
```

---

### Task 11: 后台页面与商品表单字段

**Files:**
- Create: `frontend/src/app/admin/(shell)/settings/qianyi/page.tsx`
- Create: `frontend/src/app/admin/(shell)/settings/qianyi/page.spec.tsx`
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/components/admin/AdminShell.tsx`（加导航项）
- Modify: `frontend/src/components/admin/ProductForm.tsx`（SKU 区加千易编码）

**Interfaces:**
- Consumes: Task 10 的四个端点
- Produces: `/admin/settings/qianyi` 页面

- [ ] **Step 1: 写失败测试**

`page.spec.tsx`：

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import QianyiSettingsPage from './page';

vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    qianyiStatus: vi.fn(async () => ({ enabled: true, pending: 0, failed: 1, sent24h: 3 })),
    qianyiSkus: vi.fn(async () => [
      { id: 'sku-1', skuCode: 'TB001-Wa', qianyiSkuCode: null, ready: true, gaps: [], title: 'Console Table' },
      { id: 'sku-2', skuCode: 'SC001', qianyiSkuCode: null, ready: false, gaps: ['packageWidth'], title: 'Shelf' },
    ]),
    qianyiJobs: vi.fn(async () => []),
    createQianyiSkus: vi.fn(async () => ({ results: [] })),
  },
}));

describe('QianyiSettingsPage', () => {
  it('hides rows that are not ready from selection', async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByText('Console Table')).toBeInTheDocument());
    expect(screen.getByLabelText('TB001-Wa')).not.toBeDisabled();
    expect(screen.getByLabelText('SC001')).toBeDisabled();
  });

  it('starts with nothing selected', async () => {
    render(<QianyiSettingsPage />);
    await waitFor(() => expect(screen.getByLabelText('TB001-Wa')).toBeInTheDocument());
    expect(screen.getByLabelText('TB001-Wa')).not.toBeChecked();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && pnpm vitest run "src/app/admin/(shell)/settings/qianyi/page.spec.tsx"`
Expected: FAIL —— 找不到 `./page`

- [ ] **Step 3: 加 API 客户端**

`frontend/src/lib/admin-api.ts` 追加：

```ts
export interface QianyiStatus {
  enabled: boolean;
  pending: number;
  failed: number;
  sent24h: number;
}

export interface QianyiSkuRow {
  id: string;
  skuCode: string;
  qianyiSkuCode: string | null;
  title: string;
  ready: boolean;
  gaps: string[];
}

// inside the existing adminApi object:
//   qianyiStatus: () => request<QianyiStatus>('/admin/qianyi/status'),
//   qianyiSkus: () => request<QianyiSkuRow[]>('/admin/qianyi/skus'),
//   qianyiJobs: () => request<unknown[]>('/admin/qianyi/jobs'),
//   createQianyiSkus: (skuIds: string[]) =>
//     request<{ results: Array<{ skuCode: string; ok: boolean; error?: string }> }>(
//       '/admin/qianyi/skus/create',
//       { method: 'POST', body: JSON.stringify({ skuIds }) },
//     ),
//   retryQianyiJob: (id: string) =>
//     request<{ retried: boolean }>(`/admin/qianyi/jobs/${id}/retry`, { method: 'POST' }),
//   setQianyiMapping: (skuId: string, qianyiSkuCode: string | null) =>
//     request<{ qianyiSkuCode: string | null }>(`/admin/qianyi/skus/${skuId}/mapping`, {
//       method: 'PUT',
//       body: JSON.stringify({ qianyiSkuCode }),
//     }),
```

> 上面的 `request` 就是该文件里既有的请求封装；先看它在文件里的真实名字再补。

- [ ] **Step 4: 写页面**

`page.tsx` 结构（完整实现，非骨架）：

```tsx
"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/Button";
import { adminApi, type QianyiSkuRow, type QianyiStatus } from "@/lib/admin-api";

export default function QianyiSettingsPage() {
  const [status, setStatus] = useState<QianyiStatus | null>(null);
  const [rows, setRows] = useState<QianyiSkuRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([adminApi.qianyiStatus(), adminApi.qianyiSkus()]).then(([s, r]) => {
      setStatus(s);
      setRows(r);
    });
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { results } = await adminApi.createQianyiSkus([...selected]);
      const ok = results.filter((r) => r.ok).length;
      setMessage(`Created ${ok} / ${results.length}`);
      setSelected(new Set());
      setRows(await adminApi.qianyiSkus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Qianyi ERP" description="千易订单同步与商品建档" />
      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p>状态：{status?.enabled ? "已启用" : "未启用"}</p>
        <p>待推送 {status?.pending ?? 0} · 失败 {status?.failed ?? 0} · 24 小时成功 {status?.sent24h ?? 0}</p>
        <p className="break-all text-xs text-muted">
          Webhook：https://luwag.shop/api/v1/qianyi/webhook
        </p>
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">商品建档（只提交勾选的行）</h2>
          <Button onClick={submit} disabled={busy || selected.size === 0}>
            建档选中的 {selected.size} 个
          </Button>
        </div>
        {message ? <p className="mb-2 text-xs text-primary">{message}</p> : null}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="w-10" />
              <th>SKU</th>
              <th>名称</th>
              <th>千易编码</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border/60">
                <td>
                  <input
                    type="checkbox"
                    aria-label={row.skuCode}
                    disabled={!row.ready || Boolean(row.qianyiSkuCode)}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </td>
                <td>{row.skuCode}</td>
                <td>{row.title}</td>
                <td>{row.qianyiSkuCode ?? "—"}</td>
                <td className={row.ready ? "text-primary" : "text-red-600"}>
                  {row.ready ? "可建档" : `缺 ${row.gaps.join(", ")}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: 加导航与商品表单字段**

`AdminShell.tsx` 在 `/admin/settings` 之后加一项：

```tsx
  { href: "/admin/settings/qianyi", label: "千易 ERP", permission: "SYSTEM_SETTINGS_EDIT" },
```

`ProductForm.tsx` 在 SKU 行里 `skuCode` 输入旁边加：

```tsx
<TextInput
  label="千易编码"
  value={sku.qianyiSkuCode ?? ""}
  onChange={(value) => updateSku(sku.id, { qianyiSkuCode: value })}
  hint="留空表示还没映射，该 SKU 的订单不会被推送到千易"
/>
```

> `updateSku` 用该文件里现有的切换函数；商品 PATCH 的 DTO 需同步在 `backend` 的 catalog DTO 里接受 `qianyiSkuCode`（`sku.code` 同层），保存后用 psql 或后台刷新确认写库。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd frontend && pnpm vitest run "src/app/admin/(shell)/settings/qianyi/page.spec.tsx"`
Expected: PASS（2 个用例）

- [ ] **Step 7: 提交**

```bash
git add frontend/src/app/admin frontend/src/lib/admin-api.ts frontend/src/components/admin
git commit -m "feat(qianyi): admin settings page, SKU creation gate and mapping field"
```

---

### Task 12: 门店轨迹展示

**Files:**
- Modify: `frontend/src/components/track-order/OrderList.tsx`
- Modify: `frontend/src/components/track-order/OrderList.spec.tsx`
- Modify: `backend/src/modules/orders/storefront/orders.controller.ts`（详情里带上 `shipments[].events`）
- Modify: `backend/src/modules/orders/orders.service.ts`（`lookup()` 的 select 带 `events`）

**Interfaces:**
- Consumes: `LogisticsEvent` 行（`normalizedStatus`、`externalStatus`、`eventTime`）
- Produces: `/track-order` 订单卡片下的轨迹时间线

- [ ] **Step 1: 写失败测试**

追加到 `OrderList.spec.tsx`：

```tsx
it('renders the carrier timeline when tracking events exist', () => {
  render(
    <OrderList
      orders={[
        {
          orderNumber: 'PH100012',
          orderStatus: 'SHIPPING',
          trackingNumber: 'TRACK123',
          carrier: 'SHIPDOC',
          events: [
            { normalizedStatus: 'SHIPPED', externalStatus: 'SHIPPED', eventTime: '2026-10-28T02:00:00.000Z' },
            { normalizedStatus: 'IN_TRANSIT', externalStatus: 'IN_TRANSIT', eventTime: '2026-10-29T02:00:00.000Z' },
          ],
        },
      ]}
    />,
  );
  expect(screen.getByText('SHIPDOC · TRACK123')).toBeInTheDocument();
  expect(screen.getByText('In transit')).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && pnpm vitest run src/components/track-order/OrderList.spec.tsx`
Expected: FAIL —— 找不到轨迹文案

- [ ] **Step 3: 实现时间线**

`OrderList.tsx` 在已有运单号附近加：

```tsx
{order.events?.length ? (
  <ol className="mt-3 space-y-1 border-l border-border pl-3 text-xs">
    {order.events.map((event) => (
      <li key={`${event.normalizedStatus}-${event.eventTime}`}>
        <span className="font-medium">{LABELS[event.normalizedStatus] ?? event.externalStatus}</span>
        <span className="ml-2 text-muted">{new Date(event.eventTime).toLocaleDateString('en-PH')}</span>
      </li>
    ))}
  </ol>
) : null}
```

`LABELS`：

```tsx
const LABELS: Record<string, string> = {
  SHIPPED: 'Picked up',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  SIGNED: 'Delivered',
  FAILED_DELIVERY: 'Delivery failed',
  RETURNING: 'Returning',
  RETURNED: 'Returned',
};
```

- [ ] **Step 4: 后端带出轨迹**

`orders.service.ts` 的 `lookup()` 里，把 `shipments` 的 include 改成：

```ts
      shipments: {
        include: { events: { orderBy: { eventTime: 'asc' } } },
      },
```

并在返回对象里把 `carrier` / `trackingNumber` / `events` 从 `shipments[0]` 投影出来。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd frontend && pnpm vitest run src/components/track-order/OrderList.spec.tsx && cd ../backend && pnpm vitest run src/modules/orders`
Expected: 全 PASS

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/track-order backend/src/modules/orders
git commit -m "feat(track-order): show the carrier timeline from Qianyi events"
```

---

### Task 13: 上线手册

**Files:**
- Create: `docs/superpowers/runbooks/qianyi-erp-go-live.md`

**Interfaces:**
- Produces: 一份可照做的上线步骤，含开关、白名单、回调配置、回滚。

- [ ] **Step 1: 写手册**

内容必须覆盖：

1. 千易后台：三方应用 `LUWAG` → IP 白名单 `43.160.229.107`；勾选本次要用的权限（商品新增/编辑/查询、订单创建并审核/关闭/列表查询、店铺查询、仓库查询、仓库物流查询）。
2. 千易后台：推送接收地址填 `https://luwag.shop/api/v1/qianyi/webhook`，勾选「出库反馈推送」「订单物流信息推送」「物流跟踪状态变更推送」。
3. 服务器 `.env.deploy` 追加 `QIANYI_*`（`chmod 600`，不进 Git），`QIANYI_ENABLED=true`。
4. `docker compose --env-file .env.deploy -f docker-compose.prod.yml up -d backend`（**不带 `--env-file` 会导致空库凭据停机**）。
5. 后台 `/admin/settings/qianyi`：确认状态、勾选首批商品建档、确认未匹配数下降。
6. 用一笔真实订单：客服确认 → 看 `qianyi_sync_jobs` 变 `SENT`、千易出现单号 → 千易发货 → `/track-order` 出现运单号与轨迹。
7. 回滚：`QIANYI_ENABLED=false` + 重启后端（迁移为加性，回退不需要动表）。

- [ ] **Step 2: 提交**

```bash
git add docs/superpowers/runbooks/qianyi-erp-go-live.md
git commit -m "docs(qianyi): go-live runbook"
```

---

## 自检记录

- **Spec 覆盖**：§3 模块边界 → Task 1/2/4/5/7/8；§4 数据模型 → Task 3；§5 出站 → Task 4/5/6；§6 入站 → Task 7/8；§7 对账 → Task 9；§8 建档 → Task 10/11；§9 后台 → Task 10/11；§10 配置 → Task 1；§11 安全 → Task 2/7；§12 测试 → 各任务；§13 上线 → Task 13。
- **修正**：轨迹复用 `LogisticsEvent`（原 spec 的新表已删除）；webhook 路径统一为 `/api/v1/qianyi/webhook`。
- **已知未覆盖**：`ProductForm` 保存 `qianyiSkuCode` 需要 catalog DTO 同步接受该字段，Task 11 Step 5 已注明，但具体 DTO 位置留给执行时按现有 `code` 字段照抄。
