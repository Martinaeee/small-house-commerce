# J&T Express Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll the J&T Express PH open platform every 30 minutes for every shipped waybill, store the carrier's scans as logistics events, auto-sign deliveries, and show J&T's wording plus the rider's phone on the guest order page.

**Architecture:** One new NestJS module (`backend/src/modules/jt/`) that owns the J&T wire protocol, the scan-code mapping and a `setInterval` polling worker. It writes through the existing `LogisticsEventService`, calls the existing `OrdersService.sign()` for deliveries, and adds six additive columns. No table, no order-flow rewrite, no webhook endpoint.

**Tech Stack:** NestJS 12 (ESM), Prisma 7 (schema folder + hand-written SQL migrations), Vitest, Next.js 16 admin and storefront, Zod env validation.

**Spec:** `docs/superpowers/specs/2026-10-28-jt-tracking-design.md`

## Baseline

The Orders V2 code this plan depends on (`Shipment`, `LogisticsEvent`, `OrdersService.sign`, `OrderDrawer`, `FulfillmentDialog`) lives on `feat/qianyi-erp-integration`, **not** on the current worktree branch. Before Task 1, create a worktree from that branch:

```bash
cd /Users/Admin1/Desktop/菲律宾家居/建站/codex建站
git worktree add .claude/worktrees/jt-tracking -b feat/jt-tracking feat/qianyi-erp-integration
cd .claude/worktrees/jt-tracking
pnpm --dir small-house-commerce/backend install
pnpm --dir small-house-commerce/frontend install
```

All paths below are relative to that worktree.

## Global Constraints

- Polling only. No `trace/subscribe` endpoint, no public webhook route, no waybill-creation or label-printing API in this plan.
- `enabled` is derived from `JT_ENABLED === 'true'` **and** all four credentials being present. Never call J&T with a blank secret.
- Credentials come from env only. No key, password or account id is ever written to source, tests, docs or logs.
- One additive migration. No table drops, renames or column type changes.
- A `scanTypeCode` outside the eight mapped codes is never persisted.
- Codes 116 / 117 / 118 record events only and must never change `Shipment.status` or `Order.orderStatus`.
- Guest API returns `description` and `riderPhone` **only** when `personalDetailsIncluded === true`.
- `scanTime` is UTC+8 with no suffix and must be parsed as `+08:00`. Never parse it as local time.
- Node >= 22, ESM: relative imports end in `.js`. Backend and frontend both use Vitest.
- Existing behavior of `OrdersService.sign()` for admin callers is unchanged.

## Review Focus

- **Timezone drift.** `"2026-05-09 09:57:32"` parsed as server-local time silently shifts every event by the host offset. A mapper test pins the `+08:00` interpretation.
- **Signature byte drift.** The header digest signs the exact `bizContent` string sent on the wire; re-serialising the object (key order, spacing) breaks auth. A client test asserts the signed string equals the transmitted one.
- **Auto-sign on a non-shipping order.** A delivered scan on a cancelled or after-sales order must be recorded without marking the whole poll as failed. A service test pins this.
- **Duplicate polls.** Re-polling the same waybill must not duplicate events. A service test polls twice and expects one event row.
- **Carrier label mismatch.** `carrier` is free text typed by staff; polling compares case-insensitively against `JT_CARRIER_NAME`. A service test includes a `j&t express` row and expects it polled, and an `LBC` row it must skip.
- **Guest redaction.** The description and rider phone must be absent when the shopper only knows an order number. A guest-lookup test pins the null fields.

---

### Task 1: Add the six tracking columns

**Files:**
- Modify: `small-house-commerce/backend/prisma/schema/order.prisma` (`LogisticsEvent`, `Shipment` models)
- Create: `small-house-commerce/backend/prisma/migrations/20261028170000_add_jt_tracking_detail/migration.sql`

**Interfaces:**
- Produces: `LogisticsEvent.externalDescription: string | null`, `LogisticsEvent.staffContact: string | null`, `LogisticsEvent.signatureImageUrl: string | null`, `Shipment.trackingCheckedAt: Date | null`, `Shipment.trackingError: string | null`, `Shipment.trackingFailures: number`.

- [ ] **Step 1: Edit the schema**

In `small-house-commerce/backend/prisma/schema/order.prisma`, inside `model LogisticsEvent`, after `rawPayloadReference`:

```prisma
  /// J&T's own wording for the scan, kept verbatim for the guest timeline.
  externalDescription  String?              @map("external_description")
  /// Rider phone from the scan, shown to phone-verified guests only.
  staffContact         String?              @map("staff_contact") @db.VarChar(40)
  /// Delivery / problem photo URL. Admin only, never sent to the storefront.
  signatureImageUrl    String?              @map("signature_image_url")
```

Inside `model Shipment`, after `updatedAt`:

```prisma
  /// Last time the tracking worker asked the carrier about this box.
  trackingCheckedAt DateTime? @map("tracking_checked_at") @db.Timestamptz(3)
  /// Last tracking failure, truncated; null once a poll succeeds.
  trackingError     String?   @map("tracking_error") @db.VarChar(300)
  /// Consecutive failures, drives the polling backoff.
  trackingFailures  Int       @default(0) @map("tracking_failures")

  @@index([status, trackingCheckedAt])
```

- [ ] **Step 2: Write the migration**

Create `small-house-commerce/backend/prisma/migrations/20261028170000_add_jt_tracking_detail/migration.sql`:

```sql
-- J&T Express tracking: carrier wording on events, poll bookkeeping on shipments.
-- Additive only; nothing existing is rewritten.

ALTER TABLE "logistics_events"
  ADD COLUMN "external_description" TEXT,
  ADD COLUMN "staff_contact" VARCHAR(40),
  ADD COLUMN "signature_image_url" TEXT;

ALTER TABLE "shipments"
  ADD COLUMN "tracking_checked_at" TIMESTAMPTZ(3),
  ADD COLUMN "tracking_error" VARCHAR(300),
  ADD COLUMN "tracking_failures" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "shipments_status_tracking_checked_at_idx"
  ON "shipments" ("status", "tracking_checked_at");
```

- [ ] **Step 3: Apply and regenerate**

Run, from `small-house-commerce/backend`:

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

Expected: migration `20261028170000_add_jt_tracking_detail` applied; client regenerated with no error.

- [ ] **Step 4: Verify the columns exist**

```bash
psql "postgresql://smallhouse:smallhouse@localhost:5432/smallhouse" -c '\d logistics_events' | grep -E "external_description|staff_contact|signature_image_url"
psql "postgresql://smallhouse:smallhouse@localhost:5432/smallhouse" -c '\d shipments' | grep -E "tracking_checked_at|tracking_error|tracking_failures"
```

Expected: all six column names printed.

- [ ] **Step 5: Confirm the suite still compiles**

```bash
pnpm test
```

Expected: PASS. No test references the new columns yet; this proves the regenerated client did not break imports.

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/backend/prisma
git commit -m "feat(jt): add tracking columns for carrier detail and poll state"
```

---

### Task 2: J&T configuration and env validation

**Files:**
- Create: `small-house-commerce/backend/src/modules/jt/jt.config.ts`
- Create: `small-house-commerce/backend/src/modules/jt/jt.config.spec.ts`
- Modify: `small-house-commerce/backend/src/config/env.validation.ts`
- Modify: `small-house-commerce/backend/src/config/configuration.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readJtConfig(config: ConfigService): JtConfig`; `JtConfig { enabled, baseUrl, apiAccount, privateKey, customerCode, customerPassword, pollMinutes, carrierName }`.

- [ ] **Step 1: Write the failing test**

Create `small-house-commerce/backend/src/modules/jt/jt.config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readJtConfig } from './jt.config.js';

const base = {
  'jt.enabled': 'true',
  'jt.baseUrl': 'https://demoopenapi.jtexpress.ph/webopenplatformapi/api',
  'jt.apiAccount': '640826271705595946',
  'jt.privateKey': 'pk',
  'jt.customerCode': 'J0086474299',
  'jt.customerPassword': 'pw',
  'jt.pollMinutes': 30,
  'jt.carrierName': 'J&T Express',
};

const configOf = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as never;

