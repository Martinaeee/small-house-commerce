import { Injectable } from '@nestjs/common';
import {
  CACHE_TAGS,
  revalidateCache,
} from '../../common/revalidation.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { findAvailableNewsletterPromotion } from '../newsletter/promotion-availability.js';
import type { UpdateSettingsInput } from './dto/settings.dto.js';

/**
 * The single settings row. Mirrors the INSERT baked into the
 * add_site_settings migration; the upsert is only a backstop for restores
 * that skipped the migration.
 */
export const SITE_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full row (admin form echo / internal backstop). */
  async getRow() {
    const existing = await this.prisma.siteSetting.findUnique({
      where: { id: SITE_SETTINGS_ID },
    });
    if (existing) return existing;
    return this.prisma.siteSetting.upsert({
      where: { id: SITE_SETTINGS_ID },
      create: { id: SITE_SETTINGS_ID },
      update: {},
    });
  }

  /** Public payload: contact fields plus server-authoritative newsletter display state. */
  async getPublic() {
    const [row, promotion] = await Promise.all([
      this.getRow(),
      findAvailableNewsletterPromotion(this.prisma),
    ]);
    return {
      messengerUrl: row.messengerUrl,
      supportEmail: row.supportEmail,
      supportPhone: row.supportPhone,
      supportHours: row.supportHours,
      newsletterBandEnabled: row.newsletterBandEnabled,
      newsletterPopupEnabled: row.newsletterPopupEnabled,
      newsletterPopupDelaySeconds: row.newsletterPopupDelaySeconds,
      newsletterOfferTitle: row.newsletterOfferTitle,
      newsletterOfferBody: row.newsletterOfferBody,
      newsletterEyebrow: row.newsletterEyebrow,
      newsletterFormTitle: row.newsletterFormTitle,
      newsletterEmailPlaceholder: row.newsletterEmailPlaceholder,
      newsletterConsentText: row.newsletterConsentText,
      newsletterOfferAvailable: promotion !== null,
    };
  }

  async update(input: UpdateSettingsInput) {
    await this.prisma.siteSetting.upsert({
      where: { id: SITE_SETTINGS_ID },
      create: { id: SITE_SETTINGS_ID, ...input },
      update: input,
    });
    // Best-effort ISR refresh; never blocks/fails the mutation (see helper).
    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return this.getRow();
  }
}
