import { describe, expect, it, vi } from 'vitest';
import { CampaignLinksService } from './campaign-links.service.js';
import { CampaignLinksController } from './admin/campaign-links.controller.js';
import { OptimizersService } from './optimizers.service.js';
import { campaignLinkCloneSchema, campaignLinkCreateSchema, campaignLinkUpdateSchema } from './dto/campaign-link.dto.js';

const U1 = '11111111-1111-4111-a111-111111111111';
const U2 = '22222222-2222-4222-a222-222222222222';
const P1 = '33333333-3333-4333-a333-333333333333';
const V1 = '44444444-4444-4444-a444-444444444444';
const LP = '55555555-5555-4555-a555-555555555555';
const owner = { id: U1, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] };
const admin = { id: U2, permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] };
const base = { productId: P1, name: 'Ad A', sourceType: 'META_AD' as const, campaignId: 'campaign', adsetId: 'set', adId: 'ad', utmSource: 'facebook', utmMedium: 'paid', utmCampaign: 'A' };

function setup() {
  const rows = new Map<string, Record<string, unknown>>();
  const product = { id: P1, slug: 'chair', name: 'Chair', status: 'ACTIVE', productCode: 'LUW-001', images: [{ url: '/uploads/chair.jpg' }] };
  const page = { id: LP, productId: P1, ownerUserId: U1, slug: 'campaign', name: 'Campaign', status: 'ACTIVE', publishedRevision: 1, publishedContent: { blocks: [] }, startAt: null, endAt: null };
  const variant = { id: V1, productId: P1, name: 'Standard', sku: { status: 'ACTIVE', price: '100' } };
  const profile = { userId: U1, aid: 'OP-1', displayName: 'Operator', status: 'ACTIVE' };
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ name: 'Operator', status: 'ACTIVE' })) },
    optimizerProfile: { findUnique: vi.fn(async () => profile) },
    product: { findUnique: vi.fn(async () => product) },
    productVariant: { findUnique: vi.fn(async () => variant) },
    productLandingPage: { findUnique: vi.fn(async () => page) },
    campaignLink: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `link-${rows.size}`, version: 0, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...data, product, landingPage: data.landingPageId ? page : null, owner: { name: 'Operator', optimizerProfile: profile } };
        rows.set(row.id, row); return structuredClone(row);
      }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; code?: string } }) => structuredClone(where.id ? rows.get(where.id) ?? null : [...rows.values()].find((row) => row.code === where.code) ?? null)),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = rows.get(String(where.id));
        if (!row || row.version !== where.version || row.ownerUserId !== where.ownerUserId) return { count: 0 };
        rows.set(String(where.id), { ...row, ...data, version: Number(row.version) + 1 }); return { count: 1 };
      }),
      findMany: vi.fn(async () => []), count: vi.fn(async () => 0),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (work: (client: typeof prisma) => unknown) => work(prisma));
  return { prisma, service: new CampaignLinksService(prisma as never, new OptimizersService(prisma as never)) };
}

