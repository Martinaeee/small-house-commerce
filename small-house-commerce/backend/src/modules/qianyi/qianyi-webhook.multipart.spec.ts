import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { QianyiWebhookController } from './qianyi-webhook.controller.js';
import { QianyiWebhookService } from './qianyi-webhook.service.js';

/**
 * End-to-end proof that Qianyi's default multipart/form-data body survives the
 * interceptor and reaches the service as plain fields — the one thing the
 * controller unit test cannot cover. No database involved: the service is a
 * stub.
 */
describe('POST /qianyi/webhook (multipart)', () => {
  it('parses the five text fields from a multipart body', async () => {
    const ingest = vi.fn(async () => ({ ok: true, duplicated: false }));
    const moduleRef = await Test.createTestingModule({
      controllers: [QianyiWebhookController],
      providers: [{ provide: QianyiWebhookService, useValue: { ingest, allow: () => true } }],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .post('/qianyi/webhook')
        .field('appId', '1793-test')
        .field('serviceType', 'PUSH_ODO_ORDER')
        .field('bizParam', '{"onlineOrderNumber":"PH100012","status":"SHIPPED"}')
        .field('timestamp', '1700000000000')
        .field('sign', 'abc123')
        .expect(200);

      expect(response.body).toEqual({ ok: true });
      expect(ingest).toHaveBeenCalledWith({
        appId: '1793-test',
        serviceType: 'PUSH_ODO_ORDER',
        bizParam: '{"onlineOrderNumber":"PH100012","status":"SHIPPED"}',
        timestamp: '1700000000000',
        sign: 'abc123',
      });
    } finally {
      await app.close();
    }
  });
});
