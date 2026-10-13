import { ConfigService } from '@nestjs/config';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';
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
      }),
    );

    await expect(settings.getPublic()).resolves.toMatchObject({
      newsletterBandEnabled: false,
      newsletterPopupEnabled: true,
      newsletterPopupDelaySeconds: 8,
      newsletterOfferTitle: 'Subscribe and save',
      newsletterOfferBody: 'Enjoy a welcome discount.',
    });
  });
});
