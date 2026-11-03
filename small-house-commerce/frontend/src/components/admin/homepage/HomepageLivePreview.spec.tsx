import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { api } from "@/lib/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HomepageNavigationEntry } from "@/lib/homepage-section-payloads";
import { HomepageLivePreview } from "@/components/admin/homepage/HomepageLivePreview";
import { ANNOUNCEMENT_SELECTION_ID } from "@/components/admin/homepage/ModuleTree";
import { optimizedUploadImage } from "@/lib/image-url";
import type {
  AdminCategoryNode,
  AdminProduct,
} from "@/lib/admin-api";
import {
  emptyDocument,
  type HomepageDocument,
  type HomepageSection,
} from "@/lib/homepage-document";

const getProduct = vi.hoisted(() => vi.fn());
const tracking = vi.hoisted(() => ({ track: vi.fn(), trackCustom: vi.fn() }));
vi.mock("@/lib/tracking", () => ({ ...tracking, currentMarketingCredential: vi.fn(() => null) }));
vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins", variable: "--font-poppins" },
}));
vi.mock(
  "@/components/admin/homepage/useHomepagePreviewShellData",
  async () => {
    const { FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA } = await import(
      "@/lib/homepage-preview-shell-data"
    );
    return {
      useHomepagePreviewShellData: () => ({
        ...FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA,
        degraded: false,
        loading: false,
      }),
    };
  },
);
const listCategories = vi.hoisted(() => vi.fn());
const listCollections = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    getProduct,
    listCategories,
    listCollections,
  },
}));

const PRODUCT_ID = "00000000-0000-7000-8000-000000000701";
const CATEGORY_ID = "00000000-0000-7000-8000-000000000702";
const VARIANT_ID = "00000000-0000-7000-8000-000000000703";
const SKU_ID = "00000000-0000-7000-8000-000000000704";
const OPTION_ID = "00000000-0000-7000-8000-000000000705";
const VALUE_ID = "00000000-0000-7000-8000-000000000706";

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: PRODUCT_ID,
    name: "Preview product",
    slug: "preview-product",
    productCode: null,
    description: null,
    tagline: null,
    seoTitle: null,
    metaDescription: null,
    categoryId: CATEGORY_ID,
    status: "ACTIVE",
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    materials: null,
    features: null,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: [],
    detailBlocks: [],
    variants: [
      {
        id: VARIANT_ID,
        name: "Default",
        position: 0,
        sku: {
          id: SKU_ID,
          skuCode: "PREVIEW-1",
          status: "ACTIVE",
          isBundle: false,
          bundleVersion: 0,
          price: "1200",
          compareAtPrice: null,
          supplierSku: null,
          supplierCost: null,
          costCurrency: null,
          landedCost: null,
          productWidth: null, productDepth: null, productHeight: null, productWeight: null,
          packageWidth: null,
          packageHeight: null,
          packageDepth: null,
          packageWeight: null,
          volumetricWeight: null,
          onHand: 4,
          reserved: 0,
          availableInventory: 4,
        },
      },
    ],
    ...overrides,
  };
}

function category(overrides: Partial<AdminCategoryNode> = {}): AdminCategoryNode {
  return {
    id: CATEGORY_ID,
    parentId: null,
    name: "Preview category",
    slug: "preview-category",
    sortOrder: 0,
    imageUrl: "https://example.com/category.jpg",
    status: "ACTIVE",
    heroStyle: null,
    children: [],
    ...overrides,
  };
}

function section(
  type: HomepageSection["type"],
  patch: Partial<HomepageSection> = {},
): HomepageSection {
  return {
    id: crypto.randomUUID(),
    type,
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: 0,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload: {},
    ...patch,
  } as HomepageSection;
}

function documentWith(...sections: HomepageSection[]): HomepageDocument {
  return {
    ...emptyDocument(),
    sections,
  };
}

function productGrid(enabled = true): HomepageSection {
  return section("PRODUCT_GRID", {
    title: "Selected products",
    enabled,
    products: [{ productId: PRODUCT_ID, sortOrder: 0, badge: null }],
    payload: { columns: 4 },
  });
}

