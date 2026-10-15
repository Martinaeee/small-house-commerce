import { describe, expect, it, vi } from 'vitest';
import { LandingPagesService } from './landing-pages.service.js';
import { LandingSnapshotService } from './landing-snapshot.service.js';
import { OptimizersService } from '../../marketing/optimizers.service.js';
import { adminLandingPageQuerySchema } from './dto/landing-page.dto.js';
import type { LandingContent } from './landing-content.js';

const A: LandingContent = { schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null, blocks: [{ id: 'buy', type: 'buy', sourceKey: null, props: {} }] };
const B: LandingContent = { ...A, blocks: [...A.blocks, { id: 'copy', type: 'richText', sourceKey: null, props: { html: '<p>New copy</p>' } }] };
const owner = { id: 'u1', permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] };
const other = { ...owner, id: 'u2' };
const finance = { id: 'f1', permissions: ['MARKETING_VIEW_ALL'] };

function setup(overrides: Record<string, unknown> = {}) {
  let row = {
    id: 'page-1', productId: 'product-1', ownerUserId: 'u1', name: 'Campaign', slug: 'campaign',
    draftContent: A, publishedContent: A, sourceContentHash: 'source', publishedSourceContentHash: 'source',
    version: 2, publishedRevision: 1, publishedAt: new Date('2026-10-09'), status: 'ACTIVE',
    startAt: null, endAt: null, createdAt: new Date(), updatedAt: new Date(),
    product: { name: 'Chair', productCode: 'LUW-001', slug: 'chair', status: 'ACTIVE' },
    owner: { name: 'Operator', optimizerProfile: { aid: 'OP-1', displayName: 'Campaign operator' } },
    ...overrides,
  };
  const tx = {
    productLandingPage: {
      findUnique: vi.fn(async () => structuredClone(row)),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.version !== row.version || where.ownerUserId !== row.ownerUserId) return { count: 0 };
        const values = Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
          value && typeof value === 'object' && 'increment' in value
            ? Number(row[key as keyof typeof row]) + Number(value.increment)
            : value,
        ]));
        row = { ...row, ...values };
        return { count: 1 };
      }),
    },
    optimizerProfile: { findUnique: vi.fn(async () => ({ userId: 'u1', status: 'ACTIVE', user: { status: 'ACTIVE' } })) },
    product: { findUnique: vi.fn(async () => ({ id: 'product-1', status: 'ACTIVE', name: 'New parent title', tagline: null, description: null, seoTitle: null, metaDescription: null, images: [], detailBlocks: [] })) },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  const snapshots = new LandingSnapshotService(prisma as never);
  const service = new LandingPagesService(prisma as never, { storefrontGetBySlug: vi.fn() } as never, snapshots, new OptimizersService(prisma as never));
  return { service, tx, prisma, read: () => row };
}

