import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApplyVerifiedResultService } from './apply-verified-result.service.js';
import { signFields } from './sunrate.signature.js';
import { SunrateNotifyController } from './sunrate/notify.controller.js';

const KEY = 'notify-controller-unit-test-key';

const ATTEMPT = {
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
  status: 'PENDING',
  lastResult: { metaConsent: true },
};

const ORDER = {
  id: 'order-1',
  orderNumber: 'PH100030',
  orderStatus: 'NEW',
  paymentStatus: 'ONLINE_PENDING',
  grandTotal: new Prisma.Decimal('199.00'),
  payments: [{ id: 'pay-1', status: 'ONLINE_PENDING', paidAt: null }],
};

function config() {
  return new ConfigService({
    sunrate: {
      enabled: 'true',
      env: 'test',
      baseUrl: 'https://test-api.xunhuiacq.com',
      merchantId: 'TEST34453112600',
      signKey: KEY,
    },
    payments: { publicBaseUrl: 'https://luwag.shop' },
  });
}

function notification(overrides: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    transType: 'PURC',
    orderNum: 'AT20261120100000001234',
    orderAmount: '199.00',
    orderCurrency: 'PHP',
    merID: 'TEST34453112600',
    respCode: '00',
    respMsg: 'success',
    transID: 'trans-1',
    gwTime: '20261120080000',
    transTime: '20261120080000',
    paymentBrand: 'gcash',
    signType: 'SHA256',
    ...overrides,
  };
  return { ...fields, signature: signFields(fields, KEY) };
}

async function app(options: { attempt?: Record<string, unknown> | null; failOn?: 'event' | 'apply' } = {}) {
  const attempt = options.attempt === undefined ? { ...ATTEMPT } : options.attempt;
  const order = { ...ORDER, payments: [{ ...ORDER.payments[0] }] };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    sunratePaymentAttempt: {
      findUnique: vi.fn(async () => attempt),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        // The row keeps its new state, so a second delivery sees it.
        if (attempt) Object.assign(attempt, args.data);
        return { ...ATTEMPT, ...args.data };
      }),
    },
    sunrateNotificationEvent: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'event-1', ...args.data })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'event-1', ...args.data })),
    },
    order: {
      findUnique: vi.fn(async () => order),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(order, args.data);
        return { ...order };
      }),
    },
    payment: {
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        Object.assign(order.payments[0]!, args.data);
        return { ...order.payments[0] };
      }),
    },
  };
  if (options.failOn === 'event') {
    tx.sunrateNotificationEvent.create.mockRejectedValue(new Error('database is down'));
  }
  if (options.failOn === 'apply') {
    tx.sunratePaymentAttempt.update.mockRejectedValue(new Error('database is down'));
  }
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    sunratePaymentAttempt: {
      findFirst: vi.fn(async () => attempt),
      findUnique: vi.fn(async () => attempt),
    },
    sunrateNotificationEvent: tx.sunrateNotificationEvent,
  };
  const module = await Test.createTestingModule({
    controllers: [SunrateNotifyController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: config() },
      { provide: ApplyVerifiedResultService, useClass: ApplyVerifiedResultService },
    ],
  }).compile();
  const instance = module.createNestApplication();
  await instance.init();
  return { instance, tx, prisma };
}

describe('POST /payments/sunrate/notify', () => {
  it('marks the order paid and answers exactly OK', async () => {
    const { instance, tx } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/payments/sunrate/notify')
        .send(notification());

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'PAID', paidAt: new Date('2026-11-20T00:00:00Z') },
      });
    } finally {
      await instance.close();
    }
  });

  it('records the notification and answers OK the second time without paying twice', async () => {
    const { instance, tx } = await app();
    try {
      const body = notification();
      await request(instance.getHttpServer()).post('/payments/sunrate/notify').send(body);
      const firstPaymentUpdate = tx.payment.update.mock.calls.length;

      const second = await request(instance.getHttpServer()).post('/payments/sunrate/notify').send(body);

      expect(second.status).toBe(200);
      expect(second.text).toBe('OK');
      expect(tx.payment.update.mock.calls.length).toBe(firstPaymentUpdate);
      const eventUpdate = tx.sunrateNotificationEvent.update.mock.calls.at(-1)![0] as {
        data: Record<string, unknown>;
      };
      expect(eventUpdate.data.outcome).toBe('DUPLICATE');
    } finally {
      await instance.close();
    }
  });

  it('rejects a notification signed with another key without touching a payment', async () => {
    const { instance, tx } = await app();
    try {
      const body = notification();
      const forged = { ...body, signature: 'a'.repeat(64) };

      const response = await request(instance.getHttpServer())
        .post('/payments/sunrate/notify')
        .send(forged);

      expect(response.status).toBe(400);
      expect(tx.payment.update).not.toHaveBeenCalled();
      expect(tx.sunrateNotificationEvent.create).not.toHaveBeenCalled();
    } finally {
      await instance.close();
    }
  });

  it('answers OK for a notification it cannot match, so the gateway stops retrying', async () => {
    const { instance, tx } = await app({ attempt: null });
    try {
      const response = await request(instance.getHttpServer())
        .post('/payments/sunrate/notify')
        .send(notification({ orderNum: 'AT99999999999999999999' }));

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
      const event = tx.sunrateNotificationEvent.create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(event.data.outcome).toBe('UNMATCHED');
      expect(event.data.signatureValid).toBe(true);
    } finally {
      await instance.close();
    }
  });

  it('answers an error when persistence fails, so the gateway retries', async () => {
    const { instance } = await app({ failOn: 'event' });
    try {
      const response = await request(instance.getHttpServer())
        .post('/payments/sunrate/notify')
        .send(notification());

      expect(response.status).toBe(500);
    } finally {
      await instance.close();
    }
  });

  it('never downgrades a paid order on a late failure notification', async () => {
    const { instance, tx } = await app({
      attempt: { ...ATTEMPT, status: 'SUCCEEDED', transId: 'trans-1' },
    });
    try {
      const response = await request(instance.getHttpServer())
        .post('/payments/sunrate/notify')
        .send(notification({ respCode: '01' }));

      expect(response.status).toBe(200);
      expect(tx.payment.update).not.toHaveBeenCalled();
      const eventUpdate = tx.sunrateNotificationEvent.update.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(eventUpdate.data.outcome).toBe('IGNORED_LATE_FAILURE');
    } finally {
      await instance.close();
    }
  });

  it('stores whitelisted fields only', async () => {
    const { instance, tx } = await app();
    try {
      await request(instance.getHttpServer())
        .post('/payments/sunrate/notify')
        .send(notification({ merReserve: 'anything the gateway wants to send' }));

      const event = tx.sunrateNotificationEvent.create.mock.calls[0]![0] as {
        data: { payload: Record<string, unknown> };
      };
      expect(Object.keys(event.data.payload).sort()).toEqual([
        'gwTime',
        'merID',
        'orderAmount',
        'orderCurrency',
        'orderNum',
        'paymentBrand',
        'respCode',
        'respMsg',
        'signType',
        'transID',
        'transTime',
        'transType',
      ]);
      expect(JSON.stringify(event.data.payload)).not.toMatch(/signature|merReserve|card|pan|cvv/i);
    } finally {
      await instance.close();
    }
  });
});
