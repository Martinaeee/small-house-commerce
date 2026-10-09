import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../../common/revalidation.js';
import { faqItemsSchema, type FaqItem } from './faq-content.js';

/**
 * The one site-wide FAQ library every product may borrow from.
 *
 * The row is a singleton with a fixed id. `get()` creates it on first read so
 * callers never have to distinguish "not seeded yet" from "empty", and
 * `update()` guards on `version` so two administrators editing the library at
 * once cannot silently overwrite each other.
 */
export const SHARED_FAQ_SET_ID = '00000000-0000-0000-0000-0000000000fa';

export interface SharedFaqSetView {
  id: string;
  items: FaqItem[];
  version: number;
}

@Injectable()
export class SharedFaqService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SharedFaqSetView> {
    const existing = await this.prisma.sharedFaqSet.findUnique({
      where: { id: SHARED_FAQ_SET_ID },
    });
    if (existing) {
      return {
        id: existing.id,
        items: (existing.items ?? []) as FaqItem[],
        version: existing.version,
      };
    }

    const created = await this.prisma.sharedFaqSet.upsert({
      where: { id: SHARED_FAQ_SET_ID },
      create: { id: SHARED_FAQ_SET_ID, items: [], version: 0 },
      update: {},
    });
    return {
      id: created.id,
      items: (created.items ?? []) as FaqItem[],
      version: created.version,
    };
  }

  async update(
    rawItems: unknown,
    expectedVersion: number,
    userId: string | null,
  ): Promise<{ version: number }> {
    const parsed = faqItemsSchema.safeParse(rawItems);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'FAQ_INVALID',
        message: 'The FAQ items do not match the shared FAQ schema.',
        issues: parsed.error.issues,
      });
    }

    // Make sure the singleton exists before the guarded write.
    await this.get();

    const current = await this.prisma.sharedFaqSet.findUniqueOrThrow({
      where: { id: SHARED_FAQ_SET_ID },
    });
    if (current.version !== expectedVersion) {
      throw new ConflictException({
        code: 'FAQ_VERSION_MISMATCH',
        message: `Version ${expectedVersion} is stale (current version ${current.version}).`,
        currentVersion: current.version,
      });
    }

    const { count } = await this.prisma.sharedFaqSet.updateMany({
      where: { id: SHARED_FAQ_SET_ID, version: expectedVersion },
      data: {
        items: parsed.data as Prisma.InputJsonValue,
        version: expectedVersion + 1,
        updatedByUserId: userId,
      },
    });
    if (count === 0) {
      throw new ConflictException({
        code: 'FAQ_VERSION_MISMATCH',
        message: 'The shared FAQ library was modified concurrently; reload and retry.',
      });
    }

    // Every product using SHARED or EXTEND renders from this library.
    revalidateCache([CACHE_TAGS.STOREFRONT]);

    return { version: expectedVersion + 1 };
  }
}
