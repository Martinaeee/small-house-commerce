import { describe, expect, it, vi } from 'vitest';
import { StorefrontBackInStockController } from './back-in-stock.controller.js';

function service(overrides: Record<string, unknown> = {}) {
  return {
    subscribe: vi.fn().mockResolvedValue({ ok: true }),
    cancelByToken: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('StorefrontBackInStockController', () => {
  it('delegates the exact email and SKU subscription', async () => {
    const backInStock = service();
    const controller = new StorefrontBackInStockController(
      backInStock as never,
    );
    const input = {
      email: 'shopper@example.com',
      skuId: '018f4d9f-7b31-7a4d-8d64-3c6f8b889c11',
    };

    await expect(controller.subscribe(input)).resolves.toEqual({ ok: true });
    expect(backInStock.subscribe).toHaveBeenCalledWith(input);
  });

  it('GET renders a POST confirmation without cancelling', () => {
    const backInStock = service();
    const controller = new StorefrontBackInStockController(
      backInStock as never,
    );

    const html = controller.unsubscribeConfirmation({ token: 'valid.token' });

    expect(html).toContain('Confirm stock alert unsubscribe');
    expect(html).toContain('method="post"');
    expect(html).toContain('token=valid.token');
    expect(backInStock.cancelByToken).not.toHaveBeenCalled();
  });

  it('POST reports valid and invalid unsubscribe links', async () => {
    const valid = new StorefrontBackInStockController(service() as never);
    const invalid = new StorefrontBackInStockController(
      service({ cancelByToken: vi.fn().mockResolvedValue(false) }) as never,
    );

    await expect(valid.confirmUnsubscribe({ token: 'valid.token' })).resolves.toContain(
      'cancelled',
    );
    await expect(
      invalid.confirmUnsubscribe({ token: 'invalid.token' }),
    ).resolves.toContain('invalid');
  });
});
