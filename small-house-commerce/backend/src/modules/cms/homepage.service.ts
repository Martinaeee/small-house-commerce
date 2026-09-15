import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HomepageSectionType, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import { ProductsService } from '../catalog/products.service.js';
import {
  homepagePayloadSchemas,
  type SaveHomepageSectionsInput,
  type SetHomepageProductsInput,
} from './dto/homepage-section.dto.js';

/**
 * App-layer multiplicity rules (spec §3). type stays non-unique at the DB
 * level because PRODUCT_GRID/PRODUCT_STORY legitimately repeat.
 */
const SECTION_LIMITS: Record<HomepageSectionType, number> = {
  [HomepageSectionType.HERO]: 1,
  [HomepageSectionType.USP]: 1,
  [HomepageSectionType.CATEGORY_TILES]: 1,
  [HomepageSectionType.PRODUCT_GRID]: 3,
  [HomepageSectionType.SOLUTIONS]: 1,
  [HomepageSectionType.PRODUCT_STORY]: 2,
  [HomepageSectionType.ROOM_INSPIRATION]: 1,
  [HomepageSectionType.UGC]: 1,
  [HomepageSectionType.BRAND_STORY]: 1,
  [HomepageSectionType.CONFIDENCE]: 1,
};

type SectionWithProducts = Prisma.HomepageSectionGetPayload<{
  include: { products: true };
}>;

type HydratedProduct = Awaited<
  ReturnType<ProductsService['storefrontByIds']>
>[number];

