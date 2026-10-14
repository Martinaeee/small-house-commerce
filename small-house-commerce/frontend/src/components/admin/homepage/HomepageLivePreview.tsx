"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  SECTION_REGISTRY,
  type SectionPreviewDevice,
  type SectionProps,
} from "@/components/home/sectionRegistry";
import type {
  AnnouncementBlockView,
  HomepageCategoryTile,
  HomepageSection as StorefrontHomepageSection,
  HomepageSectionProduct,
  HomepageSectionStyle,
} from "@/lib/api";
import {
  adminApi,
  type AdminCategoryNode,
  type AdminProduct,
} from "@/lib/admin-api";
import { deserializeAdminProduct, deserializeProduct } from "@/lib/admin-product-graph";
import { buildProductCardPreview } from "@/lib/admin-product-card-preview";
import type {
  HomepageDocument,
  HomepageSection,
  LinkValue,
} from "@/lib/homepage-document";
import { normalizeSectionForEditor } from "@/lib/homepage-section-normalize";
import { HeroCanvas } from "./HeroCanvas";
import { ANNOUNCEMENT_SELECTION_ID } from "./ModuleTree";
import { PreviewStorefrontShell } from "./PreviewStorefrontShell";
import { useHomepagePreviewShellData } from "./useHomepagePreviewShellData";

type PreviewDevice = SectionPreviewDevice;

const DEVICE_HEIGHTS: Record<PreviewDevice, number> = {
  desktop: 900,
  tablet: 1024,
  mobile: 844,
};

/** Mirrors the storefront Hero height rules inside each simulated viewport. */
const HERO_HEIGHTS: Record<PreviewDevice, number> = {
  desktop: Math.min(720, Math.max(560, DEVICE_HEIGHTS.desktop * 0.72)),
  tablet: 768 * 1.25,
  mobile: 390 * 1.25,
};

