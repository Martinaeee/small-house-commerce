import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  ORDER_RECEIPT_COOKIE,
  ORDER_RECEIPT_PATH,
  ORDER_RECEIPT_TTL_MS,
  OrderReceiptService,
} from '../order-receipt.service.js';
import { OrdersService } from '../orders.service.js';
import { StorefrontOrdersController } from './orders.controller.js';

const CHECKOUT_BODY = {
  customer: {
    name: 'Jane',
    phone: '09171234567',
    province: 'Metro Manila',
    city: 'Manila',
    streetAddress: '1 Main St',
  },
  items: [{ skuId: '00000000-0000-4000-8000-0000000000c1', quantity: 1 }],
  attribution: { sourceType: 'ORGANIC' },
};

function receipts(deny: string[] = []) {
  return new OrderReceiptService(
    new ConfigService({
      jwt: { secret: 'order-receipt-controller-unit-test-secret' },
      orders: { receiptDenyNumbers: deny },
    }),
  );
}

async function app(options: { deny?: string[]; placedAt?: Date | null } = {}) {
  const placedAt = options.placedAt === undefined ? new Date('2026-11-09T06:00:00Z') : options.placedAt;
  const ordersService = {
    checkout: vi.fn(async () => ({
      orderNumber: 'PH100030',
      orderStatus: 'NEW',
      confirmationStatus: 'UNCONFIRMED',
      riskType: null,
      requiresReview: false,
      grandTotal: 199,
    })),
    receiptStatus: vi.fn(async (orderNumber: string) =>
      placedAt && orderNumber === 'PH100030' ? { ok: true as const, placedAt } : null,
    ),
    attemptStatus: vi.fn(async (key: string) =>
      key === '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
        ? {
            orderNumber: 'PH100030',
            orderStatus: 'NEW',
            grandTotal: 199,
            placedAt,
            items: [{ skuId: '00000000-0000-4000-8000-0000000000c1', quantity: 1 }],
          }
        : null,
    ),
  };
  const module = await Test.createTestingModule({
    controllers: [StorefrontOrdersController],
    providers: [
      { provide: OrderReceiptService, useValue: receipts(options.deny) },
      { provide: OrdersService, useValue: ordersService },
    ],
  }).compile();
  const instance = module.createNestApplication();
  instance.set('trust proxy', 1);
  await instance.init();
  return { instance, ordersService };
}

describe('StorefrontOrdersController', () => {
  it('is the public checkout route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StorefrontOrdersController)).toBe(
      'storefront/orders',
    );
  });
});

describe('checkout receipt cookie', () => {
  it('sets an HttpOnly, path-scoped 72h cookie on a successful order', async () => {
    const { instance } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/orders')
        .set('X-Forwarded-Proto', 'https')
        .send(CHECKOUT_BODY);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ orderNumber: 'PH100030' });
      const cookies = response.headers['set-cookie'] as unknown as string[];
      const receipt = cookies.find((value) => value.startsWith(`${ORDER_RECEIPT_COOKIE}=`));
      expect(receipt).toBeDefined();
      expect(receipt).toContain('HttpOnly');
      expect(receipt).toContain('SameSite=Lax');
      expect(receipt).toContain(`Path=${ORDER_RECEIPT_PATH}`);
      expect(receipt).toContain(`Max-Age=${ORDER_RECEIPT_TTL_MS / 1000}`);
      expect(receipt).toContain('Secure');
    } finally {
      await instance.close();
    }
  });

  it('issues no cookie for an order number on the operator deny list', async () => {
    const { instance } = await app({ deny: ['PH100030'] });
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/orders')
        .set('X-Forwarded-Proto', 'https')
        .send(CHECKOUT_BODY);

      const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((value) => value.startsWith(`${ORDER_RECEIPT_COOKIE}=`))).toBe(false);
    } finally {
      await instance.close();
    }
  });
});

