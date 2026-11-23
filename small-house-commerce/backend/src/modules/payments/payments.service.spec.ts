import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import {
  PAYMENT_CAPABILITY_COOKIE,
  PAYMENT_CAPABILITY_PATH,
  PAYMENT_CAPABILITY_TTL_MS,
  PaymentCapabilityService,
} from './payment-capability.service.js';
import { PaymentsService } from './payments.service.js';
import { SunrateClient } from './sunrate.client.js';
import type { SunrateConfig } from './sunrate.config.js';

const GATEWAY: SunrateConfig = {
  enabled: true,
  env: 'test',
  baseUrl: 'https://test-api.xunhuiacq.com',
  merchantId: 'TEST34453112600',
  signKey: 'unit-test-key',
  publicBaseUrl: 'https://luwag.shop',
};

const ATTEMPT = {
  id: 'attempt-1',
  orderId: 'order-1',
  channel: 'card',
  env: 'test',
  merchantId: 'TEST34453112600',
  merchantOrderNum: 'AT20261120100000001234',
  amount: new Prisma.Decimal('199.00'),
  currency: 'PHP',
  status: 'CREATING',
  lastResult: { metaConsent: true },
};

function config() {
  return new ConfigService({
    sunrate: {
      enabled: 'true',
      env: 'test',
      baseUrl: 'https://test-api.xunhuiacq.com',
      merchantId: 'TEST34453112600',
      signKey: 'unit-test-key',
    },
    payments: { publicBaseUrl: 'https://luwag.shop' },
  });
}

function harness(options: { fetchImpl: typeof fetch; attempt?: Record<string, unknown> }) {
  const attempt = { ...ATTEMPT, ...(options.attempt ?? {}) };
  const update = vi.fn(
    async (_args: { where: Record<string, unknown>; data: Record<string, any> }) => ({ ...attempt }),
  );
  const findFirst = vi.fn(async (_args: unknown) => attempt);
  const tx = {
    $queryRaw: vi.fn(async () => []),
    sunratePaymentAttempt: { findFirst, update },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    sunratePaymentAttempt: { findFirst, update },
  };
  const client = new SunrateClient(GATEWAY, options.fetchImpl);
  const service = new PaymentsService(prisma as never, config(), client);
  return { service, prisma, attempt, findFirst, update };
}

const okFetch = (body: Record<string, unknown>): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

