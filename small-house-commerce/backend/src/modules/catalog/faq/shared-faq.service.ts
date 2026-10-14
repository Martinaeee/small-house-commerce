import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../../common/revalidation.js';
import {
  faqItemsSchema,
  stampItemTimestamps,
  type FaqItem,
} from './faq-content.js';
import type {
  SharedFaqImpactView,
  SharedFaqProductQuery,
} from './dto/shared-faq.dto.js';

/**
 * The one site-wide FAQ library every product may borrow from.
 *
 * The row is a singleton with a fixed id. `get()` creates it on first read so
 * callers never have to distinguish "not seeded yet" from "empty", and
 * `update()` guards on `version` so two administrators editing the library at
 * once cannot silently overwrite each other.
 */
export const SHARED_FAQ_SET_ID = '00000000-0000-0000-0000-0000000000fa';

/**
 * How many of the given inheriting products a library's enabled questions
 * apply to. An all-product question (legacy or `scope:'ALL'`) reaches every
 * inheriting product; with only targeted questions the count is the number of
 * inheriting products inside their combined selections. Disabled questions
 * apply to nothing.
 */
function applyingProductCount(
  items: readonly FaqItem[],
  inheritingIds: Set<string>,
): number {
  const enabled = items.filter((item) => item.enabled);
  if (enabled.some((item) => !item.audience || item.audience.scope === 'ALL')) {
    return inheritingIds.size;
  }
  const targeted = new Set<string>();
  for (const item of enabled) {
    if (item.audience?.scope === 'PRODUCTS') {
      for (const id of item.audience.productIds) targeted.add(id);
    }
  }
  let count = 0;
  for (const id of targeted) if (inheritingIds.has(id)) count += 1;
  return count;
}

export interface SharedFaqSetView {
  id: string;
  items: FaqItem[];
  version: number;
  /** Active products that will render this library (SHARED or EXTEND). */
  usage: { productCount: number };
}

@Injectable()
export class SharedFaqService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly now: () => Date = () => new Date(),
  ) {}

  private parseItems(rawItems: unknown): FaqItem[] {
    const parsed = faqItemsSchema.safeParse(rawItems);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'FAQ_INVALID',
        message: 'The FAQ items do not match the shared FAQ schema.',
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  private assertExpectedVersion(
    currentVersion: number,
    expectedVersion: number,
  ): void {
    if (currentVersion !== expectedVersion) {
      throw new ConflictException({
        code: 'FAQ_VERSION_MISMATCH',
        message: `Version ${expectedVersion} is stale (current version ${currentVersion}).`,
        currentVersion,
      });
    }
  }

  private async validateAudienceProducts(items: readonly FaqItem[]): Promise<void> {
    const selectedIds = [
      ...new Set(
        items.flatMap((item) =>
          item.audience?.scope === 'PRODUCTS'
            ? item.audience.productIds
            : [],
        ),
      ),
    ];
    if (selectedIds.length === 0) return;

    const found = await this.prisma.product.findMany({
      where: { id: { in: selectedIds } },
      select: { id: true },
    });
    const existingIds = new Set(found.map((product) => product.id));
    const missing = selectedIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'FAQ_AUDIENCE_PRODUCT_MISSING',
        message:
          'Some selected products no longer exist. Remove them from the question audience and retry.',
        productIds: missing,
      });
    }
  }

  private async loadInheritingProductIds(): Promise<Set<string>> {
    const [activeIds, customFaqs] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.productFaq.findMany({
        where: { mode: 'CUSTOM', product: { status: 'ACTIVE' } },
        select: { productId: true },
      }),
    ]);
    const inheritingIds = new Set(activeIds.map((product) => product.id));
    for (const custom of customFaqs) inheritingIds.delete(custom.productId);
    return inheritingIds;
  }

  async get(): Promise<SharedFaqSetView> {
    const [existing, inheritingIds] = await Promise.all([
      this.prisma.sharedFaqSet.findUnique({ where: { id: SHARED_FAQ_SET_ID } }),
      this.loadInheritingProductIds(),
    ]);

    const items = (existing?.items ?? []) as FaqItem[];
    const usage = {
      productCount: applyingProductCount(items, inheritingIds),
    };

    if (existing) {
      return {
        id: existing.id,
        items,
        version: existing.version,
        usage,
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
      usage,
    };
  }

  async listProducts(query: SharedFaqProductQuery) {
    const where: Prisma.ProductWhereInput = {
      ...(query.ids ? { id: { in: query.ids } } : {}),
      ...(query.search ? { OR: [
        { name: { contains: query.search, mode: 'insensitive' as const } },
        { slug: { contains: query.search, mode: 'insensitive' as const } },
        { productCode: { contains: query.search, mode: 'insensitive' as const } },
      ] } : {}),
    };
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: {
          id: true, name: true, slug: true, status: true, productCode: true,
          images: {
            where: { type: 'IMAGE', variantId: null, optionValueId: null },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            take: 1, select: { url: true },
          },
          faq: { select: { mode: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: products.map((product) => ({
        id: product.id, name: product.name, slug: product.slug,
        status: product.status, productCode: product.productCode,
        thumbnailUrl: product.images[0]?.url ?? null,
        faqMode: product.faq?.mode ?? 'SHARED',
      })),
      total, page: query.page, pageSize: query.pageSize,
    };
  }

  async previewImpact(
    rawItems: unknown,
    expectedVersion: number,
  ): Promise<SharedFaqImpactView> {
    const items = this.parseItems(rawItems);
    const current = await this.prisma.sharedFaqSet.findUnique({
      where: { id: SHARED_FAQ_SET_ID },
    });
    const currentVersion = current?.version ?? 0;
    this.assertExpectedVersion(currentVersion, expectedVersion);
    await this.validateAudienceProducts(items);
    const inheritingIds = await this.loadInheritingProductIds();

    return {
      productCount: applyingProductCount(items, inheritingIds),
      version: currentVersion,
    };
  }

  async update(
    rawItems: unknown,
    expectedVersion: number,
    userId: string | null,
  ): Promise<{ version: number }> {
    const items = this.parseItems(rawItems);

    // Make sure the singleton exists before the guarded write.
    await this.get();

    const current = await this.prisma.sharedFaqSet.findUniqueOrThrow({
      where: { id: SHARED_FAQ_SET_ID },
    });
    this.assertExpectedVersion(current.version, expectedVersion);
    await this.validateAudienceProducts(items);

    const { count } = await this.prisma.sharedFaqSet.updateMany({
      where: { id: SHARED_FAQ_SET_ID, version: expectedVersion },
      data: {
        items: stampItemTimestamps(
          (current.items ?? []) as FaqItem[],
          items,
          this.now(),
        ) as unknown as Prisma.InputJsonValue,
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
