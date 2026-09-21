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
import { presentCatalogGraph } from './catalog-compat.js';
import { CatalogGraphService } from './catalog-graph.service.js';
import { CatalogGraphVersionRequiredError } from './dto/catalog-graph.dto.js';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import {
  ProductMediaResolver,
  isMediaEligibleVariant,
  type MediaScopeRequest,
  type ProductMediaItem,
} from './product-media.resolver.js';

/**
 * Placeholder a surviving variant is parked under while the submitted names are
 * reassigned, so swapping two names cannot collide on @@unique([productId, name]).
 * Never observable: the whole reconcile runs inside one transaction.
 */
const PENDING_RENAME = '__pending_rename__';

const ADMIN_PRODUCT_INCLUDE = {
  images: {
    where: { optionValueId: null, variantId: null },
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
  },
  detailBlocks: { orderBy: { sortOrder: 'asc' as const } },
  variants: {
    include: { sku: true },
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
  },
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
  tagline: true,
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
  catalogGraphVersion: true,
  defaultDisplayVariantId: true,
  images: {
    where: { optionValueId: null, variantId: null },
    select: {
      id: true,
      url: true,
      type: true,
      altText: true,
      sortOrder: true,
      optionValueId: true,
      variantId: true,
    },
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
  },
  options: {
    where: { isActive: true },
    select: {
      id: true,
      kind: true,
      name: true,
      position: true,
      presentation: true,
      isMediaDriver: true,
      isActive: true,
      values: {
        where: { isActive: true },
        select: {
          id: true,
          label: true,
          position: true,
          swatchHex: true,
          thumbnailUrl: true,
          thumbnailAlt: true,
          isActive: true,
        },
        orderBy: { position: 'asc' as const },
      },
    },
    orderBy: { position: 'asc' as const },
  },
  variants: {
    select: {
      id: true,
      name: true,
      position: true,
      combinationKey: true,
      optionValues: {
        select: { optionId: true, optionValueId: true },
      },
      sku: {
        select: {
          id: true,
          skuCode: true,
          status: true,
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
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.ProductSelect;

/**
 * PDP-only extra: the description-body blocks. Deliberately NOT part of
 * STOREFRONT_SELECT — list endpoints (PLP, recently viewed, related) would
 * otherwise carry every product's full media deck.
 */
const STOREFRONT_PDP_SELECT = {
  ...STOREFRONT_SELECT,
  // Structured specifications are PDP-only (lists never need them).
  materials: true,
  features: true,
  detailBlocks: {
    select: { id: true, type: true, url: true, altText: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} satisfies Prisma.ProductSelect;

type StorefrontProductRecord = Prisma.ProductGetPayload<{
  select: typeof STOREFRONT_SELECT;
}>;

function publicStorefrontMedia(media: ProductMediaItem): ProductMediaItem {
  return {
    id: media.id,
    url: media.url,
    type: media.type,
    altText: media.altText,
    sortOrder: media.sortOrder,
  };
}

function mediaDisplayVariant<
  T extends { id: string; sku: { status: 'ACTIVE' | 'DISABLED' } | null },
>(variants: T[], persistedDefaultId: string | null): T | undefined {
  return (
    variants.find(
      (variant) =>
        variant.id === persistedDefaultId && isMediaEligibleVariant(variant),
    ) ?? variants.find(isMediaEligibleVariant)
  );
}

@Injectable()
export class ProductsService {
  private readonly productMedia: ProductMediaResolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
    private readonly inventory: InventoryService,
    private readonly catalogGraph?: CatalogGraphService,
  ) {
    this.productMedia = new ProductMediaResolver(prisma as never);
  }

  // --- admin ---------------------------------------------------------------

  /**
   * Adds the live stock figures to admin SKUs so the product form can show and
   * set them — inventory lives in its own table, so without this the form has
   * no way to see it. Prices are deliberately left untouched (unlike
   * withAvailableInventory, which converts them for the storefront): the admin
   * form round-trips prices as decimal strings.
   */
  private async withStock<
    T extends { variants: { sku: { id: string } | null }[] },
  >(products: T[]): Promise<T[]> {
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
            tagline: input.tagline ?? null,
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
            materials: input.materials ?? null,
            features: input.features ?? null,
            images: { create: input.images },
            detailBlocks: { create: input.detailBlocks },
          },
        });

        // Variants are created one at a time so each gets an id before its
        // SKU row is inserted (Sku.productId is a separate required FK that
        // Prisma cannot fill through the nested create path).
        for (const variant of input.variants) {
          const created = await tx.productVariant.create({
            data: {
              productId: product.id,
              name: variant.name,
              position: variant.position,
            },
          });

          if (variant.sku) {
            await tx.sku.create({
              data: {
                ...variant.sku,
                productId: product.id,
                variantId: created.id,
              },
            });
          }
        }

        return tx.product.findUniqueOrThrow({
          where: { id: product.id },
          include: ADMIN_PRODUCT_INCLUDE,
        });
      });
      await revalidateCache([CACHE_TAGS.STOREFRONT]);
      const [enriched] = await this.withStock([created]);
      return enriched;
    } catch (error) {
      this.rethrowKnown(error);
    }
  }

  async update(id: string, input: UpdateProductInput) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, catalogGraphVersion: true },
    });

    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    const currentGraphVersion = existing.catalogGraphVersion ?? 0;
    const writesLegacyGraph =
      input.variants !== undefined || input.images !== undefined;
    if (
      input.catalogGraph === undefined &&
      currentGraphVersion > 0 &&
      writesLegacyGraph
    ) {
      throw new CatalogGraphVersionRequiredError();
    }
    if (
      input.catalogGraph !== undefined &&
      input.catalogGraphVersion === undefined
    ) {
      throw new CatalogGraphVersionRequiredError();
    }

    if (input.categoryId) {
      await this.ensureCategory(input.categoryId);
    }

    const data: Prisma.ProductUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.description !== undefined) data.description = input.description;
    if (input.tagline !== undefined) data.tagline = input.tagline;
    if (input.categoryId !== undefined)
      data.category = { connect: { id: input.categoryId } };
    if (input.status !== undefined) data.status = input.status;
    if (input.room !== undefined) data.room = input.room;
    if (input.internalRole !== undefined)
      data.internalRole = input.internalRole;
    if (input.solutions !== undefined) data.solutions = input.solutions;
    if (input.width !== undefined) data.width = input.width;
    if (input.height !== undefined) data.height = input.height;
    if (input.depth !== undefined) data.depth = input.depth;
    if (input.foldedWidth !== undefined) data.foldedWidth = input.foldedWidth;
    if (input.foldedHeight !== undefined)
      data.foldedHeight = input.foldedHeight;
    if (input.foldedDepth !== undefined) data.foldedDepth = input.foldedDepth;
    if (input.materials !== undefined) data.materials = input.materials;
    if (input.features !== undefined) data.features = input.features;
    if (input.detailBlocks !== undefined) {
      data.detailBlocks = { deleteMany: {}, create: input.detailBlocks };
    }

    try {
      if (input.catalogGraph !== undefined) {
        if (!this.catalogGraph) {
          throw new Error('CatalogGraphService is not configured');
        }
        const graphUpdated =
          await this.catalogGraph.applyPatchWithProductMutation(
            id,
            input.catalogGraphVersion!,
            input.catalogGraph,
            async (tx) => {
              await tx.product.update({ where: { id }, data });
            },
          );
        const [enriched] = await this.withStock([graphUpdated]);
        return enriched;
      }

      if (input.images !== undefined) {
        data.images = { deleteMany: {}, create: input.images };
      }
      const updated = await this.prisma.$transaction(async (tx) => {
        if (input.variants !== undefined) {
          await this.reconcileVariants(tx, id, input.variants);
        }
        return tx.product.update({
          where: { id },
          data,
          include: ADMIN_PRODUCT_INCLUDE,
        });
      });

      await revalidateCache([CACHE_TAGS.STOREFRONT]);
      // Same shape as get(): the edit form adopts this response as its new
      // server truth, so a missing onHand would re-render the stock box as
      // "undefined" and block the next save client-side.
      const [enriched] = await this.withStock([updated]);
      return enriched;
    } catch (error) {
      this.rethrowKnown(error);
    }
  }

  /**
   * Applies the submitted variant list by diffing against what is stored.
   *
   * The old implementation deleted every variant and recreated it. SKUs are
   * referenced by order_items / inventory_movements / inventory_reservations
   * with onDelete: Restrict, so that answered 400 for any product with sales
   * history — and where it did succeed it minted new SKU ids, orphaning the
   * inventory rows keyed to the old ones.
   *
   * Matching is by SKU code first, then by variant name, so renaming a variant
   * or editing its SKU code keeps the row (and its inventory) alive.
   */
  private async reconcileVariants(
    tx: Prisma.TransactionClient,
    productId: string,
    incoming: UpdateProductInput['variants'],
  ): Promise<void> {
    const variants = incoming ?? [];

    // Both columns are unique. Left to the database these surfaced as a bare
    // 409, which the edit form renders as "A product with this slug already
    // exists." — pointing the operator at a field they never touched. Catching
    // them here names the actual conflict, and stops a duplicate name from
    // silently resolving both entries to one row (the second write won).
    const seenNames = new Set<string>();
    const seenSkuCodes = new Set<string>();
    for (const variant of variants) {
      if (seenNames.has(variant.name)) {
        throw new BadRequestException(
          `Two variants cannot share the name "${variant.name}". Rename one of them.`,
        );
      }
      seenNames.add(variant.name);

      const skuCode = variant.sku?.skuCode;
      if (!skuCode) continue;
      if (seenSkuCodes.has(skuCode)) {
        throw new BadRequestException(
          `Two variants cannot share the SKU code "${skuCode}".`,
        );
      }
      seenSkuCodes.add(skuCode);
    }

    const existing = await tx.productVariant.findMany({
      where: { productId },
      include: { sku: true },
    });

    const bySkuCode = new Map<string, (typeof existing)[number]>();
    const byName = new Map<string, (typeof existing)[number]>();
    for (const variant of existing) {
      if (variant.sku) bySkuCode.set(variant.sku.skuCode, variant);
      byName.set(variant.name, variant);
    }

    // Resolve every entry before writing anything: a rename must not claim a
    // row that a later entry still needs to match against.
    const plan = variants.map((variant) => {
      const incomingSku = variant.sku;
      const match =
        (incomingSku ? bySkuCode.get(incomingSku.skuCode) : undefined) ??
        byName.get(variant.name);
      if (match) {
        byName.delete(match.name);
        if (incomingSku) bySkuCode.delete(incomingSku.skuCode);
      }
      return { variant, match };
    });

    // Phase 1: park every surviving row under a name no payload can claim, so
    // swapping two names (A→B while B still holds it) cannot collide.
    for (const { match } of plan) {
      if (!match) continue;
      try {
        await tx.productVariant.update({
          where: { id: match.id },
          data: { name: `${PENDING_RENAME}${match.id}` },
        });
      } catch (error) {
        this.rethrowVariantNameTaken(error, match.name);
      }
    }

    const kept = new Set<string>();

    // Phase 2: assign the final names and reconcile each SKU.
    for (const { variant, match } of plan) {
      const incomingSku = variant.sku;

      if (!match) {
        const created = await tx.productVariant.create({
          data: { productId, name: variant.name, position: variant.position },
        });
        if (incomingSku) {
          try {
            await tx.sku.create({
              data: { ...incomingSku, productId, variantId: created.id },
            });
          } catch (error) {
            this.rethrowSkuCodeTaken(error, incomingSku.skuCode);
          }
        }
        continue;
      }

      kept.add(match.id);
      await tx.productVariant.update({
        where: { id: match.id },
        data: { name: variant.name, position: variant.position },
      });

      if (incomingSku && match.sku) {
        const { skuCode, ...rest } = incomingSku;
        try {
          await tx.sku.update({
            where: { id: match.sku.id },
            data: { ...rest, skuCode, productId, variantId: match.id },
          });
        } catch (error) {
          this.rethrowSkuCodeTaken(error, skuCode);
        }
      } else if (incomingSku && !match.sku) {
        try {
          await tx.sku.create({
            data: { ...incomingSku, productId, variantId: match.id },
          });
        } catch (error) {
          this.rethrowSkuCodeTaken(error, incomingSku.skuCode);
        }
      } else if (!incomingSku && match.sku) {
        try {
          await tx.sku.delete({ where: { id: match.sku.id } });
        } catch (error) {
          this.rethrowVariantInUse(error, variant.name);
        }
      }
    }

    for (const variant of existing) {
      if (kept.has(variant.id)) continue;
      try {
        await tx.productVariant.delete({ where: { id: variant.id } });
      } catch (error) {
        this.rethrowVariantInUse(error, variant.name);
      }
    }
  }

  /**
   * A variant's SKU is pinned by order_items / inventory_movements /
   * inventory_reservations (onDelete: Restrict). Say which variant is blocking
   * the save instead of the bare "Referenced record does not exist" the
   * generic P2003 mapping would produce.
   */
  private rethrowVariantInUse(error: unknown, variantName: string): never {
    if (this.isPrismaCode(error, 'P2003')) {
      throw new BadRequestException(
        `Variant "${variantName}" has orders or stock history and cannot be removed. Disable it instead.`,
      );
    }
    throw error;
  }

  /** `skus.sku_code` is unique across the whole catalog, not per product. */
  private rethrowSkuCodeTaken(error: unknown, skuCode: string): never {
    if (this.isPrismaCode(error, 'P2002')) {
      throw new ConflictException(
        `SKU code "${skuCode}" is already used by another product.`,
      );
    }
    throw error;
  }

  /** `product_variants` is unique on (product_id, name). */
  private rethrowVariantNameTaken(error: unknown, variantName: string): never {
    if (this.isPrismaCode(error, 'P2002')) {
      throw new ConflictException(
        `Two variants cannot share the name "${variantName}". Rename one of them.`,
      );
    }
    throw error;
  }

  private isPrismaCode(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
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
      where.categoryId = {
        in: expandCategoryIds(activeCategories, query.categoryId),
      };
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
    const mediaPresentation = await this.storefrontMediaPresentation(enriched);
    const summary = await this.reviews.summaryForProducts(
      enriched.map((p) => p.id),
    );
    return enriched.map((product) => {
      const reviewSummary = summary.get(product.id) ?? {
        reviewCount: 0,
        ratingAverage: null,
      };
      const presentation = mediaPresentation.get(product.id);
      const productWithThumbnails = {
        ...product,
        options: product.options.map((option) => ({
          ...option,
          values: option.values.map((value) => {
            const thumbnail = presentation?.thumbnails.get(value.id);
            return thumbnail
              ? {
                  ...value,
                  thumbnailUrl: thumbnail.url,
                  thumbnailAlt: thumbnail.altText ?? value.label,
                }
              : {
                  ...value,
                  thumbnailAlt: value.thumbnailUrl
                    ? (value.thumbnailAlt ?? value.label)
                    : value.thumbnailAlt,
                };
          }),
        })),
      };
      const graph = presentCatalogGraph(productWithThumbnails);
      return {
        ...product,
        ...graph,
        images: graph.images.map(publicStorefrontMedia),
        effectiveCoverMedia:
          presentation?.effectiveCoverMedia ?? graph.effectiveCoverMedia,
        reviewCount: reviewSummary.reviewCount,
        ratingAverage: reviewSummary.ratingAverage,
      };
    });
  }

  private async storefrontMediaPresentation(items: StorefrontProductRecord[]) {
    const result = new Map<
      string,
      {
        effectiveCoverMedia: ProductMediaItem | null;
        thumbnails: Map<string, ProductMediaItem>;
      }
    >();
    if (items.length === 0) return result;

    const optionValueIds = items.flatMap((product) =>
      product.options.flatMap((option) =>
        option.values.map((value) => value.id),
      ),
    );
    const mediaVariantByProductId = new Map(
      items.map((product) => [
        product.id,
        product.catalogGraphVersion > 0
          ? mediaDisplayVariant(
              product.variants,
              product.defaultDisplayVariantId,
            )
          : undefined,
      ]),
    );
    const defaultVariantIds = [...mediaVariantByProductId.values()]
      .filter((variant) => variant !== undefined)
      .map((variant) => variant.id);

    const scopedMedia =
      optionValueIds.length === 0 && defaultVariantIds.length === 0
        ? []
        : await this.prisma.productImage.findMany({
            where: {
              productId: { in: items.map((product) => product.id) },
              OR: [
                { optionValueId: { in: optionValueIds } },
                { variantId: { in: defaultVariantIds } },
              ],
            },
            select: {
              id: true,
              productId: true,
              url: true,
              type: true,
              altText: true,
              sortOrder: true,
              optionValueId: true,
              variantId: true,
            },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          });

    for (const product of items) {
      const productScopedMedia = scopedMedia.filter(
        (item) => item.productId === product.id,
      );
      const sharedCover = product.images[0] ?? null;
      const sharedThumbnail =
        product.images.find((item) => item.type === 'IMAGE') ?? null;
      const defaultVariant = mediaVariantByProductId.get(product.id);
      const driverOptionIds = new Set(
        product.options
          .filter((option) => option.isActive && option.isMediaDriver)
          .map((option) => option.id),
      );
      const driverValueId = defaultVariant?.optionValues.find((assignment) =>
        driverOptionIds.has(assignment.optionId),
      )?.optionValueId;
      const variantCover = defaultVariant
        ? productScopedMedia.find(
            (item) =>
              item.variantId === defaultVariant.id &&
              item.optionValueId === null,
          )
        : undefined;
      const optionCover = driverValueId
        ? productScopedMedia.find(
            (item) =>
              item.optionValueId === driverValueId && item.variantId === null,
          )
        : undefined;
      const thumbnails = new Map<string, ProductMediaItem>();

      for (const option of product.options) {
        for (const value of option.values) {
          if (value.thumbnailUrl) {
            thumbnails.set(value.id, {
              id: `thumbnail:${value.id}`,
              url: value.thumbnailUrl,
              type: 'IMAGE',
              altText: value.thumbnailAlt ?? value.label,
              sortOrder: 0,
            });
            continue;
          }
          const fallback =
            productScopedMedia.find(
              (item) =>
                item.optionValueId === value.id &&
                item.variantId === null &&
                item.type === 'IMAGE',
            ) ?? sharedThumbnail;
          if (fallback) thumbnails.set(value.id, fallback);
        }
      }

      const cover = variantCover ?? optionCover ?? sharedCover;
      result.set(product.id, {
        effectiveCoverMedia: cover ? publicStorefrontMedia(cover) : null,
        thumbnails,
      });
    }

    return result;
  }

  /** Non-search SQL filters shared by the fuzzy id/count queries. */
  private storefrontFilterFragments(
    query: StorefrontProductQuery,
    categoryIds: string[],
  ): Prisma.Sql[] {
    const filters: Prisma.Sql[] = [Prisma.sql`products.status = 'ACTIVE'`];

    if (query.categoryId) {
      // UUIDs come from our own category table; bind them as a uuid array.
      filters.push(
        Prisma.sql`products.category_id = ANY(${categoryIds}::uuid[])`,
      );
    }
    if (query.room) {
      filters.push(Prisma.sql`products.room = ${query.room}::"Room"`);
    }
    if (query.solution) {
      filters.push(
        Prisma.sql`${query.solution}::"Solution" = ANY(products.solutions)`,
      );
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

  private async storefrontFuzzyList(
    query: StorefrontProductQuery,
    tokens: string[],
  ) {
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
      .filter(
        (product): product is StorefrontProductRecord => product !== undefined,
      );

    return {
      items: await this.presentStorefront(ordered),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async storefrontGetBySlug(slug: string, requestedScope?: MediaScopeRequest) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: STOREFRONT_PDP_SELECT,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // PDP needs availableInventory to render the stock state and to gate
    // ORDER NOW on the frontend (docs/frontend/PDP_SPEC.md §18).
    const enriched = (await this.withAvailableInventory([product]))[0];
    const presented = presentCatalogGraph(enriched);
    const base = {
      ...enriched,
      ...presented,
      images: presented.images.map(publicStorefrontMedia),
    };
    const mediaVariant = mediaDisplayVariant(
      base.variants,
      base.defaultDisplayVariantId,
    );
    const defaultScope = mediaVariant
      ? { variantId: mediaVariant.id }
      : undefined;
    const media = await this.productMedia.resolveInitialProductMedia(
      base.id,
      base.catalogGraphVersion,
      requestedScope ?? defaultScope,
    );
    const reviewData = await this.reviews.storefrontForProduct(base.id);
    return {
      ...base,
      ...media,
      effectiveCoverMedia: media.initialMediaSet.media[0] ?? null,
      ...reviewData,
    };
  }

  async storefrontMediaBySlug(slug: string, request: MediaScopeRequest) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: { id: true, catalogGraphVersion: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.productMedia.resolveProductMedia(
      product.id,
      product.catalogGraphVersion,
      request,
    );
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
        products.flatMap((p) =>
          p.variants.map((v) => v.sku?.id).filter((id): id is string => !!id),
        ),
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
        availableBySku.set(
          row.skuId,
          (row._sum.onHand ?? 0) - (row._sum.reserved ?? 0),
        );
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
              price:
                variant.sku.price === null ? null : Number(variant.sku.price),
              compareAtPrice:
                variant.sku.compareAtPrice === null
                  ? null
                  : Number(variant.sku.compareAtPrice),
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
        throw new ConflictException(
          'A record with the same unique value already exists',
        );
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Referenced record does not exist');
      }
    }
    throw error;
  }
}