describe('PaymentsService.initiateGatewaySession', () => {
  it('stores the paySession and moves the attempt to PENDING', async () => {
    const fetchImpl = okFetch({ respCode: '00', respMsg: 'success', parameter: { paySession: 'ps_123' } });
    const { service, update } = harness({ fetchImpl });

    const session = await service.initiateGatewaySession('PH100030');

    expect(session).toEqual({
      attemptId: 'attempt-1',
      channel: 'card',
      env: 'test',
      paySession: 'ps_123',
    });
    const updateArgs = update.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe('PENDING');
    // The checkout facts written at order time must survive the gateway
    // summary: the Purchase event still needs the consent flag.
    expect(updateArgs.data.lastResult.metaConsent).toBe(true);
    expect(updateArgs.data.lastResult.session.paySession).toBe('ps_123');
  });

  it('sends the order number and amount of the attempt to the gateway', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> });
      return new Response(JSON.stringify({ respCode: '00', parameter: { paySession: 'ps_1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const { service } = harness({ fetchImpl });

    await service.initiateGatewaySession('PH100030');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://test-api.xunhuiacq.com/api/v5/createcashier');
    expect(calls[0]!.body.orderNum).toBe('AT20261120100000001234');
    expect(calls[0]!.body.orderAmount).toBe('199.00');
    expect(calls[0]!.body.orderCurrency).toBe('PHP');
    expect(calls[0]!.body.frontURL).toBe('https://luwag.shop/payment-return/PH100030');
    expect(calls[0]!.body.backURL).toBe('https://luwag.shop/api/v1/payments/sunrate/notify');
  });

  it('keeps the same merchant order number and marks the attempt UNKNOWN when the gateway times out', async () => {
    const fetchImpl = (async () => {
      throw new Error('The operation was aborted due to timeout');
    }) as unknown as typeof fetch;
    const { service, update } = harness({ fetchImpl });

    await expect(service.initiateGatewaySession('PH100030')).rejects.toMatchObject({
      status: 502,
      message: 'GATEWAY_INITIATION_FAILED',
    });
    const updateArgs = update.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe('UNKNOWN');
    // The order number is never swapped: the gateway may still have the
    // request, and reconciliation looks the payment up by this number.
    expect(updateArgs.where).toEqual({ id: 'attempt-1' });
    expect(updateArgs.data.merchantOrderNum).toBeUndefined();
  });

  it('marks the attempt UNKNOWN when a wallet pay url is not on the allow list', async () => {
    const fetchImpl = okFetch({
      respCode: '00',
      respMsg: 'success',
      parameter: { payUrl: 'https://evil.example.com/pay' },
    });
    const { service, update } = harness({
      fetchImpl,
      attempt: { channel: 'bpi' },
    });

    await expect(service.initiateGatewaySession('PH100030')).rejects.toMatchObject({
      status: 502,
      message: 'GATEWAY_INITIATION_FAILED',
    });
    const updateArgs = update.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe('UNKNOWN');
  });

  it('carries the shopper address and device into the wallet request', async () => {
    const bodies: Array<Record<string, string>> = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, string>);
      return new Response(
        JSON.stringify({
          respCode: '00',
          parameter: {
            payUrl: 'https://psp.ac.alipay.com/page/simulation-wallet/acwallet/x',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const { service } = harness({ fetchImpl, attempt: { channel: 'gcash' } });

    await service.initiateGatewaySession('PH100030', {
      userIp: '1.2.3.4',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile',
    });

    expect(bodies[0]).toMatchObject({
      tradeFrom: 'H5',
      userIP: '1.2.3.4',
      userID: 'order-1',
      osType: 'IOS',
    });
  });

  it('returns the stored session instead of calling the gateway twice', async () => {
    const fetchImpl = vi.fn();
    const { service } = harness({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      attempt: {
        status: 'PENDING',
        lastResult: { metaConsent: false, session: { paySession: 'ps_stored' } },
      },
    });

    const session = await service.initiateGatewaySession('PH100030');

    expect(session.paySession).toBe('ps_stored');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses to open a second session for an attempt whose outcome is unknown', async () => {
    const fetchImpl = vi.fn();
    const { service, update } = harness({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      attempt: { status: 'UNKNOWN' },
    });

    await expect(service.initiateGatewaySession('PH100030')).rejects.toMatchObject({
      status: 502,
      message: 'GATEWAY_INITIATION_FAILED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('PaymentCapabilityService', () => {
  const service = () =>
    new PaymentCapabilityService(
      new ConfigService({ jwt: { secret: 'payment-capability-unit-test-secret' } }),
    );

  it('signs a token that verifies for its own order number', () => {
    const capability = service();
    const token = capability.issue('PH100030', 'attempt-1');

    expect(capability.verify(token, 'PH100030')).toBe(true);
    expect(capability.verify(token, 'PH100031')).toBe(false);
  });

  it('rejects a tampered token', () => {
    const capability = service();
    const token = capability.issue('PH100030', 'attempt-1');
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()) as Record<string, unknown>;
    payload.orderNumber = 'PH100031';
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[1]}`;

    expect(capability.verify(forged, 'PH100031')).toBe(false);
    expect(capability.verify(forged, 'PH100030')).toBe(false);
  });

  it('rejects a token after its window has passed', () => {
    const capability = service();
    const issuedAt = new Date('2026-11-20T06:00:00Z');
    const token = capability.issue('PH100030', 'attempt-1', issuedAt);

    expect(capability.verify(token, 'PH100030', issuedAt)).toBe(true);
    expect(
      capability.verify(token, 'PH100030', new Date(issuedAt.getTime() + PAYMENT_CAPABILITY_TTL_MS + 1000)),
    ).toBe(false);
  });

  it('keeps the cookie scoped to the payment endpoints and expiring in 24 hours', () => {
    expect(PAYMENT_CAPABILITY_COOKIE).toBe('luwag_pay_return');
    expect(PAYMENT_CAPABILITY_PATH).toBe('/api/v1/payments');
    expect(PAYMENT_CAPABILITY_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
