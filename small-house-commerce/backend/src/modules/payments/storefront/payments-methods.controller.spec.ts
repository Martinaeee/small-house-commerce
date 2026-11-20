import { describe, expect, it, vi } from 'vitest';
import { StorefrontPaymentsMethodsController } from './payments-methods.controller.js';
import { PaymentMethodsService, type EffectiveMethods } from '../payment-methods.service.js';

const serviceOf = (result: EffectiveMethods) =>
  ({ listEffectiveMethods: vi.fn().mockResolvedValue(result) }) as unknown as PaymentMethodsService;

describe('storefront payment methods endpoint', () => {
  it('projects id and enabled only — never merchant or readiness detail', async () => {
    const controller = new StorefrontPaymentsMethodsController(
      serviceOf({
        codEnabled: true,
        revision: 3,
        methods: [
          { id: 'COD', enabled: true, ready: true },
          { id: 'CARD', enabled: false, ready: true },
        ],
      }),
    );
    const payload = (await controller.list()) as Record<string, unknown>;
    expect(payload).toEqual({
      codEnabled: true,
      revision: 3,
      methods: [
        { id: 'COD', enabled: true },
        { id: 'CARD', enabled: false },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(/merchant|signKey|ready/i);
  });

  it('reports codEnabled=false when COD is switched off', async () => {
    const controller = new StorefrontPaymentsMethodsController(
      serviceOf({
        codEnabled: false,
        revision: 7,
        methods: [
          { id: 'COD', enabled: false, ready: true },
          { id: 'GCASH', enabled: true, ready: true },
        ],
      }),
    );
    const payload = (await controller.list()) as Record<string, unknown>;
    expect(payload.codEnabled).toBe(false);
    expect(payload.methods).toContainEqual({ id: 'GCASH', enabled: true });
  });
});
