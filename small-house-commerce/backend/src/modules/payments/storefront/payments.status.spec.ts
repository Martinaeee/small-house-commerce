import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  PAYMENT_CAPABILITY_COOKIE,
  PaymentCapabilityService,
} from '../payment-capability.service.js';
import { PaymentStatusController } from './payment-status.controller.js';

const SECRET = 'payment-status-controller-unit-test-secret';

function capability() {
  return new PaymentCapabilityService(new ConfigService({ jwt: { secret: SECRET } }));
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'PH100030',
    orderStatus: 'NEW',
    paymentStatus: 'ONLINE_PENDING',
    grandTotal: new Prisma.Decimal('199.00'),
    payments: [{ id: 'pay-1', status: 'ONLINE_PENDING', paidAt: null }],
    items: [{ skuId: 'sku-1', quantity: 2 }],
    sunrateAttempts: [
      {
        id: 'attempt-1',
        status: 'PENDING',
        currency: 'PHP',
        amount: new Prisma.Decimal('199.00'),
        lastResult: { metaConsent: true },
      },
    ],
    ...overrides,
  };
}

async function app(options: { order?: Record<string, unknown> | null } = {}) {
  const row = options.order === undefined ? order() : options.order;
  const prisma = {
    order: { findUnique: vi.fn(async () => row) },
  };
  const module = await Test.createTestingModule({
    controllers: [PaymentStatusController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: PaymentCapabilityService, useValue: capability() },
    ],
  }).compile();
  const instance = module.createNestApplication();
  await instance.init();
  return { instance, prisma };
}

const cookieFor = (orderNumber: string, attemptId = 'attempt-1') =>
  `${PAYMENT_CAPABILITY_COOKIE}=${capability().issue(orderNumber, attemptId)}`;

describe('GET /payments/status', () => {
  it('answers with the payment state of the order the cookie names', async () => {
    const { instance } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .get('/payments/status')
        .set('Cookie', cookieFor('PH100030'));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        orderNumber: 'PH100030',
        paymentStatus: 'ONLINE_PENDING',
        attemptStatus: 'PENDING',
        amount: 199,
        currency: 'PHP',
      });
    } finally {
      await instance.close();
    }
  });

  it('never answers without a capability cookie', async () => {
    const { instance, prisma } = await app();
    try {
      const response = await request(instance.getHttpServer()).get('/payments/status');

      expect(response.status).toBe(404);
      expect(prisma.order.findUnique).not.toHaveBeenCalled();
    } finally {
      await instance.close();
    }
  });

  it('never answers for a tampered cookie', async () => {
    const { instance } = await app();
    try {
      const token = capability().issue('PH100030', 'attempt-1')!;
      const [body, signature] = token.split('.');
      const last = signature!.at(-1);
      const tampered = `${body}.${signature!.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
      const response = await request(instance.getHttpServer())
        .get('/payments/status')
        .set('Cookie', `${PAYMENT_CAPABILITY_COOKIE}=${tampered}`);

      expect(response.status).toBe(404);
    } finally {
      await instance.close();
    }
  });

  it('never answers for a cookie that names another order', async () => {
    const { instance } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .get('/payments/status')
        .query({ orderNumber: 'PH100031' })
        .set('Cookie', cookieFor('PH100030'));

      expect(response.status).toBe(404);
    } finally {
      await instance.close();
    }
  });

  it('adds the purchase facts once the payment is verified as paid', async () => {
    const { instance } = await app({
      order: order({
        paymentStatus: 'PAID',
        payments: [{ id: 'pay-1', status: 'PAID', paidAt: new Date('2026-11-20T08:00:00Z') }],
        sunrateAttempts: [
          {
            id: 'attempt-1',
            status: 'SUCCEEDED',
            currency: 'PHP',
            amount: new Prisma.Decimal('199.00'),
            lastResult: { metaConsent: true },
          },
        ],
      }),
    });
    try {
      const response = await request(instance.getHttpServer())
        .get('/payments/status')
        .set('Cookie', cookieFor('PH100030'));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        orderNumber: 'PH100030',
        paymentStatus: 'PAID',
        attemptStatus: 'SUCCEEDED',
        paidAt: '2026-11-20T08:00:00.000Z',
        amount: 199,
        currency: 'PHP',
        value: 199,
        items: [{ skuId: 'sku-1', quantity: 2 }],
        metaConsent: true,
      });
    } finally {
      await instance.close();
    }
  });

  it('reports a cancelled order as cancelled', async () => {
    const { instance } = await app({ order: order({ orderStatus: 'CANCELLED' }) });
    try {
      const response = await request(instance.getHttpServer())
        .get('/payments/status')
        .set('Cookie', cookieFor('PH100030'));

      expect(response.status).toBe(200);
      expect(response.body.paymentStatus).toBe('CANCELLED');
    } finally {
      await instance.close();
    }
  });

  it('never returns customer, address or gateway data', async () => {
    const { instance } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .get('/payments/status')
        .set('Cookie', cookieFor('PH100030'));

      expect(Object.keys(response.body).sort()).toEqual([
        'amount',
        'attemptStatus',
        'currency',
        'orderNumber',
        'paymentStatus',
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(/customer|phone|address|province|signature/i);
    } finally {
      await instance.close();
    }
  });
});
