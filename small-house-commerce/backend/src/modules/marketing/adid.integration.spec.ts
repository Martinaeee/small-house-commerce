import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CampaignLinksService } from './campaign-links.service.js';
import { campaignLinkCloneSchema, campaignLinkCreateSchema, campaignLinkQuerySchema, campaignLinkUpdateSchema } from './dto/campaign-link.dto.js';
import { OptimizersService } from './optimizers.service.js';

const database = process.env.ADID_APP_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/adid_app_test') {
    throw new Error('Adid integration tests require the dedicated local adid_app_test database.');
  }
}

describe.skipIf(!database)('advertising numbers with real PostgreSQL transactions', () => {
  let prisma: PrismaService;
  let service: CampaignLinksService;
  let productId: string;
  let categoryId: string;
  let userId: string;
  const aid = `OP-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    prisma = new PrismaService(new ConfigService({ database: { url: database } }));
    await prisma.$connect();
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: {
      name: 'Adid integration operator', email: `adid-${suffix}@example.test`, passwordHash: 'not-a-login-hash',
      optimizerProfile: { create: { aid, displayName: 'Integration operator' } },
    } });
    userId = user.id;
    const category = await prisma.category.create({ data: { name: 'Adid integration', slug: `adid-${suffix}` } });
    categoryId = category.id;
    const product = await prisma.product.create({ data: {
      name: 'Adid integration chair', slug: `adid-${suffix}`, status: 'ACTIVE', categoryId,
    } });
    productId = product.id;
    service = new CampaignLinksService(prisma, new OptimizersService(prisma));
  });

  afterAll(async () => {
    if (!prisma) return;
    if (userId) {
      await prisma.campaignLink.deleteMany({ where: { ownerUserId: userId } });
      await prisma.adidCounter.deleteMany({ where: { ownerUserId: userId } });
      await prisma.optimizerProfile.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    if (productId) await prisma.product.delete({ where: { id: productId } });
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  const admin = () => ({ id: userId, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] });
  const input = (postDate: string) => campaignLinkCreateSchema.parse({ productId, name: 'Concurrent post', sourceType: 'FB_POST', postDate });

  it('allocates 20 simultaneous posts without a duplicate or missing number', async () => {
    const links = await Promise.all(Array.from({ length: 20 }, () => service.createLink(input('2026-11-05'), admin())));
    expect(new Set(links.map(link => link.adid)).size).toBe(20);
    expect(links.map(link => link.adid).sort()).toEqual(Array.from({ length: 20 }, (_, i) => `FB-${aid}-261105-${String(i + 1).padStart(2, '0')}`));
    expect((await prisma.adidCounter.findUnique({ where: { ownerUserId_dayKey_kind: { ownerUserId: userId, dayKey: '261105', kind: 'FB' } } }))?.lastNumber).toBe(20);
  });

  it('rolls the counter back when creating the link fails', async () => {
    const collision = await prisma.campaignLink.create({ data: {
      code: randomUUID(), adid: `FB-${aid}-261106-01`, ownerUserId: userId,
      aidSnapshot: aid, productId, name: 'Collision fixture', sourceType: 'FB_POST',
    } });
    await expect(service.createLink(input('2026-11-06'), admin())).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.adidCounter.findUnique({ where: { ownerUserId_dayKey_kind: { ownerUserId: userId, dayKey: '261106', kind: 'FB' } } })).toBeNull();
    await prisma.campaignLink.delete({ where: { id: collision.id } });
    expect((await service.createLink(input('2026-11-06'), admin())).adid).toBe(`FB-${aid}-261106-01`);
  });

  it('finds the link when searching for its generated advertising number', async () => {
    const link = await service.createLink(input('2026-11-09'), admin());
    const result = await service.listLinks(campaignLinkQuerySchema.parse({ search: link.adid }), admin());
    expect(result.items.map(row => row.id)).toEqual([link.id]);
  });

  it('keeps the original number after editing a post and gives a clone a new identity', async () => {
    const original = await service.createLink(input('2026-11-07'), admin());
    const edited = await service.updateLink(original.id, campaignLinkUpdateSchema.parse({ expectedVersion: original.version, name: 'Renamed', postDate: '2026-11-08' }), admin());
    expect(edited.adid).toBe(`FB-${aid}-261107-01`);
    const clone = await service.cloneLink(original.id, campaignLinkCloneSchema.parse({ postDate: '2026-11-07' }), admin());
    expect(clone.adid).toBe(`FB-${aid}-261107-02`);
  });
});