describe('GET :orderNumber/receipt', () => {
  it('confirms a real order when the cookie matches its number', async () => {
    const { instance } = await app();
    try {
      const token = receipts().issue('PH100030');
      const response = await request(instance.getHttpServer())
        .get('/storefront/orders/PH100030/receipt')
        .set('Cookie', `${ORDER_RECEIPT_COOKIE}=${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true, placedAt: '2026-11-09T06:00:00.000Z' });
    } finally {
      await instance.close();
    }
  });

  it('answers the same 404 for a missing, tampered, mismatched or cancelled receipt', async () => {
    const { instance } = await app();
    const service = receipts();
    const valid = service.issue('PH100030')!;
    const [body, signature] = valid.split('.');
    // Flip the last character to a value it certainly is not: appending 'A'
    // would sometimes reproduce the valid token and make this probe 200.
    const last = signature!.at(-1);
    const tampered = `${body}.${signature!.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    try {
      for (const [url, cookie] of [
        ['/storefront/orders/PH100030/receipt', null],
        ['/storefront/orders/PH100030/receipt', tampered],
        ['/storefront/orders/PH100999/receipt', valid],
      ] as const) {
        const probe = request(instance.getHttpServer()).get(url);
        if (cookie) probe.set('Cookie', `${ORDER_RECEIPT_COOKIE}=${cookie}`);
        const response = await probe;
        expect(response.status).toBe(404);
      }
    } finally {
      await instance.close();
    }
  });

  it('never confirms an order the backend has cancelled or deleted', async () => {
    const { instance } = await app({ placedAt: null });
    try {
      const token = receipts().issue('PH100030');
      const response = await request(instance.getHttpServer())
        .get('/storefront/orders/PH100030/receipt')
        .set('Cookie', `${ORDER_RECEIPT_COOKIE}=${token}`);

      expect(response.status).toBe(404);
    } finally {
      await instance.close();
    }
  });

  it('exposes only the order state, never customer or payment data', async () => {
    const { instance } = await app();
    try {
      const token = receipts().issue('PH100030');
      const response = await request(instance.getHttpServer())
        .get('/storefront/orders/PH100030/receipt')
        .set('Cookie', `${ORDER_RECEIPT_COOKIE}=${token}`);

      expect(Object.keys(response.body).sort()).toEqual(['ok', 'placedAt']);
    } finally {
      await instance.close();
    }
  });
});

/**
 * F04 result recovery: the browser sends the idempotency key it already holds
 * in the request body (never the URL, so it stays out of access logs) and
 * learns whether that attempt produced an order. When it did, the response
 * also re-issues the success-page receipt cookie, so a lost order response
 * still ends on a confirmable receipt.
 */
describe('POST attempt-status', () => {
  const KEY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  it('confirms a committed attempt and re-issues the receipt cookie', async () => {
    const { instance } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/orders/attempt-status')
        .set('X-Forwarded-Proto', 'https')
        .send({ idempotencyKey: KEY });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        state: 'ORDERED',
        orderNumber: 'PH100030',
        orderStatus: 'NEW',
        grandTotal: 199,
      });
      const cookies = response.headers['set-cookie'] as unknown as string[];
      const receipt = cookies.find((value) => value.startsWith(`${ORDER_RECEIPT_COOKIE}=`));
      expect(receipt).toBeDefined();
      expect(receipt).toContain('HttpOnly');
      expect(receipt).toContain(`Path=${ORDER_RECEIPT_PATH}`);
    } finally {
      await instance.close();
    }
  });

  it('answers PENDING without a cookie while the order is not visible yet', async () => {
    const { instance } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/orders/attempt-status')
        .send({ idempotencyKey: 'unknown-key-1234567890' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ state: 'PENDING' });
      const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((value) => value.startsWith(`${ORDER_RECEIPT_COOKIE}=`))).toBe(false);
    } finally {
      await instance.close();
    }
  });

  it('rejects a malformed key before touching the database', async () => {
    const { instance, ordersService } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/orders/attempt-status')
        .send({ idempotencyKey: 'short key' });

      expect(response.status).toBe(400);
      expect(ordersService.attemptStatus).not.toHaveBeenCalled();
    } finally {
      await instance.close();
    }
  });

  it('never returns customer, address or payment data', async () => {
    const { instance } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/orders/attempt-status')
        .send({ idempotencyKey: KEY });

      expect(Object.keys(response.body).sort()).toEqual([
        'grandTotal',
        'items',
        'orderNumber',
        'orderStatus',
        'placedAt',
        'state',
      ]);
      expect(response.body.items).toEqual([
        { skuId: '00000000-0000-4000-8000-0000000000c1', quantity: 1 },
      ]);
    } finally {
      await instance.close();
    }
  });
});

describe('checkout request tracing', () => {
  it('echoes a sane X-Request-Id so frontend and backend logs can be joined', async () => {
    const { instance } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/orders')
        .set('X-Request-Id', 'trace-abc-123')
        .send(CHECKOUT_BODY);
      expect(response.headers['x-request-id']).toBe('trace-abc-123');
    } finally {
      await instance.close();
    }
  });

  it('replaces a hostile or empty request id instead of reflecting it', async () => {
    const { instance } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/orders')
        .set('X-Request-Id', 'bad id with spaces')
        .send(CHECKOUT_BODY);
      expect(response.headers['x-request-id']).toMatch(
        /^[A-Za-z0-9_-]{8,64}$/,
      );
    } finally {
      await instance.close();
    }
  });
});
