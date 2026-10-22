import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HomepageSectionType, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProductsService } from '../catalog/products.service.js';
import {
  isScheduleActive,
  normalizeLegacyDocument,
  type HomepageDocument,
  type LinkValue,
  type Schedule,
  type SectionStyle,
} from './homepage-document.js';
import { HomepageDocumentService } from './homepage-document.service.js';
import { PrismaLinkLookup } from './homepage-link-lookup.js';
import { verifyPreviewToken } from './homepage-preview-token.js';
import { categoryNavigationDraftSchema } from './homepage-content-schema.js';
import type { NavigationTarget } from './homepage-validation.js';

type SectionWithProducts = Prisma.HomepageSectionGetPayload<{
  include: { products: true };
}>;

type HydratedProduct = Awaited<
  ReturnType<ProductsService['storefrontByIds']>
>[number];

type StorefrontProductJoin = {
  productId: string;
  sortOrder: number;
  badge: string | null;
};

type StorefrontSectionType =
  | HomepageSectionType
  | 'PROMO_BANNER'
  | 'COUNTDOWN_BANNER';

type StorefrontSection = {
  id: string;
  type: StorefrontSectionType;
  title: string | null;
  subtitle: string | null;
  enabled: boolean;
  sortOrder: number;
  payload: unknown;
  style?: Record<string, unknown>;
  products: StorefrontProductJoin[];
  schedule?: Schedule;
};

type SelectedSource = {
  document: HomepageDocument | null;
  sections: StorefrontSection[];
};

type LinkEntityType = 'PRODUCT' | 'COLLECTION' | 'CATEGORY' | 'LANDING';

type LinkHrefs = Map<string, string | null>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_NORMALIZATION_ID = '00000000-0000-7000-8000-000000000001';
const LINK_ENTITY_TYPES: LinkEntityType[] = [
  'PRODUCT',
  'COLLECTION',
  'CATEGORY',
  'LANDING',
];

/**
 * Overlay a section's own style on the homepage defaults, field by field.
 * Returns undefined when neither side sets anything, so a document with no
 * defaults keeps emitting no `style` key (the storefront's built-in classes
 * then apply, exactly as before).
 */
function mergeSectionStyle(
  defaults: SectionStyle,
  style: unknown,
): Record<string, unknown> | undefined {
  const section = style && typeof style === 'object' && !Array.isArray(style)
    ? style as SectionStyle
    : {};
  const { overrides: globalOverrides, ...globalBase } = defaults;
  const { overrides: sectionOverrides, ...sectionBase } = section;
  const merged: Record<string, unknown> = { ...globalBase, ...sectionBase };
  const overrides: Record<string, unknown> = {};
  for (const device of ['tablet', 'mobile'] as const) {
    const effective = {
      ...globalBase, ...globalOverrides?.[device],
      ...sectionBase, ...sectionOverrides?.[device],
    };
    const difference = Object.fromEntries(Object.entries(effective).filter(
      ([key, value]) => value !== merged[key],
    ));
    if (Object.keys(difference).length > 0) overrides[device] = difference;
  }
  if (Object.keys(overrides).length > 0) merged.overrides = overrides;
  return Object.keys(merged).length > 0 ? merged : undefined;
}