function previewStyle(value: unknown): HomepageSectionStyle | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const style = value as Record<string, unknown>;
  const next: HomepageSectionStyle = {};
  if (typeof style.backgroundColor === "string") {
    next.backgroundColor = style.backgroundColor;
  }
  if (typeof style.textColor === "string") {
    next.textColor = style.textColor;
  }
  if (
    style.contentWidth === "FULL" ||
    style.contentWidth === "STANDARD" ||
    style.contentWidth === "NARROW"
  ) {
    next.contentWidth = style.contentWidth;
  }
  if (typeof style.paddingTop === "number") next.paddingTop = style.paddingTop;
  if (typeof style.paddingBottom === "number") {
    next.paddingBottom = style.paddingBottom;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Mirror the storefront merge: homepage defaults under the section's own
 * style, field by field. Keeps the live preview identical to production.
 */
function mergedPreviewStyle(
  defaults: unknown,
  style: unknown,
): HomepageSectionStyle | undefined {
  const merged = { ...(previewStyle(defaults) ?? {}), ...(previewStyle(style) ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function flattenCategories(
  nodes: AdminCategoryNode[],
): Record<string, HomepageCategoryTile> {
  const result: Record<string, HomepageCategoryTile> = {};
  const visit = (items: AdminCategoryNode[]): void => {
    for (const category of items) {
      if (category.status === "ACTIVE" && category.imageUrl) {
        result[category.id] = {
          id: category.id,
          name: category.name,
          slug: category.slug,
          imageUrl: category.imageUrl,
        };
      }
      visit(category.children);
    }
  };
  visit(nodes);
  return result;
}

function productIdsInSection(section: HomepageSection): string[] {
  const ids = new Set(
    section.products
      .map((product) => product.productId)
      .filter((id): id is string => typeof id === "string" && id.trim() !== ""),
  );
  const payload = section.payload as Record<string, unknown>;
  if (typeof payload.productId === "string" && payload.productId.trim() !== "") {
    ids.add(payload.productId);
  }

  if (Array.isArray(payload.entries)) {
    for (const entry of payload.entries) {
      if (entry && typeof entry === "object" && "productId" in entry) {
        const productId = (entry as { productId?: unknown }).productId;
        if (typeof productId === "string" && productId.trim() !== "") {
          ids.add(productId);
        }
      }
    }
  }
  if (Array.isArray(payload.scenes)) {
    for (const scene of payload.scenes) {
      if (!scene || typeof scene !== "object") continue;
      const hotspots = (scene as { hotspots?: unknown }).hotspots;
      if (!Array.isArray(hotspots)) continue;
      for (const hotspot of hotspots) {
        if (hotspot && typeof hotspot === "object" && "productId" in hotspot) {
          const productId = (hotspot as { productId?: unknown }).productId;
          if (typeof productId === "string" && productId.trim() !== "") {
          ids.add(productId);
        }
        }
      }
    }
  }
  return [...ids];
}

type PreviewAdminSku = NonNullable<AdminProduct["variants"][number]["sku"]>;

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPreviewSku(source: PreviewAdminSku) {
  return {
    id: source.id,
    skuCode: source.skuCode,
    status: source.status,
    price: numberOrNull(source.price),
    compareAtPrice: numberOrNull(source.compareAtPrice),
    availableInventory: source.availableInventory,
    productWeight: source.productWeight,
    packageWidth: source.packageWidth,
    packageHeight: source.packageHeight,
    packageDepth: source.packageDepth,
    packageWeight: source.packageWeight,
  };
}

function isActiveProduct(source: AdminProduct): boolean {
  return source.status === "ACTIVE";
}

function isSellableProduct(source: AdminProduct): boolean {
  return (
    isActiveProduct(source) &&
    source.variants.some((variant) => {
      const sku = variant.sku;
      return (
        sku?.status === "ACTIVE" &&
        numberOrNull(sku.price) !== null &&
        sku.availableInventory > 0
      );
    })
  );
}

function effectivePreviewCover(source: AdminProduct) {
  const imageMedia = (source.media ?? [])
    .filter((media) => media.type === "IMAGE")
    .slice()
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    );
  const defaultVariant = source.variants.find(
    (variant) => variant.id === source.defaultDisplayVariantId,
  );
  const variantCover = defaultVariant
    ? imageMedia.find((media) => media.variantId === defaultVariant.id)
    : undefined;
  const mediaDriver = (source.options ?? []).find(
    (option) => option.isActive && option.isMediaDriver,
  );
  const driverValueId =
    defaultVariant && mediaDriver && "optionValues" in defaultVariant
      ? defaultVariant.optionValues.find(
          (assignment) => assignment.optionId === mediaDriver.id,
        )?.optionValueId
      : undefined;
  const optionCover = driverValueId
    ? imageMedia.find(
        (media) =>
          media.variantId === null && media.optionValueId === driverValueId,
      )
    : undefined;
  const cover = variantCover ?? optionCover ?? source.images.find((media) => media.type === "IMAGE");
  return cover
    ? {
        id: cover.id,
        url: cover.url,
        type: cover.type,
        altText: cover.altText,
        sortOrder: cover.sortOrder,
      }
    : null;
}

function toPreviewProduct(
  source: AdminProduct,
  badge: string | null = null,
): HomepageSectionProduct {
  const cardDraft = deserializeAdminProduct(source);
  const cardPreview = buildProductCardPreview(deserializeProduct(source), cardDraft, cardDraft.defaultDisplayVariantRef ?? null);
  const images = source.images.map((image) => ({ ...image }));
  const options = (source.options ?? []).map((option) => ({
    id: option.id,
    kind: option.kind,
    name: option.name,
    position: option.position,
    presentation: option.presentation,
    isMediaDriver: option.isMediaDriver,
    values: option.values
      .filter((value) => value.isActive)
      .map((value) => ({
        id: value.id,
        label: value.label,
        position: value.position,
        swatchHex: value.swatchHex,
        thumbnailUrl: value.thumbnailUrl,
        thumbnailAlt: value.thumbnailAlt,
      })),
  }));
  const variants = source.variants
    .filter((variant) => variant.sku?.status === "ACTIVE")
    .map((variant) => ({
      id: variant.id,
      name: variant.name,
      position: variant.position,
      combinationKey:
        "combinationKey" in variant && typeof variant.combinationKey === "string"
          ? variant.combinationKey
          : "",
      optionValueIds:
        "optionValues" in variant
          ? variant.optionValues.map((value) => value.optionValueId)
          : [],
      sku: variant.sku ? toPreviewSku(variant.sku) : null,
    }));
  return {
    id: source.id,
    name: source.name,
    slug: source.slug,
    description: source.description,
    tagline: source.tagline,
    categoryId: source.categoryId,
    ratingAverage: null,
    reviewCount: 0,
    room: null,
    internalRole: source.internalRole,
    solutions: [],
    width: source.width,
    height: source.height,
    depth: source.depth,
    foldedWidth: source.foldedWidth,
    foldedHeight: source.foldedHeight,
    foldedDepth: source.foldedDepth,
    materials: source.materials,
    features: source.features,
    catalogGraphVersion: source.catalogGraphVersion,
    options,
    defaultDisplayVariantId: source.defaultDisplayVariantId,
    cardMedia: cardPreview.cardMedia,
    effectiveCoverMedia: effectivePreviewCover(source),
    images,
    variants,
    badge,
  };
}

function stableIdKey(ids: string[]): string {
  return JSON.stringify([...new Set(ids)].sort());
}

function usePreviewCatalog(sections: HomepageSection[]): PreviewCatalog {
  const productIdsKey = stableIdKey(sections.flatMap(productIdsInSection));
  const categoryIdsKey = stableIdKey(
    sections.flatMap((section) => {
      if (section.type !== "CATEGORY_TILES") return [];
      const value = (section.payload as { categoryIds?: unknown }).categoryIds;
      return Array.isArray(value)
        ? value.filter(
            (id): id is string => typeof id === "string" && id.trim() !== "",
          )
        : [];
    }),
  );
  const productIds = useMemo(
    () => JSON.parse(productIdsKey) as string[],
    [productIdsKey],
  );
  const categoryIds = useMemo(
    () => JSON.parse(categoryIdsKey) as string[],
    [categoryIdsKey],
  );
  const [productsById, setProductsById] = useState<Record<string, AdminProduct>>({});
  const [categoriesById, setCategoriesById] = useState<
    Record<string, HomepageCategoryTile>
  >({});
  const productRequests = useRef(new Map<string, Promise<AdminProduct | null>>());
  const categoryRequest = useRef<Promise<AdminCategoryNode[]> | null>(null);

  useEffect(() => {
    const currentIds = new Set(productIds);
    for (const id of productRequests.current.keys()) {
      if (!currentIds.has(id)) productRequests.current.delete(id);
    }
    const missing = productIds.filter((id) => !productsById[id]);
    if (missing.length === 0) return;
    let active = true;
    void Promise.all(
      missing.map((id) => {
        let request = productRequests.current.get(id);
        if (!request) {
          request = adminApi.getProduct(id).catch(() => null);
          productRequests.current.set(id, request);
        }
        return request;
      }),
    ).then((products) => {
      if (!active) return;
      const found = products.filter(
        (product): product is AdminProduct => product !== null,
      );
      if (found.length === 0) return;
      setProductsById((current) => {
        const next = { ...current };
        found.forEach((product) => {
          next[product.id] = product;
        });
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [productIds, productsById]);

  useEffect(() => {
    if (categoryIds.length === 0) return;
    const request = categoryRequest.current ?? adminApi.listCategories();
    categoryRequest.current = request;
    let active = true;
    void request
      .then((categories) => {
        if (active) setCategoriesById(flattenCategories(categories));
      })
      .catch(() => {
        if (active) categoryRequest.current = null;
      });
    return () => {
      active = false;
    };
  }, [categoryIds]);

  return { productsById, categoriesById };
}

type PreviewCatalog = {
  productsById: Record<string, AdminProduct>;
  categoriesById: Record<string, HomepageCategoryTile>;
};

function previewSection(
  section: Exclude<HomepageSection, { type: "HERO" }>,
  catalog: PreviewCatalog,
  defaults: unknown,
): StorefrontHomepageSection {
  const sourcePayload = section.payload as Record<string, unknown>;
  const payload: Record<string, unknown> = { ...sourcePayload };
  const products = section.products
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((join) => {
      const product = catalog.productsById[join.productId];
      const eligible =
        product &&
        (section.type === "PRODUCT_GRID"
          ? isSellableProduct(product)
          : isActiveProduct(product));
      return eligible ? [toPreviewProduct(product, join.badge)] : [];
    });
  const categoryIds = Array.isArray(sourcePayload.categoryIds)
    ? sourcePayload.categoryIds.filter((id): id is string => typeof id === "string")
    : [];
  const categories = categoryIds.flatMap((id) => {
    const category = catalog.categoriesById[id];
    return category ? [category] : [];
  });

  if (section.type === "PRODUCT_STORY" && typeof sourcePayload.productId === "string") {
    const product = catalog.productsById[sourcePayload.productId];
    if (product && isActiveProduct(product)) payload.product = toPreviewProduct(product);
  }
  if (section.type === "UGC" && Array.isArray(sourcePayload.entries)) {
    payload.entries = sourcePayload.entries.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const productId = (entry as { productId?: unknown }).productId;
      const product = typeof productId === "string" ? catalog.productsById[productId] : null;
      return product && isActiveProduct(product)
        ? { ...entry, product: toPreviewProduct(product) }
        : entry;
    });
  }
  if (section.type === "ROOM_INSPIRATION" && Array.isArray(sourcePayload.scenes)) {
    payload.scenes = sourcePayload.scenes.map((scene) => {
      if (!scene || typeof scene !== "object") return scene;
      const hotspots = (scene as { hotspots?: unknown }).hotspots;
      if (!Array.isArray(hotspots)) return scene;
      return {
        ...scene,
        hotspots: hotspots.map((hotspot) => {
          if (!hotspot || typeof hotspot !== "object") return hotspot;
          const productId = (hotspot as { productId?: unknown }).productId;
          const product = typeof productId === "string" ? catalog.productsById[productId] : null;
          return product && isActiveProduct(product)
            ? { ...hotspot, product: toPreviewProduct(product) }
            : hotspot;
        }),
      };
    });
  }

  return {
    id: section.id,
    type: section.type,
    title: section.title,
    subtitle: section.subtitle,
    sortOrder: section.sortOrder,
    payload,
    style: mergedPreviewStyle(defaults, section.style),
    products,
    categories,
  };
}

function unresolvedJoinIds(
  section: Exclude<HomepageSection, { type: "HERO" }>,
  catalog: PreviewCatalog,
): { kind: "products" | "categories"; ids: string[] } | null {
  if (section.type === "PRODUCT_GRID") {
    const ids = section.products
      .map((product) => product.productId)
      .filter((id) => {
        const product = catalog.productsById[id];
        return !product || !isSellableProduct(product);
      });
    return ids.length > 0 ? { kind: "products", ids } : null;
  }
  if (section.type === "CATEGORY_TILES") {
    const value = (section.payload as { categoryIds?: unknown }).categoryIds;
    const ids = Array.isArray(value)
      ? value.filter(
          (id): id is string => typeof id === "string" && !catalog.categoriesById[id],
        )
      : [];
    return ids.length > 0 ? { kind: "categories", ids } : null;
  }
  return null;
}

function PreviewJoinNotice({
  kind,
  ids,
}: {
  kind: "products" | "categories";
  ids: string[];
}): ReactNode {
  return (
    <div
      data-preview-join={kind}
      className="mx-auto my-4 max-w-6xl rounded-lg border border-dashed border-border bg-card px-4 py-3 text-sm text-ink-secondary sm:px-6"
    >
      <p>
        {kind === "products"
          ? "Selected products are unavailable in this preview."
          : "Selected categories are unavailable in this preview."}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2 text-xs text-ink-muted">
        {ids.map((id) => (
          <li key={id} className="font-mono">
            {id}
          </li>
        ))}
      </ul>
    </div>
  );
}


function renderSection(
  section: Exclude<HomepageSection, { type: "HERO" }>,
  catalog: PreviewCatalog,
  defaults: unknown,
  device: PreviewDevice,
): ReactNode {
  const Renderer = SECTION_REGISTRY[section.type] as ComponentType<SectionProps>;
  const storefrontSection = previewSection(section, catalog, defaults);
  const unresolved = unresolvedJoinIds(section, catalog);
  const hideEmptyJoinRenderer =
    unresolved !== null &&
    ((section.type === "PRODUCT_GRID" && storefrontSection.products?.length === 0) ||
      (section.type === "CATEGORY_TILES" && storefrontSection.categories?.length === 0));
  const showEmptyUspTitle =
    section.type === "USP" &&
    (!Array.isArray(storefrontSection.payload.items) ||
      storefrontSection.payload.items.length === 0) &&
    section.title;

  return (
    <div
      key={section.id}
      data-preview-section={section.type}
      data-preview-section-id={section.id}
      className="min-w-0 shrink-0"
    >
      {showEmptyUspTitle ? (
        <h2 className="mx-auto max-w-6xl px-4 pt-8 text-2xl font-semibold text-ink sm:px-6">
          {section.title}
        </h2>
      ) : null}
      {unresolved ? <PreviewJoinNotice {...unresolved} /> : null}
      {!hideEmptyJoinRenderer ? (
        <Renderer section={storefrontSection} previewDevice={device} interactionMode="preview" />
      ) : null}
    </div>
  );
}

function previewLinkHref(link: LinkValue | null): string | null {
  if (!link) return null;
  if (link.type === "INTERNAL") return link.path;
  if (link.type === "EXTERNAL") return link.url;
  return "#preview-entity-link";
}

function previewAnnouncementBlock(
  announcement: HomepageDocument["announcement"],
): AnnouncementBlockView {
  return {
    enabled: announcement.enabled,
    rotationMs: announcement.rotationMs,
    items: announcement.items.map((item) => ({
      ...item,
      linkHref: previewLinkHref(item.link),
    })),
  };
}

function scrollPreview(
  preview: HTMLDivElement,
  options: ScrollToOptions,
): void {
  if (typeof preview.scrollTo === "function") {
    preview.scrollTo(options);
    return;
  }
  if (typeof options.top === "number") preview.scrollTop = options.top;
}

export function HomepageLivePreview({
  document,
  device,
  selectedSectionId,
}: {
  document: HomepageDocument;
  device: PreviewDevice;
  selectedSectionId: string | null;
}): ReactNode {
  const previewRef = useRef<HTMLDivElement>(null);
  const shellData = useHomepagePreviewShellData();
  const announcement = useMemo(
    () => previewAnnouncementBlock(document.announcement),
    [document.announcement],
  );
  const sections = useMemo(
    () =>
      document.sections
        .map(normalizeSectionForEditor)
        .filter((section) => section.enabled)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    [document.sections],
  );
  const catalog = usePreviewCatalog(sections);

  useEffect(() => {
    const preview = previewRef.current;
    if (!selectedSectionId || !preview) return;
    if (selectedSectionId === ANNOUNCEMENT_SELECTION_ID) {
      scrollPreview(preview, { behavior: "smooth", top: 0 });
      return;
    }
    const target = Array.from(
      preview.querySelectorAll<HTMLElement>("[data-preview-section-id]"),
    ).find((section) => section.dataset.previewSectionId === selectedSectionId);
    if (!target) return;

    const previewRect = preview.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const viewportTop = preview.scrollTop;
    const viewportBottom = viewportTop + preview.clientHeight;
    const measuredScale = previewRect.height / preview.clientHeight;
    const scale = Number.isFinite(measuredScale) && measuredScale > 0 ? measuredScale : 1;
    const targetTop = (targetRect.top - previewRect.top) / scale + viewportTop;
    const targetHeight = targetRect.height / scale;
    const targetBottom = targetTop + targetHeight;
    if (targetTop >= viewportTop && targetBottom <= viewportBottom) return;

    const visibleTargetHeight = Math.min(targetHeight, preview.clientHeight);
    const centeredTop = targetTop - (preview.clientHeight - visibleTargetHeight) / 2;
    const maxScrollTop = Math.max(0, preview.scrollHeight - preview.clientHeight);
    scrollPreview(preview, {
      behavior: "smooth",
      top: Math.min(Math.max(centeredTop, 0), maxScrollTop),
    });
  }, [device, selectedSectionId, shellData.loading]);

  return (
    <div
      ref={previewRef}
      data-homepage-live-preview
      className="storefront-theme min-h-0 w-full overflow-x-hidden overflow-y-auto bg-background"
      style={{ height: DEVICE_HEIGHTS[device] }}
      onClickCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("a")) {
          event.preventDefault();
        }
      }}
    >
      <PreviewStorefrontShell
        shell={shellData.shell}
        roots={shellData.roots}
        collections={shellData.collections}
        settings={shellData.settings}
        announcement={announcement}
        device={device}
      >
        {sections.map((section) =>
          section.type === "HERO" ? (
            <div
              key={section.id}
              data-preview-section="HERO"
              data-preview-section-id={section.id}
              className="relative min-w-0 shrink-0"
              style={{ height: HERO_HEIGHTS[device] }}
            >
              <HeroCanvas style={mergedPreviewStyle(document.defaults, section.style)} />
            </div>
          ) : (
            renderSection(section, catalog, document.defaults, device)
          ),
        )}
      </PreviewStorefrontShell>
    </div>
  );
}