describe('readJtConfig', () => {
  it('is enabled when the flag is on and every credential is present', () => {
    expect(readJtConfig(configOf(base)).enabled).toBe(true);
  });

  it('stays disabled when the flag is on but the private key is missing', () => {
    const values = { ...base, 'jt.privateKey': '' };
    expect(readJtConfig(configOf(values)).enabled).toBe(false);
  });

  it('stays disabled when the flag is off even with full credentials', () => {
    const values = { ...base, 'jt.enabled': 'false' };
    expect(readJtConfig(configOf(values)).enabled).toBe(false);
  });

  it('defaults the poll cadence and carrier label', () => {
    const values = { ...base };
    delete (values as Record<string, unknown>)['jt.pollMinutes'];
    delete (values as Record<string, unknown>)['jt.carrierName'];
    const config = readJtConfig(configOf(values));
    expect(config.pollMinutes).toBe(30);
    expect(config.carrierName).toBe('J&T Express');
  });

  it('falls back to the production host', () => {
    const values = { ...base };
    delete (values as Record<string, unknown>)['jt.baseUrl'];
    expect(readJtConfig(configOf(values)).baseUrl).toBe(
      'https://openapi.jtexpress.ph/webopenplatformapi/api',
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd small-house-commerce/backend && pnpm exec vitest run src/modules/jt/jt.config.spec.ts
```

Expected: FAIL — cannot resolve `./jt.config.js`.

- [ ] **Step 3: Implement the config reader**

Create `small-house-commerce/backend/src/modules/jt/jt.config.ts`:

```ts
import { ConfigService } from '@nestjs/config';

/**
 * Everything the J&T tracking worker needs, read from the validated env tree
 * (`jt.*` in configuration.ts). `enabled` is derived, never trusted on its
 * own: a half-configured integration must stay off rather than call the
 * carrier with an empty secret.
 */
export interface JtConfig {
  enabled: boolean;
  baseUrl: string;
  apiAccount: string;
  privateKey: string;
  customerCode: string;
  customerPassword: string;
  pollMinutes: number;
  carrierName: string;
}

export const JT_DEFAULT_BASE_URL =
  'https://openapi.jtexpress.ph/webopenplatformapi/api';

export function readJtConfig(config: ConfigService): JtConfig {
  const enabledFlag = config.get<string>('jt.enabled') ?? 'false';
  const apiAccount = config.get<string>('jt.apiAccount') ?? '';
  const privateKey = config.get<string>('jt.privateKey') ?? '';
  const customerCode = config.get<string>('jt.customerCode') ?? '';
  const customerPassword = config.get<string>('jt.customerPassword') ?? '';
  const complete = Boolean(apiAccount && privateKey && customerCode && customerPassword);
  const pollMinutes = config.get<number>('jt.pollMinutes') ?? 30;
  return {
    enabled: enabledFlag === 'true' && complete,
    baseUrl: config.get<string>('jt.baseUrl') || JT_DEFAULT_BASE_URL,
    apiAccount,
    privateKey,
    customerCode,
    customerPassword,
    pollMinutes: pollMinutes > 0 ? pollMinutes : 30,
    carrierName: config.get<string>('jt.carrierName') || 'J&T Express',
  };
}
```

- [ ] **Step 4: Run the test again**

```bash
pnpm exec vitest run src/modules/jt/jt.config.spec.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Add the env keys**

In `small-house-commerce/backend/src/config/env.validation.ts`, after the `QIANYI_LOGISTICS` entry and before the closing `}).superRefine(`:

```ts
  // J&T Express PH open platform. Optional so an unconfigured deployment
  // boots unchanged; the superRefine below refuses a half-configured switch-on.
  JT_ENABLED: z.preprocess(blankAsUndefined, z.enum(['true', 'false']).optional()),
  JT_BASE_URL: z.preprocess(blankAsUndefined, z.string().url().optional()),
  JT_API_ACCOUNT: z.preprocess(blankAsUndefined, z.string().min(1).max(40).optional()),
  JT_PRIVATE_KEY: z.preprocess(blankAsUndefined, z.string().min(8).optional()),
  JT_CUSTOMER_CODE: z.preprocess(blankAsUndefined, z.string().min(1).max(40).optional()),
  JT_CUSTOMER_PASSWORD: z.preprocess(blankAsUndefined, z.string().min(1).max(100).optional()),
  JT_POLL_MINUTES: z.preprocess(
    blankAsUndefined,
    z.coerce.number().int().positive().max(1440).optional(),
  ),
  JT_CARRIER_NAME: z.preprocess(blankAsUndefined, z.string().min(1).max(60).optional()),
```

Inside the existing `superRefine`, after the `QIANYI_ENABLED` block:

```ts
  if (env.JT_ENABLED === 'true') {
    const required = [
      'JT_API_ACCOUNT',
      'JT_PRIVATE_KEY',
      'JT_CUSTOMER_CODE',
      'JT_CUSTOMER_PASSWORD',
    ] as const;
    for (const key of required) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when JT_ENABLED is true`,
        });
      }
    }
  }
```

- [ ] **Step 6: Add the config tree**

In `small-house-commerce/backend/src/config/configuration.ts`, after the `qianyi` block:

```ts
    // J&T Express tracking. Empty values keep the worker switched off.
    jt: {
      enabled: env.JT_ENABLED ?? 'false',
      baseUrl: env.JT_BASE_URL ?? 'https://openapi.jtexpress.ph/webopenplatformapi/api',
      apiAccount: env.JT_API_ACCOUNT ?? '',
      privateKey: env.JT_PRIVATE_KEY ?? '',
      customerCode: env.JT_CUSTOMER_CODE ?? '',
      customerPassword: env.JT_CUSTOMER_PASSWORD ?? '',
      pollMinutes: env.JT_POLL_MINUTES ?? 30,
      carrierName: env.JT_CARRIER_NAME ?? 'J&T Express',
    },
```

- [ ] **Step 7: Run the config specs**

```bash
pnpm exec vitest run src/config src/modules/jt/jt.config.spec.ts
```

Expected: PASS, including the existing `env.validation.spec.ts` and `configuration.spec.ts`.

- [ ] **Step 8: Commit**

```bash
git add small-house-commerce/backend/src/config small-house-commerce/backend/src/modules/jt
git commit -m "feat(jt): validated configuration for the tracking worker"
```

---

### Task 3: J&T client — two-level signing and one HTTP call

**Files:**
- Create: `small-house-commerce/backend/src/modules/jt/jt.types.ts`
- Create: `small-house-commerce/backend/src/modules/jt/jt.client.ts`
- Create: `small-house-commerce/backend/src/modules/jt/jt.client.spec.ts`

**Interfaces:**
- Consumes: `readJtConfig`, `JtConfig`.
- Produces:
  - `JtDetail { scanTime: string; desc?: string | null; scanTypeName: string; scanTypeCode: string; staffConcatPhone?: string | null; scanNetworkProvince?: string | null; scanNetworkCity?: string | null; scanNetworkArea?: string | null; sigPicUrl?: string | null; timeZone?: string | null }`
  - `class JtError extends Error { kind: 'DISABLED' | 'TRANSPORT' | 'NON_JSON' | 'BUSINESS' | 'SIGNATURE'; requestId?: string }`
  - `jtPasswordCipher(password: string): string`
  - `jtBodyDigest(customerCode: string, password: string, privateKey: string): string`
  - `jtHeaderDigest(bizContent: string, privateKey: string): string`
  - `JtClient.trace(billCode: string): Promise<JtDetail[]>`, `JtClient.enabled: boolean`

- [ ] **Step 1: Write the failing test**

Create `small-house-commerce/backend/src/modules/jt/jt.client.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  JtClient,
  JtError,
  jtBodyDigest,
  jtHeaderDigest,
  jtPasswordCipher,
} from './jt.client.js';

const values = {
  'jt.enabled': 'true',
  'jt.baseUrl': 'https://demoopenapi.jtexpress.ph/webopenplatformapi/api',
  'jt.apiAccount': '640826271705595946',
  'jt.privateKey': 'test-private-key',
  'jt.customerCode': 'J0086474299',
  'jt.customerPassword': 's3cret',
  'jt.pollMinutes': 30,
  'jt.carrierName': 'J&T Express',
};

const configOf = (overrides: Record<string, unknown> = {}) =>
  ({ get: (key: string) => ({ ...values, ...overrides })[key] }) as never;

const okBody = {
  code: '1',
  msg: 'success',
  data: {
    billCode: 'JT0000008101561',
    details: [
      {
        scanTime: '2026-05-09 09:57:32',
        desc: 'Your package has been Delivered',
        scanTypeName: 'Delivered',
        scanTypeCode: '113',
        staffConcatPhone: null,
        scanNetworkProvince: 'METRO-MANILA',
        scanNetworkCity: 'TAGUIG',
        sigPicUrl: null,
        timeZone: 'UTC+8',
      },
    ],
  },
  requestId: 'req-1',
};

function clientWith(response: Response | Error) {
  const request = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: new JtClient(configOf(), request as never), request };
}

describe('J&T signatures', () => {
  // Fixed vectors computed with node:crypto; they lock the algorithm.
  it('derives the password cipher', () => {
    expect(jtPasswordCipher('s3cret')).toBe('A91EFD85DD3C9E9D8689A420A2A7A9DE');
  });

  it('derives the body digest', () => {
    expect(jtBodyDigest('J0086474299', 's3cret', 'test-private-key')).toBe(
      'kkaZl0cj8DAH4wkeJ5DDaw==',
    );
  });

  it('derives the header digest', () => {
    const bizContent =
      '{"customerCode":"J0086474299","digest":"kkaZl0cj8DAH4wkeJ5DDaw==","billCode":"JT0000008101561"}';
    expect(jtHeaderDigest(bizContent, 'test-private-key')).toBe('2aDY86tkxV7uboypIkYhSw==');
  });
});

