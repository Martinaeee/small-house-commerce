import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaLinkLookup } from './homepage-link-lookup.js';
import { HomepageService } from './homepage.service.js';

const ids = { shared: randomUUID(), disabled: randomUUID(), section: randomUUID(), entryA: randomUUID(), entryB: randomUUID(), entryC: randomUUID() };
let prisma: PrismaClient | undefined;

describe.skipIf(process.env.HOMEPAGE_STUDIO_PG !== '1')('owned homepage navigation PostgreSQL', () => {
  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL ?? '';
    const url = new URL(connectionString);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5556' ||
      url.pathname !== '/small_house_homepage_studio_20261016_test' || process.env.E2E_PG_PORT !== '5556') {
      throw new Error('Refusing non-owned homepage studio database');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    await prisma.category.create({ data: { id: ids.shared, name: 'Sample studio category', slug: `studio-category-${ids.shared}`, status: 'ACTIVE', imageUrl: null } });
    await prisma.collection.createMany({ data: [
      { id: ids.shared, name: 'Sample studio collection', slug: `studio-collection-${ids.shared}`, status: 'ACTIVE' },
      { id: ids.disabled, name: 'Sample disabled collection', slug: `studio-${ids.disabled}`, status: 'DISABLED' },
    ] });
    await prisma.homepageSection.create({ data: {
      id: ids.section, type: 'CATEGORY_TILES', title: 'Sample test navigation', sortOrder: 999,
      payload: { entries: [
        { id: ids.entryA, imageUrl: '/uploads/e2e/category.jpg', label: '  ', link: { type: 'CATEGORY', id: ids.shared } },
        { id: ids.entryB, imageUrl: '/uploads/e2e/collection.jpg', label: 'Custom collection label', link: { type: 'COLLECTION', id: ids.shared } },
        { id: ids.entryC, imageUrl: '/uploads/e2e/repeat.jpg', link: { type: 'CATEGORY', id: ids.shared } },
      ], presentation: 'CIRCLES' },
    } });
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      await prisma.homepageSection.deleteMany({ where: { id: ids.section } });
      await prisma.collection.deleteMany({ where: { id: { in: [ids.shared, ids.disabled] } } });
      await prisma.category.deleteMany({ where: { id: ids.shared } });
    } finally { await prisma.$disconnect(); }
  });

  it('keeps same-UUID entity types separate and returns only ACTIVE targets with no global image requirement', async () => {
    if (!prisma) throw new Error('Missing owned fixture connection');
    const result = await new PrismaLinkLookup(prisma as never).navigationTargets({ categoryIds: [ids.shared, ids.shared], collectionIds: [ids.shared, ids.disabled] });
    expect(result.get(`CATEGORY:${ids.shared}`)).toMatchObject({ type: 'CATEGORY', name: 'Sample studio category' });
    expect(result.get(`COLLECTION:${ids.shared}`)).toMatchObject({ type: 'COLLECTION', name: 'Sample studio collection' });
    expect(result.has(`COLLECTION:${ids.disabled}`)).toBe(false);
    expect(result.size).toBe(2);
  });

  it('hydrates exact custom images and target order from the real database', async () => {
    if (!prisma) throw new Error('Missing owned fixture connection');
    const products = { storefrontByIds: async () => [] };
    const response = await new HomepageService(prisma as never, products as never).storefrontGet();
    const row = response.sections.find((section) => section.id === ids.section);
    expect(row).toHaveProperty('navigationEntries', [
      { id: ids.entryA, name: 'Sample studio category', imageUrl: '/uploads/e2e/category.jpg', href: `/categories/studio-category-${ids.shared}`, link: { type: 'CATEGORY', id: ids.shared } },
      { id: ids.entryB, name: 'Custom collection label', imageUrl: '/uploads/e2e/collection.jpg', href: `/collections/studio-collection-${ids.shared}`, link: { type: 'COLLECTION', id: ids.shared } },
      { id: ids.entryC, name: 'Sample studio category', imageUrl: '/uploads/e2e/repeat.jpg', href: `/categories/studio-category-${ids.shared}`, link: { type: 'CATEGORY', id: ids.shared } },
    ]);
  });

  it('removes disabled and deleted targets without substituting another entity with the same UUID', async () => {
    if (!prisma) throw new Error('Missing owned fixture connection');
    const service = new HomepageService(prisma as never, { storefrontByIds: async () => [] } as never);
    await prisma.category.update({ where: { id: ids.shared }, data: { status: 'DISABLED' } });
    const disabled = await service.storefrontGet();
    expect(disabled.sections.find((section) => section.id === ids.section)).toHaveProperty('navigationEntries', [expect.objectContaining({ id: ids.entryB, href: `/collections/studio-collection-${ids.shared}` })]);
    await prisma.category.delete({ where: { id: ids.shared } });
    const deleted = await service.storefrontGet();
    expect(deleted.sections.find((section) => section.id === ids.section)).toHaveProperty('navigationEntries', [expect.objectContaining({ id: ids.entryB })]);
  });
});
