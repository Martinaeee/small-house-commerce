import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { Prisma } from '../../generated/prisma/client.js';
import { StorefrontCustomerAuthService } from './storefront-customer-auth.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on ${target}`,
    { code: 'P2002', clientVersion: '7.10.0' },
  );
}

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const config = {
  getOrThrow: (key: string) => (key === 'jwt.accessTtl' ? '1h' : '7d'),
} as never;

function makeService(prismaOverrides: Record<string, unknown>) {
  const prisma = {
    customerAccount: {},
    customerRefreshToken: {},
    customer: {},
    order: {},
    // The service uses both transaction forms: interactive callback
    // (phone linking) and the awaited-array form (orders list).
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
    ),
    ...prismaOverrides,
  } as unknown as PrismaService;
  // JwtService needs an explicit secret in tests (no JwtModule config here).
  return new StorefrontCustomerAuthService(prisma, new JwtService({ secret: SECRET }), config);
}

const accountRow = {
  id: 'acct-1',
  email: 'juan@example.com',
  name: 'Juan',
  passwordHash: '',
  customerId: null,
  customer: null,
};

describe('StorefrontCustomerAuthService', () => {
  it('register hashes the password and lowercases email', async () => {
    const create = vi.fn().mockResolvedValue({ ...accountRow, email: 'juan@example.com' });
    const service = makeService({
      customerAccount: { create, findUnique: vi.fn().mockResolvedValue(null) },
      customerRefreshToken: { create: vi.fn().mockResolvedValue(undefined) },
    });
    const result = await service.register({
      name: 'Juan',
      email: 'Juan@Example.com',
      password: 'longpassword',
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data.email).toBe('juan@example.com');
    expect(create.mock.calls[0][0].data.passwordHash).not.toBe('longpassword');
    expect(result.account.email).toBe('juan@example.com');
    expect(result.accessToken).toBeTruthy();
  });

  it('register maps a duplicate email to 409', async () => {
    const service = makeService({
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue(accountRow),
        create: vi.fn(),
      },
    });
    await expect(
      service.register({ name: 'Juan', email: 'juan@example.com', password: 'longpassword' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('register maps a concurrent duplicate-email P2002 on create to 409', async () => {
    const service = makeService({
      customerAccount: {
        // Pre-check misses; a racing transaction wins the unique email.
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(p2002('CustomerAccount_email_key')),
      },
    });
    await expect(
      service.register({ name: 'Juan', email: 'juan@example.com', password: 'longpassword' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updateMe maps a concurrent phone-link P2002 on account update to 409', async () => {
    const service = makeService({
      customer: {
        upsert: vi.fn().mockResolvedValue({ id: 'cust-9', normalizedPhone: '+639170000002' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      customerAccount: {
        // Call 1: requireAccount; call 2: owner lookup (misses the racer).
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ ...accountRow })
          .mockResolvedValueOnce(null),
        // The racing account already owns customerId cust-9.
        update: vi.fn().mockRejectedValue(p2002('CustomerAccount_customerId_key')),
      },
    });
    await expect(
      service.updateMe('acct-1', { phone: '09170000002' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('login rejects an unknown email with 401', async () => {
    const service = makeService({
      customerAccount: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    await expect(
      service.login({ email: 'nobody@example.com', password: 'longpassword' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login rejects a wrong password with 401 even when the email exists', async () => {
    const service = makeService({
      customerAccount: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...accountRow, passwordHash: await argon2.hash('correct-password') }),
      },
    });
    await expect(
      service.login({ email: 'juan@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('links a saved phone by upserting Customer and rejects a phone owned by another account', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'cust-9', normalizedPhone: '+639170000001' });
    const update = vi.fn().mockResolvedValue(undefined);

    const ownerService = makeService({
      customer: {
        upsert,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: 'other-account' }),
        update,
      },
    });
    await expect(
      ownerService.updateMe('acct-1', { phone: '0917 000 0001' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();

    const upsertFree = vi
      .fn()
      .mockResolvedValue({ id: 'cust-10', normalizedPhone: '+639170000002' });
    const freeService = makeService({
      customer: {
        upsert: upsertFree,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      customerAccount: {
        // Call 1: requireAccount at updateMe entry.
        // Call 2: owner lookup inside the transaction (null = phone free).
        // Call 3: requireAccount when me() reloads the profile.
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ ...accountRow })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            ...accountRow,
            customerId: 'cust-10',
            customer: { normalizedPhone: '+639170000002' },
          }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });
    const profile = await freeService.updateMe('acct-1', { phone: '09170000002' });
    expect(profile.phone).toBe('+639170000002');
    // New COD customer inherits the account identity on creation.
    expect(upsertFree.mock.calls[0][0].create).toMatchObject({
      normalizedPhone: '+639170000002',
      name: 'Juan',
      email: 'juan@example.com',
    });
  });

  it('PATCH /me with name+phone seeds and backfills Customer using the NEW name', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'cust-11', normalizedPhone: '+639170000003' });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = makeService({
      customer: { upsert, updateMany },
      customerAccount: {
        // Call 1: requireAccount at updateMe entry (pre-update name "Juan").
        // Call 2: owner lookup inside the transaction (null = phone free).
        // Call 3: requireAccount when me() reloads the profile.
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ ...accountRow })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            ...accountRow,
            name: 'Juanita',
            customerId: 'cust-11',
            customer: { normalizedPhone: '+639170000003' },
          }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    });

    const profile = await service.updateMe('acct-1', {
      name: 'Juanita',
      phone: '0917 000 0003',
    });

    expect(profile.name).toBe('Juanita');
    // A brand-new phone-keyed Customer is seeded with the incoming name.
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      normalizedPhone: '+639170000003',
      name: 'Juanita',
    });
    // The name:null backfill (first updateMany) also gets the incoming name.
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'cust-11', name: null },
      data: { name: 'Juanita' },
    });
  });

  it('serializes orders without cost/supplier/internal fields and converts decimals', async () => {
    const service = makeService({
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({ ...accountRow, customerId: 'cust-1' }),
      },
      order: {
        findMany: vi.fn().mockResolvedValue([
          {
            orderNumber: 'ORD-1',
            orderStatus: 'NEW',
            paymentStatus: 'COD_PENDING',
            currency: 'PHP',
            grandTotal: { toString: () => '1999.00' },
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            items: [
              {
                productNameSnapshot: 'Stock Chair',
                variantSnapshot: 'Default',
                quantity: 2,
                lineTotal: { toString: () => '3998.00' },
              },
            ],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    });
    const page = await service.listOrders('acct-1', { page: 1, pageSize: 10 });
    expect(page.items[0].grandTotal).toBe(1999);
    expect(page.items[0].items[0].lineTotal).toBe(3998);
    expect(JSON.stringify(page.items)).not.toContain('optimizer');
    expect(JSON.stringify(page.items)).not.toContain('landedCost');
  });

  it('returns an empty order page when no phone is linked yet', async () => {
    const service = makeService({
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({ ...accountRow, customerId: null }),
      },
    });
    const page = await service.listOrders('acct-1', { page: 1, pageSize: 10 });
    expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
  });
});