describe('JtClient.trace', () => {
  it('posts a form body whose bizContent is exactly the signed string', async () => {
    const { client, request } = clientWith(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );

    const details = await client.trace('JT0000008101561');

    expect(details).toHaveLength(1);
    expect(details[0].scanTypeCode).toBe('113');

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://demoopenapi.jtexpress.ph/webopenplatformapi/api/logistics/trace',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.apiAccount).toBe('640826271705595946');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const sent = new URLSearchParams(init.body as string).get('bizContent');
    expect(jtHeaderDigest(sent as string, 'test-private-key')).toBe(headers.digest);
    expect(JSON.parse(sent as string)).toEqual({
      customerCode: 'J0086474299',
      digest: 'kkaZl0cj8DAH4wkeJ5DDaw==',
      billCode: 'JT0000008101561',
    });
  });

  it('returns an empty list when the carrier has no scans yet', async () => {
    const { client } = clientWith(
      new Response(JSON.stringify({ code: '1', msg: 'success', data: null }), {
        status: 200,
      }),
    );
    await expect(client.trace('JT1')).resolves.toEqual([]);
  });

  it('surfaces a business rejection with its request id', async () => {
    const { client } = clientWith(
      new Response(
        JSON.stringify({ code: '0', msg: 'billCode not found', requestId: 'req-9' }),
        { status: 200 },
      ),
    );
    await expect(client.trace('JT1')).rejects.toMatchObject({
      kind: 'BUSINESS',
      message: 'billCode not found',
      requestId: 'req-9',
    });
  });

  it('marks a signing complaint as SIGNATURE', async () => {
    const { client } = clientWith(
      new Response(JSON.stringify({ code: '0', msg: 'sign error' }), { status: 200 }),
    );
    await expect(client.trace('JT1')).rejects.toMatchObject({ kind: 'SIGNATURE' });
  });

  it('rejects a non-JSON body', async () => {
    const { client } = clientWith(new Response('<html>502</html>', { status: 502 }));
    await expect(client.trace('JT1')).rejects.toMatchObject({ kind: 'NON_JSON' });
  });

  it('wraps a transport failure', async () => {
    const { client } = clientWith(new Error('socket hang up'));
    await expect(client.trace('JT1')).rejects.toMatchObject({ kind: 'TRANSPORT' });
  });

  it('refuses to call out when disabled', async () => {
    const request = vi.fn();
    const client = new JtClient(configOf({ 'jt.enabled': 'false' }), request as never);
    await expect(client.trace('JT1')).rejects.toBeInstanceOf(JtError);
    expect(request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
pnpm exec vitest run src/modules/jt/jt.client.spec.ts
```

Expected: FAIL — cannot resolve `./jt.client.js`.

- [ ] **Step 3: Define the wire types**

Create `small-house-commerce/backend/src/modules/jt/jt.types.ts`:

```ts
/** One scan as J&T reports it inside `data.details[]`. */
export interface JtDetail {
  scanTime: string;
  desc?: string | null;
  scanTypeName: string;
  scanTypeCode: string;
  staffConcatPhone?: string | null;
  scanNetworkProvince?: string | null;
  scanNetworkCity?: string | null;
  scanNetworkArea?: string | null;
  sigPicUrl?: string | null;
  timeZone?: string | null;
}

export interface JtEnvelope {
  code: string | number;
  msg?: string;
  data?: { billCode?: string; details?: JtDetail[] } | null;
  requestId?: string;
}
```

- [ ] **Step 4: Implement the client**

Create `small-house-commerce/backend/src/modules/jt/jt.client.ts`:

```ts
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readJtConfig, type JtConfig } from './jt.config.js';
import type { JtDetail, JtEnvelope } from './jt.types.js';

export type JtErrorKind =
  | 'DISABLED'
  | 'TRANSPORT'
  | 'NON_JSON'
  | 'BUSINESS'
  | 'SIGNATURE';

export class JtError extends Error {
  constructor(
    message: string,
    readonly kind: JtErrorKind,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'JtError';
  }
}

/** MD5(password + fixed salt), uppercase — J&T's "密文". */
export function jtPasswordCipher(password: string): string {
  return createHash('md5')
    .update(password + 'jadada236t2', 'utf8')
    .digest('hex')
    .toUpperCase();
}

/** Body-level digest: base64(MD5(customerCode + cipher + privateKey)). */
export function jtBodyDigest(
  customerCode: string,
  password: string,
  privateKey: string,
): string {
  return createHash('md5')
    .update(customerCode + jtPasswordCipher(password) + privateKey, 'utf8')
    .digest('base64');
}

/** Header digest: base64(MD5(bizContent + privateKey)) over the exact JSON sent. */
export function jtHeaderDigest(bizContent: string, privateKey: string): string {
  return createHash('md5')
    .update(bizContent + privateKey, 'utf8')
    .digest('base64');
}

const TIMEOUT_MS = 15_000;

/**
 * The only place that knows the J&T open-platform wire protocol: two-level
 * signing, a form-encoded `bizContent`, and one endpoint per feature. No
 * persistence and no retries — the worker owns cadence and backoff.
 */
@Injectable()
export class JtClient {
  private readonly logger = new Logger(JtClient.name);
  private readonly config: JtConfig;

  constructor(
    config: ConfigService,
    // Not a provider: optional keeps Nest from resolving it, and the default
    // lets tests inject a fake fetch.
    @Optional() private readonly request: typeof fetch = fetch,
  ) {
    this.config = readJtConfig(config);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async trace(billCode: string): Promise<JtDetail[]> {
    if (!this.config.enabled) {
      throw new JtError('J&T integration is disabled', 'DISABLED');
    }

    const bizContent = JSON.stringify({
      customerCode: this.config.customerCode,
      digest: jtBodyDigest(
        this.config.customerCode,
        this.config.customerPassword,
        this.config.privateKey,
      ),
      billCode,
    });
    const headerDigest = jtHeaderDigest(bizContent, this.config.privateKey);

    let response: Response;
    try {
      response = await this.request(`${this.config.baseUrl}/logistics/trace`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          apiAccount: this.config.apiAccount,
          digest: headerDigest,
          timestamp: String(Date.now()),
        },
        body: new URLSearchParams({ bizContent }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new JtError(
        `J&T request failed: ${(error as Error).message}`,
        'TRANSPORT',
      );
    }

    const text = await response.text();
    let parsed: JtEnvelope;
    try {
      parsed = JSON.parse(text) as JtEnvelope;
    } catch {
      throw new JtError(
        `J&T returned a non-JSON body (HTTP ${response.status})`,
        'NON_JSON',
      );
    }

    if (String(parsed.code) !== '1') {
      const message = parsed.msg || `J&T rejected the request (HTTP ${response.status})`;
      this.logger.warn(`J&T trace rejected: ${message}${parsed.requestId ? ` (${parsed.requestId})` : ''}`);
      throw new JtError(
        message,
        /sign|签名/i.test(message) ? 'SIGNATURE' : 'BUSINESS',
        parsed.requestId,
      );
    }

    const details = parsed.data?.details;
    return Array.isArray(details) ? details : [];
  }
}
```

- [ ] **Step 5: Run the test**

```bash
pnpm exec vitest run src/modules/jt/jt.client.spec.ts
```

Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/backend/src/modules/jt
git commit -m "feat(jt): signed client for the logistics trace endpoint"
```

---

### Task 4: Scan-code mapping

**Files:**
- Create: `small-house-commerce/backend/src/modules/jt/jt-tracking.mapper.ts`
- Create: `small-house-commerce/backend/src/modules/jt/jt-tracking.mapper.spec.ts`

**Interfaces:**
- Consumes: `JtDetail` from `jt.types.js`; `LogisticsStatus` and `RecordLogisticsEventInput` from `../orders/logistics-event.service.js` (the latter extended in Task 5 — this task's inputs may set the new optional fields before Task 5 lands; they are optional, so the mapper compiles either way).
- Produces:
  - `mapScanType(code: string): LogisticsStatus | null`
  - `parseScanTime(value: string): Date`
  - `toEventInput(detail: JtDetail): RecordLogisticsEventInput | null`

- [ ] **Step 1: Write the failing test**

Create `small-house-commerce/backend/src/modules/jt/jt-tracking.mapper.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapScanType, parseScanTime, toEventInput } from './jt-tracking.mapper.js';

const detail = (overrides: Record<string, unknown> = {}) => ({
  scanTime: '2026-05-09 09:57:32',
  desc: 'Your package has been Delivered',
  scanTypeName: 'Delivered',
  scanTypeCode: '113',
  staffConcatPhone: '9684746842',
  scanNetworkProvince: 'METRO-MANILA',
  scanNetworkCity: 'TAGUIG',
  sigPicUrl: 'https://example.test/sign.jpg',
  ...overrides,
});

describe('mapScanType', () => {
  it.each([
    ['106', 'SHIPPED'],
    ['109', 'IN_TRANSIT'],
    ['110', 'IN_TRANSIT'],
    ['112', 'OUT_FOR_DELIVERY'],
    ['113', 'SIGNED'],
    ['116', 'RETURNING'],
    ['117', 'RETURNED'],
    ['118', 'FAILED_DELIVERY'],
  ])('maps %s to %s', (code, expected) => {
    expect(mapScanType(code)).toBe(expected);
  });

  it('ignores codes it cannot classify', () => {
    expect(mapScanType('999')).toBeNull();
    expect(mapScanType('')).toBeNull();
  });
});

describe('parseScanTime', () => {
  it('reads the carrier timestamp as UTC+8, not as server-local time', () => {
    expect(parseScanTime('2026-05-09 09:57:32').toISOString()).toBe(
      '2026-05-09T01:57:32.000Z',
    );
  });
});

describe('toEventInput', () => {
  it('carries the carrier wording, rider phone and signature url', () => {
    const input = toEventInput(detail());
    expect(input).toEqual({
      normalizedStatus: 'SIGNED',
      externalEventId: '113:2026-05-09 09:57:32',
      externalStatus: 'Delivered',
      eventTime: new Date('2026-05-09T01:57:32.000Z'),
      province: 'METRO-MANILA',
      city: 'TAGUIG',
      description: 'Your package has been Delivered',
      staffContact: '9684746842',
      signatureImageUrl: 'https://example.test/sign.jpg',
    });
  });

  it('builds a stable id so a repeat poll is idempotent', () => {
    expect(toEventInput(detail())?.externalEventId).toBe(
      toEventInput(detail())?.externalEventId,
    );
  });

  it('returns null for an unmapped code', () => {
    expect(toEventInput(detail({ scanTypeCode: '999' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
pnpm exec vitest run src/modules/jt/jt-tracking.mapper.spec.ts
```

Expected: FAIL — cannot resolve `./jt-tracking.mapper.js`.

- [ ] **Step 3: Implement the mapper**

Create `small-house-commerce/backend/src/modules/jt/jt-tracking.mapper.ts`:

```ts
import type {
  LogisticsStatus,
  RecordLogisticsEventInput,
} from '../orders/logistics-event.service.js';
import type { JtDetail } from './jt.types.js';

/**
 * J&T scan codes we act on. Everything else is a node we cannot classify and
 * is dropped: a wrong guess would move the order state machine on hearsay.
 */
const SCAN_STATUS: Record<string, LogisticsStatus> = {
  '106': 'SHIPPED',
  '109': 'IN_TRANSIT',
  '110': 'IN_TRANSIT',
  '112': 'OUT_FOR_DELIVERY',
  '113': 'SIGNED',
  '116': 'RETURNING',
  '117': 'RETURNED',
  '118': 'FAILED_DELIVERY',
};

export function mapScanType(code: string): LogisticsStatus | null {
  return SCAN_STATUS[String(code).trim()] ?? null;
}

/**
 * J&T sends `yyyy-MM-dd HH:mm:ss` with no zone. It is UTC+8 (Philippine
 * local time), so it is pinned explicitly instead of being read as the
 * server's local time.
 */
export function parseScanTime(value: string): Date {
  return new Date(`${value.trim().replace(' ', 'T')}+08:00`);
}

export function toEventInput(detail: JtDetail): RecordLogisticsEventInput | null {
  const normalizedStatus = mapScanType(detail.scanTypeCode);
  if (!normalizedStatus) return null;
  const eventTime = parseScanTime(detail.scanTime);
  if (Number.isNaN(eventTime.getTime())) return null;

  return {
    normalizedStatus,
    externalEventId: `${detail.scanTypeCode.trim()}:${detail.scanTime.trim()}`,
    externalStatus: detail.scanTypeName,
    eventTime,
    province: detail.scanNetworkProvince ?? null,
    city: detail.scanNetworkCity ?? null,
    description: detail.desc ?? null,
    staffContact: detail.staffConcatPhone ?? null,
    signatureImageUrl: detail.sigPicUrl ?? null,
  };
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm exec vitest run src/modules/jt/jt-tracking.mapper.spec.ts
```

Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/jt
git commit -m "feat(jt): map carrier scan codes onto logistics event states"
```

---

### Task 5: Carry carrier detail through `LogisticsEventService`

**Files:**
- Modify: `small-house-commerce/backend/src/modules/orders/logistics-event.service.ts`
- Modify: `small-house-commerce/backend/src/modules/orders/logistics-event.service.spec.ts`

**Interfaces:**
- Consumes: the columns from Task 1.
- Produces: `RecordLogisticsEventInput` gains `description?`, `staffContact?`, `signatureImageUrl?`; `record()` persists them.

- [ ] **Step 1: Write the failing test**

Append to `small-house-commerce/backend/src/modules/orders/logistics-event.service.spec.ts`, inside the existing `describe`:

```ts
  it('stores the carrier wording, rider phone and signature url', async () => {
    const { service } = createHarness();
    const saved = await service.record(
      ORDER_ID,
      SHIPMENT_ID,
      event({
        normalizedStatus: 'SIGNED',
        externalEventId: '113:2026-05-09 09:57:32',
        description: 'Your package has been Delivered',
        staffContact: '9684746842',
        signatureImageUrl: 'https://example.test/sign.jpg',
      }),
    );

    expect(saved).toMatchObject({
      externalDescription: 'Your package has been Delivered',
      staffContact: '9684746842',
      signatureImageUrl: 'https://example.test/sign.jpg',
    });
  });
```

- [ ] **Step 2: Run it to see it fail**

```bash
pnpm exec vitest run src/modules/orders/logistics-event.service.spec.ts
```

Expected: FAIL — the saved row has `externalDescription: undefined`.

- [ ] **Step 3: Extend the service**

In `small-house-commerce/backend/src/modules/orders/logistics-event.service.ts`, add to `RecordLogisticsEventInput`:

```ts
  /** The carrier's own wording, kept verbatim for the guest timeline. */
  description?: string | null;
  /** Rider phone from the scan; shown to phone-verified guests only. */
  staffContact?: string | null;
  /** Delivery or problem photo; admin only. */
  signatureImageUrl?: string | null;
```

In `record()`'s `prisma.logisticsEvent.create({ data: { … } })`, after `rawPayloadReference`:

```ts
        externalDescription: input.description ?? null,
        staffContact: input.staffContact ?? null,
        signatureImageUrl: input.signatureImageUrl ?? null,
```

- [ ] **Step 4: Run the test**

```bash
pnpm exec vitest run src/modules/orders/logistics-event.service.spec.ts
```

Expected: PASS (all existing tests plus the new one).

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/orders/logistics-event.service.ts small-house-commerce/backend/src/modules/orders/logistics-event.service.spec.ts
git commit -m "feat(orders): keep carrier wording and rider phone on logistics events"
```

---

### Task 6: Let a carrier drive `sign()` with an auditable source

**Files:**
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.ts:2153-2310` (`sign`)
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `sign(orderId: string, shipmentId: string, operatorId: string | null, options?: { source?: 'ADMIN' | 'CARRIER'; comment?: string })`. Existing admin callers keep passing a string and no options.

- [ ] **Step 1: Write the failing test**

Append to `small-house-commerce/backend/src/modules/orders/orders.service.spec.ts`, inside `describe('OrdersService.sign (§69)', …)`. It reuses the file's existing `createHarness()`:

```ts
  it('records a carrier-driven signature with source CARRIER and no operator', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderStatus: 'SHIPPING',
      items: [{ id: 'line-1', quantity: 1 }],
      shipments: [
        {
          id: 'ship-1',
          status: 'SHIPPING',
          carrier: 'J&T Express',
          trackingNumber: 'JT-1',
          items: [{ orderItemId: 'line-1', quantity: 1 }],
        },
      ],
    });
    tx.shipment = {
      update: vi.fn(async () => ({ status: 'SIGNED' })),
      count: vi.fn(async () => 0),
    };
    tx.orderNote = { create: vi.fn(async () => ({})) };

    const out = await service.sign('order-1', 'ship-1', null, { source: 'CARRIER' });

    expect(out.orderStatus).toBe('SIGNED');
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: 'CARRIER', operatorId: null }),
    });
    expect(tx.orderNote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null }),
    });
  });
