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

describe('SettingsService storefront-shell compatibility mirror', () => {
  it('never writes support email or hours through the general settings mutation', async () => {
    const row = {
      id: SITE_SETTINGS_ID,
      messengerUrl: '',
      supportEmail: 'support@luwag.ph',
      supportPhone: '',
      supportHours: 'Mon–Sat, 9am–6pm (PHT)',
    };
    const prisma = {
      siteSetting: {
        findUnique: vi.fn(async () => row),
        upsert: vi.fn(async () => row),
      },
    } as unknown as PrismaService;
    const settings = new SettingsService(prisma);

    await settings.update({
      messengerUrl: 'https://m.me/luwag',
      supportPhone: '+63 917 123 4567',
      supportEmail: 'attacker@example.com',
      supportHours: 'Never',
    } as Parameters<SettingsService['update']>[0]);

    const write = vi.mocked(prisma.siteSetting.upsert).mock.calls[0][0];
    expect(write.create).not.toHaveProperty('supportEmail');
    expect(write.create).not.toHaveProperty('supportHours');
    expect(write.update).not.toHaveProperty('supportEmail');
    expect(write.update).not.toHaveProperty('supportHours');
    expect(write.update).toMatchObject({
      messengerUrl: 'https://m.me/luwag',
      supportPhone: '+63 917 123 4567',
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
        newsletterPopupEnabled: false,
        newsletterPopupDelaySeconds: 5,
        newsletterBandEnabled: true,
        supportPhone: '',
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
        supportPhone: '',
      },
    });
    await prisma.$disconnect();
  });

  it('exposes the display fields on the public payload', async () => {
    await expect(settings.getPublic()).resolves.toMatchObject({
      supportPhone: '',
      newsletterBandEnabled: true,
      newsletterPopupEnabled: false,
      newsletterPopupDelaySeconds: 5,
      newsletterOfferTitle: '',
      newsletterOfferBody: '',
    });
  });

  it('persists the display fields through update', async () => {
    const updated = await settings.update(
      updateSettingsSchema.parse({
        messengerUrl: '',
        supportEmail: 'support@luwag.ph',
        supportPhone: '  +63 917 123 4567  ',
        supportHours: 'Mon–Sat, 9am–6pm (PHT)',
        newsletterBandEnabled: false,
        newsletterPopupEnabled: true,
        newsletterPopupDelaySeconds: 8,
        newsletterOfferTitle: 'Subscribe and save',
        newsletterOfferBody: 'Enjoy a welcome discount.',
      }),
    );

    expect(updated.supportPhone).toBe('+63 917 123 4567');

    await expect(settings.getPublic()).resolves.toMatchObject({
      supportPhone: '+63 917 123 4567',
      newsletterBandEnabled: false,
      newsletterPopupEnabled: true,
      newsletterPopupDelaySeconds: 8,
      newsletterOfferTitle: 'Subscribe and save',
      newsletterOfferBody: 'Enjoy a welcome discount.',
    });
  });
});