@Injectable()
export class HomepageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    @Optional() private readonly docs?: HomepageDocumentService,
    @Optional() private readonly links?: PrismaLinkLookup,
    @Optional() private readonly config?: ConfigService,
  ) {}

  // --- storefront ----------------------------------------------------------

  async storefrontGet(opts?: { previewToken?: string }) {
    const now = new Date();
    const source = await this.selectSource(opts?.previewToken, now);
    const sections = this.activeSections(source.sections, now);
    const productById = await this.hydrateProducts(sections);
    const heroLinks = await this.resolveHeroLinks(sections, now);
    const navigationTargets = await this.resolveNavigationTargets(sections);

    return {
      ...(source.document?.appearance === 'STUDIO_V3' ? { appearance: 'STUDIO_V3' as const } : {}),
      sections: await Promise.all(
        sections.map((section) =>
          this.presentSection(section, productById, heroLinks, navigationTargets, now),
        ),
      ),
    };
  }

  async storefrontGetAnnouncement(opts?: { previewToken?: string }) {
    const now = new Date();
    const source = await this.selectSource(opts?.previewToken, now);
    const announcement = source.document?.announcement;
    if (!announcement?.enabled) return null;

    const nowMs = now.getTime();
    const items = announcement.items
      .filter(
        (item) =>
          item.enabled &&
          isScheduleActive(item.schedule, now) &&
          (item.countdown?.endsAt === null ||
            item.countdown?.endsAt === undefined ||
            Date.parse(item.countdown.endsAt) > nowMs),
      )
      .sort((left, right) => left.sortOrder - right.sortOrder);
    if (items.length === 0) return null;

    const linkHrefs = await this.resolveLinks(items.map((item) => item.link));
    return {
      enabled: true as const,
      rotationMs: announcement.rotationMs,
      items: items.map((item) => ({
        ...item,
        linkHref: this.hrefForLink(item.link, linkHrefs),
      })),
    };
  }

  private async selectSource(
    previewToken: string | undefined,
    now: Date,
  ): Promise<SelectedSource> {
    if (previewToken !== undefined) {
      const preview = await this.previewDocument(previewToken, now);
      if (!preview) {
        throw new NotFoundException({
          code: 'HOMEPAGE_PREVIEW_NOT_FOUND',
          message: 'Homepage preview not found.',
        });
      }
      return this.sourceFromDocument(preview);
    }

    if (this.docs) {
      const effective = await this.docs.getEffectiveVersion(now);
      if (effective) {
        // The document service already normalizes its result, but normalize at
        // this boundary as well so every source follows the same read contract.
        return this.sourceFromDocument(
          normalizeLegacyDocument(effective.document),
        );
      }
    }

    return {
      document: null,
      sections: await this.legacyStorefrontGet(),
    };
  }

  private async previewDocument(
    previewToken: string | undefined,
    now: Date,
  ): Promise<HomepageDocument | null> {
    if (!previewToken || !this.docs) return null;

    const secret = this.config?.get<string>('homepagePreviewSecret') ?? '';
    const verified = verifyPreviewToken(previewToken, secret, now);
    if (!verified) return null;

    // This read deliberately does not call getDraft(): that method also reads
    // effective-version metadata with its own clock. Preview needs only the
    // saved draft and revision, keeping source selection on this request's one
    // `now` value.
    const snapshot =
      typeof (this.docs as { getDraftForPreview?: unknown })
        .getDraftForPreview === 'function'
        ? await this.docs.getDraftForPreview()
        : await this.docs.getDraft();
    if (snapshot.draftRev !== verified.draftRev) return null;
    return normalizeLegacyDocument(snapshot.draft);
  }

  private sourceFromDocument(document: HomepageDocument): SelectedSource {
    const defaults = document.defaults ?? {};
    return {
      document,
      sections: document.sections.map((section) => {
        const style = mergeSectionStyle(defaults, section.style);
        return {
          id: section.id,
          type: section.type as StorefrontSectionType,
          title: section.title,
          subtitle: section.subtitle,
          enabled: section.enabled,
          sortOrder: section.sortOrder,
          schedule: section.schedule,
          ...(style ? { style } : {}),
          payload: section.payload,
          products: section.products
            .map((product) => ({ ...product }))
            .sort((left, right) => left.sortOrder - right.sortOrder),
        };
      }),
    };
  }

  /** The frozen legacy table read path used when no document version is live. */
  private async legacyStorefrontGet(): Promise<StorefrontSection[]> {
    const sections = await this.prisma.homepageSection.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { products: { orderBy: { sortOrder: 'asc' } } },
    });

    return sections.map((section) => ({
      id: section.id,
      type: section.type,
      title: section.title,
      subtitle: section.subtitle,
      enabled: section.enabled,
      sortOrder: section.sortOrder,
      payload:
        section.type === HomepageSectionType.HERO
          ? this.normalizeLegacyHeroPayload(section)
          : (section.payload ?? {}),
      products: section.products.map((product) => ({
        productId: product.productId,
        sortOrder: product.sortOrder,
        badge: product.badge,
      })),
    }));
  }

  private activeSections(
    sections: StorefrontSection[],
    now: Date,
  ): StorefrontSection[] {
    return sections.filter(
      (section) =>
        section.enabled &&
        (section.schedule === undefined ||
          isScheduleActive(section.schedule, now)) &&
        this.countdownIsActive(section, now),
    );
  }

  /**
   * COUNTDOWN_BANNER hides itself at/after its payload `endsAt` (half-open,
   * same convention as schedule windows). Null/invalid ends fail closed so a
   * broken payload never leaks an expired banner; other section types are
   * unaffected.
   */
  private countdownIsActive(section: StorefrontSection, now: Date): boolean {
    if (section.type !== 'COUNTDOWN_BANNER') return true;
    const payload = this.payloadObject(section);
    const endsAt =
      typeof payload.endsAt === 'string' ? Date.parse(payload.endsAt) : Number.NaN;
    return Number.isFinite(endsAt) && endsAt > now.getTime();
  }

  private async hydrateProducts(
    sections: StorefrontSection[],
  ): Promise<Map<string, HydratedProduct>> {
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
      if (
        section.type === HomepageSectionType.UGC &&
        Array.isArray(payload.entries)
      ) {
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
    return new Map(hydrated.map((product) => [product.id, product]));
  }

  private async resolveNavigationTargets(sections: StorefrontSection[]): Promise<Map<string, NavigationTarget>> {
    const categoryIds = new Set<string>();
    const collectionIds = new Set<string>();
    for (const section of sections) {
      if (section.type !== HomepageSectionType.CATEGORY_TILES) continue;
      const payload = this.payloadObject(section);
      if (!('entries' in payload)) continue;
      const parsed = categoryNavigationDraftSchema.safeParse(payload);
      if (!parsed.success) continue;
      for (const entry of parsed.data.entries ?? []) {
        if (entry.link?.type === 'CATEGORY') categoryIds.add(entry.link.id);
        else if (entry.link?.type === 'COLLECTION') collectionIds.add(entry.link.id);
      }
    }
    if (categoryIds.size === 0 && collectionIds.size === 0) return new Map();
    return (this.links ?? new PrismaLinkLookup(this.prisma)).navigationTargets({ categoryIds: [...categoryIds], collectionIds: [...collectionIds] });
  }

  private async presentSection(
    section: StorefrontSection,
    productById: Map<string, HydratedProduct>,
    heroLinks: LinkHrefs,
    navigationTargets: Map<string, NavigationTarget>,
    now: Date,
  ) {
    const payload = this.payloadObject(section);
    const base = {
      id: section.id,
      type: section.type,
      title: section.title,
      subtitle: section.subtitle,
      enabled: section.enabled,
      sortOrder: section.sortOrder,
      // Banner sections keep their schedule so an already-open or cached page
      // can still honor an earlier `unpublishAt` at runtime.
      ...(section.type === 'PROMO_BANNER' || section.type === 'COUNTDOWN_BANNER'
        ? { schedule: { ...section.schedule } }
        : {}),
      ...(section.style ? { style: { ...section.style } } : {}),
    };

    if (section.type === HomepageSectionType.HERO) {
      return { ...base, payload: this.presentHero(payload, heroLinks, now) };
    }

    if (section.type === HomepageSectionType.CATEGORY_TILES) {
      if ('entries' in payload) {
        const parsed = categoryNavigationDraftSchema.safeParse(payload);
        const entries = parsed.success ? parsed.data.entries ?? [] : [];
        const navigationEntries = entries.flatMap((entry) => {
          if (!entry.link || !entry.imageUrl) return [];
          const target = navigationTargets.get(`${entry.link.type}:${entry.link.id}`);
          if (!target) return [];
          const prefix = target.type === 'CATEGORY' ? 'categories' : 'collections';
          return [{ id: entry.id, name: entry.label?.trim() || target.name, imageUrl: entry.imageUrl,
            href: `/${prefix}/${encodeURIComponent(target.slug)}`, link: entry.link }];
        });
        return { ...base, payload, navigationEntries };
      }
      const ids = Array.isArray(payload.categoryIds)
        ? payload.categoryIds.filter((x): x is string => typeof x === 'string')
        : [];
      return {
        ...base,
        payload,
        categories: ids.length > 0 ? await this.categoriesByIds(ids) : [],
      };
    }

    if (section.type === HomepageSectionType.PRODUCT_GRID) {
      // Only ACTIVE products with a priced, in-stock SKU appear. Empty grids
      // still come back so the frontend can render its empty state.
      const products = section.products
        .map((joinRow) => productById.get(joinRow.productId))
        .filter(
          (product): product is HydratedProduct =>
            !!product && this.isSellable(product),
        )
        .map((product) => ({
          ...product,
          badge:
            section.products.find((j) => j.productId === product.id)?.badge ??
            null,
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
          badge:
            section.products.find((j) => j.productId === product.id)?.badge ??
            null,
        }));
      return {
        ...base,
        payload: this.hydrateRoomScenes(payload, productById),
        products,
      };
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
        if (this.isRecord(payload.presentation) && payload.presentation.layout === 'COLLAGE') delete rest.product;
        if (typeof productId !== 'string') return rest;
        const product = productById.get(productId);
        return product ? { ...rest, product } : rest;
      });
      return { ...base, payload: { ...payload, entries: nextEntries } };
    }

    return { ...base, payload };
  }

  private presentHero(
    payload: Record<string, unknown>,
    linkHrefs: LinkHrefs,
    now: Date,
  ): Record<string, unknown> {
    const rawSlides = Array.isArray(payload.slides) ? payload.slides : [];
    const slides = rawSlides
      .filter((slide): slide is Record<string, unknown> => this.isRecord(slide))
      .filter(
        (slide) =>
          slide.enabled === true &&
          this.scheduleValueIsActive(slide.schedule, now),
      )
      .sort(this.sortByOrder)
      .map((slide) => {
        const elements = this.isRecord(slide.elements) ? slide.elements : {};
        const nextElements: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(elements)) {
          if (!this.isRecord(value)) {
            nextElements[key] = value;
            continue;
          }
          const countdownDisabled =
            key === 'countdown' && value.endsAt === null;
          nextElements[key] = {
            ...value,
            linkHref: countdownDisabled
              ? null
              : this.hrefForLink(this.asLink(value.link), linkHrefs),
          };
        }
        const nextSlide: Record<string, unknown> = { ...slide, elements: nextElements };
        // The whole-banner target (SLIDE mode) and every link zone resolve
        // through the same batch as the element links.
        if (slide.slideLink !== undefined) {
          nextSlide.slideLinkHref = this.hrefForLink(
            this.asLink(slide.slideLink),
            linkHrefs,
          );
        }
        if (Array.isArray(slide.zones)) {
          nextSlide.zones = slide.zones.map((zone) => {
            if (!this.isRecord(zone)) return zone;
            return {
              ...zone,
              linkHref: this.hrefForLink(this.asLink(zone.link), linkHrefs),
            };
          });
        }
        return nextSlide;
      });

    return { ...payload, slides };
  }

  private async resolveHeroLinks(
    sections: StorefrontSection[],
    now: Date,
  ): Promise<LinkHrefs> {
    const links: Array<LinkValue | null> = [];
    for (const section of sections) {
      if (section.type !== HomepageSectionType.HERO) continue;
      const payload = this.payloadObject(section);
      const slides = Array.isArray(payload.slides) ? payload.slides : [];
      for (const slide of slides) {
        if (!this.isRecord(slide)) continue;
        if (
          slide.enabled !== true ||
          !this.scheduleValueIsActive(slide.schedule, now)
        ) {
          continue;
        }
        const elements = this.isRecord(slide.elements) ? slide.elements : {};
        for (const [key, value] of Object.entries(elements)) {
          if (!this.isRecord(value)) continue;
          if (key === 'countdown' && value.endsAt === null) continue;
          links.push(this.asLink(value.link));
        }
        // The whole-banner target and the link zones need the same batch, so
        // a slide that only carries those links still resolves.
        if (slide.slideLink !== undefined) {
          links.push(this.asLink(slide.slideLink));
        }
        if (Array.isArray(slide.zones)) {
          for (const zone of slide.zones) {
            if (!this.isRecord(zone)) continue;
            links.push(this.asLink(zone.link));
          }
        }
      }
    }
    return this.resolveLinks(links);
  }

  private async resolveLinks(
    links: Array<LinkValue | null>,
  ): Promise<LinkHrefs> {
    const ids = new Map<LinkEntityType, Set<string>>(
      LINK_ENTITY_TYPES.map((type) => [type, new Set<string>()]),
    );
    for (const link of links) {
      if (
        link &&
        link.type !== 'EXTERNAL' &&
        link.type !== 'INTERNAL' &&
        link.type !== 'SUBSCRIBE'
      ) {
        ids.get(link.type)?.add(link.id);
      }
    }

    const slugMaps = new Map<LinkEntityType, Map<string, string>>();
    if (this.links) {
      await Promise.all(
        LINK_ENTITY_TYPES.filter((type) => (ids.get(type)?.size ?? 0) > 0).map(
          async (type) => {
            slugMaps.set(
              type,
              await this.links!.slugs(type, [...ids.get(type)!]),
            );
          },
        ),
      );
    }

    const hrefs: LinkHrefs = new Map();
    for (const link of links) {
      if (!link) continue;
      const key = this.linkKey(link);
      if (link.type === 'EXTERNAL') {
        hrefs.set(key, link.url);
        continue;
      }
      if (link.type === 'INTERNAL') {
        hrefs.set(key, link.path);
        continue;
      }
      if (link.type === 'SUBSCRIBE') {
        // The subscribe popup is an action, not a destination.
        hrefs.set(key, null);
        continue;
      }
      const slug = slugMaps.get(link.type)?.get(link.id);
      hrefs.set(key, slug ? this.internalHref(link.type, slug) : null);
    }
    return hrefs;
  }

  private hrefForLink(link: LinkValue | null, hrefs: LinkHrefs): string | null {
    if (!link) return null;
    if (link.type === 'EXTERNAL') return link.url;
    if (link.type === 'INTERNAL') return link.path;
    // The subscribe popup is an action, not a destination.
    if (link.type === 'SUBSCRIBE') return null;
    return hrefs.get(this.linkKey(link)) ?? null;
  }

  private linkKey(link: LinkValue): string {
    if (link.type === 'EXTERNAL') return `${link.type}:${link.url}`;
    if (link.type === 'INTERNAL') return `${link.type}:${link.path}`;
    if (link.type === 'SUBSCRIBE') return link.type;
    return `${link.type}:${link.id}`;
  }

  private internalHref(type: LinkEntityType, slug: string): string {
    const path =
      type === 'PRODUCT'
        ? 'products'
        : type === 'COLLECTION'
          ? 'collections'
          : type === 'CATEGORY'
            ? 'categories'
            : 'lp';
    return `/${path}/${encodeURIComponent(slug)}`;
  }

  private asLink(value: unknown): LinkValue | null {
    if (!this.isRecord(value) || typeof value.type !== 'string') return null;
    if (value.type === 'EXTERNAL' && typeof value.url === 'string') {
      return { type: 'EXTERNAL', url: value.url };
    }
    if (value.type === 'INTERNAL' && typeof value.path === 'string') {
      return { type: 'INTERNAL', path: value.path };
    }
    if (
      (value.type === 'PRODUCT' ||
        value.type === 'COLLECTION' ||
        value.type === 'CATEGORY' ||
        value.type === 'LANDING') &&
      typeof value.id === 'string'
    ) {
      return { type: value.type, id: value.id };
    }
    if (value.type === 'SUBSCRIBE') {
      return { type: 'SUBSCRIBE' };
    }
    return null;
  }

  private scheduleValueIsActive(value: unknown, now: Date): boolean {
    if (!this.isRecord(value)) return true;
    if (
      (value.publishAt !== null && typeof value.publishAt !== 'string') ||
      (value.unpublishAt !== null && typeof value.unpublishAt !== 'string')
    ) {
      return false;
    }
    return isScheduleActive(
      {
        publishAt: typeof value.publishAt === 'string' ? value.publishAt : null,
        unpublishAt:
          typeof value.unpublishAt === 'string' ? value.unpublishAt : null,
      },
      now,
    );
  }

  private normalizeLegacyHeroPayload(section: SectionWithProducts): unknown {
    const payload = this.payloadObject(section);
    const normalized = normalizeLegacyDocument({
      schemaVersion: 1,
      sections: [
        {
          id: UUID_RE.test(section.id) ? section.id : LEGACY_NORMALIZATION_ID,
          type: HomepageSectionType.HERO,
          title: section.title,
          subtitle: section.subtitle,
          enabled: section.enabled,
          sortOrder: section.sortOrder,
          schedule: { publishAt: null, unpublishAt: null },
          payload,
          products: [],
        },
      ],
      announcement: { enabled: false, rotationMs: 5000, items: [] },
    });
    return normalized.sections[0].payload;
  }

  private sortByOrder(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
  ): number {
    const leftOrder = typeof left.sortOrder === 'number' ? left.sortOrder : 0;
    const rightOrder =
      typeof right.sortOrder === 'number' ? right.sortOrder : 0;
    return leftOrder - rightOrder;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /** A homepage grid product is sellable with one priced, in-stock SKU. */
  private isSellable(product: HydratedProduct): boolean {
    // presentStorefront adds availableInventory at runtime through
    // withAvailableInventory; STOREFRONT_SELECT's inferred type does not carry
    // the field, so narrow the enriched SKU shape structurally here.
    return product.variants.some((variant) => {
      const sku = variant.sku as {
        price: number | null;
        availableInventory: number;
      } | null;
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

  private payloadObject(section: {
    payload: unknown;
  }): Record<string, unknown> {
    return section.payload &&
      typeof section.payload === 'object' &&
      !Array.isArray(section.payload)
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
      if (typeof scene.id !== 'string' || typeof scene.imageUrl !== 'string')
        return [];

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
            product: {
              select: { id: true, name: true, slug: true, status: true },
            },
          },
        },
      },
    });
  }
}
