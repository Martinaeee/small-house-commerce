import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ThrottleGuard } from '../../../common/throttle.guard.js';
import {
  PAYMENT_CAPABILITY_COOKIE,
  PaymentCapabilityService,
} from '../payment-capability.service.js';
import { PaymentMethodsService } from '../payment-methods.service.js';
import { PaymentsService } from '../payments.service.js';
import { StorefrontPaymentsController } from './payments.controller.js';

const SECRET = 'payment-retry-unit-test-secret';

const FAILED_ATTEMPT = {
  id: 'attempt-1',
  orderId: 'order-1',
  channel: 'gcash',
  env: 'test',
  merchantId: 'TEST34453112600',
  merchantOrderNum: 'AT20261120100000001234',
  amount: new Prisma.Decimal('199.00'),
  currency: 'PHP',
  transId: null,
  cardBrand: null,
  cardLast4: null,
  status: 'FAILED',
  lastResult: { metaConsent: true, eventSourceUrl: 'https://luwag.shop/checkout' },
  createdAt: new Date('2026-11-20T08:00:00Z'),
};

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PH100030',
    orderStatus: 'NEW',
    paymentStatus: 'FAILED',
    grandTotal: new Prisma.Decimal('199.00'),
    payments: [{ id: 'pay-1', status: 'FAILED', paidAt: null }],
    sunrateAttempts: [{ ...FAILED_ATTEMPT }],
    ...overrides,
  };
}

async function app(options: { order?: Record<string, unknown> } = {}) {
  const row = order(options.order);
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    order: { findUnique: vi.fn(async () => row) },
    sunratePaymentAttempt: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: 'attempt-2', ...args.data };
      }),
    },
  };
  const payments = {
    initiateGatewaySession: vi.fn(async () => ({
      attemptId: 'attempt-2',
      channel: 'gcash',
      env: 'test',
      payUrl: 'https://test.xunhuiacq.com/b2c-cashier/#/cashier?key=abc',
    })),
  };
  const methods = {
    listEffectiveMethods: vi.fn(async () => ({
      codEnabled: true,
      revision: 0,
      methods: [
        { id: 'COD' as const, enabled: true, ready: true },
        { id: 'CARD' as const, enabled: false, ready: true },
        { id: 'GCASH' as const, enabled: true, ready: true },
        { id: 'BPI' as const, enabled: false, ready: true },
      ],
    })),
  };
  const capability = new PaymentCapabilityService(
    new ConfigService({ jwt: { secret: SECRET } }),
  );
  const module = await Test.createTestingModule({
    controllers: [StorefrontPaymentsController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: PaymentCapabilityService, useValue: capability },
      { provide: PaymentsService, useValue: payments },
      { provide: PaymentMethodsService, useValue: methods },
      { provide: ThrottleGuard, useClass: ThrottleGuard },
    ],
  }).compile();
  const instance = module.createNestApplication();
  await instance.init();
  return { instance, prisma, payments, created, capability };
}

const cookieFor = (capability: PaymentCapabilityService, orderNumber = 'PH100030') =>
  `${PAYMENT_CAPABILITY_COOKIE}=${capability.issue(orderNumber, 'attempt-1')}`;

describe('POST /payments/retry', () => {
  it('opens a new attempt for a failed payment', async () => {
    const { instance, created } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/payments/retry')
        .set('Cookie', cookieFor(new PaymentCapabilityService(new ConfigService({ jwt: { secret: SECRET } }))));

      expect(response.status).toBe(201);
      expect(response.body.payment).toMatchObject({
        attemptId: 'attempt-2',
        channel: 'gcash',
        env: 'test',
      });
      expect(created).toHaveLength(1);
      // A new merchant order number: the failed one is never reused.
      expect(created[0]!.merchantOrderNum).not.toBe('AT20261120100000001234');
      expect(String(created[0]!.merchantOrderNum)).toMatch(/^AT\d{20}$/);
      expect(created[0]!.status).toBe('CREATING');
      // The consent flag survives, so the Purchase event can still be sent.
      expect((created[0]!.lastResult as Record<string, unknown>).metaConsent).toBe(true);
    } finally {
      await instance.close();
    }
  });

  it('refuses a retry while a payment is still pending', async () => {
    const { instance, created } = await app({
      order: {
        paymentStatus: 'ONLINE_PENDING',
        sunrateAttempts: [{ ...FAILED_ATTEMPT, status: 'PENDING' }],
      },
    });
    try {
      const response = await request(instance.getHttpServer())
        .post('/payments/retry')
        .set('Cookie', cookieFor(new PaymentCapabilityService(new ConfigService({ jwt: { secret: SECRET } }))));

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('PAYMENT_STILL_PENDING');
      expect(created).toHaveLength(0);
    } finally {
      await instance.close();
    }
  });

  it('never answers without a capability cookie', async () => {
    const { instance, prisma } = await app();
    try {
      const response = await request(instance.getHttpServer()).post('/payments/retry');

      expect(response.status).toBe(404);
      expect(prisma.order.findUnique).not.toHaveBeenCalled();
    } finally {
      await instance.close();
    }
  });

  it('refuses a retry for an order that is already paid', async () => {
    const { instance, created } = await app({ order: { paymentStatus: 'PAID' } });
    try {
      const response = await request(instance.getHttpServer())
        .post('/payments/retry')
        .set('Cookie', cookieFor(new PaymentCapabilityService(new ConfigService({ jwt: { secret: SECRET } }))));

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('ALREADY_PAID');
      expect(created).toHaveLength(0);
    } finally {
      await instance.close();
    }
  });
});
