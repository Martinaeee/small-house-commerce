import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminJtController,
  JtShipmentTrackingController,
} from './jt-admin.controller.js';

const tracking = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  health: vi.fn(async () => ({ enabled: true })),
  refreshShipment: vi.fn(async () => ({ appended: 2, skipped: 0, signed: true })),
  ...overrides,
});

describe('AdminJtController', () => {
  it('returns the worker health', async () => {
    const service = tracking();
    const controller = new AdminJtController(service as never);
    await expect(controller.status()).resolves.toEqual({ enabled: true });
  });
});

describe('JtShipmentTrackingController', () => {
  it('refreshes one shipment on demand', async () => {
    const service = tracking();
    const controller = new JtShipmentTrackingController(service as never);
    await expect(controller.refresh('order-1', 'shipment-1')).resolves.toEqual({
      appended: 2,
      skipped: 0,
      signed: true,
    });
    expect(service.refreshShipment).toHaveBeenCalledWith('order-1', 'shipment-1');
  });

  it('refuses with 409 when the integration is off', async () => {
    const service = tracking({ enabled: false });
    const controller = new JtShipmentTrackingController(service as never);
    await expect(
      controller.refresh('order-1', 'shipment-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(service.refreshShipment).not.toHaveBeenCalled();
  });
});
