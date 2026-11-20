import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service.js';
import { updatePaymentMethodsSchema } from './dto/payment-methods.dto.js';

const OPERATOR = '11111111-1111-1111-1111-111111111111';

const rowOf = (method: string, enabled: boolean, revision = 0) => ({
  method,
  enabled,
  revision,
  updatedBy: null,
  updatedAt: new Date('2026-11-20T00:00:00Z'),
});

/** Fake PrismaService covering the paymentMethodConfig surface. */
const prismaOf = (rows: { method: string; enabled: boolean; revision?: number }[]) => {
  const state = new Map(rows.map((r) => [r.method, rowOf(r.method, r.enabled, r.revision ?? 0)]));
  return {
    paymentMethodConfig: {
      findMany: vi.fn(async () => [...state.values()]),
      upsert: vi.fn(async ({ where, update, create }) => {
        const existing = state.get(where.method);
        if (existing) {
          const next = { ...existing, ...(update as object) };
          state.set(where.method, next);
          return next;
        }
        const created = { rowOf, revision: 0, ...(create as object) } as never;
        state.set((create as { method: string }).method, created);
        return created;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        paymentMethodConfig: {
          upsert: async ({ where, update, create }: { where: { method: string }; update: object; create: object }) => {
            const existing = state.get(where.method);
            if (existing) {
              const next = { ...existing, ...update };
              state.set(where.method, next);
              return next;
            }
            const created = { revision: 0, ...create } as never;
            state.set((create as { method: string }).method, created);
            return created;
          },
        },
      }),
    ),
  } as unknown as import('../../prisma/prisma.service.js').PrismaService & { _state?: Map<string, unknown> };
};

/** ConfigService whose sunrate block answers through a SunrateConfig-like tree. */
const configOf = (values: Record<string, string>) =>
  new ConfigService({
    sunrate: {
      enabled: values['sunrate.enabled'],
      env: values['sunrate.env'],
      merchantId: values['sunrate.merchantId'],
      signKey: values['sunrate.signKey'],
      baseUrl: values['sunrate.baseUrl'],
    },
    payments: { publicBaseUrl: values['payments.publicBaseUrl'] ?? 'https://luwag.shop' },
  });

const gatewayOn = { 'sunrate.enabled': 'true', 'sunrate.env': 'test', 'sunrate.merchantId': 'M12345678', 'sunrate.signKey': 'k'.repeat(24), 'payments.publicBaseUrl': 'https://luwag.shop' };

describe('PaymentMethodsService — effective methods', () => {
  it('defaults to COD enabled and every online method off when the gateway is unconfigured', async () => {
    const service = new PaymentMethodsService(prismaOf([
      { method: 'COD', enabled: true },
      { method: 'CARD', enabled: false },
      { method: 'GCASH', enabled: false },
      { method: 'BPI', enabled: false },
    ]), configOf({}));
    const result = await service.listEffectiveMethods();
    expect(result.codEnabled).toBe(true);
    expect(result.revision).toBe(0);
    expect(result.methods).toEqual([
      { id: 'COD', enabled: true, ready: true },
      { id: 'CARD', enabled: false, ready: false },
      { id: 'GCASH', enabled: false, ready: false },
      { id: 'BPI', enabled: false, ready: false },
    ]);
  });

  it('exposes an online method only when its DB switch AND the gateway are on', async () => {
    const service = new PaymentMethodsService(prismaOf([
      { method: 'COD', enabled: true },
      { method: 'GCASH', enabled: true },
      { method: 'CARD', enabled: false },
      { method: 'BPI', enabled: false },
    ]), configOf(gatewayOn));
    const result = await service.listEffectiveMethods();
    expect(result.methods.find((m) => m.id === 'GCASH')).toEqual({ id: 'GCASH', enabled: true, ready: true });
    expect(result.methods.find((m) => m.id === 'CARD')!.enabled).toBe(false);
  });

  it('treats a missing COD row as enabled (restore backstop)', async () => {
    const service = new PaymentMethodsService(prismaOf([
      { method: 'CARD', enabled: false },
      { method: 'GCASH', enabled: false },
      { method: 'BPI', enabled: false },
    ]), configOf({}));
    const result = await service.listEffectiveMethods();
    expect(result.codEnabled).toBe(true);
  });
});

describe('PaymentMethodsService — update', () => {
  let prisma: ReturnType<typeof prismaOf>;
  beforeEach(() => {
    prisma = prismaOf([
      { method: 'COD', enabled: true },
      { method: 'CARD', enabled: false },
      { method: 'GCASH', enabled: false },
      { method: 'BPI', enabled: false },
    ]);
  });

  it('rejects enabling an online method while the gateway is unconfigured', async () => {
    const service = new PaymentMethodsService(prisma, configOf({}));
    await expect(
      service.update([{ id: 'GCASH', enabled: true }], OPERATOR, 0),
    ).rejects.toMatchObject({ message: 'CHANNEL_NOT_READY' });
  });

  it('saves an online method once the gateway is ready and bumps the revision', async () => {
    const service = new PaymentMethodsService(prisma, configOf(gatewayOn));
    const result = await service.update([{ id: 'GCASH', enabled: true }], OPERATOR, 0);
    expect(result.revision).toBe(1);
    expect(result.methods.find((m) => m.id === 'GCASH')!.enabled).toBe(true);
  });

  it('refuses to leave no enabled-and-ready method (all-off store)', async () => {
    const service = new PaymentMethodsService(prisma, configOf({}));
    await expect(
      service.update([{ id: 'COD', enabled: false }], OPERATOR, 0),
    ).rejects.toMatchObject({ message: 'NO_ENABLED_PAYMENT_METHOD' });
  });

  it('conflicts on a stale revision', async () => {
    const service = new PaymentMethodsService(prisma, configOf({}));
    await expect(
      service.update([{ id: 'COD', enabled: true }], OPERATOR, 5),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records the operator on the saved rows', async () => {
    const service = new PaymentMethodsService(prisma, configOf(gatewayOn));
    await service.update([{ id: 'BPI', enabled: true }], OPERATOR, 0);
    const saved = await service.listForAdmin();
    expect(saved.methods.find((m) => m.id === 'BPI')!.updatedBy).toBe(OPERATOR);
  });
});

describe('payment methods dto', () => {
  it('validates the update payload shape', () => {
    expect(() => updatePaymentMethodsSchema.parse({ methods: [{ id: 'PAYPAL', enabled: true }], revision: 0 })).toThrow();
    expect(
      updatePaymentMethodsSchema.parse({ methods: [{ id: 'GCASH', enabled: true }], revision: 0 }),
    ).toEqual({ methods: [{ id: 'GCASH', enabled: true }], revision: 0 });
  });
});