describe('persisted owner-scoped campaign links', () => {
  it('uses the authenticated owner and a random code while excluding raw attribution overrides', async () => {
    const { service } = setup();
    const link = await service.createLink({ ...base, aid: 'OTHER', ownerUserId: U2 } as never, owner);
    expect(link).toMatchObject({ ownerUserId: U1, aid: 'OP-1' });
    expect(link.code).toMatch(/^[A-Za-z0-9_-]{16}$/);
    const url = new URL(link.path, 'https://example.test');
    expect(url.pathname).toBe('/products/chair');
    expect(url.searchParams.get('cl')).toBe(link.code);
    expect(url.searchParams.get('aid')).toBeNull();
    expect(campaignLinkCreateSchema.safeParse({ ...base, ownerUserId: U2 }).success).toBe(false);
  });


  it('returns product thumbnails with each link', async () => {
    const { service } = setup();
    const link = await service.createLink({ ...base }, owner);
    expect(link.productThumbnailUrl).toBe('/uploads/chair.jpg');
    expect(link.productName).toBe('Chair');
  });
  it('derives page-link ownership from the authorized page, including an administrator acting for its owner', async () => {
    const { service } = setup();
    const link = await service.createLink({ ...base, landingPageId: LP, variantId: V1 }, admin);
    expect(link.ownerUserId).toBe(U1);
    expect(new URL(link.path, 'https://example.test').pathname).toBe('/lp/campaign');
    expect(new URL(link.path, 'https://example.test').searchParams.get('variant')).toBe(V1);
  });

  it('rejects an unpublished, disabled or unassigned landing target', async () => {
    for (const values of [{ status: 'DRAFT', publishedContent: null }, { status: 'DISABLED' }, { ownerUserId: null }]) {
      const { service, prisma } = setup();
      prisma.productLandingPage.findUnique.mockResolvedValueOnce({ ...await prisma.productLandingPage.findUnique(), ...values } as never);
      await expect(service.createLink({ ...base, landingPageId: LP }, admin)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('validates product, page and variant relationships and current SKU eligibility', async () => {
    for (const variant of [{ productId: U2 }, { sku: { status: 'DISABLED', price: '100' } }, { sku: { status: 'ACTIVE', price: null } }]) {
      const { service, prisma } = setup();
      prisma.productVariant.findUnique.mockResolvedValueOnce({ ...await prisma.productVariant.findUnique(), ...variant } as never);
      await expect(service.createLink({ ...base, variantId: V1 }, owner)).rejects.toMatchObject({ status: 400 });
    }
    const { service, prisma } = setup();
    prisma.productLandingPage.findUnique.mockResolvedValueOnce({ ...await prisma.productLandingPage.findUnique(), productId: U2 });
    await expect(service.createLink({ ...base, landingPageId: LP }, owner)).rejects.toMatchObject({ status: 400 });
  });

  it('hides foreign resources and prevents broad-read-only accounts from creating links', async () => {
    const { service } = setup();
    const link = await service.createLink(base, owner);
    await expect(service.getLink(link.id, { ...owner, id: U2 })).rejects.toMatchObject({ status: 404 });
    await expect(service.createLink(base, { id: U2, permissions: ['MARKETING_VIEW_ALL'] })).rejects.toMatchObject({ status: 403 });
    await expect(service.createLink({ ...base, landingPageId: LP }, { id: U2, permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_OWN'] })).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a forged foreign-page target at the controller entry point without writing a link', async () => {
    const { service, prisma } = setup();
    const controller = new CampaignLinksController(service);
    const input = campaignLinkCreateSchema.parse({ ...base, landingPageId: LP });

    await expect(controller.create(input, { ...owner, id: U2 })).rejects.toMatchObject({ status: 404 });
    expect(prisma.campaignLink.create).not.toHaveBeenCalled();
  });

  it('keeps target and ad identity immutable during rename or disable and rejects stale writes', async () => {
    const { service } = setup();
    const link = await service.createLink(base, owner);
    const renamed = await service.updateLink(link.id, { name: 'New internal label', expectedVersion: 0 }, owner);
    expect(renamed).toMatchObject({ code: link.code, productId: P1, adId: 'ad', name: 'New internal label', version: 1 });
    await expect(service.updateLink(link.id, { name: 'Stale', expectedVersion: 0 }, owner)).rejects.toMatchObject({ status: 409 });
    const disabled = await service.disableLink(link.id, 1, owner);
    expect(disabled).toMatchObject({ code: link.code, status: 'DISABLED', version: 2 });
    expect(await service.resolveTouch(link.code)).toMatchObject({ disabled: true, id: link.id });
    for (const field of ['ownerUserId', 'productId', 'variantId', 'landingPageId', 'adId', 'sourceType']) expect(campaignLinkUpdateSchema.safeParse({ name: 'New', expectedVersion: 0, [field]: U2 }).success).toBe(false);
  });

  it('copies new ad parameters to a new record while preserving the source and server-owned identity', async () => {
    const { service } = setup();
    const original = await service.createLink(base, owner);
    const copy = await service.cloneLink(original.id, { name: 'New creative', adId: 'ad-B', utmCampaign: null, sourceType: 'FB_POST' }, admin);
    expect(copy).toMatchObject({ ownerUserId: U1, productId: P1, adId: 'ad-B', campaignId: 'campaign', utmCampaign: null, sourceType: 'FB_POST' });
    expect(copy.code).not.toBe(original.code);
    expect(await service.getLink(original.id, owner)).toMatchObject({ adId: 'ad', utmCampaign: 'A', sourceType: 'META_AD' });
  });

  it('validates clone overrides without adding defaults that silently erase copied metadata', () => {
    expect(campaignLinkCloneSchema.parse({ name: 'Copy' })).toEqual({ name: 'Copy' });
    expect(campaignLinkCloneSchema.parse({ adId: ' ad-B ', utmCampaign: null })).toEqual({ adId: 'ad-B', utmCampaign: null });
    for (const field of ['ownerUserId', 'aid', 'targetUrl', 'code']) expect(campaignLinkCloneSchema.safeParse({ [field]: U2 }).success).toBe(false);
  });

  it('clones immutable parameters to a new code without changing the original link', async () => {
    const { service } = setup();
    const original = await service.createLink(base, owner);
    const copy = await service.cloneLink(original.id, { name: 'Ad B copy' }, owner);
    expect(copy).toMatchObject({ ownerUserId: U1, productId: P1, adId: 'ad', sourceType: 'META_AD' });
    expect(copy.code).not.toBe(original.code);
    expect((await service.getLink(original.id, owner)).name).toBe('Ad A');
  });
});