describe('owner-scoped landing drafts and publishing', () => {
  it('creates a private draft owned by the authenticated operator, never an immediate live page', async () => {
    const source = {
      id: 'product-1', name: 'Parent', tagline: null, description: null, seoTitle: null, metaDescription: null, images: [], detailBlocks: [],
    };
    const prisma = {
      product: { findUnique: vi.fn(async () => source) },
      user: { findUnique: vi.fn(async () => ({ name: 'Operator', status: 'ACTIVE' })) },
      optimizerProfile: { findUnique: vi.fn(async () => ({ userId: 'u1', aid: 'OP-1', status: 'ACTIVE' })) },
      productLandingPage: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data, publishedContent: null, startAt: null, endAt: null, product: { name: 'Parent', productCode: null, slug: 'parent', status: 'ACTIVE' }, owner: { name: 'Operator', optimizerProfile: { aid: 'OP-1', displayName: 'Operator' } } })) },
    };
    const service = new LandingPagesService(prisma as never, {} as never, new LandingSnapshotService(prisma as never), new OptimizersService(prisma as never));
    const created = await service.createDraft('product-1', { name: 'My campaign', slug: 'my-campaign' }, owner);
    expect(created).toMatchObject({ ownerUserId: 'u1', status: 'DRAFT', slug: 'my-campaign', effectiveStatus: 'DRAFT', draftContent: { blocks: expect.any(Array) } });
    expect(created.publishedContent).toBeNull();
    expect(prisma.productLandingPage.create.mock.calls[0]![0].data).not.toHaveProperty('price');
    await expect(service.createDraft('product-1', { name: 'Spoof', slug: 'spoof', ownerUserId: 'u2' }, owner)).rejects.toMatchObject({ status: 404 });
  });

  it('scopes global list rows and total at the database boundary', async () => {
    const { service, prisma } = setup();
    const findMany = vi.fn(async () => []);
    Object.assign(prisma.productLandingPage, { findMany, count: vi.fn(async () => 0) });
    Object.assign(prisma, { landingPageVisit: { groupBy: vi.fn(async () => []) }, orderAttribution: { groupBy: vi.fn(async () => []) } });
    prisma.$transaction.mockImplementation(async (ops: unknown) => Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => Promise<unknown>)(prisma));
    await service.adminList(adminLandingPageQuerySchema.parse({}), owner);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: 'u1' } }));
    expect((prisma.productLandingPage as unknown as { count: ReturnType<typeof vi.fn> }).count).toHaveBeenCalledWith({ where: { ownerUserId: 'u1' } });
  });

  it('supports draft and explicit owner filters without widening an optimizer scope', async () => {
    const { service, prisma } = setup();
    const findMany = vi.fn(async () => []);
    Object.assign(prisma.productLandingPage, { findMany, count: vi.fn(async () => 0) });
    Object.assign(prisma, { landingPageVisit: { groupBy: vi.fn(async () => []) }, orderAttribution: { groupBy: vi.fn(async () => []) } });
    prisma.$transaction.mockImplementation(async (ops: unknown) => Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => Promise<unknown>)(prisma));
    const target = '11111111-1111-4111-a111-111111111111';
    const parsed = adminLandingPageQuerySchema.parse({ ownerUserId: target, effectiveStatus: 'DRAFT' });
    await service.adminList(parsed, finance);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: target, status: 'DRAFT' } }));
    await expect(service.adminList(parsed, owner)).rejects.toMatchObject({ status: 404 });
  });

  it('provides a slim saved-product picker without requiring product management', async () => {
    const { service, prisma } = setup();
    Object.assign(prisma.product, { findMany: vi.fn(async () => [{ id: 'product-1', name: 'Chair', productCode: 'LUW-001', slug: 'chair', status: 'ACTIVE' }]), count: vi.fn(async () => 1) });
    const result = await service.productOptions({ search: 'LUW-001', page: 1, pageSize: 20 }, owner);
    expect(result).toMatchObject({ total: 1, items: [{ id: 'product-1', name: 'Chair', productCode: 'LUW-001' }] });
    expect((prisma.product as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, name: true, productCode: true, slug: true, status: true } }));
    await expect(service.productOptions({ page: 1, pageSize: 20 }, { id: 'no-access', permissions: [] })).rejects.toMatchObject({ status: 403 });
  });

  it('limits optimizer choices to the own profile unless all-owner reads are granted', async () => {
    const { service, prisma } = setup();
    const findMany = vi.fn(async () => [{ userId: 'u1', aid: 'OP-1', displayName: 'Campaign operator', status: 'ACTIVE', user: { status: 'ACTIVE' } }]);
    Object.assign(prisma, { optimizerProfile: { findMany } });
    expect(await service.ownerOptions(owner)).toEqual([{ userId: 'u1', aid: 'OP-1', displayName: 'Campaign operator', status: 'ACTIVE', userStatus: 'ACTIVE' }]);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
    await service.ownerOptions(finance);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });

  it('projects list labels and draft state without downloading content or account records', async () => {
    const { service, prisma, read } = setup({ draftContent: B, _count: { campaignLinks: 2 } });
    Object.assign(prisma.productLandingPage, { findMany: vi.fn(async () => [read()]), count: vi.fn(async () => 1) });
    Object.assign(prisma, { landingPageVisit: { groupBy: vi.fn(async () => []) }, orderAttribution: { groupBy: vi.fn(async () => []) } });
    prisma.$transaction.mockImplementation(async (ops: unknown) => Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => Promise<unknown>)(prisma));
    const result = await service.adminList(adminLandingPageQuerySchema.parse({}), owner);
    expect(result.items[0]).toMatchObject({ productCode: 'LUW-001', ownerUserId: 'u1', ownerName: 'Campaign operator', aid: 'OP-1', version: 2, publishedRevision: 1, hasUnpublishedChanges: true, linkCount: 2 });
    for (const field of ['product', 'owner', 'draftContent', 'publishedContent', '_count']) expect(result.items[0]).not.toHaveProperty(field);
  });

  it('projects parent and optimizer labels without returning nested account records', async () => {
    const { service } = setup({ draftContent: B });
    const result = await service.getDraft('page-1', owner);
    expect(result).toMatchObject({ productName: 'Chair', productCode: 'LUW-001', productSlug: 'chair', productStatus: 'ACTIVE', ownerName: 'Campaign operator', aid: 'OP-1', hasUnpublishedChanges: true });
    expect(result).not.toHaveProperty('owner');
    expect(result).not.toHaveProperty('product');
  });

  it('clears the unpublished flag after publishing and restores it only when content changes', async () => {
    const { service } = setup({ draftContent: B });
    expect(await service.publish('page-1', 2, owner)).toMatchObject({ hasUnpublishedChanges: false });
    expect(await service.saveDraft('page-1', B, 3, owner, 'New internal name')).toMatchObject({ hasUnpublishedChanges: false });
    expect(await service.saveDraft('page-1', A, 4, owner)).toMatchObject({ hasUnpublishedChanges: true });
  });

  it('does not infer an optimizer for a legacy unassigned page', async () => {
    const { service } = setup({ ownerUserId: null, owner: null });
    const result = await service.getDraft('page-1', finance);
    expect(result).toMatchObject({ ownerUserId: null, ownerName: null, aid: null });
  });

  it('assigns only an unassigned page through all-owner management while preserving both content snapshots', async () => {
    const { service, read } = setup({ ownerUserId: null, owner: null, draftContent: B });
    const before = structuredClone(read());
    const result = await service.assignOwner('page-1', 'u1', 2, { id: 'admin', permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] });
    expect(result).toMatchObject({ ownerUserId: 'u1', version: 3 });
    expect(read()).toMatchObject({ draftContent: before.draftContent, publishedContent: before.publishedContent, publishedRevision: before.publishedRevision, publishedAt: before.publishedAt, sourceContentHash: before.sourceContentHash, slug: before.slug });
  });

  it('does not treat broad read or own management as permission to claim an unassigned page', async () => {
    const { service, read } = setup({ ownerUserId: null, owner: null });
    await expect(service.assignOwner('page-1', 'u1', 2, finance)).rejects.toMatchObject({ status: 403 });
    await expect(service.assignOwner('page-1', 'u1', 2, owner)).rejects.toMatchObject({ status: 404 });
    await expect(service.assignOwner('page-1', 'u1', 2, { ...finance, permissions: [...finance.permissions, 'MARKETING_MANAGE_OWN'] })).rejects.toMatchObject({ status: 404 });
    expect(read()).toMatchObject({ ownerUserId: null, version: 2 });
  });

  it('refuses reassignment of an already owned page and stale or competing assignment versions', async () => {
    const admin = { id: 'admin', permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] };
    await expect(setup().service.assignOwner('page-1', 'u2', 2, admin)).rejects.toMatchObject({ status: 409 });
    const { service, tx, read } = setup({ ownerUserId: null, owner: null });
    await expect(service.assignOwner('page-1', 'u1', 1, admin)).rejects.toMatchObject({ status: 409 });
    tx.productLandingPage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.assignOwner('page-1', 'u1', 2, admin)).rejects.toMatchObject({ status: 409 });
    expect(read()).toMatchObject({ ownerUserId: null, version: 2 });
  });

  it('requires an existing active optimizer profile and active user before assignment', async () => {
    const admin = { id: 'admin', permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] };
    for (const target of [null, { status: 'DISABLED', user: { status: 'ACTIVE' } }, { status: 'ACTIVE', user: { status: 'DISABLED' } }]) {
      const { service, tx, read } = setup({ ownerUserId: null, owner: null });
      Object.assign(tx.optimizerProfile, { findUnique: vi.fn(async () => target) });
      await expect(service.assignOwner('page-1', 'u1', 2, admin)).rejects.toMatchObject({ status: 400 });
      expect(read()).toMatchObject({ ownerUserId: null, version: 2 });
    }
  });

  it('saves only the draft and leaves the live snapshot and revision untouched', async () => {
    const { service, read } = setup();
    await service.saveDraft('page-1', B, 2, owner);
    expect(read()).toMatchObject({ draftContent: B, publishedContent: A, version: 3, publishedRevision: 1, status: 'ACTIVE' });
  });

  it('saves internal names and draft windows without changing the public address or window', async () => {
    const { service, read } = setup();
    const scheduled = { ...B, startAt: '2026-10-15T09:00:00+08:00', endAt: '2026-10-16T09:00:00+08:00' };
    await service.saveDraft('page-1', scheduled, 2, owner, 'Renamed campaign');
    expect(read()).toMatchObject({ name: 'Renamed campaign', slug: 'campaign', startAt: null, endAt: null });
    await service.publish('page-1', 3, owner);
    expect(read()).toMatchObject({ startAt: new Date('2026-10-15T01:00:00Z'), endAt: new Date('2026-10-16T01:00:00Z') });
  });

  it('sanitizes incoming text before persisting a draft', async () => {
    const { service, read } = setup();
    await service.saveDraft('page-1', { ...B, blocks: [...A.blocks, { id: 'copy', type: 'richText', sourceKey: null, props: { html: '<p onclick="bad()">Safe</p><script>bad()</script>' } }] }, 2, owner);
    expect(read().draftContent).toMatchObject({ blocks: [A.blocks[0], { props: { html: '<p>Safe</p>' } }] });
  });

  it('rejects a stale expected version with a named 409 without overwriting', async () => {
    const { service, read } = setup();
    await expect(service.saveDraft('page-1', B, 1, owner)).rejects.toMatchObject({ response: { code: 'LANDING_VERSION_CONFLICT' }, status: 409 });
    expect(read()).toMatchObject({ draftContent: A, version: 2 });
  });

  it('uses compare-and-swap even when a competing write happens after the initial read', async () => {
    const { service, tx, read } = setup();
    tx.productLandingPage.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.saveDraft('page-1', B, 2, owner)).rejects.toMatchObject({ status: 409 });
    expect(read().draftContent).toEqual(A);
    expect(tx.productLandingPage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'page-1', ownerUserId: 'u1', version: 2 } }));
  });

  it('hides other owners from reads and writes and forbids finance writes', async () => {
    const { service, read } = setup();
    await expect(service.getDraft('page-1', other)).rejects.toMatchObject({ status: 404 });
    await expect(service.saveDraft('page-1', B, 2, other)).rejects.toMatchObject({ status: 404 });
    await expect(service.saveDraft('page-1', B, 2, finance)).rejects.toMatchObject({ status: 403 });
    expect(read().version).toBe(2);
  });

  it('public reads return the published document even after another draft save', async () => {
    const { service, prisma } = setup({ draftContent: B });
    prisma.productLandingPage.findUnique.mockResolvedValueOnce({
      ...setup().read(), draftContent: B, product: { ...setup().read().product },
    });
    const result = await service.storefrontGetComposite('campaign');
    expect(result.landingPage).toMatchObject({ content: A, publishedRevision: 1 });
    expect(result.landingPage).not.toHaveProperty('draftContent');
    expect(result.landingPage).not.toHaveProperty('ownerUserId');
  });

  it('private preview reads the saved draft and live product without counting a visit', async () => {
    const { service, prisma } = setup({ draftContent: B });
    prisma.productLandingPage.findUnique.mockResolvedValueOnce({
      ...setup().read(), draftContent: B, product: { ...setup().read().product },
    });
    const visits = { upsert: vi.fn() };
    Object.assign(prisma, { landingPageVisit: visits });
    const result = await service.getPreview('page-1', owner);
    expect(result.content).toEqual(B);
    expect(visits.upsert).not.toHaveBeenCalled();
  });

  it('private preview rejects another owner before fetching a product', async () => {
    const { service } = setup();
    await expect(service.getPreview('page-1', other)).rejects.toMatchObject({ status: 404 });
  });

  it('validates unsaved preview content without persisting or publishing it', async () => {
    const { service, tx, read } = setup();
    const validated = await service.validateDraft('page-1', {
      ...B, blocks: [...A.blocks, { id: 'copy', type: 'richText', sourceKey: null, props: { html: '<p onclick="bad()">Safe</p><script>bad()</script>' } }],
    }, owner);
    expect(validated.blocks[1]).toMatchObject({ props: { html: '<p>Safe</p>' } });
    expect(read()).toMatchObject({ draftContent: A, publishedContent: A, version: 2 });
    expect(tx.productLandingPage.updateMany).not.toHaveBeenCalled();
    await expect(service.validateDraft('page-1', B, other)).rejects.toMatchObject({ status: 404 });
    await expect(service.validateDraft('page-1', B, finance)).rejects.toMatchObject({ status: 403 });
  });

  it('publishes the saved draft atomically with a new immutable revision', async () => {
    const { service, read } = setup({ draftContent: B });
    await service.publish('page-1', 2, owner);
    expect(read()).toMatchObject({ publishedContent: B, version: 3, publishedRevision: 2, status: 'ACTIVE', publishedAt: expect.any(Date) });
  });

  it('does not publish a disabled parent product', async () => {
    const { service, tx, read } = setup({ draftContent: B });
    tx.product.findUnique.mockResolvedValueOnce({ id: 'product-1', status: 'DISABLED', name: 'Parent', tagline: null, description: null, seoTitle: null, metaDescription: null, images: [], detailBlocks: [] });
    await expect(service.publish('page-1', 2, owner)).rejects.toMatchObject({ status: 400 });
    expect(read().publishedContent).toEqual(A);
  });

  it('does not publish an empty or invalid draft', async () => {
    const { service, read } = setup({ draftContent: null });
    await expect(service.publish('page-1', 2, owner)).rejects.toMatchObject({ status: 400 });
    expect(read().publishedRevision).toBe(1);
  });

  it('syncs a selected source into the draft without changing the published page', async () => {
    const { service, read } = setup();
    await service.resync('page-1', ['hero:product-1'], 2, owner, 'buy');
    expect(read().draftContent).toMatchObject({ blocks: [{ type: 'hero', props: { title: 'New parent title' } }, A.blocks[0]] });
    expect(read().publishedContent).toEqual(A);
    expect(read().version).toBe(3);
  });

  it('does not reveal source content through an unowned page', async () => {
    const { service } = setup();
    await expect(service.sourceComparison('page-1', other)).rejects.toMatchObject({ status: 404 });
  });

  it('disables by version without deleting published history', async () => {
    const { service, read } = setup();
    await service.disable('page-1', 2, owner);
    expect(read()).toMatchObject({ status: 'DISABLED', publishedContent: A, version: 3, publishedRevision: 1 });
  });

  it('does not expose an unpublished draft to public visitors even if status is ACTIVE', async () => {
    const { service, tx } = setup({ publishedContent: null });
    tx.productLandingPage.findUnique.mockResolvedValueOnce({ ...setup({ publishedContent: null }).read(), product: { slug: 'parent', status: 'ACTIVE' } } as never);
    await expect(service.storefrontGetComposite('campaign')).rejects.toMatchObject({ status: 404 });
  });
});
