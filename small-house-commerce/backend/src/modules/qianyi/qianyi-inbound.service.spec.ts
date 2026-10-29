import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QianyiInboundService } from './qianyi-inbound.service.js';

function config(enabled: boolean) {
  return new ConfigService({ qianyi: {
    enabled: String(enabled), appId: 'test-app-id-0001', appSecret: 'test-secret-000000000000',
    shop: 'LUWAG- PH', warehouseId: 71537, warehouse: 'PH-DAVAO-01', logistics: 'SHIPDOC-STD',
  } });
}
function build(enabled = true) {
  const prisma = { $transaction: vi.fn(), $queryRaw: vi.fn(async () => []), order: { findUnique: vi.fn(async () => null) } };
  return { prisma, service: new QianyiInboundService(prisma as never, {} as never, {} as never, config(enabled)) };
}
const tx = { $queryRaw: vi.fn(async () => []), order: { findUnique: vi.fn(async () => null) } };

describe('QianyiInboundService', () => {
  it('does nothing at all while the integration is disabled', async () => {
    const { service, prisma } = build(false);
    await service.handle('PUSH_ODO_ORDER', { onlineOrderNumber: 'PH1', status: 'SHIPPED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a callback that names no order', async () => {
    const { service } = build();
    await expect(service.handle('PUSH_TRACKING_PACKAGE', { status: 'IN_TRANSIT' }, tx as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects conflicting order references instead of guessing one', async () => {
    const { service } = build();
    await expect(service.handle('PUSH_TRACKING_PACKAGE',
      { onlineOrderNumber: 'PH1', onlineOrderId: 'PH2', status: 'IN_TRANSIT' }, tx as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a callback for an order that does not exist locally', async () => {
    const { service } = build();
    await expect(service.handle('PUSH_TRACKING_PACKAGE',
      { onlineOrderNumber: 'PH-MISSING', status: 'IN_TRANSIT' }, tx as never))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
