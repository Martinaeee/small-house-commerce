import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailGateway } from '../email/email.gateway.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { NewsletterService, normalizeEmail } from './newsletter.service.js';
import { PromotionService } from './promotion.service.js';
import { signUnsubscribeToken } from './unsubscribe-token.js';

const database = process.env.NEWSLETTER_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/small_house_variant_test'
  ) {
    throw new Error(
      'Newsletter service tests require the dedicated local variant test database.',
    );
  }
}

const SECRET = 'n'.repeat(32);

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  A@B.COM ')).toBe('a@b.com');
  });
});

describe.skipIf(!database)('NewsletterService PostgreSQL behavior', () => {
  let prisma: PrismaService;
  let service: NewsletterService;
  let promotions: PromotionService;
  let gateway: EmailGateway;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await prisma.$connect();
    promotions = new PromotionService(prisma);
  });

  beforeEach(async () => {
    await prisma.promoCodeRedemption.deleteMany();
    await prisma.newsletterPromotion.deleteMany();
    await prisma.newsletterSubscriber.deleteMany();
    gateway = {
      sendWelcome: vi.fn().mockResolvedValue(undefined),
      sendBackInStock: vi.fn().mockResolvedValue(undefined),
    };
    // Stubbed so this spec never writes the shared site-settings singleton
    // (the settings spec owns that row).
    const settings = {
      getRow: async () => ({
        newsletterOfferTitle: 'Subscribe and save',
        newsletterOfferBody: 'Welcome to LUWAG.',
      }),
    } as unknown as SettingsService;
    service = new NewsletterService(
      prisma,
      settings,
      gateway,
      new ConfigService({
        jwt: { secret: SECRET },
        email: { storefrontBaseUrl: 'https://luwag.test' },
      }),
    );
  });

  afterEach(async () => {
    await prisma.promoCodeRedemption.deleteMany();
    await prisma.newsletterPromotion.deleteMany();
    await prisma.newsletterSubscriber.deleteMany();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (!prisma) return;
    const phoneFilter = { normalizedPhone: { startsWith: '+6391700000' } };
    await prisma.promoCodeRedemption.deleteMany();
    await prisma.newsletterPromotion.deleteMany();
    await prisma.order.deleteMany({ where: { customer: phoneFilter } });
    await prisma.customer.deleteMany({ where: phoneFilter });
    await prisma.$disconnect();
  });

  it('upserts idempotently, normalizes email, and keeps the first source', async () => {
    await service.subscribe({ email: ' Shopper@Example.COM ', source: 'POPUP' });
    await service.subscribe({ email: 'shopper@example.com', source: 'FOOTER' });

    expect(await prisma.newsletterSubscriber.findMany()).toEqual([
      expect.objectContaining({
        email: 'shopper@example.com',
        source: 'POPUP',
        status: 'SUBSCRIBED',
        unsubscribedAt: null,
      }),
    ]);
  });

  it('restores an unsubscribed address without changing its first source', async () => {
    await prisma.newsletterSubscriber.create({
      data: {
        email: 'shopper@example.com',
        source: 'POPUP',
        status: 'UNSUBSCRIBED',
        unsubscribedAt: new Date(),
      },
    });

    await service.subscribe({ email: 'SHOPPER@example.com', source: 'FOOTER' });

    expect(
      await prisma.newsletterSubscriber.findUniqueOrThrow({
        where: { email: 'shopper@example.com' },
      }),
    ).toMatchObject({
      source: 'POPUP',
      status: 'SUBSCRIBED',
      unsubscribedAt: null,
    });
  });

  it('returns the live promotion code and sends it in the welcome email', async () => {
    await prisma.newsletterPromotion.create({
      data: {
        code: 'WELCOME10',
        discountType: 'PERCENT',
        discountValue: 10,
        validFrom: new Date(Date.now() - 60_000),
        validUntil: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      service.subscribe({ email: 'shopper@example.com', source: 'FOOTER' }),
    ).resolves.toMatchObject({
      ok: true,
      promoCode: 'WELCOME10',
      offerTitle: 'Subscribe and save',
      offerBody: 'Welcome to LUWAG.',
    });
    expect(gateway.sendWelcome).toHaveBeenCalledWith(
      'shopper@example.com',
      expect.objectContaining({
        promoCode: 'WELCOME10',
        unsubscribeUrl: expect.stringContaining(
          '/api/v1/storefront/newsletter/unsubscribe?token=',
        ),
      }),
    );
  });

  it('reports the offer available only while a promotion is live', async () => {
    const realSettings = new SettingsService(prisma);
    await expect(realSettings.getPublic()).resolves.toMatchObject({
      newsletterOfferAvailable: false,
    });

    const now = Date.now();
    const promotion = await prisma.newsletterPromotion.create({
      data: {
        code: 'LIVE10',
        discountType: 'PERCENT',
        discountValue: 10,
        validFrom: new Date(now - 60_000),
        validUntil: new Date(now + 60_000),
      },
    });
    await expect(realSettings.getPublic()).resolves.toMatchObject({
      newsletterOfferAvailable: true,
    });

    await prisma.newsletterPromotion.update({
      where: { id: promotion.id },
      data: { validFrom: new Date(now + 60_000) },
    });
    await expect(realSettings.getPublic()).resolves.toMatchObject({
      newsletterOfferAvailable: false,
    });
  });

  it('does not advertise or return a code after the total-use limit is exhausted', async () => {
    const promotion = await promotions.create({
      ...newRound('LIMITED10', 10),
      maxUses: 1,
    });
    await redeem(promotion.id, '+639170000014', 10);

    const realSettings = new SettingsService(prisma);
    await expect(realSettings.getPublic()).resolves.toMatchObject({
      newsletterOfferAvailable: false,
    });
    await expect(
      service.subscribe({ email: 'shopper@example.com', source: 'FOOTER' }),
    ).resolves.toMatchObject({ promoCode: null });
    expect(gateway.sendWelcome).toHaveBeenCalledWith(
      'shopper@example.com',
      expect.objectContaining({ promoCode: null }),
    );
  });

  it('does not expose a future or expired promotion code', async () => {
    await prisma.newsletterPromotion.create({
      data: {
        code: 'FUTURE',
        discountType: 'FIXED',
        discountValue: 100,
        validFrom: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      service.subscribe({ email: 'shopper@example.com', source: 'FOOTER' }),
    ).resolves.toMatchObject({ promoCode: null });
  });

  it('keeps the subscription when welcome delivery fails', async () => {
    vi.mocked(gateway.sendWelcome).mockRejectedValueOnce(
      new Error('provider unavailable'),
    );

    await expect(
      service.subscribe({ email: 'shopper@example.com', source: 'FOOTER' }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      await prisma.newsletterSubscriber.count({
        where: { email: 'shopper@example.com' },
      }),
    ).toBe(1);
  });

  it('unsubscribes a signed address and rejects tampered tokens', async () => {
    await service.subscribe({ email: 'shopper@example.com', source: 'FOOTER' });
    const token = signUnsubscribeToken('shopper@example.com', SECRET);

    await expect(service.unsubscribeByToken(`${token}x`)).resolves.toBe(false);
    await expect(service.unsubscribeByToken(token)).resolves.toBe(true);
    expect(
      await prisma.newsletterSubscriber.findUniqueOrThrow({
        where: { email: 'shopper@example.com' },
      }),
    ).toMatchObject({ status: 'UNSUBSCRIBED' });
  });

  it('lists subscribers with pagination and filters', async () => {
    await prisma.newsletterSubscriber.createMany({
      data: [
        { email: 'a@example.com', source: 'POPUP' },
        {
          email: 'b@example.com',
          source: 'FOOTER',
          status: 'UNSUBSCRIBED',
          unsubscribedAt: new Date(),
        },
      ],
    });

    await expect(
      service.listSubscribers({
        page: 1,
        pageSize: 20,
        status: 'UNSUBSCRIBED',
        source: 'FOOTER',
      }),
    ).resolves.toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [expect.objectContaining({ email: 'b@example.com' })],
    });
  });

  it('changes subscriber status and keeps the unsubscribe timestamp consistent', async () => {
    const row = await prisma.newsletterSubscriber.create({
      data: { email: 'a@example.com', source: 'POPUP' },
    });

    await expect(
      service.setSubscriberStatus(row.id, 'UNSUBSCRIBED'),
    ).resolves.toMatchObject({
      status: 'UNSUBSCRIBED',
      unsubscribedAt: expect.any(Date),
    });
    await expect(
      service.setSubscriberStatus(row.id, 'SUBSCRIBED'),
    ).resolves.toMatchObject({ status: 'SUBSCRIBED', unsubscribedAt: null });
  });

  it('exports spreadsheet-safe CSV', async () => {
    await prisma.newsletterSubscriber.create({
      data: { email: '=cmd@example.com', source: 'FOOTER' },
    });

    const csv = await service.exportSubscribersCsv();
    expect(csv).toContain('email,status,source,createdAt,unsubscribedAt');
    expect(csv).toContain("'=cmd@example.com");
    expect(csv).not.toContain('\r\n=cmd@example.com');
  });

  // --- Promotion identity (spec §3.2: stable id, counts never reset) -------

  async function redeem(
    promotionId: string,
    normalizedPhone: string,
    discountAmount: number,
  ): Promise<void> {
    const customer = await prisma.customer.create({
      data: { normalizedPhone, name: 'Promo test' },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `PH${Date.now()}${Math.floor(Math.random() * 1000)}`,
        customerId: customer.id,
        subtotal: 100,
        discountTotal: discountAmount,
        shippingTotal: 0,
        grandTotal: 100 - discountAmount,
        promoCode: 'WELCOME10',
      },
    });
    await prisma.promoCodeRedemption.create({
      data: {
        promotionId,
        orderId: order.id,
        codeSnapshot: 'WELCOME10',
        normalizedPhone,
        discountAmount,
      },
    });
  }

  const newRound = (code: string, discountValue: number) => ({
    code,
    discountType: 'PERCENT' as const,
    discountValue,
    minSpend: 0,
    maxUses: null,
    perCustomerLimit: null,
    validFrom: null,
    validUntil: null,
  });

  it('archives the previous ACTIVE promotion when a new round starts', async () => {
    const first = await promotions.create(newRound('WELCOME10', 10));
    const second = await promotions.create(newRound('WELCOME20', 20));

    expect(second.id).not.toBe(first.id);
    expect(
      await prisma.newsletterPromotion.findUniqueOrThrow({
        where: { id: first.id },
      }),
    ).toMatchObject({ status: 'ARCHIVED', archivedAt: expect.any(Date) });
    expect(
      await prisma.newsletterPromotion.findUniqueOrThrow({
        where: { id: second.id },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
  });

  it('keeps the promotion id and its redemption counts when the code changes', async () => {
    const created = await promotions.create(newRound('WELCOME10', 10));
    await redeem(created.id, '+639170000011', 10);

    const updated = await promotions.update(created.id, {
      code: 'WELCOME15',
      discountValue: 15,
    });

    expect(updated).toMatchObject({ id: created.id, code: 'WELCOME15' });
    // Changing the code string cannot reset the usage limit: the redemption
    // still counts against the same promotion id.
    await expect(promotions.usage(created.id)).resolves.toMatchObject({
      effective: 1,
      released: 0,
    });
  });

  it('rejects a partial update that makes a percentage exceed 100', async () => {
    const created = await promotions.create(newRound('WELCOME10', 10));

    await expect(
      promotions.update(created.id, { discountValue: 120 }),
    ).rejects.toThrow('percentage discount cannot exceed 100');
    const unchanged = await prisma.newsletterPromotion.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(Number(unchanged.discountValue)).toBe(10);
  });

  it('rejects a partial update that reverses the stored validity window', async () => {
    const created = await promotions.create({
      ...newRound('WINDOW10', 10),
      validFrom: '2026-10-20T00:00:00.000Z',
      validUntil: '2026-10-30T00:00:00.000Z',
    });

    await expect(
      promotions.update(created.id, {
        validUntil: '2026-10-10T00:00:00.000Z',
      }),
    ).rejects.toThrow('validUntil must be after validFrom');
  });

  it('keeps archived promotion history read-only', async () => {
    const archived = await promotions.create(newRound('OLD10', 10));
    await promotions.create(newRound('NEW20', 20));

    await expect(
      promotions.update(archived.id, { code: 'CHANGED' }),
    ).rejects.toThrow('Archived promotions cannot be edited');
    await expect(
      prisma.newsletterPromotion.findUniqueOrThrow({ where: { id: archived.id } }),
    ).resolves.toMatchObject({ code: 'OLD10', status: 'ARCHIVED' });
  });

  it('lists the active promotion ahead of archived history', async () => {
    await promotions.create(newRound('OLD10', 10));
    await promotions.create(newRound('NEW20', 20));

    const list = await promotions.list();
    expect(list.map((row) => row.code)).toEqual(['NEW20', 'OLD10']);
    expect(list[0]).toMatchObject({ status: 'ACTIVE' });
    expect(list[1]).toMatchObject({ status: 'ARCHIVED' });
  });

  it('reports exhausted availability against the promotion limits', async () => {
    const created = await promotions.create({
      ...newRound('LIMITED', 10),
      discountType: 'FIXED',
      discountValue: 50,
      maxUses: 1,
      perCustomerLimit: 1,
    });
    await redeem(created.id, '+639170000012', 50);

    await expect(promotions.usage(created.id)).resolves.toMatchObject({
      promotionId: created.id,
      effective: 1,
      released: 0,
      maxUses: 1,
      perCustomerLimit: 1,
      availability: 'EXHAUSTED',
    });
  });

  it('reports scheduled and expired promotion availability', async () => {
    const scheduled = await promotions.create({
      ...newRound('FUTURE10', 10),
      validFrom: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(promotions.usage(scheduled.id)).resolves.toMatchObject({
      availability: 'SCHEDULED',
    });

    const expired = await promotions.create({
      ...newRound('EXPIRED10', 10),
      validUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(promotions.usage(expired.id)).resolves.toMatchObject({
      availability: 'EXPIRED',
    });
  });

  it('previews a valid code without consuming a slot', async () => {
    const promotion = await promotions.create(newRound('WELCOME10', 10));

    await expect(promotions.preview('welcome10', 250)).resolves.toEqual({
      valid: true,
      discountAmount: 25,
      message: '',
    });
    expect(
      await prisma.promoCodeRedemption.count({
        where: { promotionId: promotion.id },
      }),
    ).toBe(0);
  });

  it('previews each rejection reason readably', async () => {
    await expect(promotions.preview('NOPE', 250)).resolves.toMatchObject({
      valid: false,
      discountAmount: 0,
      message: expect.stringMatching(/isn't valid/),
    });

    await promotions.create({ ...newRound('MINSPEND', 10), minSpend: 500 });
    await expect(promotions.preview('MINSPEND', 250)).resolves.toMatchObject({
      valid: false,
      message: expect.stringMatching(/minimum order/),
    });

    await prisma.newsletterPromotion.updateMany({
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await promotions.create({ ...newRound('LIMITED', 10), maxUses: 1 });
    const active = await prisma.newsletterPromotion.findFirstOrThrow({
      where: { status: 'ACTIVE' },
    });
    await redeem(active.id, '+639170000013', 25);

    await expect(promotions.preview('LIMITED', 250)).resolves.toMatchObject({
      valid: false,
      message: expect.stringMatching(/usage limit/),
    });
  });
});
