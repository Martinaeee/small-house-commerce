import { ConfigService } from '@nestjs/config';
import { afterAll, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SITE_SETTINGS_ID, SettingsService } from './settings.service.js';
import { updateSettingsSchema } from './dto/settings.dto.js';

const database = process.env.NEWSLETTER_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/small_house_variant_test'
  ) {
    throw new Error(
      'Settings tests require the dedicated local variant test database.',
    );
  }
}

describe('SettingsService public newsletter copy', () => {
  it('projects the four editable copy fields to the storefront payload', async () => {
    const row = {
      messengerUrl: '',
      supportEmail: 'support@luwag.ph',
      supportHours: 'Mon–Sat, 9am–6pm (PHT)',
      newsletterBandEnabled: true,
      newsletterPopupEnabled: false,
      newsletterPopupDelaySeconds: 5,
      newsletterOfferTitle: '',
      newsletterOfferBody: '',
      newsletterEyebrow: 'The LUWAG edit',
      newsletterFormTitle: 'Subscribe by email',
      newsletterEmailPlaceholder: 'Your email address',
      newsletterConsentText:
        'By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.',
    };
    const prisma = {
      siteSetting: { findUnique: vi.fn().mockResolvedValue(row) },
      newsletterPromotion: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    await expect(new SettingsService(prisma).getPublic()).resolves.toMatchObject({
      newsletterEyebrow: row.newsletterEyebrow,
      newsletterFormTitle: row.newsletterFormTitle,
      newsletterEmailPlaceholder: row.newsletterEmailPlaceholder,
      newsletterConsentText: row.newsletterConsentText,
    });
  });
});

describe.skipIf(!database)('SettingsService newsletter surface', () => {
  let prisma: PrismaService;
  let settings: SettingsService;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: database } }),
    );
    await prisma.$connect();
    settings = new SettingsService(prisma);
    await prisma.siteSetting.upsert({
      where: { id: SITE_SETTINGS_ID },
      create: { id: SITE_SETTINGS_ID },
      update: {},
    });
  });

  beforeEach(async () => {
    // Promotions are owned by the newsletter spec; this spec only touches the
    // settings singleton, so the two files never fight over the single-ACTIVE
    // promotion index.
    await prisma.siteSetting.update({
      where: { id: SITE_SETTINGS_ID },
      data: {
        newsletterOfferTitle: '',
        newsletterOfferBody: '',
        newsletterEyebrow: 'The LUWAG edit',
        newsletterFormTitle: 'Subscribe by email',
        newsletterEmailPlaceholder: 'Your email address',
        newsletterConsentText:
          'By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.',
        newsletterPopupEnabled: false,
        newsletterPopupDelaySeconds: 5,
        newsletterBandEnabled: true,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.siteSetting.update({
      where: { id: SITE_SETTINGS_ID },
      data: {
        newsletterOfferTitle: '',
        newsletterOfferBody: '',
        newsletterEyebrow: 'The LUWAG edit',
        newsletterFormTitle: 'Subscribe by email',
        newsletterEmailPlaceholder: 'Your email address',
        newsletterConsentText:
          'By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.',
        newsletterPopupEnabled: false,
        newsletterPopupDelaySeconds: 5,
        newsletterBandEnabled: true,
      },
    });
    await prisma.$disconnect();
  });

  it('exposes the display fields on the public payload', async () => {
    await expect(settings.getPublic()).resolves.toMatchObject({
      newsletterBandEnabled: true,
      newsletterPopupEnabled: false,
      newsletterPopupDelaySeconds: 5,
      newsletterOfferTitle: '',
      newsletterOfferBody: '',
      newsletterEyebrow: 'The LUWAG edit',
      newsletterFormTitle: 'Subscribe by email',
      newsletterEmailPlaceholder: 'Your email address',
      newsletterConsentText:
        'By subscribing, you agree to receive LUWAG offers and updates. Unsubscribe anytime.',
    });
  });

  it('persists the display fields through update', async () => {
    await settings.update(
      updateSettingsSchema.parse({
        messengerUrl: '',
        supportEmail: 'support@luwag.ph',
        supportHours: 'Mon–Sat, 9am–6pm (PHT)',
        newsletterBandEnabled: false,
        newsletterPopupEnabled: true,
        newsletterPopupDelaySeconds: 8,
        newsletterOfferTitle: 'Subscribe and save',
        newsletterOfferBody: 'Enjoy a welcome discount.',
        newsletterEyebrow: 'Furniture notes',
        newsletterFormTitle: 'Join the list',
        newsletterEmailPlaceholder: 'name@example.com',
        newsletterConsentText: 'Occasional emails. Unsubscribe anytime.',
      }),
    );

    await expect(settings.getPublic()).resolves.toMatchObject({
      newsletterBandEnabled: false,
      newsletterPopupEnabled: true,
      newsletterPopupDelaySeconds: 8,
      newsletterOfferTitle: 'Subscribe and save',
      newsletterOfferBody: 'Enjoy a welcome discount.',
      newsletterEyebrow: 'Furniture notes',
      newsletterFormTitle: 'Join the list',
      newsletterEmailPlaceholder: 'name@example.com',
      newsletterConsentText: 'Occasional emails. Unsubscribe anytime.',
    });
  });
});
