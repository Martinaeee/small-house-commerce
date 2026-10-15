import 'reflect-metadata';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { MarketingTouchService } from '../marketing-touch.service.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';

async function app() {
  const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CatalogModule) as Type<unknown>[])
    .filter((controller) => Reflect.getMetadata(PATH_METADATA, controller) === 'storefront/marketing-touch');
  const module = await Test.createTestingModule({
    controllers,
    providers: [{ provide: MarketingTouchService, useValue: { touch: async () => ({ credential: 'opaque.test-credential', expiresAt: '2026-10-18T00:00:00Z' }) } }],
  }).compile();
  const instance = module.createNestApplication();
  await instance.init();
  return instance;
}

describe('public touch HTTP boundary', () => {
  it('issues an uncached credential without requiring an admin session', async () => {
    const instance = await app();
    try {
      const response = await request(instance.getHttpServer()).post('/storefront/marketing-touch').send({ code: 'abcdefghijklmnop', visitKey: 'tab-1' });
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({ credential: 'opaque.test-credential' });
    } finally { await instance.close(); }
  });

  it('rejects client owner identities, malformed targets and unbounded session input', async () => {
    const instance = await app();
    try {
      for (const extra of [{ ownerUserId: 'forged' }, { optimizerId: 'forged' }, { landingPageId: 'not-a-uuid' }, { visitKey: 'x'.repeat(129) }, { path: '//outside.test/lp/page' }]) {
        const response = await request(instance.getHttpServer()).post('/storefront/marketing-touch').send({ code: 'abcdefghijklmnop', visitKey: 'tab-1', ...extra });
        expect(response.status).toBe(400);
      }
    } finally { await instance.close(); }
  });
});