```

- [ ] **Step 2: Run it to see it fail**

```bash
pnpm exec vitest run src/modules/orders/orders.service.spec.ts -t "carrier-driven"
```

Expected: FAIL — `source` is `'ADMIN'` and the fourth argument is ignored.

- [ ] **Step 3: Change the signature and the write**

In `small-house-commerce/backend/src/modules/orders/orders.service.ts`:

```ts
export interface SignShipmentOptions {
  /** Who drove the transition; carrier data and a human click must be distinguishable. */
  source?: 'ADMIN' | 'CARRIER';
  comment?: string;
}
```

Change the method declaration:

```ts
  async sign(
    orderId: string,
    shipmentId: string,
    operatorId: string | null,
    options: SignShipmentOptions = {},
  ) {
```

In the `orderStatusHistory.create` data:

```ts
            source: options.source ?? 'ADMIN',
            operatorId,
            comment:
              options.comment ??
              (hasReturnedUnits
                ? 'Remaining goods signed; some units were returned'
                : 'All shipments signed'),
```

In the `orderNote.create` content:

```ts
          content: `Shipment signed (${shipment.carrier}${shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ''})${options.source === 'CARRIER' ? ' · reported by carrier' : ''}`,
```

- [ ] **Step 4: Run the order specs**

```bash
pnpm exec vitest run src/modules/orders
```

Expected: PASS. Existing sign tests still see `source: 'ADMIN'`.

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/orders/orders.service.ts small-house-commerce/backend/src/modules/orders/orders.service.spec.ts
git commit -m "feat(orders): distinguish a carrier-driven signature from an admin one"
```

---

### Task 7: The tracking worker

**Files:**
- Create: `small-house-commerce/backend/src/modules/jt/jt-tracking.service.ts`
- Create: `small-house-commerce/backend/src/modules/jt/jt-tracking.service.spec.ts`

**Interfaces:**
- Consumes: `JtClient.trace`, `toEventInput`, `parseScanTime`, `LogisticsEventService.record`, `OrdersService.sign`, the new columns.
- Produces:
  - `trackingBackoffMs(failures: number): number`
  - `isTrackingDue(row, now): boolean`
  - `JtTrackingService.tick(now?): Promise<{ checked: number; appended: number; failed: number }>`
  - `JtTrackingService.refreshShipment(orderId: string | null, shipmentId: string): Promise<{ appended: number; skipped: number; signed: boolean }>`
  - `JtTrackingService.health(): Promise<{ enabled: boolean; lastTickAt: string | null; lastFetched: number; lastFailed: number; pendingShipments: number; lastError: string | null }>`

- [ ] **Step 1: Write the failing test**

Create `small-house-commerce/backend/src/modules/jt/jt-tracking.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogisticsEventService } from '../orders/logistics-event.service.js';
import { JtTrackingService, isTrackingDue, trackingBackoffMs } from './jt-tracking.service.js';

const O1 = '00000000-0000-4000-8000-0000000000a1';
const O2 = '00000000-0000-4000-8000-0000000000a2';
const S1 = '00000000-0000-4000-8000-0000000000b1';
const S2 = '00000000-0000-4000-8000-0000000000b2';
const S3 = '00000000-0000-4000-8000-0000000000b3';

const NOW = Date.parse('2026-10-28T10:00:00.000Z');

const delivered = {
  scanTime: '2026-10-28 09:00:00',
  desc: 'Your package has been Delivered',
  scanTypeName: 'Delivered',
  scanTypeCode: '113',
  staffConcatPhone: '9684746842',
  scanNetworkCity: 'TAGUIG',
  sigPicUrl: 'https://example.test/sign.jpg',
};

const inTransit = {
  scanTime: '2026-10-28 08:00:00',
  desc: 'Arrival at sorting centre',
  scanTypeName: 'Arrival',
  scanTypeCode: '110',
};

function createHarness(details = [delivered, inTransit]) {
  const shipments = [
    {
      id: S1, orderId: O1, carrier: 'J&T Express', status: 'SHIPPING',
      trackingNumber: 'JT1', shippedAt: new Date('2026-10-27T02:00:00.000Z'),
      trackingCheckedAt: null, trackingFailures: 0, trackingError: null,
    },
    {
      id: S2, orderId: O2, carrier: 'LBC', status: 'SHIPPING',
      trackingNumber: 'LBC1', shippedAt: new Date('2026-10-27T02:00:00.000Z'),
      trackingCheckedAt: null, trackingFailures: 0, trackingError: null,
    },
    {
      id: S3, orderId: O2, carrier: 'J&T Express', status: 'SIGNED',
      trackingNumber: 'JT3', shippedAt: new Date('2026-10-26T02:00:00.000Z'),
      trackingCheckedAt: null, trackingFailures: 0, trackingError: null,
    },
  ];
  const orders = [
    { id: O1, orderStatus: 'SHIPPING' },
    { id: O2, orderStatus: 'SHIPPING' },
  ];
  const events: Array<Record<string, any>> = [];
  let seq = 0;

  const matches = (row: Record<string, any>, where: Record<string, any>) => {
    if (where.status && row.status !== where.status) return false;
    if (where.trackingNumber?.not === null && row.trackingNumber == null) return false;
    if (where.carrier?.equals) {
      const want = String(where.carrier.equals).toLowerCase();
      if (String(row.carrier).toLowerCase() !== want) return false;
    }
    return true;
  };

  const prisma = {
    shipment: {
      findMany: vi.fn(async ({ where }: any) =>
        shipments.filter((row) => matches(row, where)),
      ),
      findUnique: vi.fn(async ({ where }: any) =>
        shipments.find((row) => row.id === where.id) ?? null,
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const row = shipments.find((s) => s.id === where.id)!;
        if (data.trackingFailures?.increment) {
          row.trackingFailures += data.trackingFailures.increment;
        } else if (typeof data.trackingFailures === 'number') {
          row.trackingFailures = data.trackingFailures;
        }
        for (const key of ['trackingCheckedAt', 'trackingError'] as const) {
          if (key in data) (row as any)[key] = data[key];
        }
        return row;
      }),
      count: vi.fn(async ({ where }: any) =>
        shipments.filter((row) => matches(row, where)).length,
      ),
    },
    logisticsEvent: {
      findMany: vi.fn(async ({ where }: any) =>
        events.filter((e) => e.shipmentId === where.shipmentId),
      ),
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = events
          .filter(
            (e) =>
              e.shipmentId === where.shipmentId &&
              (where.externalEventId === undefined ||
                e.externalEventId === where.externalEventId) &&
              (!where.normalizedStatus || e.normalizedStatus === where.normalizedStatus) &&
              (!where.eventTime ||
                (e.eventTime as Date).getTime() === where.eventTime.getTime()),
          )
          .sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
        return rows[0] ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `ev-${++seq}`, ...data };
        events.push(row);
        return row;
      }),
    },
    order: {
      findUnique: vi.fn(async ({ where }: any) =>
        orders.find((o) => o.id === where.id) ?? null,
      ),
    },
  };

  const client = {
    enabled: true,
    trace: vi.fn(async () => details),
  };
  const ordersService = { sign: vi.fn(async () => ({})) };
  const eventsService = new LogisticsEventService(prisma as never);
  const config = {
    get: (key: string) =>
      ({
        'jt.enabled': 'true',
        'jt.carrierName': 'J&T Express',
        'jt.pollMinutes': 30,
      })[key],
  } as never;

  const service = new JtTrackingService(
    prisma as never,
    client as never,
    eventsService,
    ordersService as never,
    config,
    { gapMs: 0 },
  );

  return { service, client, ordersService, prisma, shipments, events };
}

describe('backoff', () => {
  it('escalates and caps', () => {
    expect(trackingBackoffMs(0)).toBe(0);
    expect(trackingBackoffMs(1)).toBe(60 * 60 * 1000);
    expect(trackingBackoffMs(2)).toBe(6 * 60 * 60 * 1000);
    expect(trackingBackoffMs(5)).toBe(24 * 60 * 60 * 1000);
  });

  it('treats a never-checked shipment as due', () => {
    expect(
      isTrackingDue(
        { trackingCheckedAt: null, trackingFailures: 0, shippedAt: new Date(NOW) },
        NOW,
      ),
    ).toBe(true);
  });

  it('holds a recently failed shipment until its backoff passes', () => {
    expect(
      isTrackingDue(
        {
          trackingCheckedAt: new Date(NOW - 10 * 60 * 1000),
          trackingFailures: 1,
          shippedAt: new Date(NOW - 24 * 60 * 60 * 1000),
        },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('JtTrackingService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('polls only SHIPPING J&T boxes, case-insensitively on the carrier', async () => {
    const { service, client } = createHarness();
    await service.tick(NOW);

    expect(client.trace).toHaveBeenCalledTimes(1);
    expect(client.trace).toHaveBeenCalledWith('JT1');
  });

  it('records every mapped scan and signs the delivery once', async () => {
    const { service, events, ordersService, shipments } = createHarness();
    const result = await service.tick(NOW);

    expect(result).toMatchObject({ checked: 1, appended: 2, failed: 0 });
    expect(events.map((e) => e.normalizedStatus).sort()).toEqual([
      'IN_TRANSIT',
      'SIGNED',
    ]);
    expect(ordersService.sign).toHaveBeenCalledWith(O1, S1, null, {
      source: 'CARRIER',
    });
    expect(shipments[0].trackingCheckedAt).toBeInstanceOf(Date);
    expect(shipments[0].trackingFailures).toBe(0);
  });

  it('does not duplicate events when the same waybill is polled twice', async () => {
    const { service, events, shipments } = createHarness();
    await service.tick(NOW);
    shipments[0].trackingCheckedAt = null; // force a second poll now
    await service.tick(NOW + 1000);

    expect(events).toHaveLength(2);
  });

  it('records a delivery without failing the poll when the carrier-driven sign is refused', async () => {
    const { service, ordersService, shipments } = createHarness();
    ordersService.sign.mockRejectedValueOnce(new Error('Order is CANCELLED'));

    const result = await service.tick(NOW);

    expect(result.failed).toBe(0);
    expect(shipments[0].trackingError).toBeNull();
  });

  it('increments failures and stores the error when the carrier rejects', async () => {
    const { service, client, shipments } = createHarness();
    client.trace.mockRejectedValueOnce(new Error('billCode not found'));

    const result = await service.tick(NOW);

    expect(result.failed).toBe(1);
    expect(shipments[0].trackingFailures).toBe(1);
    expect(shipments[0].trackingError).toBe('billCode not found');
  });

  it('resets the failure counter after a successful poll', async () => {
    const { service, shipments } = createHarness();
    shipments[0].trackingFailures = 2;

    await service.refreshShipment(O1, S1);

    expect(shipments[0].trackingFailures).toBe(0);
    expect(shipments[0].trackingError).toBeNull();
  });

  it('never changes status for a return scan', async () => {
    const { service, ordersService, events } = createHarness([
      {
        scanTime: '2026-10-28 09:00:00',
        desc: 'Return delivered',
        scanTypeName: 'Return Delivered',
        scanTypeCode: '117',
      },
    ]);

    await service.tick(NOW);

    expect(events[0].normalizedStatus).toBe('RETURNED');
    expect(ordersService.sign).not.toHaveBeenCalled();
  });

  it('reports health without touching the carrier', async () => {
    const { service, client } = createHarness();
    const health = await service.health();

    expect(health.enabled).toBe(true);
    expect(health.pendingShipments).toBe(2);
    expect(client.trace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
pnpm exec vitest run src/modules/jt/jt-tracking.service.spec.ts
```

Expected: FAIL — cannot resolve `./jt-tracking.service.js`.

- [ ] **Step 3: Implement the worker**

Create `small-house-commerce/backend/src/modules/jt/jt-tracking.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LogisticsEventService } from '../orders/logistics-event.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { JtClient } from './jt.client.js';
import { readJtConfig, type JtConfig } from './jt.config.js';
import { parseScanTime, toEventInput } from './jt-tracking.mapper.js';

const CANDIDATE_SCAN = 200;
const BATCH_LIMIT = 25;
const DEFAULT_GAP_MS = 200;
const STALE_SHIPMENT_MS = 30 * 24 * 60 * 60 * 1000;

export function trackingBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  if (failures === 1) return 60 * 60 * 1000;
  if (failures === 2) return 6 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

export interface TrackingDueRow {
  trackingCheckedAt: Date | null;
  trackingFailures: number;
  shippedAt: Date;
}

export function isTrackingDue(row: TrackingDueRow, now: number): boolean {
  if (!row.trackingCheckedAt) return true;
  const age = now - new Date(row.shippedAt).getTime();
  const stale = age > STALE_SHIPMENT_MS ? 24 * 60 * 60 * 1000 : 0;
  const required = Math.max(trackingBackoffMs(row.trackingFailures), stale);
  return now - new Date(row.trackingCheckedAt).getTime() >= required;
}

export interface JtTickSummary {
  checked: number;
  appended: number;
  failed: number;
}

export interface JtRefreshResult {
  appended: number;
  skipped: number;
  signed: boolean;
}

export interface JtTrackingHealth {
  enabled: boolean;
  lastTickAt: string | null;
  lastFetched: number;
  lastFailed: number;
  pendingShipments: number;
  lastError: string | null;
}

export interface JtTrackingOptions {
  gapMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls J&T for every shipped waybill.
 *
 * The carrier is the source of scans, never of state: events are append-only
 * facts, and the only state change this worker makes is the existing sign
 * flow, triggered by a Delivered scan. Return and problem scans are recorded
 * and nothing more — RTO still has to be counted in by hand.
 */
@Injectable()
export class JtTrackingService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JtTrackingService.name);
  private readonly config: JtConfig;
  private readonly gapMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastTickAt: Date | null = null;
  private lastFetched = 0;
  private lastFailed = 0;
  private lastError: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: JtClient,
    private readonly events: LogisticsEventService,
    private readonly orders: OrdersService,
    config: ConfigService,
    @Optional() options: JtTrackingOptions = {},
  ) {
    this.config = readJtConfig(config);
    this.gapMs = options.gapMs ?? DEFAULT_GAP_MS;
  }

  get enabled(): boolean {
    return this.client.enabled;
  }

  onModuleInit(): void {
    if (!this.client.enabled || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, this.config.pollMinutes * 60_000);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = Date.now()): Promise<JtTickSummary> {
    if (!this.client.enabled || this.running) {
      return { checked: 0, appended: 0, failed: 0 };
    }
    this.running = true;
    let checked = 0;
    let appended = 0;
    let failed = 0;
    try {
      const rows = await this.prisma.shipment.findMany({
        where: {
          status: 'SHIPPING',
          trackingNumber: { not: null },
          carrier: { equals: this.config.carrierName, mode: 'insensitive' },
        },
        orderBy: { shippedAt: 'asc' },
        take: CANDIDATE_SCAN,
        select: {
          id: true,
          shippedAt: true,
          trackingCheckedAt: true,
          trackingFailures: true,
        },
      });
      const due = rows.filter((row) => isTrackingDue(row, now)).slice(0, BATCH_LIMIT);

      for (const row of due) {
        if (checked > 0 && this.gapMs > 0) await sleep(this.gapMs);
        checked += 1;
        try {
          const result = await this.refreshShipment(null, row.id);
          appended += result.appended;
        } catch (error) {
          failed += 1;
          this.lastError = (error as Error).message;
          this.logger.warn(`J&T poll failed for shipment ${row.id}: ${this.lastError}`);
        }
      }

      this.lastTickAt = new Date(now);
      this.lastFetched = checked - failed;
      this.lastFailed = failed;
      return { checked, appended, failed };
    } finally {
      this.running = false;
    }
  }

  async refreshShipment(
    orderId: string | null,
    shipmentId: string,
  ): Promise<JtRefreshResult> {
    if (!this.client.enabled) {
      throw new ConflictException('J&T tracking is disabled');
    }
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (orderId && shipment.orderId !== orderId) {
      throw new NotFoundException('Shipment not found for this order');
    }
    if (!shipment.trackingNumber) {
      throw new BadRequestException('Shipment has no tracking number');
    }

    try {
      const details = await this.client.trace(shipment.trackingNumber);
      const existing = new Set(
        (
          await this.prisma.logisticsEvent.findMany({
            where: { shipmentId },
            select: { externalEventId: true },
          })
        ).map((event) => event.externalEventId),
      );

      const ordered = [...details].sort(
        (a, b) => parseScanTime(a.scanTime).getTime() - parseScanTime(b.scanTime).getTime(),
      );

      let appended = 0;
      let skipped = 0;
      for (const detail of ordered) {
        const input = toEventInput(detail);
        if (!input) {
          skipped += 1;
          this.logger.warn(
            `Unmapped J&T scan ${detail.scanTypeCode} on ${shipment.trackingNumber}`,
          );
          continue;
        }
        if (!existing.has(input.externalEventId ?? null)) appended += 1;
        await this.events.record(shipment.orderId, shipmentId, input);
      }

      const signed = await this.signIfDelivered(shipment.orderId, shipmentId);

      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          trackingCheckedAt: new Date(),
          trackingError: null,
          trackingFailures: 0,
        },
      });

      return { appended, skipped, signed };
    } catch (error) {
      const message = (error as Error).message.slice(0, 300);
      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          trackingCheckedAt: new Date(),
          trackingError: message,
          trackingFailures: { increment: 1 },
        },
      });
      throw error;
    }
  }

  async health(): Promise<JtTrackingHealth> {
    const pendingShipments = await this.prisma.shipment.count({
      where: {
        status: 'SHIPPING',
        trackingNumber: { not: null },
        carrier: { equals: this.config.carrierName, mode: 'insensitive' },
      },
    });
    return {
      enabled: this.client.enabled,
      lastTickAt: this.lastTickAt ? this.lastTickAt.toISOString() : null,
      lastFetched: this.lastFetched,
      lastFailed: this.lastFailed,
      pendingShipments,
      lastError: this.lastError,
    };
  }

  /**
   * A Delivered scan signs the box through the normal sign flow. Anything the
   * sign flow refuses (order already closed, after-sales, cancelled) is logged
   * and left alone: the scan itself is already recorded.
   */
  private async signIfDelivered(orderId: string, shipmentId: string): Promise<boolean> {
    const newest = await this.prisma.logisticsEvent.findFirst({
      where: { shipmentId },
      orderBy: { eventTime: 'desc' },
      select: { normalizedStatus: true },
    });
    if (!newest || newest.normalizedStatus !== 'SIGNED') return false;

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { status: true },
    });
    if (!shipment || shipment.status !== 'SHIPPING') return false;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true },
    });
    if (!order || order.orderStatus !== 'SHIPPING') {
      this.logger.log(
        `J&T reports ${shipmentId} delivered but order ${orderId} is ${order?.orderStatus ?? 'missing'}`,
      );
      return false;
    }

    try {
      await this.orders.sign(orderId, shipmentId, null, { source: 'CARRIER' });
      return true;
    } catch (error) {
      this.logger.warn(
        `Auto-sign refused for shipment ${shipmentId}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm exec vitest run src/modules/jt/jt-tracking.service.spec.ts
```

Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add small-house-commerce/backend/src/modules/jt
git commit -m "feat(jt): poll carrier scans and auto-sign deliveries"
```

---

### Task 8: Wire the module and expose admin endpoints

**Files:**
- Create: `small-house-commerce/backend/src/modules/jt/jt-admin.controller.ts`
- Create: `small-house-commerce/backend/src/modules/jt/jt-admin.controller.spec.ts`
- Create: `small-house-commerce/backend/src/modules/jt/jt.module.ts`
- Modify: `small-house-commerce/backend/src/modules/orders/orders.module.ts` (export `OrdersService`)
- Modify: `small-house-commerce/backend/src/app.module.ts`

**Interfaces:**
- Consumes: `JtTrackingService.health`, `JtTrackingService.refreshShipment`, `JtClient`.
- Produces:
  - `GET /api/v1/admin/jt/status` → `JtTrackingHealth`
  - `POST /api/v1/admin/orders/:id/shipments/:shipmentId/tracking/refresh` → `JtRefreshResult`, `409` when disabled

- [ ] **Step 1: Write the failing test**

Create `small-house-commerce/backend/src/modules/jt/jt-admin.controller.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminJtController, JtShipmentTrackingController } from './jt-admin.controller.js';

const tracking = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  health: vi.fn(async () => ({ enabled: true })),
  refreshShipment: vi.fn(async () => ({ appended: 2, skipped: 0, signed: true })),
  ...overrides,
});

describe('AdminJtController', () => {
  it('returns the worker health', async () => {
    const service = tracking();
    const controller = new AdminJtController(service as never);
    await expect(controller.status()).resolves.toEqual({ enabled: true });
  });
});

describe('JtShipmentTrackingController', () => {
  it('refreshes one shipment on demand', async () => {
    const service = tracking();
    const controller = new JtShipmentTrackingController(service as never);
    await expect(controller.refresh('order-1', 'shipment-1')).resolves.toEqual({
      appended: 2,
      skipped: 0,
      signed: true,
    });
    expect(service.refreshShipment).toHaveBeenCalledWith('order-1', 'shipment-1');
  });

  it('refuses with 409 when the integration is off', async () => {
    const service = tracking({ enabled: false });
    const controller = new JtShipmentTrackingController(service as never);
    await expect(controller.refresh('order-1', 'shipment-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(service.refreshShipment).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
pnpm exec vitest run src/modules/jt/jt-admin.controller.spec.ts
```

Expected: FAIL — cannot resolve `./jt-admin.controller.js`.

- [ ] **Step 3: Implement the controllers**

Create `small-house-commerce/backend/src/modules/jt/jt-admin.controller.ts`:

```ts
import {
  ConflictException,
  Controller,
  Get,
  Header,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { JtTrackingService } from './jt-tracking.service.js';

/** Read-only worker health for the admin status page. */
@Controller('admin/jt')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class AdminJtController {
  constructor(private readonly tracking: JtTrackingService) {}

  @Get('status')
  @Header('Cache-Control', 'private, no-store')
  status() {
    return this.tracking.health();
  }
}

/**
 * On-demand refresh for one box. Lives here rather than in OrdersModule so the
 * dependency only flows one way: JtModule imports OrdersModule, never the
 * reverse.
 */
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JtShipmentTrackingController {
  constructor(private readonly tracking: JtTrackingService) {}

  @Post(':id/shipments/:shipmentId/tracking/refresh')
  @Permissions('SHIPMENT_CREATE')
  refresh(
    @Param('id') id: string,
    @Param('shipmentId') shipmentId: string,
  ) {
    if (!this.tracking.enabled) {
      throw new ConflictException('J&T tracking is disabled');
    }
    return this.tracking.refreshShipment(id, shipmentId);
  }
}
```

- [ ] **Step 4: Create the module**

Create `small-house-commerce/backend/src/modules/jt/jt.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LogisticsEventService } from '../orders/logistics-event.service.js';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminJtController, JtShipmentTrackingController } from './jt-admin.controller.js';
import { JtClient } from './jt.client.js';
import { JtTrackingService } from './jt-tracking.service.js';

/**
 * J&T Express tracking.
 *
 * `LogisticsEventService` is provided locally rather than imported: OrdersModule
 * does not export it, and the provider is stateless. OrdersModule is imported
 * for `OrdersService.sign` and exports it one-way — OrdersModule never imports
 * this module, so there is no cycle.
 */
@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [AdminJtController, JtShipmentTrackingController],
  providers: [JtClient, JtTrackingService, LogisticsEventService],
  exports: [JtClient, JtTrackingService],
})
export class JtModule {}
```

- [ ] **Step 5: Export `OrdersService` and register the module**

In `small-house-commerce/backend/src/modules/orders/orders.module.ts`, add to the `@Module` decorator:

```ts
  exports: [OrdersService],
```

In `small-house-commerce/backend/src/app.module.ts`, add the import next to `QianyiModule`:

```ts
import { JtModule } from './modules/jt/jt.module.js';
```

and to the `imports` array after `QianyiModule`:

```ts
    JtModule,
```

- [ ] **Step 6: Run the tests and boot the app**

```bash
pnpm exec vitest run src/modules/jt src/modules/orders
pnpm build
```

Expected: tests PASS, build succeeds with no circular-dependency warning.

- [ ] **Step 7: Commit**

```bash
git add small-house-commerce/backend/src/modules/jt small-house-commerce/backend/src/modules/orders/orders.module.ts small-house-commerce/backend/src/app.module.ts
git commit -m "feat(jt): module wiring, admin health and on-demand refresh"
```

---

### Task 9: Guest order fields behind the phone check

**Files:**
- Modify: `small-house-commerce/backend/src/modules/orders/orders.service.ts` (`GUEST_ORDER_INCLUDE`, `guestOrder`, the three `lookup` call sites)
- Modify: `small-house-commerce/backend/src/modules/orders/orders.guest-lookup.spec.ts`

**Interfaces:**
- Consumes: `LogisticsEvent.externalDescription`, `.staffContact`.
- Produces: guest `shipment.tracking[]` entries become `{ status, at, description: string | null, riderPhone: string | null }`.

- [ ] **Step 1: Write the failing test**

Append to `small-house-commerce/backend/src/modules/orders/orders.guest-lookup.spec.ts`, using the existing harness in that file:

```ts
  it('hides the carrier wording and rider phone when only the order number is given', async () => {
    const { service } = harnessWith({
      events: [
        {
          normalizedStatus: 'SIGNED',
          eventTime: new Date('2026-10-28T01:00:00.000Z'),
          externalDescription: 'Your package has been Delivered',
          staffContact: '9684746842',
        },
      ],
      phone: '09171234567',
    });

    const result = await service.lookup('ORD-000001', null);
    const tracking = result.orders[0].shipment?.tracking ?? [];

    expect(tracking[0]).toMatchObject({
      status: 'SIGNED',
      description: null,
      riderPhone: null,
    });
  });

  it('returns the carrier wording once the phone matches', async () => {
    const { service } = harnessWith({
      events: [
        {
          normalizedStatus: 'SIGNED',
          eventTime: new Date('2026-10-28T01:00:00.000Z'),
          externalDescription: 'Your package has been Delivered',
          staffContact: '9684746842',
        },
      ],
      phone: '09171234567',
    });

    const result = await service.lookup('ORD-000001', '09171234567');
    const tracking = result.orders[0].shipment?.tracking ?? [];

    expect(tracking[0]).toMatchObject({
      description: 'Your package has been Delivered',
      riderPhone: '9684746842',
    });
  });
```

`harnessWith({ events, phone })` must reuse the lookup harness already in this spec file: build one order whose guest include returns a shipment with those events and a customer whose phone is `phone`. If the existing harness has a different name, extend it rather than adding a second one.

- [ ] **Step 2: Run it to see it fail**

```bash
pnpm exec vitest run src/modules/orders/orders.guest-lookup.spec.ts
```

Expected: FAIL — `description` and `riderPhone` are `undefined`.

- [ ] **Step 3: Select the new columns**

In `small-house-commerce/backend/src/modules/orders/orders.service.ts`, inside `GUEST_ORDER_INCLUDE`'s shipment events `select`:

```ts
        select: {
          normalizedStatus: true,
          eventTime: true,
          externalDescription: true,
          staffContact: true,
        },
```

Update the inline type used by `guestOrder` to include `externalDescription: string | null; staffContact: string | null` on the event shape (both nullable).

- [ ] **Step 4: Thread the flag and map the fields**

Change the signature to:

```ts
  private guestOrder<T extends { … }>(order: T, personalDetailsIncluded: boolean) {
```

and the tracking mapping to:

```ts
          tracking: (shipments[0].events ?? []).map((event) => ({
            status: event.normalizedStatus,
            at: iso(event.eventTime),
            description: personalDetailsIncluded
              ? (event.externalDescription ?? null)
              : null,
            riderPhone: personalDetailsIncluded ? (event.staffContact ?? null) : null,
          })),
```

Update the three call sites in `lookup()`:

```ts
              ...this.guestOrder(order, false),
```

```ts
        orders: [this.guestOrder(order, true)],
```

```ts
      orders: orders.map((order) => this.guestOrder(order, true)),
```

- [ ] **Step 5: Run the order specs**

```bash
pnpm exec vitest run src/modules/orders
```

Expected: PASS, including the two new tests.

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/backend/src/modules/orders
git commit -m "feat(orders): expose carrier wording to phone-verified guests only"
```

---

### Task 10: Storefront tracking timeline

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/guestOrder.ts` (shipment tracking type)
- Modify: `small-house-commerce/frontend/src/components/track-order/OrderList.tsx:497-510`
- Modify: `small-house-commerce/frontend/src/components/track-order/OrderList.spec.tsx`

**Interfaces:**
- Consumes: the guest API shape from Task 9.
- Produces: nothing exported.

- [ ] **Step 1: Write the failing test**

In `small-house-commerce/frontend/src/components/track-order/OrderList.spec.tsx`, inside `describe("carrier tracking", …)`:

```tsx
  it("shows the carrier wording and rider phone under the node", () => {
    renderList(
      result({
        orders: [
          order({
            orderStatus: "SHIPPING",
            shipment: {
              carrier: "J&T Express",
              trackingNumber: "JT0000008101561",
              shippedAt: "2026-10-28T02:00:00.000Z",
              signedAt: null,
              tracking: [
                {
                  status: "OUT_FOR_DELIVERY",
                  at: "2026-10-29T02:00:00.000Z",
                  description: "Your package Out for Delivery - prepare exact amount",
                  riderPhone: "9684746842",
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(
      screen.getByText("Your package Out for Delivery - prepare exact amount"),
    ).toBeInTheDocument();
    const call = screen.getByRole("link", { name: "9684746842" });
    expect(call).toHaveAttribute("href", "tel:9684746842");
  });

  it("renders a node with no carrier wording without an empty line", () => {
    renderList(
      result({
        orders: [
          order({
            orderStatus: "SHIPPING",
            shipment: {
              carrier: "J&T Express",
              trackingNumber: "JT1",
              shippedAt: "2026-10-28T02:00:00.000Z",
              signedAt: null,
              tracking: [
                { status: "IN_TRANSIT", at: "2026-10-29T02:00:00.000Z", description: null, riderPhone: null },
              ],
            },
          }),
        ],
      }),
    );

    expect(screen.getByText("In transit")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd small-house-commerce/frontend && pnpm exec vitest run src/components/track-order/OrderList.spec.tsx
```

Expected: FAIL — the description text is not rendered.

- [ ] **Step 3: Widen the type**

In `small-house-commerce/frontend/src/lib/guestOrder.ts`:

```ts
  tracking: Array<{
    status: string;
    at: string;
    /** J&T's own wording; null until the shopper verifies the phone. */
    description?: string | null;
    /** Rider phone; null until the shopper verifies the phone. */
    riderPhone?: string | null;
  }>;
```

- [ ] **Step 4: Render the new lines**

In `OrderList.tsx`, replace the `<li>` body of the tracking list with:

```tsx
                  <li key={`${event.status}-${event.at}`}>
                    <span className="font-medium text-ink">
                      {TRACKING_LABELS[event.status] ?? event.status}
                    </span>
                    <span className="ml-2 text-ink-secondary">{formatDate(event.at)}</span>
                    {event.description ? (
                      <p className="mt-0.5 text-[12px] leading-5 text-ink-muted">
                        {event.description}
                      </p>
                    ) : null}
                    {event.riderPhone ? (
                      <a
                        href={`tel:${event.riderPhone}`}
                        className="mt-0.5 block text-[12px] font-medium text-cta underline-offset-2 hover:underline"
                      >
                        {event.riderPhone}
                      </a>
                    ) : null}
                  </li>
```

- [ ] **Step 5: Run the test**

```bash
pnpm exec vitest run src/components/track-order/OrderList.spec.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add small-house-commerce/frontend/src/lib/guestOrder.ts small-house-commerce/frontend/src/components/track-order
git commit -m "feat(track-order): show carrier wording and rider phone"
```

---

### Task 11: Admin surface — status card, refresh button, carrier preset

**Files:**
- Modify: `small-house-commerce/frontend/src/lib/admin-api.ts` (`AdminLogisticsEvent`, new status type, two calls)
- Create: `small-house-commerce/frontend/src/components/admin/system-status/JtTrackingHealthCard.tsx`
- Create: `small-house-commerce/frontend/src/components/admin/system-status/JtTrackingHealthCard.spec.tsx`
- Modify: `small-house-commerce/frontend/src/app/admin/(shell)/status/page.tsx`
- Modify: `small-house-commerce/frontend/src/components/admin/orders/workbench/FulfillmentDialog.tsx` (carrier preset)
- Modify: `small-house-commerce/frontend/src/components/admin/orders/workbench/OrderDrawer.tsx` (refresh button + event detail)
- Modify: `small-house-commerce/frontend/src/i18n/en.ts`, `small-house-commerce/frontend/src/i18n/zh.ts`

**Interfaces:**
- Consumes: Tasks 8 and 9 endpoints/fields.
- Produces: nothing exported.

- [ ] **Step 1: Write the failing card test**

Create `small-house-commerce/frontend/src/components/admin/system-status/JtTrackingHealthCard.spec.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JtTrackingHealthCard } from "./JtTrackingHealthCard";

const status = {
  enabled: true,
  lastTickAt: "2026-10-28T10:00:00.000Z",
  lastFetched: 3,
  lastFailed: 0,
  pendingShipments: 7,
  lastError: null,
};

vi.mock("@/lib/admin-api", () => ({
  adminApi: { jtTrackingStatus: vi.fn(async () => status) },
}));

const t = ((key: string) => key) as never;

describe("JtTrackingHealthCard", () => {
  it("shows the pending count and the last run", async () => {
    render(<JtTrackingHealthCard t={t} />);
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.getByText("jt_tracking_title")).toBeInTheDocument();
  });

  it("shows the last error when the worker failed", async () => {
    const { adminApi } = await import("@/lib/admin-api");
    vi.mocked(adminApi.jtTrackingStatus).mockResolvedValueOnce({
      ...status,
      lastFailed: 2,
      lastError: "billCode not found",
    });

    render(<JtTrackingHealthCard t={t} />);
    await waitFor(() =>
      expect(screen.getByText(/billCode not found/)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd small-house-commerce/frontend && pnpm exec vitest run src/components/admin/system-status/JtTrackingHealthCard.spec.tsx
```

Expected: FAIL — cannot resolve `./JtTrackingHealthCard`.

- [ ] **Step 3: Add the API surface**

In `small-house-commerce/frontend/src/lib/admin-api.ts`, extend `AdminLogisticsEvent`:

```ts
  externalDescription: string | null;
  staffContact: string | null;
  signatureImageUrl: string | null;
```

Add near `AdminMetaCapiStatus`:

```ts
export interface AdminJtTrackingStatus {
  enabled: boolean;
  lastTickAt: string | null;
  lastFetched: number;
  lastFailed: number;
  pendingShipments: number;
  lastError: string | null;
}
```

Add to the `adminApi` object beside `metaCapiStatus`:

```ts
  jtTrackingStatus: (): Promise<AdminJtTrackingStatus> =>
    adminAuthedFetch<AdminJtTrackingStatus>("/api/v1/admin/jt/status"),
  refreshJtTracking: (
    orderId: string,
    shipmentId: string,
  ): Promise<{ appended: number; skipped: number; signed: boolean }> =>
    adminAuthedFetch(`/api/v1/admin/orders/${orderId}/shipments/${shipmentId}/tracking/refresh`, {
      method: "POST",
    }),
```

- [ ] **Step 4: Build the card**

Create `JtTrackingHealthCard.tsx`, mirroring `MetaCapiHealthCard`'s shape:

```tsx
"use client";

import { useEffect, useState } from "react";
import { adminApi, type AdminJtTrackingStatus } from "@/lib/admin-api";
import type { TKey } from "@/lib/admin-i18n";

type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

/**
 * J&T polling health: whether the credentials are complete, how many shipped
 * boxes are waiting for a scan, and the last failure. The worker is invisible
 * unless this card says otherwise.
 */
export function JtTrackingHealthCard({ t }: { t: Translate }) {
  const [data, setData] = useState<AdminJtTrackingStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const value = await adminApi.jtTrackingStatus();
        if (alive) {
          setData(value);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const tone = failed
    ? "critical"
    : data && !data.enabled
      ? "unknown"
      : data && data.lastFailed > 0
        ? "warning"
        : "healthy";
  const toneClasses: Record<string, string> = {
    healthy: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    critical: "border-rose-200 bg-rose-50 text-rose-900",
    unknown: "border-border bg-card text-ink",
  };

  return (
    <section
      className={`mt-4 rounded-xl border p-4 ${toneClasses[tone]}`}
      aria-label={t("jt_tracking_title")}
    >
      <h2 className="text-sm font-semibold">{t("jt_tracking_title")}</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-secondary">{t("jt_tracking_status")}</dt>
          <dd className="font-medium">
            {data ? (data.enabled ? t("jt_tracking_on") : t("jt_tracking_off")) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-secondary">{t("jt_tracking_pending")}</dt>
          <dd className="font-medium tabular-nums">{data?.pendingShipments ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-secondary">{t("jt_tracking_last_run")}</dt>
          <dd className="font-medium">
            {data?.lastTickAt ? new Date(data.lastTickAt).toLocaleString() : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-secondary">{t("jt_tracking_failed")}</dt>
          <dd className="font-medium tabular-nums">{data?.lastFailed ?? "—"}</dd>
        </div>
      </dl>
      {data?.lastError ? (
        <p className="mt-2 text-[12.5px]">{t("jt_tracking_error")}: {data.lastError}</p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Mount the card**

In `small-house-commerce/frontend/src/app/admin/(shell)/status/page.tsx`, import the card and render it directly after `<MetaCapiHealthCard t={t} />`.

- [ ] **Step 6: Add the carrier preset**

In `FulfillmentDialog.tsx`, above the carrier `Field`, add:

```tsx
            {kind === "ship" ? (
              <button
                type="button"
                onClick={() => setCarrier("J&T Express")}
                className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold text-cta hover:bg-primary-light/40"
              >
                {t("orders_ship_carrier_jt")}
              </button>
            ) : null}
```

- [ ] **Step 7: Add the refresh button and event detail**

In `OrderDrawer.tsx`, per shipment, next to the existing record button, add a refresh button shown when `shipment.status === "SHIPPING" && shipment.trackingNumber`:

```tsx
                                <button
                                  type="button"
                                  disabled={trackingBusy === shipment.id}
                                  onClick={() => void refreshTracking(shipment.id)}
                                  className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-cta hover:bg-primary-light/40 disabled:opacity-60"
                                >
                                  {t("orders_jt_refresh")}
                                </button>
```

with, in the component body (using the drawer's existing `fulfillmentVersion` refresh mechanism at `OrderDrawer.tsx:119,156`):

```tsx
  const [trackingBusy, setTrackingBusy] = useState<string | null>(null);
  async function refreshTracking(shipmentId: string) {
    setTrackingBusy(shipmentId);
    try {
      await adminApi.refreshJtTracking(row.id, shipmentId);
      setFulfillmentVersion((version) => version + 1);
    } catch {
      // The drawer keeps the previous data; the status card explains why.
    } finally {
      setTrackingBusy(null);
    }
  }
```

In the event list item, append the carrier detail:

```tsx
                                      {event.externalDescription ? ` · ${event.externalDescription}` : ""}
                                      {event.staffContact ? ` · ${event.staffContact}` : ""}
                                      {event.signatureImageUrl ? (
                                        <>
                                          {" · "}
                                          <a
                                            href={event.signatureImageUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="underline"
                                          >
                                            {t("orders_jt_signature")}
                                          </a>
                                        </>
                                      ) : null}
```

- [ ] **Step 8: Add the i18n keys**

In both `i18n/en.ts` and `i18n/zh.ts`, add:

```ts
  jt_tracking_title: "J&T tracking",            // zh: "J&T 物流轨迹"
  jt_tracking_status: "Integration",            // zh: "集成状态"
  jt_tracking_on: "Enabled",                    // zh: "已启用"
  jt_tracking_off: "Disabled",                  // zh: "未启用"
  jt_tracking_pending: "Awaiting scans",        // zh: "待同步运单"
  jt_tracking_last_run: "Last poll",            // zh: "上次轮询"
  jt_tracking_failed: "Failing",                // zh: "失败数"
  jt_tracking_error: "Last error",              // zh: "最近错误"
  orders_jt_refresh: "Refresh tracking",        // zh: "刷新轨迹"
  orders_jt_signature: "Signature photo",       // zh: "签收图"
  orders_ship_carrier_jt: "J&T Express",        // zh: "J&T Express"
```

- [ ] **Step 9: Run the frontend tests**

```bash
pnpm exec vitest run src/components/admin src/i18n
```

Expected: PASS, including the two card tests and the existing FulfillmentDialog and OrderDrawer specs.

- [ ] **Step 10: Commit**

```bash
git add small-house-commerce/frontend/src
git commit -m "feat(admin): J&T health card, refresh button and carrier preset"
```

---

### Task 12: Go-live runbook and whole-suite verification

**Files:**
- Create: `docs/superpowers/runbooks/jt-tracking-go-live.md`

**Interfaces:**
- Consumes: everything above.
- Produces: operator instructions.

- [ ] **Step 1: Write the runbook**

```markdown
# J&T Tracking Go-Live

## Credentials

| Env var | Value source |
| --- | --- |
| `JT_ENABLED` | `false` until step 3 |
| `JT_BASE_URL` | `https://demoopenapi.jtexpress.ph/webopenplatformapi/api` for the dry run |
| `JT_API_ACCOUNT` | J&T console |
| `JT_PRIVATE_KEY` | J&T console |
| `JT_CUSTOMER_CODE` | J&T shipping branch |
| `JT_CUSTOMER_PASSWORD` | J&T shipping branch |
| `JT_POLL_MINUTES` | `30` (optional) |
| `JT_CARRIER_NAME` | `J&T Express` (must match the ship dialog label) |

Missing any of the four credentials keeps the integration off; the app still boots.

## Dry run

1. Set the demo base URL and demo credentials in `.env.deploy`.
2. Deploy with `--env-file .env.deploy`.
3. Open `/admin/status`; the J&T card must read "Enabled".
4. Ship one test order with carrier `J&T Express` and a known demo waybill.
5. Press "Refresh tracking" in the order drawer.
6. Confirm events appear with J&T wording, and that a Delivered scan signs the shipment with source `CARRIER` in the order status history.

## Production

1. Swap in production credentials and `https://openapi.jtexpress.ph/webopenplatformapi/api`.
2. Set `JT_ENABLED=true`, deploy, watch the card for one tick.
3. Confirm one real waybill's events land.

## Rollback

Set `JT_ENABLED=false` and restart. Existing events, signatures and the six columns stay valid; nothing needs cleaning up.

## Known failure modes

- **No events for a shipment**: check the carrier label equals `JT_CARRIER_NAME` (case-insensitive) and the tracking number is the J&T bill code.
- **Signature errors in the card**: the private key or customer password is wrong. `sign` appears in the message.
- **Waybill not found**: the number is not a J&T bill code for this account.
```

- [ ] **Step 2: Run every test**

```bash
cd small-house-commerce/backend && pnpm test
cd ../frontend && pnpm test
```

Expected: both suites PASS with no skipped tests in `src/modules/jt`, `src/modules/orders`, `src/components/track-order`, `src/components/admin/system-status`.

- [ ] **Step 3: Build both apps**

```bash
cd small-house-commerce/backend && pnpm exec prisma generate && pnpm build
cd ../frontend && pnpm build
```

Expected: both builds succeed.

- [ ] **Step 4: Verify the migration is replayable**

```bash
cd small-house-commerce/backend
pnpm exec prisma migrate deploy
```

Run twice. Expected: the second run reports no pending migrations.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/runbooks/jt-tracking-go-live.md
git commit -m "docs(jt): go-live runbook for tracking polling"
```

---

## Spec coverage check

| Spec section | Task |
| --- | --- |
| Which J&T API / endpoint / signatures | 3 |
| Status mapping table | 4 |
| `jt.config.ts` + env validation | 2 |
| `jt.client.ts` | 3 |
| `jt-tracking.mapper.ts` | 4 |
| `jt-tracking.service.ts` worker, backoff, batching | 7 |
| Auto-sign rules | 6, 7 |
| Schema changes | 1, 5 |
| Admin refresh endpoint + status | 8, 11 |
| Guest fields + phone gate | 9, 10 |
| Admin carrier preset / event detail | 11 |
| Error handling | 3, 7 |
| Testing | every task; whole-suite in 12 |
| Rollout / rollback | 12 |
