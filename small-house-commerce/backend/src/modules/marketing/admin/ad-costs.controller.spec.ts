import 'reflect-metadata';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { MarketingGuard } from '../marketing.guard.js';
import { AdCostsService } from '../ad-costs.service.js';

const OWNER = '11111111-1111-4111-a111-111111111111';
const FINANCE = '22222222-2222-4222-a222-222222222222';
const LINK = '33333333-3333-4333-a333-333333333333';
const COST = '44444444-4444-4444-a444-444444444444';
const base = { linkId: LINK, costDate: '2026-10-09', amountUsd: '50.00', phpPerUsd: '57.3' };

async function app() {
  const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CatalogModule) as Type<unknown>[])
    .filter(controller => Reflect.getMetadata(PATH_METADATA, controller) === 'admin/marketing/costs');
  const jwt = new JwtService({ secret: 'cost-http-test-only-secret' });
  const config = new ConfigService({ jwt: { secret: 'cost-http-test-only-secret' } });
  const prisma = { user: { findUnique: async ({ where }: { where: { id: string } }) => ({ status: 'ACTIVE', roles: [{ role: { permissions: (where.id === FINANCE ? ['MARKETING_VIEW_ALL'] : ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN']).map(code => ({ permission: { code } })) } }] }) } };
  const costs = {
    listCosts: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    upsertCost: vi.fn(async () => ({ id: COST, amountPhp: '2865.00', version: 0 })),
    voidCost: vi.fn(async () => ({ id: COST, voidedAt: '2026-10-11T00:00:00Z', version: 1 })),
    auditHistory: vi.fn(async () => [{ action: 'CREATE', actorUserId: OWNER }]),
  };
  const module = await Test.createTestingModule({ controllers, providers: [{ provide: AdCostsService, useValue: costs }] })
    .overrideGuard(JwtAuthGuard).useValue(new JwtAuthGuard(jwt, config))
    .overrideGuard(MarketingGuard).useValue(new MarketingGuard(prisma as never)).compile();
  const instance = module.createNestApplication();
  await instance.init();
  return { instance, costs, token: (id = OWNER) => jwt.sign({ sub: id, email: 'cost-http@example.test' }) };
}

describe('advertising costs authenticated HTTP boundary', () => {
  it('requires an authenticated account, keeps reads private, and permits finance read-only', async () => {
    const { instance, token } = await app();
    try {
      const server = instance.getHttpServer();
      expect((await request(server).get('/admin/marketing/costs')).status).toBe(401);
      const response = await request(server).get('/admin/marketing/costs').auth(token(FINANCE), { type: 'bearer' });
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect((await request(server).post('/admin/marketing/costs').auth(token(FINANCE), { type: 'bearer' }).send(base)).status).toBe(403);
      expect((await request(server).get(`/admin/marketing/costs/${COST}/audit`).auth(token(FINANCE), { type: 'bearer' })).body).toEqual([{ action: 'CREATE', actorUserId: OWNER }]);
    } finally { await instance.close(); }
  });

  it('accepts Decimal strings and rejects computed totals, identities and invalid precision', async () => {
    const { instance, costs, token } = await app();
    try {
      const server = instance.getHttpServer();
      const response = await request(server).post('/admin/marketing/costs').auth(token(), { type: 'bearer' }).send(base);
      expect(response.status).toBe(200);
      expect(response.body.amountPhp).toBe('2865.00');
      expect(costs.upsertCost).toHaveBeenCalledWith(base, { id: OWNER, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] });
      for (const extra of [{ ownerUserId: FINANCE }, { amountPhp: '1.00' }, { currency: 'PHP' }, { amountUsd: 1 }, { amountUsd: '-1' }, { amountUsd: '1.001' }, { phpPerUsd: '1.1234567' }, { costDate: '2026-02-30' }, { note: 'x'.repeat(501) }]) {
        expect((await request(server).post('/admin/marketing/costs').auth(token(), { type: 'bearer' }).send({ ...base, ...extra })).status).toBe(400);
      }
      expect(costs.upsertCost).toHaveBeenCalledTimes(1);
    } finally { await instance.close(); }
  });

  it('requires a version to void, validates filters, and exposes no hard-delete endpoint', async () => {
    const { instance, costs, token } = await app();
    try {
      const server = instance.getHttpServer();
      expect((await request(server).post(`/admin/marketing/costs/${COST}/void`).auth(token(), { type: 'bearer' }).send({})).status).toBe(400);
      expect((await request(server).post(`/admin/marketing/costs/${COST}/void`).auth(token(), { type: 'bearer' }).send({ expectedVersion: 0 })).status).toBe(200);
      expect(costs.voidCost).toHaveBeenCalledWith(COST, 0, expect.objectContaining({ id: OWNER }));
      expect((await request(server).get('/admin/marketing/costs?dateFrom=2026-10-11&dateTo=2026-10-09').auth(token(), { type: 'bearer' })).status).toBe(400);
      expect((await request(server).get('/admin/marketing/costs?includeVoided=true').auth(token(), { type: 'bearer' })).status).toBe(200);
      expect(costs.listCosts).toHaveBeenLastCalledWith({ includeVoided: true, page: 1, pageSize: 20 }, expect.objectContaining({ id: OWNER }));
      expect((await request(server).delete(`/admin/marketing/costs/${COST}`).auth(token(), { type: 'bearer' })).status).toBe(404);
    } finally { await instance.close(); }
  });
});
