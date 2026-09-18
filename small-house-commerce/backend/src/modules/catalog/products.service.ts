import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  AdminProductQuery,
  CreateProductInput,
  StorefrontProductQuery,
  UpdateProductInput,
} from './dto/product.dto.js';
import { ReviewsService } from './reviews.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { expandCategoryIds } from './category-tree.js';
import { buildTrgmSearch, tokenizeSearch } from './product-search.js';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';

const ADMIN_PRODUCT_INCLUDE = {
  images: { orderBy: { sortOrder: 'asc' as const } },
  detailBlocks: { orderBy: { sortOrder: 'asc' as const } },
  variants: { include: { sku: true }, orderBy: { position: 'asc' as const } },
} satisfies Prisma.ProductInclude;

/**
 * Storefront select is a whitelist on purpose: cost and supplier fields live
 * on Sku and must never reach the storefront, so no `include` is used here.
 */
const STOREFRONT_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  categoryId: true,
  room: true,
  internalRole: true,
  solutions: true,
  width: true,
  height: true,
  depth: true,
  foldedWidth: true,
  foldedHeight: true,
  foldedDepth: true,
  images: {
    select: { id: true, url: true, altText: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  variants: {
    select: {
      id: true,
      name: true,
      position: true,
      sku: {
        select: {
          id: true,
          skuCode: true,
          price: true,
          compareAtPrice: true,
          productWeight: true,
          packageWidth: true,
          packageHeight: true,
          packageDepth: true,
          packageWeight: true,
        },
      },
    },
    orderBy: { position: 'asc' as const },
  },
} satisfies Prisma.ProductSelect;

/**
 * PDP-only extra: the description-body blocks. Deliberately NOT part of
 * STOREFRONT_SELECT — list endpoints (PLP, recently viewed, related) would
 * otherwise carry every product's full media deck.
 */
const STOREFRONT_PDP_SELECT = {
  ...STOREFRONT_SELECT,
  detailBlocks: {
    select: { id: true, type: true, url: true, altText: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} satisfies Prisma.ProductSelect;

type StorefrontProductRecord = Prisma.ProductGetPayload<{
  select: typeof STOREFRONT_SELECT;
}>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
    private readonly inventory: InventoryService,
  ) {}

  // --- admin ---------------------------------------------------------------

  /**
   * Adds the live stock figures to admin SKUs so the product form can show and
   * set them — inventory lives in its own table, so without this the form has
   * no way to see it. Prices are deliberately left untouched (unlike
   * withAvailableInventory, which converts them for the storefront): the admin
   * form round-trips prices as decimal strings.
   */
  private async withStock<T extends { variants: { sku: { id: string } | null }[] }>(
    products: T[],
  ): Promise<T[]> {
    const skuIds = [
      ...new Set(
        products.flatMap((p) =>
          p.variants.map((v) => v.sku?.id).filter((id): id is string => !!id),
        ),
      ),
    ];
    const stock = await this.inventory.stockBySku(skuIds);

    return products.map((product) => ({
      ...product,
      variants: product.variants.map((variant) => {
        if (!variant.sku) return variant;
        const row = stock.get(variant.sku.id);
        return {
          ...variant,
          sku: {
            ...variant.sku,
            onHand: row?.onHand ?? 0,
            reserved: row?.reserved ?? 0,
            availableInventory: row?.available ?? 0,
          },
        };
      }),
    }));
  }

  async list(query: AdminProductQuery) {
    const where = this.adminWhere(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: ADMIN_PRODUCT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: await this.withStock(items),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: ADMIN_PRODUCT_INCLUDE,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const [enriched] = await this.withStock([product]);
    return enriched;
  }

  async create(input: CreateProductInput) {
    await this.ensureCategory(input.categoryId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name: input.name,
            slug: input.slug,
            description: input.description ?? null,
            categoryId: input.categoryId,
            status: input.status,
            room: input.room ?? null,
            internalRole: input.internalRole ?? null,
            solutions: input.solutions,
            width: input.width ?? null,
            height: input.height ?? null,
            depth: input.depth ?? null,
            foldedWidth: input.foldedWidth ?? null,
            foldedHeight: input.foldedHeight ?? null,
            foldedDepth: input.foldedDepth ?? null,
            images: { create: input.images },
            detailBlocks: { create: input.detailBlocks },
          },
        });

        // Variants are created one at a time so each gets an id before its
        // SKU row is inserted (Sku.productId is a separate required FK that
        // Prisma cannot fill through the nested create path).
        for (const variant of input.variants) {
          const created = await tx.productVariant.create({
            data: { productId: product.id, name: variant.name, position: variant.position },
          });

          if (variant.sku) {
            await tx.sku.create({
              data: { ...variant.sku, productId: product.id, variantId: created.id },
            });
          }
        }

        return tx.product.findUniqueOrThrow({
          where: { id: product.id },
          include: ADMIN_PRODUCT_INCLUDE,
        });
      });
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
      return created;
    } catch (error) {
      this.rethrowKnown(error);
    }
  }

  async update(id: string, input: UpdateProductInput) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (input.categoryId) {
      await this.ensureCategory(input.categoryId);
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const data: Prisma.ProductUpdateInput = {};

        if (input.name !== undefined) data.name = input.name;
        if (input.slug !== undefined) data.slug = input.slug;
        if (input.description !== undefined) data.description = input.description;
        if (input.categoryId !== undefined) data.category = { connect: { id: input.categoryId } };
        if (input.status !== undefined) data.status = input.status;
        if (input.room !== undefined) data.room = input.room;
        if (input.internalRole !== undefined) data.internalRole = input.internalRole;
        if (input.solutions !== undefined) data.solutions = input.solutions;
        if (input.width !== undefined) data.width = input.width;
        if (input.height !== undefined) data.height = input.height;
        if (input.depth !== undefined) data.depth = input.depth;
        if (input.foldedWidth !== undefined) data.foldedWidth = input.foldedWidth;
        if (input.foldedHeight !== undefined) data.foldedHeight = input.foldedHeight;
        if (input.foldedDepth !== undefined) data.foldedDepth = input.foldedDepth;

        // Images and variants are whole-list replacements on update.
        if (input.images !== undefined) {
          data.images = { deleteMany: {}, create: input.images };
        }
        if (input.detailBlocks !== undefined) {
          data.detailBlocks = { deleteMany: {}, create: input.detailBlocks };
        }

        if (input.variants !== undefined) {
          // Cascade removes the old SKUs with their variants.
          await tx.productVariant.deleteMany({ where: { productId: id } });

          for (const variant of input.variants) {
            const created = await tx.productVariant.create({
              data: { productId: id, name: variant.name, position: variant.position },
            });

            if (variant.sku) {
              await tx.sku.create({
                data: { ...variant.sku, productId: id, variantId: created.id },
              });
            }
          }
        }

        return tx.product.update({
          where: { id },
          data,
          include: ADMIN_PRODUCT_INCLUDE,
        });
      });
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
      return updated;
    } catch (error) {
      this.rethrowKnown(error);
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    // Cascade deletes variants, SKUs and images (schema onDelete: Cascade).
    await this.prisma.product.delete({ where: { id } });
    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return { ok: true };
  }

  // --- storefront ----------------------------------------------------------

  async storefrontList(query: StorefrontProductQuery) {
    // Homepage Recently Viewed: ordered batch lookup, no pagination. The
    // parameter's mere presence triggers the branch — `?ids=` preprocesses to
    // [] and must answer with an empty page, not the full catalog listing.
    if (query.ids !== undefined) {
      const items = await this.storefrontByIds(query.ids);
      return { items, total: items.length, page: 1, pageSize: items.length };
    }

    const where: Prisma.ProductWhereInput = { status: 'ACTIVE' };

    const tokens = query.search ? tokenizeSearch(query.search) : [];
    if (query.search && tokens.length > 0) {
      return this.storefrontFuzzyList(query, tokens);
    }
    // Storefront category pages show the whole subtree: a root page lists
    // products attached to any descendant leaf.
    if (query.categoryId) {
      const activeCategories = await this.prisma.category.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, parentId: true },
      });
      where.categoryId = { in: expandCategoryIds(activeCategories, query.categoryId) };
    }
    if (query.room) where.room = query.room;
    if (query.solution) where.solutions = { has: query.solution };
    // §12 price filter: any sellable SKU in range (COLLECTION_SPEC).
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.variants = {
        some: {
          sku: {
            price: {
              gte: query.minPrice,
              lte: query.maxPrice,
            },
          },
        },
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: STOREFRONT_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: await this.presentStorefront(items),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Storefront-shaped products by id, returned in the requested order.
   * ACTIVE only; every row goes through the same inventory + review
   * enrichment as list/PDP responses. Shared by the CMS homepage grids and
   * the storefront `ids=` query (Recently Viewed), so sellability/rating
   * logic is never duplicated outside this service.
   */
  async storefrontByIds(ids: string[]) {
    if (ids.length === 0) return [];

    const items = await this.prisma.product.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      select: STOREFRONT_SELECT,
    });
    // findMany does not preserve the id order; re-apply it.
    const byId = new Map(items.map((item) => [item.id, item]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((item): item is StorefrontProductRecord => item !== undefined);

    return this.presentStorefront(ordered);
  }

  /**
   * Runs storefront product rows through the shared enrichment:
   * availableInventory on every SKU, plus review summary.
   */
  private async presentStorefront(items: StorefrontProductRecord[]) {
    const enriched = await this.withAvailableInventory(items);
    const summary = await this.reviews.summaryForProducts(enriched.map((p) => p.id));
    return enriched.map((p) => {
      const s = summary.get(p.id) ?? { reviewCount: 0, ratingAverage: null };
      return { ...p, reviewCount: s.reviewCount, ratingAverage: s.ratingAverage };
    });
  }

  /** Non-search SQL filters shared by the fuzzy id/count queries. */
  private storefrontFilterFragments(
    query: StorefrontProductQuery,
    categoryIds: string[],
  ): Prisma.Sql[] {
    const filters: Prisma.Sql[] = [Prisma.sql`products.status = 'ACTIVE'`];

    if (query.categoryId) {
      // UUIDs come from our own category table; bind them as a uuid array.
      filters.push(Prisma.sql`products.category_id = ANY(${categoryIds}::uuid[])`);
    }
    if (query.room) {
      filters.push(Prisma.sql`products.room = ${query.room}::"Room"`);
    }
    if (query.solution) {
      filters.push(Prisma.sql`${query.solution}::"Solution" = ANY(products.solutions)`);
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const price =
        query.minPrice !== undefined && query.maxPrice !== undefined
          ? Prisma.sql`s.price BETWEEN ${query.minPrice} AND ${query.maxPrice}`
          : query.minPrice !== undefined
            ? Prisma.sql`s.price >= ${query.minPrice}`
            : Prisma.sql`s.price <= ${query.maxPrice!}`;
      filters.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM product_variants pv
        JOIN skus s ON s.variant_id = pv.id
        WHERE pv.product_id = products.id AND ${price}
      )`);
    }

    return filters;
  }

  private async storefrontFuzzyList(query: StorefrontProductQuery, tokens: string[]) {
    // Subtree expansion is reused for categoryId (same helper as the Prisma path).
    let categoryIds: string[] = [];
    if (query.categoryId) {
      const activeCategories = await this.prisma.category.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, parentId: true },
      });
      categoryIds = expandCategoryIds(activeCategories, query.categoryId);
    }

    const trgm = buildTrgmSearch(tokens);
    const whereSql = Prisma.sql`${Prisma.join(
      [...this.storefrontFilterFragments(query, categoryIds), trgm.match],
      ' AND ',
    )}`;
    const offset = (query.page - 1) * query.pageSize;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; rank: number }[]>`
        SELECT products.id, ${trgm.rank} AS rank
        FROM products
        WHERE ${whereSql}
        ORDER BY rank DESC, products.created_at DESC, products.id DESC
        LIMIT ${query.pageSize} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*)::bigint AS total
        FROM products
        WHERE ${whereSql}
      `,
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    if (rows.length === 0) {
      return { items: [], total, page: query.page, pageSize: query.pageSize };
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: STOREFRONT_SELECT,
    });
    // findMany does not preserve the raw rank order; re-apply it.
    const byId = new Map(products.map((product) => [product.id, product]));
    const ordered = rows
      .map((row) => byId.get(row.id))
      .filter((product): product is StorefrontProductRecord => product !== undefined);

    return {
      items: await this.presentStorefront(ordered),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async storefrontGetBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: STOREFRONT_PDP_SELECT,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // PDP needs availableInventory to render the stock state and to gate
    // ORDER NOW on the frontend (docs/frontend/PDP_SPEC.md §18).
    const base = (await this.withAvailableInventory([product]))[0];
    const reviewData = await this.reviews.storefrontForProduct(base.id);
    return { ...base, ...reviewData };
  }

  /**
   * Enriches storefront SKUs with availableInventory (on_hand - reserved).
   * available is always computed, never stored (docs/DATABASE.md §29).
   */
  private async withAvailableInventory<
    T extends {
      variants: {
        sku: { id: string; price: unknown; compareAtPrice: unknown } | null;
      }[];
    },
  >(products: T[]): Promise<T[]> {
    const skuIds = [
      ...new Set(
        products.flatMap((p) => p.variants.map((v) => v.sku?.id).filter((id): id is string => !!id)),
      ),
    ];

    const availableBySku = new Map<string, number>();
    if (skuIds.length > 0) {
      const grouped = await this.prisma.inventory.groupBy({
        by: ['skuId'],
        where: { skuId: { in: skuIds } },
        _sum: { onHand: true, reserved: true },
      });
      for (const row of grouped) {
        availableBySku.set(row.skuId, (row._sum.onHand ?? 0) - (row._sum.reserved ?? 0));
      }
    }

    // Returns the same shape, with availableInventory added to each sku and
    // Decimal prices converted to JSON numbers.
    return products.map((product) => ({
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        sku: variant.sku
          ? {
              ...variant.sku,
              price: variant.sku.price === null ? null : Number(variant.sku.price),
              compareAtPrice:
                variant.sku.compareAtPrice === null ? null : Number(variant.sku.compareAtPrice),
              availableInventory: availableBySku.get(variant.sku.id) ?? 0,
            }
          : null,
      })),
    })) as T[];
  }

  // --- helpers -------------------------------------------------------------

  private adminWhere(query: AdminProductQuery): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {};

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status) where.status = query.status;
    if (query.categoryId) where.categoryId = query.categoryId;

    return where;
  }

  private async ensureCategory(categoryId: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestException('Category does not exist');
    }
  }

  private rethrowKnown(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('A record with the same unique value already exists');
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Referenced record does not exist');
      }
    }
    throw error;
  }
}
