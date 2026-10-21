import { describe, expect, it, vi } from 'vitest';
import { MarketingGuard } from './marketing.guard.js';

function harness(permissions: string[], method = 'GET', status = 'ACTIVE') {
  const request = { method, user: { userId: 'u1' }, marketingAccount: { id: 'forged', permissions: ['MARKETING_MANAGE_ALL'] } };
  const prisma = { user: { findUnique: vi.fn(async () => ({ status, roles: [{ role: { permissions: permissions.map((code) => ({ permission: { code } })) } }] })) } };
  const context = { switchToHttp: () => ({ getRequest: () => request }) };
  return { guard: new MarketingGuard(prisma as never), request, context };
}

describe('marketing request authorization', () => {
  it('loads current database permissions instead of trusting incoming identity fields', async () => {
    const { guard, request, context } = harness(['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'], 'POST');
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.marketingAccount).toEqual({ id: 'u1', permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] });
  });

  it('allows finance reads but refuses finance writes', async () => {
    const read = harness(['MARKETING_VIEW_ALL']);
    await expect(read.guard.canActivate(read.context as never)).resolves.toBe(true);
    const write = harness(['MARKETING_VIEW_ALL'], 'PATCH');
    await expect(write.guard.canActivate(write.context as never)).rejects.toMatchObject({ status: 403 });
  });

  it('blocks disabled and unrelated accounts', async () => {
    for (const example of [harness(['MARKETING_VIEW_ALL'], 'GET', 'DISABLED'), harness(['PRODUCT_MANAGE'])])
      await expect(example.guard.canActivate(example.context as never)).rejects.toMatchObject({ status: 403 });
  });
});
