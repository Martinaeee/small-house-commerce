import 'reflect-metadata';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { MarketingTouchService } from '../marketing-touch.service.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';

async function app(touch: () => Promise<{ credential: string | null; expiresAt: string | null; paid: boolean }> = async () => ({ credential: 'opaque.test-credential', expiresAt: '2026-10-18T00:00:00Z', paid: false })) {
  const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CatalogModule) as Type<unknown>[])
    .filter((controller) => Reflect.getMetadata(PATH_METADATA, controller) === 'storefront/marketing-touch');
  const module = await Test.createTestingModule({
    controllers,
    providers: [{ provide: MarketingTouchService, useValue: { touch } }],
  }).compile();
  const instance = module.createNestApplication();
  instance.set('trust proxy', 1);
  await instance.init();
  return instance;
}

function cookieHeaders(response: request.Response): string[] {
  const value = response.headers['set-cookie'];
  return Array.isArray(value) ? value : value ? [value] : [];
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

  it('writes both first-touch and last-touch HttpOnly cookies for a paid touch', async () => {
    const instance = await app(async () => ({ credential: 'signed.touch', expiresAt: new Date(Date.now() + 3600e3).toISOString(), paid: true }));
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/marketing-touch')
        .set('X-Forwarded-Proto', 'https')
        .send({ aid: 'OP-1', adId: '120212345678901234', visitKey: 'tab-1', path: '/products/chair' });
      expect(response.status).toBe(200);
      const cookies = cookieHeaders(response);
      expect(cookies).toHaveLength(2);
      for (const name of ['luwag_mt_first', 'luwag_mt_last']) {
        expect(cookies.find((cookie) => cookie.startsWith(`${name}=signed.touch`))).toMatch(new RegExp(`^${name}=signed\\.touch; Max-Age=(3599|3600); Path=/; Expires=.*; HttpOnly; Secure; SameSite=Lax$`));
      }
      expect(cookies.find((cookie) => cookie.startsWith('luwag_mt_first='))).toMatch(/Max-Age=(3599|3600)/);
    } finally { await instance.close(); }
  });

  it('keeps the existing first touch and refreshes the last touch', async () => {
    const instance = await app(async () => ({ credential: 'second.touch', expiresAt: new Date(Date.now() + 3600e3).toISOString(), paid: true }));
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/marketing-touch')
        .set('Cookie', 'luwag_mt_first=first.touch')
        .send({ aid: 'OP-1', adId: '120212345678901234', visitKey: 'tab-1', path: '/products/chair' });
      const cookies = cookieHeaders(response);
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toMatch(/^luwag_mt_last=second\.touch; Max-Age=(3599|3600); Path=\/; Expires=.*; HttpOnly; SameSite=Lax$/);
    } finally { await instance.close(); }
  });

  it('records the first touch but no last paid touch for an organic touch', async () => {
    const instance = await app(async () => ({ credential: 'organic.touch', expiresAt: new Date(Date.now() + 3600e3).toISOString(), paid: false }));
    try {
      const response = await request(instance.getHttpServer())
        .post('/storefront/marketing-touch')
        .send({ aid: 'OP-1', visitKey: 'tab-1', path: '/products/chair' });
      const cookies = cookieHeaders(response);
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toMatch(/^luwag_mt_first=organic\.touch;/);
    } finally { await instance.close(); }
  });
});
