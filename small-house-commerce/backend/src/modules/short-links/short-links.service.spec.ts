import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ShortLinksService } from './short-links.service.js';

type Row = {
  id: string;
  code: string;
  target: string;
  targetHash: string;
  createdAt: Date;
};

function setup() {
  const rows = new Map<string, Row>();
  const prisma = {
    shortLink: {
      findUnique: vi.fn(async ({ where }: { where: { code?: string; targetHash?: string } }) => {
        for (const row of rows.values()) {
          if (where.code !== undefined && row.code === where.code) return row;
          if (where.targetHash !== undefined && row.targetHash === where.targetHash) return row;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: { code: string; target: string; targetHash: string } }) => {
        for (const row of rows.values()) {
          if (row.code === data.code || row.targetHash === data.targetHash) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
        }
        const row = { id: `id-${rows.size + 1}`, ...data, createdAt: new Date() };
        rows.set(row.code, row);
        return row;
      }),
    },
  };
  return {
    service: new ShortLinksService(prisma as unknown as PrismaService),
    prisma,
    rows,
  };
}

describe('ShortLinksService', () => {
  describe('target validation', () => {
    it.each([
      ['https://evil.com/products/chair', 'another site'],
      ['https://luwag.shop.evil.com/products/chair', 'a look-alike host'],
      ['//evil.com/products/chair', 'a protocol-relative URL'],
      ['/\\evil.com/products/chair', 'a backslash host trick'],
      ['javascript:alert(1)', 'a script URL'],
      ['products/chair', 'a path without a leading slash'],
      ['/admin/products', 'an admin path'],
      ['/api/v1/orders', 'an API path'],
      ['/preview/landing', 'an internal preview path'],
      ['/s/abc12345', 'a short link itself'],
      ['https://user:pass@luwag.shop/products/chair', 'embedded credentials'],
      ['', 'an empty string'],
      [`/${'a'.repeat(1100)}`, 'an over-long target'],
    ])('rejects %s (%s)', async (url) => {
      const { service, prisma } = setup();

      await expect(service.createLink(url)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.shortLink.create).not.toHaveBeenCalled();
    });
  });

  it('keeps the storefront path and query, dropping the fragment', async () => {
    const { service } = setup();

    await expect(
      service.createLink('https://luwag.shop/products/chair?variant=v1&cl=code#reviews'),
    ).resolves.toMatchObject({
      target: '/products/chair?variant=v1&cl=code',
    });
    await expect(service.createLink('https://www.luwag.shop/lp/chair-ad?cl=code')).resolves.toMatchObject({
      target: '/lp/chair-ad?cl=code',
    });
    await expect(service.createLink('/lp/chair-ad?cl=code')).resolves.toMatchObject({
      target: '/lp/chair-ad?cl=code',
    });
  });

  it('stores a random eight-character code and the target hash', async () => {
    const { service, prisma } = setup();

    const result = await service.createLink('https://luwag.shop/products/chair');

    expect(result.code).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(result.path).toBe(`/s/${result.code}`);
    expect(result.target).toBe('/products/chair');
    expect(prisma.shortLink.create).toHaveBeenCalledWith({
      data: {
        code: result.code,
        target: '/products/chair',
        targetHash: createHash('sha256').update('/products/chair').digest('hex'),
      },
    });
  });

  it('returns the existing code when the same target is shortened twice', async () => {
    const { service, prisma } = setup();

    const first = await service.createLink('https://luwag.shop/products/chair?cl=code');
    const second = await service.createLink('/products/chair?cl=code');

    expect(second).toEqual(first);
    expect(prisma.shortLink.create).toHaveBeenCalledTimes(1);
  });

  it('adopts the row inserted by a concurrent request for the same target', async () => {
    const { service, prisma } = setup();
    const raced: Row = {
      id: 'raced',
      code: 'raceC0de',
      target: '/products/chair',
      targetHash: createHash('sha256').update('/products/chair').digest('hex'),
      createdAt: new Date(),
    };
    prisma.shortLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced);
    prisma.shortLink.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(service.createLink('/products/chair')).resolves.toMatchObject({
      code: 'raceC0de',
      path: '/s/raceC0de',
    });
  });

  it('resolves a known code and refuses unknown or malformed codes', async () => {
    const { service, prisma } = setup();
    const created = await service.createLink('/products/chair');

    await expect(service.resolve(created.code)).resolves.toEqual({ target: '/products/chair' });
    await expect(service.resolve('unknown1')).resolves.toBeNull();
    await expect(service.resolve('../../etc/passwd')).resolves.toBeNull();
    expect(prisma.shortLink.findUnique).toHaveBeenCalledTimes(3);
  });
});