@Injectable()
export class HomepageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  // --- storefront ----------------------------------------------------------

  async storefrontGet() {
    const sections = await this.prisma.homepageSection.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { products: { orderBy: { sortOrder: 'asc' } } },
    });

    // One batched product lookup for join products and payload productIds.
    const productIds = new Set<string>();
    for (const section of sections) {
      for (const joinRow of section.products) productIds.add(joinRow.productId);
      const payload = this.payloadObject(section);
      if (
        section.type === HomepageSectionType.PRODUCT_STORY &&
        typeof payload.productId === 'string'
      ) {
        productIds.add(payload.productId);
      }
      if (section.type === HomepageSectionType.UGC && Array.isArray(payload.entries)) {
        for (const entry of payload.entries) {
          if (
            entry &&
            typeof entry === 'object' &&
            'productId' in entry &&
            typeof entry.productId === 'string'
          ) {
            productIds.add(entry.productId);
          }
        }
      }
    }

    const hydrated = await this.products.storefrontByIds([...productIds]);
    const productById = new Map(hydrated.map((product) => [product.id, product]));

    return {
      sections: await Promise.all(
        sections.map((section) => this.presentSection(section, productById)),
      ),
    };
  }

  private async presentSection(
    section: SectionWithProducts,
    productById: Map<string, HydratedProduct>,
  ) {
    const payload = this.payloadObject(section);
    const base = {
      id: section.id,
      type: section.type,
      title: section.title,
      subtitle: section.subtitle,
      sortOrder: section.sortOrder,
    };

    if (section.type === HomepageSectionType.CATEGORY_TILES) {
      const ids = Array.isArray(payload.categoryIds)
        ? payload.categoryIds.filter((x): x is string => typeof x === 'string')
        : [];
      return { ...base, payload, categories: ids.length > 0 ? await this.categoriesByIds(ids) : [] };
    }

    if (section.type === HomepageSectionType.PRODUCT_GRID) {
      // Only ACTIVE products with a priced, in-stock SKU appear. Empty grids
      // still come back so the frontend can render its empty state.
      const products = section.products
        .map((joinRow) => productById.get(joinRow.productId))
        .filter((product): product is HydratedProduct => !!product && this.isSellable(product))
        .map((product) => ({
          ...product,
          badge: section.products.find((j) => j.productId === product.id)?.badge ?? null,
        }));
      return { ...base, payload, products };
    }

    if (section.type === HomepageSectionType.ROOM_INSPIRATION) {
      // Shop-this-room thumbs show every ACTIVE joined product (no stock gate).
      const products = section.products
        .map((joinRow) => productById.get(joinRow.productId))
        .filter((product): product is HydratedProduct => product !== undefined)
        .map((product) => ({
          ...product,
          badge: section.products.find((j) => j.productId === product.id)?.badge ?? null,
        }));
      return { ...base, payload, products };
    }

    if (section.type === HomepageSectionType.PRODUCT_STORY) {
      const nextPayload: Record<string, unknown> = { ...payload };
      if (typeof nextPayload.productId === 'string') {
        const product = productById.get(nextPayload.productId);
        delete nextPayload.productId;
        if (product) nextPayload.product = product;
      }
      return { ...base, payload: nextPayload };
    }

    if (section.type === HomepageSectionType.UGC) {
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      const nextEntries = entries.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const { productId, ...rest } = entry as Record<string, unknown>;
        if (typeof productId !== 'string') return rest;
        const product = productById.get(productId);
        return product ? { ...rest, product } : rest;
      });
      return { ...base, payload: { ...payload, entries: nextEntries } };
    }

    return { ...base, payload };
  }

  /** A homepage grid product is sellable with one priced, in-stock SKU. */
  private isSellable(product: HydratedProduct): boolean {
    // presentStorefront adds availableInventory at runtime through
    // withAvailableInventory; STOREFRONT_SELECT's inferred type does not carry
    // the field, so narrow the enriched SKU shape structurally here.
    return product.variants.some((variant) => {
      const sku = variant.sku as { price: number | null; availableInventory: number } | null;
      return sku !== null && sku.price !== null && sku.availableInventory > 0;
    });
  }

  private async categoriesByIds(ids: string[]) {
    const rows = await this.prisma.category.findMany({
      where: { id: { in: ids }, status: 'ACTIVE', imageUrl: { not: null } },
      select: { id: true, name: true, slug: true, imageUrl: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is (typeof rows)[number] => row !== undefined)
      .map((row) => ({ ...row, imageUrl: row.imageUrl as string }));
  }

  private payloadObject(section: { payload: Prisma.JsonValue | null }): Record<string, unknown> {
    return section.payload && typeof section.payload === 'object' && !Array.isArray(section.payload)
      ? (section.payload as Record<string, unknown>)
      : {};
  }

  // --- admin ---------------------------------------------------------------

  async adminList() {
    return this.prisma.homepageSection.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        products: {
          orderBy: { sortOrder: 'asc' },
          include: {
            product: { select: { id: true, name: true, slug: true, status: true } },
          },
        },
      },
    });
  }

  async saveSections(input: SaveHomepageSectionsInput) {
    const rows = input.sections;
    const existing = await this.prisma.homepageSection.findMany();
    const byId = new Map(existing.map((section) => [section.id, section]));

    for (const row of rows) {
      if (row.id && !byId.has(row.id)) {
        throw new NotFoundException(`Homepage section ${row.id} not found`);
      }
      if (!row.id && !row.type) {
        throw new BadRequestException('type is required when creating a section');
      }
      if (row.id && row.type && byId.get(row.id)?.type !== row.type) {
        throw new BadRequestException('Section type cannot be changed');
      }
    }

    // Multiplicity over the FINAL set: omitted singleton sections survive
    // (they can only be disabled, spec §6); omitted non-singletons are deleted.
    const incomingIds = new Set(rows.filter((row) => row.id).map((row) => row.id as string));
    const survivors = existing.filter(
      (section) => !incomingIds.has(section.id) && SECTION_LIMITS[section.type] === 1,
    );

    const counts = new Map<HomepageSectionType, number>();
    const bump = (type: HomepageSectionType) => counts.set(type, (counts.get(type) ?? 0) + 1);
    survivors.forEach((section) => bump(section.type));
    rows.forEach((row) => bump(row.id ? byId.get(row.id)!.type : row.type!));

    for (const [type, count] of counts) {
      if (count > SECTION_LIMITS[type]) {
        throw new BadRequestException(
          `At most ${SECTION_LIMITS[type]} section(s) of type ${type} allowed`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const deleteIds = existing
        .filter(
          (section) =>
            !incomingIds.has(section.id) && SECTION_LIMITS[section.type] !== 1,
        )
        .map((section) => section.id);
      if (deleteIds.length > 0) {
        await tx.homepageSection.deleteMany({ where: { id: { in: deleteIds } } });
      }

      for (const row of rows) {
        const type = row.id ? byId.get(row.id)!.type : row.type!;

        if (row.id) {
          const data: Prisma.HomepageSectionUpdateInput = {};
          if (row.title !== undefined) data.title = row.title;
          if (row.subtitle !== undefined) data.subtitle = row.subtitle;
          data.enabled = row.enabled;
          data.sortOrder = row.sortOrder;
          if (row.payload !== undefined) {
            // Explicit null is the SQL-null sentinel, not a validated empty
            // JSON object; omitted payloads never reach this branch.
            data.payload =
              row.payload === null ? Prisma.DbNull : this.validatePayload(type, row.payload);
          }
          await tx.homepageSection.update({ where: { id: row.id }, data });
        } else {
          await tx.homepageSection.create({
            data: {
              type,
              title: row.title ?? null,
              subtitle: row.subtitle ?? null,
              enabled: row.enabled,
              sortOrder: row.sortOrder,
              // Both omitted and explicit-null payloads persist SQL NULL;
              // validated objects persist as parsed JSON.
              payload:
                row.payload == null ? Prisma.DbNull : this.validatePayload(type, row.payload),
            },
          });
        }
      }
    });

    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return this.adminList();
  }

  async setSectionProducts(sectionId: string, input: SetHomepageProductsInput) {
    const section = await this.prisma.homepageSection.findUnique({
      where: { id: sectionId },
      select: { id: true },
    });
    if (!section) throw new NotFoundException('Homepage section not found');

    const rows = input.rows;
    const productIds = [...new Set(rows.map((row) => row.productId))];
    if (productIds.length !== rows.length) {
      throw new BadRequestException('A product can only appear once in a section');
    }

    if (productIds.length > 0) {
      const found = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      if (found.length !== productIds.length) {
        throw new BadRequestException('Some selected products do not exist');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.homepageSectionProduct.deleteMany({ where: { sectionId } });
      if (rows.length > 0) {
        await tx.homepageSectionProduct.createMany({
          data: rows.map((row) => ({
            sectionId,
            productId: row.productId,
            sortOrder: row.sortOrder,
            badge: row.badge ?? null,
          })),
        });
      }
    });

    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return { ok: true as const, count: rows.length };
  }

  private validatePayload(
    type: HomepageSectionType,
    payload: unknown,
  ): Prisma.InputJsonValue {
    const parsed = homepagePayloadSchemas[type].safeParse(payload ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        'Validation failed: ' +
          parsed.error.issues
            .map((issue) => `payload.${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; '),
      );
    }
    return parsed.data as Prisma.InputJsonValue;
  }
}
