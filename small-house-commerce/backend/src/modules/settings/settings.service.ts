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

  /** Public payload: shopper-facing contact fields plus newsletter display. */
  async getPublic() {
    const [row, newsletterOfferAvailable] = await Promise.all([
      this.getRow(),
      this.hasLivePromotion(),
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
      // Computed here so the storefront never infers the offer from copy.
      newsletterOfferAvailable,
    };
  }

  /** True while the ACTIVE promotion is live and has total-use capacity. */
  private async hasLivePromotion(): Promise<boolean> {
    return (await findAvailableNewsletterPromotion(this.prisma)) !== null;
  }

  async update(input: UpdateSettingsInput) {
    // Keep this allowlist explicit: supportEmail/supportHours now belong to the
    // Storefront Shell and are mirrored here only by its publish transaction.
    const data: UpdateSettingsInput = {
      messengerUrl: input.messengerUrl,
      ...(input.supportPhone === undefined ? {} : { supportPhone: input.supportPhone }),
      ...(input.newsletterBandEnabled === undefined
        ? {}
        : { newsletterBandEnabled: input.newsletterBandEnabled }),
      ...(input.newsletterPopupEnabled === undefined
        ? {}
        : { newsletterPopupEnabled: input.newsletterPopupEnabled }),
      ...(input.newsletterPopupDelaySeconds === undefined
        ? {}
        : { newsletterPopupDelaySeconds: input.newsletterPopupDelaySeconds }),
      ...(input.newsletterOfferTitle === undefined
        ? {}
        : { newsletterOfferTitle: input.newsletterOfferTitle }),
      ...(input.newsletterOfferBody === undefined
        ? {}
        : { newsletterOfferBody: input.newsletterOfferBody }),
    };
    await this.prisma.siteSetting.upsert({
      where: { id: SITE_SETTINGS_ID },
      create: { id: SITE_SETTINGS_ID, ...data },
      update: data,
    });
    // Best-effort ISR refresh; never blocks/fails the mutation (see helper).
    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return this.getRow();
  }
}
