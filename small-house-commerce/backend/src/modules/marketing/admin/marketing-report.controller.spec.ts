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
import { MarketingReportService } from '../marketing-report.service.js';

const OWNER = '11111111-1111-4111-a111-111111111111';
const LINK = '33333333-3333-4333-a333-333333333333';
async function app() {
  const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CatalogModule) as Type<unknown>[]).filter(controller => Reflect.getMetadata(PATH_METADATA, controller) === 'admin/marketing/reports');
  const jwt = new JwtService({ secret: 'report-http-test-only-secret' });
  const config = new ConfigService({ jwt: { secret: 'report-http-test-only-secret' } });
  const prisma = { user: { findUnique: async () => ({ status: 'ACTIVE', roles: [{ role: { permissions: [{ permission: { code: 'MARKETING_VIEW_ALL' } }] } }] }) } };
  const reports = { report: vi.fn(async () => ({ rows: [], otherSources: [], total: 0 })) };
  const module = await Test.createTestingModule({ controllers, providers: [{ provide: MarketingReportService, useValue: reports }] })
    .overrideGuard(JwtAuthGuard).useValue(new JwtAuthGuard(jwt, config))
    .overrideGuard(MarketingGuard).useValue(new MarketingGuard(prisma as never)).compile();
  const instance = module.createNestApplication(); await instance.init();
  return { instance, reports, bearer: jwt.sign({ sub: OWNER, email: 'report-finance@example.test' }) };
}

describe('marketing report HTTP boundary', () => {
  it('requires authentication and serves finance uncached, without write permission', async () => {
    const { instance, reports, bearer } = await app();
    try {
      const server = instance.getHttpServer();
      expect((await request(server).get('/admin/marketing/reports')).status).toBe(401);
      const response = await request(server).get(`/admin/marketing/reports?from=2026-10-09&to=2026-10-10&groupBy=PAGE&linkIds=${LINK}`).auth(bearer, { type: 'bearer' });
      expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('private, no-store');
      expect(reports.report).toHaveBeenCalledWith({ from: '2026-10-09', to: '2026-10-10', groupBy: 'PAGE', linkIds: [LINK], page: 1, pageSize: 20 }, { id: OWNER, permissions: ['MARKETING_VIEW_ALL'] });
    } finally { await instance.close(); }
  });

  it('rejects invalid dates, identifiers, grouping and computed client fields before querying', async () => {
    const { instance, reports, bearer } = await app();
    try {
      for (const query of ['from=2026-02-30', 'from=2026-10-10&to=2026-10-09', 'to=9999-12-31', 'groupBy=customers', 'linkIds=not-a-uuid', 'ownerUserId=not-a-uuid', 'spendUsd=0', 'pageSize=101']) {
        expect((await request(instance.getHttpServer()).get(`/admin/marketing/reports?${query}`).auth(bearer, { type: 'bearer' })).status).toBe(400);
      }
      expect(reports.report).not.toHaveBeenCalled();
    } finally { await instance.close(); }
  });
});
