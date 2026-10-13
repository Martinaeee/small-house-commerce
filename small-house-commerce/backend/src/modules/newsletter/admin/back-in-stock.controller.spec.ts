import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { describe, expect, it, vi } from 'vitest';
import { AdminBackInStockController } from './back-in-stock.controller.js';

function service() {
  return {
    list: vi.fn().mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 0,
      items: [],
    }),
    resend: vi.fn().mockResolvedValue({ id: 'subscription-id' }),
  };
}

describe('AdminBackInStockController', () => {
  it('delegates list and resend while declaring narrow permissions', async () => {
    const backInStock = service();
    const controller = new AdminBackInStockController(backInStock as never);
    const query = { page: 1, pageSize: 20, status: 'PENDING' as const };

    await expect(controller.list(query)).resolves.toMatchObject({ total: 0 });
    await expect(
      controller.resend('018f4d9f-7b31-7a4d-8d64-3c6f8b889c11'),
    ).resolves.toMatchObject({ id: 'subscription-id' });
    expect(backInStock.list).toHaveBeenCalledWith(query);
    expect(backInStock.resend).toHaveBeenCalledWith(
      '018f4d9f-7b31-7a4d-8d64-3c6f8b889c11',
    );

    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminBackInStockController),
    ).toEqual(['NEWSLETTER_READ']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        AdminBackInStockController.prototype.resend,
      ),
    ).toEqual(['NEWSLETTER_WRITE']);
  });
});
