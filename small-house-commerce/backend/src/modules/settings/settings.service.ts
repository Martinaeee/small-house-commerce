import { Injectable } from '@nestjs/common';
import {
  CACHE_TAGS,
  revalidateCache,
} from '../../common/revalidation.js';
import { PrismaService } from '../../prisma/prisma.service.js';
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

  /** Public payload: only the three shopper-facing fields. */
  async getPublic() {
    const row = await this.getRow();
    return {
      messengerUrl: row.messengerUrl,
      supportEmail: row.supportEmail,
      supportHours: row.supportHours,
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