function categoryTiles(enabled = true): HomepageSection {
  return section("CATEGORY_TILES", {
    title: "Selected categories",
    enabled,
    payload: { categoryIds: [CATEGORY_ID] },
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("HomepageLivePreview", () => {
  beforeEach(() => {
    getProduct.mockReset();
    tracking.track.mockClear();
    tracking.trackCustom.mockClear();
    listCategories.mockReset();
    listCategories.mockResolvedValue([]);
    listCollections.mockReset();
    listCollections.mockResolvedValue({ items: [] });
  });

  it("wraps only content in the selected appearance and supplies its gap defaults", async () => {
    listCategories.mockResolvedValue([category()]);
    const document = documentWith(categoryTiles());
    document.appearance = "STUDIO_V3";
    const { container, rerender } = render(<HomepageLivePreview document={document} device="tablet" selectedSectionId={null} />);
    await flush();
    const root = container.querySelector('[data-homepage-appearance="STUDIO_V3"]');
    expect(root).toHaveAttribute("data-homepage-device", "tablet");
    expect(screen.getByRole("heading", { name: "Selected categories" }).closest("[data-homepage-appearance]")).toBe(root);
    const link = screen.getByRole("link", { name: /^Preview category/ });
    expect(link.parentElement).toHaveStyle({ gap: "24px" });
    expect(container.querySelector('[data-homepage-section-type="CATEGORY_TILES"]')).not.toBeNull();
    expect(container.querySelector("header")?.closest("[data-homepage-appearance]")).toBeNull();
    expect(container.querySelector("footer")?.closest("[data-homepage-appearance]")).toBeNull();
    rerender(<HomepageLivePreview document={{ ...document, appearance: undefined }} device="tablet" selectedSectionId={null} />);
    expect(container.querySelector("[data-homepage-appearance]")).toBeNull();
    expect(screen.getByRole("link", { name: /^Preview category/ }).parentElement?.style.gap).toBe("");
  });

  it("hydrates custom navigation from active category and collection targets without global covers", async () => {
    listCategories.mockResolvedValue([category({ imageUrl: null })]);
    listCollections.mockResolvedValue({ items: [{ id: CATEGORY_ID, name: "Small spaces", slug: "small-spaces", status: "ACTIVE", heroImage: null }] });
    const entries: HomepageNavigationEntry[] = [
      { id: "first", imageUrl: "/uploads/category.jpg", link: { type: "CATEGORY", id: CATEGORY_ID } },
      { id: "second", imageUrl: "/uploads/collection.jpg", label: " Our collection ", link: { type: "COLLECTION", id: CATEGORY_ID } },
      { id: "third", imageUrl: "/uploads/repeat.jpg", link: { type: "CATEGORY", id: CATEGORY_ID } },
    ];
    const navigation = section("CATEGORY_TILES", { payload: { entries, presentation: "CIRCLES" } });
    const { container } = render(<StrictMode><HomepageLivePreview document={documentWith(navigation)} device="mobile" selectedSectionId={null} /></StrictMode>);
    await flush();
    const region = container.querySelector('[data-preview-section="CATEGORY_TILES"]')!;
    expect(within(region as HTMLElement).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/categories/preview-category", "/collections/small-spaces", "/categories/preview-category",
    ]);
    expect(within(region as HTMLElement).getByRole("link", { name: "Our collection" })).toBeVisible();
    expect(region.querySelectorAll("img")[0]).toHaveAttribute("src", optimizedUploadImage("/uploads/category.jpg", 1440));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    region.querySelector("a")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(region.querySelector("[data-track-event]")).toBeNull();
    expect(listCategories).toHaveBeenCalledTimes(1);
    expect(listCollections).toHaveBeenCalledTimes(1);
    expect(tracking.track).not.toHaveBeenCalled();
  });

  it("does not substitute a same-id category for a disabled collection and keeps an editor-only notice", async () => {
    listCategories.mockResolvedValue([category()]);
    listCollections.mockResolvedValue({ items: [{ id: CATEGORY_ID, name: "Unavailable collection", slug: "disabled", status: "DISABLED" }] });
    const navigation = section("CATEGORY_TILES", { payload: { entries: [
      { id: "valid", imageUrl: "/uploads/category.jpg", link: { type: "CATEGORY", id: CATEGORY_ID } },
      { id: "invalid", imageUrl: "/uploads/collection.jpg", link: { type: "COLLECTION", id: CATEGORY_ID } },
    ] } });
    const { container } = render(<HomepageLivePreview document={documentWith(navigation)} device="desktop" selectedSectionId={null} />);
    await flush();
    const region = container.querySelector('[data-preview-section="CATEGORY_TILES"]')!;
    expect(region.querySelectorAll("a")).toHaveLength(1);
    expect(region.querySelector("a")).toHaveAttribute("href", "/categories/preview-category");
    expect(region.querySelector('[data-preview-join="navigation"]')).toHaveTextContent("invalid");
    expect(region.querySelector('[href="/collections/disabled"]')).toBeNull();
  });

  it("never requests or revives legacy category ids when entries is explicitly empty", async () => {
    listCategories.mockResolvedValue([category()]);
    const navigation = section("CATEGORY_TILES", { payload: { entries: [], categoryIds: [CATEGORY_ID], presentation: "CIRCLES" } });
    const { container } = render(<HomepageLivePreview document={documentWith(navigation)} device="desktop" selectedSectionId={null} />);
    await flush();
    expect(container.querySelector('[data-preview-section="CATEGORY_TILES"] a')).toBeNull();
    expect(listCategories).not.toHaveBeenCalled();
    expect(listCollections).not.toHaveBeenCalled();
  });

  it("hydrates a collage's own featured product without losing identity or presentation", async () => {
    getProduct.mockResolvedValue(product());
    const ugc = section("UGC", { payload: { entries: [
      { id: "first", name: "", comment: "Supporting sample", imageUrl: "/uploads/a.jpg" },
      { id: "second", name: "", comment: "Featured sample", imageUrl: "/uploads/b.jpg", productId: PRODUCT_ID },
    ], presentation: { layout: "COLLAGE", featuredEntryId: "second", overlay: "STRONG" } } });
    const { container } = render(<HomepageLivePreview document={documentWith(ugc)} device="tablet" selectedSectionId={null} />);
    await flush();
    const featured = container.querySelector<HTMLElement>("[data-ugc-featured]")!;
    expect(featured).toHaveAttribute("data-ugc-entry-id", "second");
    expect(within(featured).getByRole("link", { name: /View Preview product/ })).toHaveAttribute("href", "/products/preview-product");
    expect(featured.querySelector("img")).toHaveAttribute("src", optimizedUploadImage("/uploads/b.jpg", 1440));
    expect(featured).not.toHaveTextContent("Supporting sample");
    expect(container.querySelector('[data-ugc-layout="collage"]')).toHaveAttribute("data-device", "tablet");
    expect(featured.querySelector("[data-track-event]")).toBeNull();
    expect(getProduct).toHaveBeenCalledExactlyOnceWith(PRODUCT_ID);
  });

  it("resolves merged style for the selected canvas device even for legacy module renderers", async () => {
    const usp = section("USP", { payload: { items: [{ icon: "truck", label: "Nationwide delivery" }] },
      style: { paddingTop: 22, overrides: { mobile: { paddingTop: 0 } } } });
    const draft = documentWith(usp);
    draft.defaults = { paddingTop: 100, overrides: { mobile: { paddingTop: 8, paddingBottom: 0, textColor: "#123456" } } };
    const { container, rerender } = render(<HomepageLivePreview document={draft} device="mobile" selectedSectionId={null} />);
    await flush();
    const shell = () => container.querySelector('[data-preview-section="USP"] section');
    expect(shell()).toHaveStyle({ paddingTop: "0px", paddingBottom: "0px", color: "#123456" });
    rerender(<HomepageLivePreview document={{ ...draft, sections: [{ ...usp, style: { paddingTop: 22 } }] }} device="mobile" selectedSectionId={null} />);
    await flush();
    expect(shell()).toHaveStyle({ paddingTop: "22px", paddingBottom: "0px" });
  });

  it("hydrates product joins through Strict Mode effect replay without a second request", async () => {
    getProduct.mockResolvedValue(product());
    render(<StrictMode><HomepageLivePreview document={documentWith(productGrid())} device="desktop" selectedSectionId={null} /></StrictMode>);
    await flush();
    expect(screen.getByRole("heading", { name: "Preview product" })).toBeVisible();
    expect(screen.queryByText("Selected products are unavailable in this preview.")).toBeNull();
    expect(getProduct).toHaveBeenCalledTimes(1);
  });

  it("hydrates categories through Strict Mode effect replay without a second request", async () => {
    listCategories.mockResolvedValue([category()]);
    render(<StrictMode><HomepageLivePreview document={documentWith(categoryTiles())} device="desktop" selectedSectionId={null} /></StrictMode>);
    await flush();
    expect(screen.getByText("Preview category")).toBeVisible();
    expect(screen.queryByText("Selected categories are unavailable in this preview.")).toBeNull();
    expect(listCategories).toHaveBeenCalledTimes(1);
  });

  it("keeps a hydrated multi-SKU grid inert without any cart provider", async () => {
    const source = product();
    const blueVariantId = "00000000-0000-7000-8000-000000000713";
    const blueValueId = "00000000-0000-7000-8000-000000000716";
    source.catalogGraphVersion = 1;
    source.defaultDisplayVariantId = blueVariantId;
    source.options = [{ id: OPTION_ID, kind: "COLOR", name: "Color", position: 0,
      presentation: "TEXT", isMediaDriver: true, isActive: true, values: [
        { id: VALUE_ID, label: "Red", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null, isActive: true },
        { id: blueValueId, label: "Blue", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null, isActive: true },
      ] }];
    source.variants = [
      { ...source.variants[0]!, name: "Red", combinationKey: `${OPTION_ID}:${VALUE_ID}`,
        optionValues: [{ optionId: OPTION_ID, optionValueId: VALUE_ID }], hasReferences: false },
      { ...source.variants[0]!, id: blueVariantId, name: "Blue", position: 1,
        combinationKey: `${OPTION_ID}:${blueValueId}`, optionValues: [{ optionId: OPTION_ID, optionValueId: blueValueId }], hasReferences: false,
        sku: { ...source.variants[0]!.sku!, id: "00000000-0000-7000-8000-000000000714" } },
    ];
    getProduct.mockResolvedValue(source);
    const add = vi.spyOn(api, "addToCart");
    const { container } = render(<HomepageLivePreview document={documentWith(productGrid())} device="desktop" selectedSectionId={null} />);
    await flush();
    const article = container.querySelector("article")!;
    expect(within(article).queryAllByRole("link")).toHaveLength(0);
    expect(container.querySelector('[data-track-event="ProductClick"]')).toBeNull();
    for (const button of within(article).getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(within(article).getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    expect(within(article).getByRole("button", { name: "Red" })).toHaveAttribute("aria-pressed", "false");
    expect(add).not.toHaveBeenCalled();
    expect(tracking.track).not.toHaveBeenCalled();
    expect(tracking.trackCustom).not.toHaveBeenCalled();
    expect(getProduct).toHaveBeenCalledTimes(1);
    add.mockRestore();
  });

  it("does not retry a failed product lookup until its id leaves and re-enters the document", async () => {
    let holdSecondRequest: (() => void) | undefined;
    getProduct
      .mockRejectedValueOnce(new Error("missing"))
      .mockImplementationOnce(
        () =>
          new Promise<AdminProduct>((resolve) => {
            holdSecondRequest = () => resolve(product());
          }),
      );

    render(
      <HomepageLivePreview
        document={documentWith(productGrid())}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    await flush();

    expect(getProduct).toHaveBeenCalledTimes(1);
    holdSecondRequest?.();
  });

  it("ignores empty hotspot product ids", async () => {
    getProduct.mockRejectedValue(new Error("empty id must not be requested"));
    const room = section("ROOM_INSPIRATION", {
      payload: {
        scenes: [
          {
            id: "scene001",
            imageUrl: "https://example.com/room.jpg",
            hotspots: [{ productId: "", xPct: 50, yPct: 50 }],
          },
        ],
      },
    });

    render(
      <HomepageLivePreview
        document={documentWith(room)}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    await flush();

    expect(getProduct).not.toHaveBeenCalled();
  });

  it("hydrates only enabled sections", async () => {
    getProduct.mockResolvedValue(product());
    listCategories.mockResolvedValue([category()]);

    render(
      <HomepageLivePreview
        document={documentWith(productGrid(false), categoryTiles(false))}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    await flush();

    expect(getProduct).not.toHaveBeenCalled();
    expect(listCategories).not.toHaveBeenCalled();
  });

  it("does not restart catalog hydration for unrelated document edits", async () => {
    let resolveProduct: ((value: AdminProduct) => void) | undefined;
    getProduct.mockImplementation(
      () =>
        new Promise<AdminProduct>((resolve) => {
          resolveProduct = resolve;
        }),
    );
    listCategories.mockResolvedValue([category()]);
    const initial = documentWith(productGrid(), categoryTiles());
    const { rerender } = render(
      <HomepageLivePreview
        document={initial}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    await flush();

    rerender(
      <HomepageLivePreview
        document={{
          ...initial,
          announcement: {
            ...initial.announcement,
            rotationMs: initial.announcement.rotationMs + 1,
          },
        }}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    await flush();

    expect(getProduct).toHaveBeenCalledTimes(1);
    expect(listCategories).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveProduct?.(product());
      await Promise.resolve();
    });
  });

  it("matches storefront product and category eligibility", async () => {
    getProduct.mockResolvedValue(
      product({
        variants: [
          {
            id: VARIANT_ID,
            name: "Out of stock",
            position: 0,
            sku: {
              ...product().variants[0].sku!,
              availableInventory: 0,
              onHand: 0,
            },
          },
        ],
      }),
    );
    listCategories.mockResolvedValue([category({ imageUrl: null })]);

    render(
      <HomepageLivePreview
        document={documentWith(productGrid(), categoryTiles())}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    await flush();

    const preview = document.querySelector("[data-homepage-live-preview]");
    expect(within(preview as HTMLElement).queryByText("Preview product")).toBeNull();
    expect(within(preview as HTMLElement).queryByText("Preview category")).toBeNull();
    expect(screen.getByText("Selected products are unavailable in this preview.")).toBeVisible();
    expect(screen.getByText("Selected categories are unavailable in this preview.")).toBeVisible();
  });

  it("uses the saved independent variant card cover instead of scoped gallery media", async () => {
    getProduct.mockResolvedValue(
      product({
        catalogGraphVersion: 1,
        defaultDisplayVariantId: VARIANT_ID,
        images: [
          {
            id: "00000000-0000-7000-8000-000000000707",
            url: "/shared.jpg",
            type: "IMAGE",
            altText: null,
            sortOrder: 0,
          },
        ],
        options: [
          {
            id: OPTION_ID,
            kind: "COLOR",
            name: "Color",
            position: 0,
            presentation: "IMAGE",
            isMediaDriver: true,
            isActive: true,
            values: [
              {
                id: VALUE_ID,
                label: "Walnut",
                position: 0,
                swatchHex: null,
                thumbnailUrl: null,
                thumbnailAlt: null,
                isActive: true,
              },
            ],
          },
        ],
        variants: [
          {
            id: VARIANT_ID,
            name: "Walnut",
            position: 0,
            cardMedia: {
              cover: { type: "IMAGE", url: "/independent-card.jpg", altText: "Independent card cover" },
              hover: { type: "IMAGE", url: "/independent-hover.jpg", altText: "Independent hover" },
            },
            combinationKey: VALUE_ID,
            optionValues: [{ optionId: OPTION_ID, optionValueId: VALUE_ID }],
            sku: {
              ...product().variants[0].sku!,
              supplierId: null,
            },
          },
        ],
        media: [
          {
            id: "00000000-0000-7000-8000-000000000707",
            url: "/shared.jpg",
            type: "IMAGE",
            altText: null,
            sortOrder: 0,
            optionValueId: null,
            variantId: null,
          },
          {
            id: "00000000-0000-7000-8000-000000000708",
            url: "/variant.jpg",
            type: "IMAGE",
            altText: "Variant cover",
            sortOrder: 1,
            optionValueId: null,
            variantId: VARIANT_ID,
          },
        ],
      }),
    );

    render(
      <HomepageLivePreview
        document={documentWith(productGrid())}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    await flush();

    expect(screen.getByRole("img", { name: "Independent card cover" })).toHaveAttribute(
      "src",
      "/independent-card.jpg",
    );
    expect(screen.queryByRole("img", { name: "Variant cover" })).not.toBeInTheDocument();
  });

  it("normalizes malformed draft payloads before rendering", () => {
    const malformed = section("USP", { title: "Repair me" });
    (malformed as unknown as { payload: unknown }).payload = { items: [null] };

    expect(() =>
      render(
        <HomepageLivePreview
          document={documentWith(malformed)}
          device="desktop"
          selectedSectionId={null}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("Cash On Delivery")).toBeVisible();
  });

  it("prevents storefront links from navigating the editor", () => {
    const solutions = section("SOLUTIONS", {
      payload: {
        items: [
          {
            title: "Small space",
            blurb: "Make every corner work",
            link: "https://example.com/collections/small-space",
          },
        ],
      },
    });
    render(
      <HomepageLivePreview
        document={documentWith(solutions)}
        device="desktop"
        selectedSectionId={null}
      />,
    );

    const link = screen.getByRole("link", { name: /Small space/ });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(link.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("renders promo and countdown banners through the storefront registry with inert links", async () => {
    const promo = section("PROMO_BANNER", {
      title: "Free delivery week",
      payload: { ctaText: "Shop now", ctaLink: "/collections/sale" },
    });
    const countdown = section("COUNTDOWN_BANNER", {
      title: "Flash sale",
      payload: {
        endsAt: new Date(Date.now() + 60_000).toISOString(),
        ctaText: "Grab it",
        ctaLink: "/collections/sale",
      },
    });
    render(
      <HomepageLivePreview
        document={documentWith(promo, countdown)}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    await flush();

    expect(screen.getByText("Free delivery week")).toBeVisible();
    expect(screen.getByText("Flash sale")).toBeVisible();
    expect(screen.getByRole("timer")).toBeVisible();

    const link = screen.getByRole("link", { name: "Shop now" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(link.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("hides an expired countdown banner in the live preview", async () => {
    const countdown = section("COUNTDOWN_BANNER", {
      title: "Expired flash sale",
      payload: { endsAt: new Date(Date.now() - 1000).toISOString() },
    });
    render(
      <HomepageLivePreview
        document={documentWith(countdown)}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    await flush();

    expect(screen.queryByText("Expired flash sale")).toBeNull();
  });

  it("uses the selected preview device instead of outer-window breakpoints", async () => {
    listCategories.mockResolvedValue([category()]);
    const draft = documentWith(categoryTiles());
    const { rerender } = render(
      <HomepageLivePreview
        document={draft}
        device="mobile"
        selectedSectionId={null}
      />,
    );
    await flush();

    const categorySection = document.querySelector('[data-preview-section="CATEGORY_TILES"]');
    const grid = categorySection?.querySelector(".grid");
    expect(grid).toHaveClass("grid-cols-2");
    expect(grid).not.toHaveClass("md:grid-cols-3", "lg:grid-cols-6");

    rerender(
      <HomepageLivePreview
        document={draft}
        device="desktop"
        selectedSectionId={null}
      />,
    );
    expect(grid).toHaveClass("grid-cols-6");
    expect(grid).not.toHaveClass("md:grid-cols-3", "lg:grid-cols-6");
  });

  it("renders the unsaved announcement, shared shell and fixed chrome for every device", () => {
    const draft = documentWith(section("CONFIDENCE"));
    draft.announcement = {
      enabled: true,
      rotationMs: 5000,
      items: [
        {
          id: "00000000-0000-7000-8000-000000000799",
          text: "Unsaved announcement",
          link: {
            type: "PRODUCT",
            id: "11111111-2222-4333-8444-555555555555",
          },
          linkLabel: "Shop now",
          textColor: "#FFFFFF",
          backgroundColor: "#6B4F3A",
          schedule: { publishAt: null, unpublishAt: null },
          enabled: true,
          sortOrder: 0,
        },
      ],
    };
    const view = render(
      <HomepageLivePreview
        document={draft}
        device="desktop"
        selectedSectionId={null}
      />,
    );

    const preview = view.container.querySelector(
      "[data-homepage-live-preview]",
    ) as HTMLElement;
    expect(within(preview).getByText("Unsaved announcement")).toBeVisible();
    expect(within(preview).getByText("Shop now")).toBeVisible();
    expect(preview.querySelector("header")).not.toBeNull();
    expect(preview.querySelector("[data-preview-section-id]")).not.toBeNull();
    expect(preview.querySelector("footer")).not.toBeNull();
    expect(preview.querySelector("[data-preview-cart-drawer='closed']")).not.toBeNull();
    expect(preview.querySelector("[data-preview-messenger]")).not.toBeNull();
    expect(preview.querySelector("[data-preview-back-to-top]")).not.toBeNull();
    expect(preview.querySelector("[data-preview-mobile-tab-bar]")).toBeNull();
    expect(within(preview).queryByRole("link")).toBeNull();

    const scrollTo = vi.fn();
    preview.scrollTo = scrollTo;
    view.rerender(
      <HomepageLivePreview
        document={draft}
        device="mobile"
        selectedSectionId={ANNOUNCEMENT_SELECTION_ID}
      />,
    );
    expect(preview.querySelector("[data-preview-mobile-tab-bar]")).not.toBeNull();
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 0 });
  });

  it("restores storefront theme tokens inside the admin shell", () => {
    render(
      <div className="admin-shell">
        <HomepageLivePreview
          document={documentWith(section("CONFIDENCE"))}
          device="desktop"
          selectedSectionId={null}
        />
      </div>,
    );

    expect(document.querySelector("[data-homepage-live-preview]")).toHaveClass(
      "storefront-theme",
    );
  });
});
