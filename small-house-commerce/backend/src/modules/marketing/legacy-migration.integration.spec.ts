import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMarketingTestPrisma, marketingTestDatabase } from '../../../test/marketing-test-prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { normaliseLandingContent } from '../catalog/landing/landing-content.js';
import { LandingSnapshotService } from '../catalog/landing/landing-snapshot.service.js';
import { backfillLegacyLandingPages } from './legacy-migration.js';

const database = marketingTestDatabase();

describe.skipIf(!database)('legacy landing backfill PostgreSQL safety', () => {
  let prisma: PrismaService;
  let categoryId: string;
  let productId: string;
  let variantId: string;
  const tag = randomUUID();

  beforeAll(async () => {
    prisma = createMarketingTestPrisma(database!);
    await prisma.$connect();
    categoryId = (await prisma.category.create({ data: { name: 'Legacy rehearsal', slug: `legacy-${tag}` } })).id;
    productId = (await prisma.product.create({ data: {
      categoryId, name: 'Parent chair', slug: `legacy-${tag}`, status: 'ACTIVE', solutions: [],
      description: '<script>unsafe</script>\nParent description', tagline: 'Saved parent tagline',
    } })).id;
    variantId = (await prisma.productVariant.create({ data: { productId, name: 'Blue', combinationKey: 'blue' } })).id;
    await prisma.productImage.createMany({ data: [
      { productId, url: '/uploads/legacy-parent.jpg', sortOrder: 0 },
      { productId, variantId, url: '/uploads/legacy-blue.jpg', sortOrder: 1 },
    ] });
  }, 20000);

  afterEach(async () => {
    vi.restoreAllMocks();
    if (productId) await prisma.productLandingPage.deleteMany({ where: { productId } });
  });

  afterAll(async () => {
    if (!prisma) return;
    if (productId) await prisma.product.delete({ where: { id: productId } });
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  function page(overrides: Partial<Prisma.ProductLandingPageUncheckedCreateInput> = {}) {
    return prisma.productLandingPage.create({ data: {
      productId, name: 'Historical campaign', slug: `legacy-${randomUUID()}`, status: 'ACTIVE',
      titleOverride: '  Legacy public title  ', seoTitle: 'Saved campaign SEO', seoDescription: 'Saved campaign description',
      promoEnabled: true, promoHeadline: 'Saved promotion', promoSubtext: 'Saved promotion detail',
      imagesOverride: [{ url: '/uploads/legacy-second.jpg', altText: 'Second first' }, { url: '/uploads/legacy-first.jpg' }],
      startAt: new Date('2026-10-01T00:00:00Z'), endAt: new Date('2026-12-01T00:00:00Z'),
      ...overrides,
    } });
  }

  function draft(title: string) {
    return normaliseLandingContent({ schemaVersion: 1, blocks: [
      { id: 'hero', type: 'hero', sourceKey: null, props: { title } },
      { id: 'buy', type: 'buy', sourceKey: null, props: {} },
    ] });
  }

  it('predicts a canonical publication without writing during dry-run', async () => {
    const original = await page();
    const result = await backfillLegacyLandingPages(prisma, { pageIds: [original.id] });
    expect(result).toMatchObject({ applied: false, rows: [{ id: original.id, ownerUserId: null, preservedDraft: false }] });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.publishedContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await prisma.productLandingPage.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.productLandingPage.count({ where: { productId } })).toBe(1);
  });

  it('publishes the saved overrides once and leaves a second apply unchanged', async () => {
    const original = await page();
    const preview = await backfillLegacyLandingPages(prisma, { pageIds: [original.id] });
    const first = await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [original.id] });
    expect(first).toEqual({ applied: true, rows: preview.rows });
    const saved = await prisma.productLandingPage.findUniqueOrThrow({ where: { id: original.id } });
    expect(saved).toMatchObject({ status: 'ACTIVE', ownerUserId: null, version: 1, publishedRevision: 1 });
    expect(saved.publishedAt).toBeInstanceOf(Date);
    expect(saved.sourceContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.draftContent).toEqual(saved.publishedContent);
    const content = normaliseLandingContent(saved.publishedContent);
    expect(content).toMatchObject({ seoTitle: 'Saved campaign SEO', seoDescription: 'Saved campaign description', startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-12-01T00:00:00.000Z' });
    expect(content.blocks.find(block => block.type === 'hero')).toMatchObject({ props: { title: 'Legacy public title', tagline: 'Saved parent tagline', promoHeadline: 'Saved promotion', promoSubtext: 'Saved promotion detail' } });
    expect(content.blocks.find(block => block.type === 'gallery')).toMatchObject({ props: { media: [
      { url: '/uploads/legacy-second.jpg', type: 'IMAGE', altText: 'Second first', variantId: null, optionValueId: null },
      { url: '/uploads/legacy-first.jpg', type: 'IMAGE', altText: null, variantId: null, optionValueId: null },
      { url: '/uploads/legacy-blue.jpg', type: 'IMAGE', variantId },
    ] } });
    const body = content.blocks.find(block => block.type === 'richText');
    expect(body?.type === 'richText' ? body.props.html : '').toContain('Parent description');
    expect(JSON.stringify(content)).not.toContain('<script>');
    expect(createHash('sha256').update(JSON.stringify(content)).digest('hex')).toBe(preview.rows[0]!.publishedContentHash);
    expect(await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [original.id] })).toEqual({ applied: true, rows: [] });
    expect(await prisma.productLandingPage.findUniqueOrThrow({ where: { id: original.id } })).toEqual(saved);
    expect(await prisma.productLandingPage.count({ where: { productId } })).toBe(1);
  });

  it('preserves an existing draft and keeps a disabled page disabled', async () => {
    const existingDraft = draft('Unpublished editor work');
    const original = await page({ status: 'DISABLED', draftContent: existingDraft as Prisma.InputJsonValue });
    const result = await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [original.id] });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: original.id, preservedDraft: true });
    const saved = await prisma.productLandingPage.findUniqueOrThrow({ where: { id: original.id } });
    expect(saved).toMatchObject({ status: 'DISABLED', version: 1, publishedRevision: 1 });
    expect(saved.draftContent).toEqual(existingDraft);
    expect(saved.publishedContent).not.toEqual(existingDraft);
    expect(await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [original.id] })).toEqual({ applied: true, rows: [] });
  });

  it('rolls back the whole batch instead of overwriting a concurrently saved draft', async () => {
    const originals = (await Promise.all([page(), page()])).sort((a, b) => a.id.localeCompare(b.id));
    const [untouched, changed] = originals;
    const newerDraft = draft('Newer editor document');
    const concurrent = createMarketingTestPrisma(database!);
    await concurrent.$connect();
    const snapshot = LandingSnapshotService.prototype.snapshotFromProduct;
    let reads = 0;
    vi.spyOn(LandingSnapshotService.prototype, 'snapshotFromProduct').mockImplementation(async function (this: LandingSnapshotService, ...args: Parameters<typeof snapshot>) {
      if (++reads === 2) await concurrent.productLandingPage.update({ where: { id: changed!.id }, data: { draftContent: newerDraft as Prisma.InputJsonValue, version: { increment: 1 } } });
      return snapshot.call(this, ...args);
    });
    try {
      const failure: unknown = await backfillLegacyLandingPages(prisma, { apply: true, pageIds: originals.map(row => row.id) }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      const conflict = failure as { code?: string; status?: number };
      expect(conflict.code === 'P2034' || conflict.status === 409).toBe(true);
      expect(await prisma.productLandingPage.findUniqueOrThrow({ where: { id: untouched!.id } })).toEqual(untouched);
      expect(await prisma.productLandingPage.findUniqueOrThrow({ where: { id: changed!.id } })).toMatchObject({ version: 1, publishedRevision: 0, publishedContent: null, draftContent: newerDraft });
      expect(await prisma.productLandingPage.count({ where: { productId } })).toBe(2);
    } finally { await concurrent.$disconnect(); }
  }, 20000);
});
