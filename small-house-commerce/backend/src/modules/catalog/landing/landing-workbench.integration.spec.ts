import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { LandingPagesService } from './landing-pages.service.js';
import { ProductsService } from '../products.service.js';
import { LandingSnapshotService } from './landing-snapshot.service.js';
import { OptimizersService } from '../../marketing/optimizers.service.js';
import { CampaignLinksService } from '../../marketing/campaign-links.service.js';
import { normaliseLandingContent } from './landing-content.js';
import { backfillLegacyLandingPages } from '../../marketing/legacy-migration.js';
import { adminLandingPageQuerySchema, marketingProductPickerQuerySchema } from './dto/landing-page.dto.js';

const database = process.env.MARKETING_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/small_house_marketing_dev')
    throw new Error('Marketing integration tests require the dedicated local marketing database.');
}

describe.skipIf(!database)('landing workbench PostgreSQL transactions', () => {
  let prisma: PrismaService;
  let service: LandingPagesService;
  let productId: string;
  let categoryId: string;
  const users: string[] = [];
  const customers: string[] = [];
  const orders: string[] = [];
  const tag = randomUUID();
  const account = (id: string) => ({ id, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] });

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({ data: { name: `Marketing test ${i}`, email: `marketing-${tag}-${i}@example.test`, passwordHash: 'integration-only-not-a-login-password' } });
      users.push(user.id);
    }
    const category = await prisma.category.create({ data: { name: 'Marketing integration', slug: `marketing-${tag}` } });
    categoryId = category.id;
    const product = await prisma.product.create({ data: { name: 'Saved parent title', productCode: `MARKETING-${tag}`, slug: `marketing-${tag}`, categoryId, status: 'ACTIVE', solutions: [] } });
    productId = product.id;
    service = new LandingPagesService(prisma, {} as never, new LandingSnapshotService(prisma), new OptimizersService(prisma));
  }, 20000);

  afterAll(async () => {
    if (!prisma) return;
    if (orders.length) await prisma.order.deleteMany({ where: { id: { in: orders } } });
    if (customers.length) await prisma.customer.deleteMany({ where: { id: { in: customers } } });
    if (productId) {
      await prisma.adCostAudit.deleteMany({ where: { cost: { link: { productId } } } });
      await prisma.adCostEntry.deleteMany({ where: { link: { productId } } });
      await prisma.campaignLink.deleteMany({ where: { productId } });
      await prisma.landingPageVisit.deleteMany({ where: { landingPage: { productId } } });
      await prisma.productLandingPage.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it('keeps unlinked landing visits and returns a readable conflict through parent-product deletion', async () => {
    const parent = await prisma.product.create({ data: { name: 'Direct-only history', productCode: `HISTORY-${randomUUID()}`, slug: `history-${randomUUID()}`, categoryId, status: 'ACTIVE', solutions: [] } });
    try {
      const page = await prisma.productLandingPage.create({ data: { productId: parent.id, name: 'Legacy direct page', slug: `direct-${randomUUID()}` } });
      const visit = await prisma.landingPageVisit.create({ data: { landingPageId: page.id, visitKey: randomUUID() } });
      expect(await prisma.campaignLink.count({ where: { productId: parent.id } })).toBe(0);
      await expect(prisma.product.delete({ where: { id: parent.id } })).rejects.toMatchObject({ code: 'P2003' });
      const products = new ProductsService(prisma, {} as never, {} as never);
      await expect(products.remove(parent.id)).rejects.toMatchObject({ status: 409, response: { code: 'PRODUCT_HAS_HISTORY', message: expect.stringContaining('marketing') } });
      expect(await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } })).toEqual(page);
      expect(await prisma.landingPageVisit.findUniqueOrThrow({ where: { id: visit.id } })).toEqual(visit);
      await prisma.product.update({ where: { id: parent.id }, data: { status: 'DISABLED' } });
      expect(await prisma.landingPageVisit.findUniqueOrThrow({ where: { id: visit.id } })).toEqual(visit);
    } finally {
      await prisma.landingPageVisit.deleteMany({ where: { landingPage: { productId: parent.id } } });
      await prisma.productLandingPage.deleteMany({ where: { productId: parent.id } });
      await prisma.product.deleteMany({ where: { id: parent.id } });
    }
  });

  it('creates owner-bound private drafts and preserves the published snapshot while saving', async () => {
    const own = account(users[0]!);
    const page = await service.createDraft(productId, { name: 'My page' }, own);
    expect(page).toMatchObject({ ownerUserId: users[0], status: 'DRAFT', publishedContent: null, publishedRevision: 0 });
    await expect(service.getDraft(page.id, account(users[1]!))).rejects.toMatchObject({ status: 404 });
    const published = await service.publish(page.id, page.version, own);
    const content = normaliseLandingContent(published.draftContent);
    const hero = content.blocks.find((block) => block.type === 'hero')!;
    if (hero.type !== 'hero') throw new Error('Fixture missing hero');
    hero.props.title = 'My independent title';
    await service.saveDraft(page.id, content, published.version, own);
    const after = await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(after.publishedContent).toEqual(published.publishedContent);
    expect(after.publishedRevision).toBe(1);
    expect(normaliseLandingContent(after.draftContent).blocks[0]).toMatchObject({ props: { title: 'My independent title' } });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe('Saved parent title');
  });

  it('allows only one competing writer to use the same expected version', async () => {
    const own = account(users[0]!);
    const page = await service.createDraft(productId, { name: 'Concurrent page' }, own);
    const a = normaliseLandingContent(page.draftContent);
    const b = normaliseLandingContent(page.draftContent);
    a.seoTitle = 'Writer A'; b.seoTitle = 'Writer B';
    const results = await Promise.allSettled([service.saveDraft(page.id, a, page.version, own), service.saveDraft(page.id, b, page.version, own)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter((result) => result.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toMatchObject({ status: 409, response: { code: 'LANDING_VERSION_CONFLICT' } });
    expect((await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } })).version).toBe(1);
  });

  it('filters real rows by Product Code, owner and AID without leaking another optimizer', async () => {
    const page = await service.createDraft(productId, { name: 'Other optimizer' }, account(users[1]!));
    const viewer = { id: users[0]!, permissions: ['MARKETING_VIEW_ALL'] };
    const query = adminLandingPageQuerySchema.parse({ productId, ownerUserId: users[1], search: `MARKETING-${tag}` });
    const result = await service.adminList(query, viewer);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ id: page.id, ownerUserId: users[1], productCode: `MARKETING-${tag}`, aid: page.aid, hasUnpublishedChanges: true });
    expect(result.items[0]).not.toHaveProperty('draftContent');
    const byAid = await service.adminList(adminLandingPageQuerySchema.parse({ productId, search: page.aid }), viewer);
    expect(byAid.items.map((row) => row.id)).toEqual([page.id]);
    await expect(service.adminList(query, account(users[0]!))).rejects.toMatchObject({ status: 404 });
    const picker = await service.productOptions(marketingProductPickerQuerySchema.parse({ search: `MARKETING-${tag}` }), account(users[0]!));
    expect(picker.items.map((row) => row.id)).toEqual([productId]);
    const ownProfiles = await service.ownerOptions(account(users[0]!));
    expect(ownProfiles.map((row) => row.userId)).toEqual([users[0]]);
  });

  it('persists owner-bound campaign links and enforces real concurrent link CAS', async () => {
    const own = account(users[0]!);
    const links = new CampaignLinksService(prisma, new OptimizersService(prisma));
    const page = await service.createDraft(productId, { name: 'Link target' }, own);
    await service.publish(page.id, page.version, own);
    const link = await links.createLink({ productId, landingPageId: page.id, name: 'Real link', sourceType: 'META_AD' }, own);
    expect(link).toMatchObject({ ownerUserId: users[0], version: 0 });
    expect((await links.resolveTouch(link.code))?.disabled).toBe(false);
    await expect(links.getLink(link.id, account(users[1]!))).rejects.toMatchObject({ status: 404 });
    const results = await Promise.allSettled([links.updateLink(link.id, { name: 'Writer A', expectedVersion: 0 }, own), links.updateLink(link.id, { name: 'Writer B', expectedVersion: 0 }, own)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')[0]).toMatchObject({ reason: { status: 409 } });
    const disabled = await links.disableLink(link.id, 1, own);
    expect(disabled.status).toBe('DISABLED');
    expect((await links.resolveTouch(link.code))?.disabled).toBe(true);
    expect((await prisma.campaignLink.findUniqueOrThrow({ where: { id: link.id } })).landingPageId).toBe(page.id);
  });

  it('previews and freezes only selected empty legacy pages without guessing their owner', async () => {
    const page = await prisma.productLandingPage.create({ data: { productId, name: 'MA-1 optimizer-looking title', adCode: 'MA-1', slug: `legacy-${randomUUID()}`, titleOverride: 'Legacy override', imagesOverride: [{ url: '/uploads/legacy-second.jpg' }, { url: '/uploads/legacy-first.jpg' }] } });
    const before = await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } });
    const preview = await backfillLegacyLandingPages(prisma, { pageIds: [page.id] });
    expect(preview.applied).toBe(false);
    expect(preview.rows).toMatchObject([{ id: page.id, ownerUserId: null, slug: page.slug }]);
    expect(await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } })).toEqual(before);
    await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [page.id] });
    const saved = await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(saved).toMatchObject({ ownerUserId: null, publishedRevision: 1, version: 1, name: before.name, slug: before.slug, adCode: before.adCode, status: before.status });
    expect(saved.draftContent).toEqual(saved.publishedContent);
    const content = normaliseLandingContent(saved.publishedContent);
    expect(content.blocks[0]).toMatchObject({ props: { title: 'Legacy override' } });
    expect(content.blocks[1]).toMatchObject({ props: { media: [{ url: '/uploads/legacy-second.jpg' }, { url: '/uploads/legacy-first.jpg' }] } });
    expect((await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [page.id] })).rows).toEqual([]);
    expect(await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } })).toEqual(saved);
  });

  it('preserves existing drafts, known owners and disabled states and never publishes a new draft', async () => {
    const own = account(users[0]!);
    const draft = await service.createDraft(productId, { name: 'Keep private' }, own);
    const beforeDraft = await prisma.productLandingPage.findUniqueOrThrow({ where: { id: draft.id } });
    const edited = normaliseLandingContent(draft.draftContent); edited.seoTitle = 'Preserve unsaved public draft';
    const disabled = await prisma.productLandingPage.create({ data: { productId, name: 'Legacy disabled', slug: `legacy-disabled-${randomUUID()}`, status: 'DISABLED', ownerUserId: users[0], draftContent: edited } });
    await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [draft.id, disabled.id] });
    const saved = await prisma.productLandingPage.findUniqueOrThrow({ where: { id: disabled.id } });
    expect(saved).toMatchObject({ ownerUserId: users[0], status: 'DISABLED', publishedRevision: 1 });
    expect(saved.draftContent).toEqual(edited);
    expect(normaliseLandingContent(saved.publishedContent).seoTitle).toBe('Saved parent title');
    expect(await prisma.productLandingPage.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(beforeDraft);
    expect((await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [] })).rows).toEqual([]);
  });

  it('rolls back the entire selected backfill when any legacy content is unsafe', async () => {
    const first = await prisma.productLandingPage.create({ data: { productId, name: 'Valid legacy first', slug: `legacy-valid-${randomUUID()}` } });
    const unsafe = await prisma.productLandingPage.create({ data: { productId, name: 'Unsafe legacy', slug: `legacy-unsafe-${randomUUID()}`, imagesOverride: [{ url: 'javascript:alert(1)' }] } });
    await expect(backfillLegacyLandingPages(prisma, { apply: true, pageIds: [first.id, unsafe.id] })).rejects.toThrow();
    for (const id of [first.id, unsafe.id]) expect(await prisma.productLandingPage.findUniqueOrThrow({ where: { id } })).toMatchObject({ publishedContent: null, draftContent: null, publishedRevision: 0, version: 0 });
  });

  it('keeps original visits, link ownership, expenses and order attribution unchanged through backfill and explicit assignment', async () => {
    const page = await prisma.productLandingPage.create({ data: { productId, name: 'Legacy history', slug: `legacy-history-${randomUUID()}` } });
    const visit = await prisma.landingPageVisit.create({ data: { landingPageId: page.id, visitKey: `legacy-${tag}` } });
    const link = await prisma.campaignLink.create({ data: { productId, landingPageId: page.id, ownerUserId: users[1]!, aidSnapshot: 'HISTORICAL-AID', name: 'Historical link', code: randomUUID().replaceAll('-', ''), sourceType: 'META_AD' } });
    const cost = await prisma.adCostEntry.create({ data: { linkId: link.id, ownerUserId: users[1]!, costDate: new Date('2026-10-01'), amountUsd: '50.00', phpPerUsd: '57.3', amountPhp: '2865.00', createdById: users[1]!, updatedById: users[1]! } });
    const customer = await prisma.customer.create({ data: { name: 'Legacy integration customer', normalizedPhone: `legacy-${tag}` } }); customers.push(customer.id);
    const order = await prisma.order.create({ data: { orderNumber: `LEGACY-${randomUUID()}`, customerId: customer.id, subtotal: 100, discountTotal: 0, shippingTotal: 10, grandTotal: 110, optimizerId: users[1], optimizerAidSnapshot: 'HISTORICAL-AID', attribution: { create: { optimizerId: users[1], aidSnapshot: 'HISTORICAL-AID', landingPageId: page.id, productId, linkId: link.id, touchedAt: new Date('2026-10-01'), legacy: false, sourceType: 'META_AD' } } } }); orders.push(order.id);
    const readHistory = async () => ({ visit: await prisma.landingPageVisit.findUniqueOrThrow({ where: { id: visit.id } }), link: await prisma.campaignLink.findUniqueOrThrow({ where: { id: link.id } }), cost: await prisma.adCostEntry.findUniqueOrThrow({ where: { id: cost.id } }), order: await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { attribution: true } }) });
    const history = await readHistory();
    await backfillLegacyLandingPages(prisma, { apply: true, pageIds: [page.id] });
    expect(await readHistory()).toEqual(history);
    const frozen = await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } });
    const assigned = await service.assignOwner(page.id, users[0]!, frozen.version, { id: users[0]!, permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] });
    expect(assigned).toMatchObject({ ownerUserId: users[0], version: frozen.version + 1, publishedContent: frozen.publishedContent, draftContent: frozen.draftContent });
    expect(await readHistory()).toEqual(history);
    await expect(service.getDraft(page.id, account(users[1]!))).rejects.toMatchObject({ status: 404 });
  });

  it('allows only one of two competing admins to claim an unassigned page', async () => {
    const page = await prisma.productLandingPage.create({ data: { productId, name: 'Claim race', slug: `legacy-claim-${randomUUID()}` } });
    const admin = { id: users[0]!, permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] };
    const results = await Promise.allSettled(users.map(id => service.assignOwner(page.id, id, 0, admin)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')[0]).toMatchObject({ reason: { status: 409 } });
    expect((await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } })).version).toBe(1);
  });

  it('counts period page-days and verified valid touch cohorts without reclaiming historical owners', async () => {
    const name = `Period boundaries ${tag}`;
    const page = await prisma.productLandingPage.create({ data: { productId, name, slug: `period-${randomUUID()}`, ownerUserId: users[0], updatedAt: new Date('2026-09-01T00:00:00Z') } });
    const link = await prisma.campaignLink.create({ data: { productId, landingPageId: page.id, ownerUserId: users[0]!, aidSnapshot: 'PERIOD-A', name: 'Period own link', code: randomUUID().replaceAll('-', ''), sourceType: 'META_AD' } });
    const historicalLink = await prisma.campaignLink.create({ data: { productId, landingPageId: page.id, ownerUserId: users[1]!, aidSnapshot: 'PERIOD-B', name: 'Historical other owner', code: randomUUID().replaceAll('-', ''), sourceType: 'META_AD' } });
    for (const [day, key] of [['2026-09-30', 'a'], ['2026-10-01', 'a'], ['2026-10-01', 'b'], ['2026-10-03', 'a'], ['2026-10-04', 'a']]) await prisma.landingPageVisit.create({ data: { landingPageId: page.id, visitKey: `${tag}-${key}`, visitDay: new Date(day!) } });
    const customer = await prisma.customer.create({ data: { name: 'Period fixture customer', normalizedPhone: `period-${tag}` } }); customers.push(customer.id);
    const fixtures: { touchedAt: string | null; legacy: boolean | null; status?: 'CANCELLED' | 'DENIED'; owner?: string; linkId?: string | null }[] = [
      { touchedAt: '2026-09-30T16:00:00Z', legacy: false },
      { touchedAt: '2026-10-03T15:59:59.999Z', legacy: false },
      { touchedAt: '2026-09-30T15:59:59.999Z', legacy: false },
      { touchedAt: '2026-10-03T16:00:00Z', legacy: false },
      { touchedAt: '2026-10-01T01:00:00Z', legacy: false, status: 'CANCELLED' },
      { touchedAt: '2026-10-01T01:00:00Z', legacy: false, status: 'DENIED' },
      { touchedAt: '2026-10-01T01:00:00Z', legacy: true },
      { touchedAt: null, legacy: null },
      { touchedAt: '2026-10-01T01:00:00Z', legacy: false, linkId: null },
      { touchedAt: '2026-10-01T01:00:00Z', legacy: false, owner: users[1], linkId: historicalLink.id },
    ];
    for (const fixture of fixtures) {
      const owner = fixture.owner ?? users[0]!;
      const order = await prisma.order.create({ data: { orderNumber: `PERIOD-${randomUUID()}`, customerId: customer.id, subtotal: 100, discountTotal: 0, shippingTotal: 10, grandTotal: 110, createdAt: new Date('2026-11-01T00:00:00Z'), ...(fixture.status ? { orderStatus: fixture.status } : {}), optimizerId: owner, attribution: { create: { optimizerId: owner, landingPageId: page.id, productId, sourceType: 'META_AD', linkId: fixture.linkId === undefined ? link.id : fixture.linkId, touchedAt: fixture.touchedAt ? new Date(fixture.touchedAt) : null, legacy: fixture.legacy } } } }); orders.push(order.id);
    }
    const read = () => prisma.order.findMany({ where: { attribution: { landingPageId: page.id } }, include: { attribution: true }, orderBy: { id: 'asc' } });
    const before = await read();
    const query = adminLandingPageQuerySchema.parse({ productId, search: name, dateFrom: '2026-09-01', dateTo: '2026-09-02', periodFrom: '2026-10-01', periodTo: '2026-10-03' });
    const own = await service.adminList(query, account(users[0]!));
    expect(own.items).toHaveLength(1);
    expect(own.items[0]).toMatchObject({ id: page.id, views: 5, periodViews: 3, periodOrders: 2 });
    expect(own).toMatchObject({ period: { from: '2026-10-01', to: '2026-10-03' } });
    const finance = { id: users[0]!, permissions: ['MARKETING_VIEW_ALL'] };
    expect((await service.adminList(query, finance)).items[0]).toMatchObject({ periodViews: 3, periodOrders: 3 });
    expect((await service.adminList({ ...query, ownerUserId: users[0] }, finance)).items[0]).toMatchObject({ periodViews: 3, periodOrders: 2 });
    expect((await service.adminList(query, account(users[1]!))).items).toEqual([]);
    expect(await read()).toEqual(before);
  });

  it('rejects publishing a disabled parent without changing the historical revision', async () => {
    const own = account(users[0]!);
    const page = await service.createDraft(productId, { name: 'Disabled parent test' }, own);
    await prisma.product.update({ where: { id: productId }, data: { status: 'DISABLED' } });
    try {
      await expect(service.publish(page.id, page.version, own)).rejects.toMatchObject({ status: 400 });
      expect((await prisma.productLandingPage.findUniqueOrThrow({ where: { id: page.id } })).publishedRevision).toBe(0);
    } finally {
      await prisma.product.update({ where: { id: productId }, data: { status: 'ACTIVE' } });
    }
  });
});
