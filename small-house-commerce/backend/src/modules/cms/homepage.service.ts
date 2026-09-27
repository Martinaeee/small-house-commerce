import { Injectable } from '@nestjs/common';
import { HomepageSectionType, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProductsService } from '../catalog/products.service.js';

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
      if (section.type === HomepageSectionType.ROOM_INSPIRATION) {
        for (const id of this.collectRoomSceneIds(payload)) productIds.add(id);
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
      return { ...base, payload: this.hydrateRoomScenes(payload, productById), products };
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

  /** Defensive read of every hotspot productId inside a room payload's scenes. */
  private collectRoomSceneIds(payload: Record<string, unknown>): string[] {
    if (!Array.isArray(payload.scenes)) return [];
    const ids: string[] = [];
    for (const scene of payload.scenes) {
      if (!scene || typeof scene !== 'object') continue;
      const hotspots = (scene as Record<string, unknown>).hotspots;
      if (!Array.isArray(hotspots)) continue;
      for (const hotspot of hotspots) {
        if (
          hotspot &&
          typeof hotspot === 'object' &&
          typeof (hotspot as Record<string, unknown>).productId === 'string'
        ) {
          ids.push((hotspot as Record<string, string>).productId);
        }
      }
    }
    return ids;
  }

  /**
   * Attach the hydrated ACTIVE product to each scene hotspot, retaining
   * productId and coordinates. Unresolved dots are dropped
   * (inactive/deleted); scenes with broken shapes are dropped too. No stock
   * gate — same rule as the legacy room list.
   */
  private hydrateRoomScenes(
    payload: Record<string, unknown>,
    productById: Map<string, HydratedProduct>,
  ): Record<string, unknown> {
    if (!Array.isArray(payload.scenes)) return payload;

    const scenes = payload.scenes.flatMap((rawScene) => {
      if (!rawScene || typeof rawScene !== 'object') return [];
      const scene = rawScene as Record<string, unknown>;
      if (typeof scene.id !== 'string' || typeof scene.imageUrl !== 'string') return [];

      const hotspots = Array.isArray(scene.hotspots) ? scene.hotspots : [];
      const nextHotspots = hotspots.flatMap((rawHotspot) => {
        if (!rawHotspot || typeof rawHotspot !== 'object') return [];
        const hotspot = rawHotspot as Record<string, unknown>;
        if (typeof hotspot.productId !== 'string') return [];
        if (
          typeof hotspot.xPct !== 'number' ||
          typeof hotspot.yPct !== 'number' ||
          !Number.isFinite(hotspot.xPct) ||
          !Number.isFinite(hotspot.yPct)
        ) {
          return [];
        }
        const product = productById.get(hotspot.productId);
        if (!product) return [];
        return [
          {
            productId: hotspot.productId,
            xPct: hotspot.xPct,
            yPct: hotspot.yPct,
            product,
          },
        ];
      });

      const nextScene: Record<string, unknown> = {
        id: scene.id,
        imageUrl: scene.imageUrl,
        hotspots: nextHotspots,
      };
      if (typeof scene.alt === 'string') nextScene.alt = scene.alt;
      return [nextScene];
    });

    return { ...payload, scenes };
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

}
