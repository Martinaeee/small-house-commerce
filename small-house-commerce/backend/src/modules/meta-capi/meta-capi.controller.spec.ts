import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { StorefrontMetaEventsController } from './meta-capi.controller.js';
import { MetaCapiService } from './meta-capi.service.js';

/**
 * A prisma stub that behaves like the real outbox table: `event_id` carries a
 * unique index, so a second insert with the same id raises P2002.
 */
function outboxPrisma() {
  const stored = new Set<string>();
  const create = vi.fn(async (args: { data: { eventId: string } }) => {
    if (stored.has(args.data.eventId)) {
      throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    }
    stored.add(args.data.eventId);
    return { id: `row-${stored.size}` };
  });
  return {
    stored,
    metaConversionEvent: {
      create,
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

async function app() {
  const prisma = outboxPrisma();
  const service = new MetaCapiService(prisma as never, {
    enabled: true,
    send: vi.fn().mockResolvedValue(undefined),
  } as never);
  const module = await Test.createTestingModule({
    controllers: [StorefrontMetaEventsController],
    providers: [{ provide: MetaCapiService, useValue: service }],
  }).compile();
  const instance = module.createNestApplication();
  instance.set('trust proxy', 1);
  await instance.init();
  return { instance, prisma };
}

const addToCart = {
  name: 'AddToCart',
  eventId: 'cart-abc12345',
  eventSourceUrl: 'https://luwag.shop/products/chair',
  customData: { content_ids: ['sku-1'], value: 1999, currency: 'PHP' },
  consent: true,
};

describe('StorefrontMetaEventsController', () => {
  it('is a public storefront route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StorefrontMetaEventsController)).toBe(
      'storefront/meta-events',
    );
  });

  it('queues one row per event id, even when the browser retries the same POST', async () => {
    const { instance, prisma } = await app();
    try {
      const first = await request(instance.getHttpServer())
        .post('/storefront/meta-events')
        .send(addToCart);
      const second = await request(instance.getHttpServer())
        .post('/storefront/meta-events')
        .send(addToCart);

      expect(first.status).toBe(202);
      expect(first.body).toEqual({ accepted: true });
      expect(second.status).toBe(202);
      expect(second.body).toEqual({ accepted: false });
      expect(prisma.stored.size).toBe(1);
      expect(prisma.metaConversionEvent.create).toHaveBeenCalledTimes(2);
    } finally {
      await instance.close();
    }
  });

  it('stores nothing when the shopper has not consented', async () => {
    const { instance, prisma } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/meta-events')
        .send({ ...addToCart, consent: false });

      expect(response.body).toEqual({ accepted: false });
      expect(prisma.metaConversionEvent.create).not.toHaveBeenCalled();
    } finally {
      await instance.close();
    }
  });

  it('keeps Purchase off the public bridge', async () => {
    const { instance, prisma } = await app();
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/meta-events')
        .send({ ...addToCart, name: 'Purchase' });

      expect(response.status).toBe(400);
      expect(prisma.metaConversionEvent.create).not.toHaveBeenCalled();
    } finally {
      await instance.close();
    }
  });
});
