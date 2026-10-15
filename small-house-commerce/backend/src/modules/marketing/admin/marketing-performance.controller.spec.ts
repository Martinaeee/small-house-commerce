import {
  GUARDS_METADATA,
  HEADERS_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { MarketingGuard } from '../../marketing/marketing.guard.js';
import { MarketingPerformanceController } from './marketing-performance.controller.js';

describe('MarketingPerformanceController', () => {
  it('delegates performance and options reads with the current marketing account', async () => {
    const service = { performance: vi.fn().mockResolvedValue({ rows: [] }), options: vi.fn().mockResolvedValue({ products: [] }) };
    const controller = new MarketingPerformanceController(service as never);
    const account = { id: 'u1', permissions: ['MARKETING_VIEW_OWN'] };
    const query = { view: 'PRODUCT', productId: 'product-1', preset: 'LAST_7_DAYS', interval: 'DAY', compare: true, sortBy: 'name', sortDirection: 'asc', page: 1, pageSize: 20 } as never;

    await expect(controller.performance(query, account)).resolves.toEqual({ rows: [] });
    expect(service.performance).toHaveBeenCalledWith(query, account);
    await expect(controller.options({}, account)).resolves.toEqual({ products: [] });
    expect(service.options).toHaveBeenCalledWith({}, account);
  });

  it('uses the owner-aware marketing guard, not a legacy permission bypass', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MarketingPerformanceController),
    ).toEqual(expect.arrayContaining([JwtAuthGuard, MarketingGuard]));
  });

  it('marks both responses private and non-cacheable', () => {
    for (const handler of [MarketingPerformanceController.prototype.performance, MarketingPerformanceController.prototype.options]) {
      expect(
        Reflect.getMetadata(HEADERS_METADATA, handler),
      ).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
    }
  });
});
