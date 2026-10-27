import { describe, expect, it, vi } from 'vitest';
import { SystemStatusController } from './system-status.controller.js';
import type { SystemStatusService, SystemStatusSnapshot } from './system-status.service.js';

describe('SystemStatusController', () => {
  it('returns the snapshot from the service', () => {
    const snapshot: SystemStatusSnapshot = {
      generatedAt: '2026-10-27T10:00:00.000Z',
      stale: false,
      services: [],
    };
    const service = {
      getStatus: vi.fn().mockReturnValue(snapshot),
    } as unknown as SystemStatusService;
    const controller = new SystemStatusController(service);

    expect(controller.get()).toBe(snapshot);
    expect(service.getStatus).toHaveBeenCalledTimes(1);
  });
});
