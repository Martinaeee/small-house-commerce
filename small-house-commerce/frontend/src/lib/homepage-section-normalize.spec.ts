import { describe, expect, it } from "vitest";
import { emptyDocument, type HomepageSection, type NonHeroHomepageSection } from "@/lib/homepage-document";
import { SECTION_TYPES } from "@/lib/homepage-section-factory";
import { SECTION_EDITOR_REGISTRY } from "@/components/admin/homepage/section-editor-registry";
import { normalizeSectionForEditor, readCategoryTilesPayload, readUgcPayload } from "@/lib/homepage-section-normalize";

const SECTION_ID = "00000000-0000-7000-8000-000000000901";

function malformedSection(
  type: NonHeroHomepageSection["type"],
): HomepageSection {
  return {
    id: SECTION_ID,
    type,
    title: "Stored title",
    subtitle: "Stored subtitle",
    enabled: false,
    sortOrder: 40,
    schedule: {
      publishAt: "2026-10-01T00:00:00.000Z",
      unpublishAt: "2026-10-02T00:00:00.000Z",
    },
    products: [
      { productId: "product-1", sortOrder: 0, badge: "Featured" },
    ],
    style: { backgroundColor: "#112233", customKey: "keep" },
    payload: {},
  } as HomepageSection;
}

describe("homepage section editor registry", () => {
  it("defines one typed editor definition for every non-HERO section type", () => {
    expect(Object.keys(SECTION_EDITOR_REGISTRY)).toEqual(SECTION_TYPES);
    expect(
      SECTION_TYPES.map((type) => SECTION_EDITOR_REGISTRY[type].labelKey),
    ).toEqual(
      SECTION_TYPES.map((type) => `homepage_builder_section_type_${type}`),
    );
    expect(
      SECTION_TYPES.map((type) => SECTION_EDITOR_REGISTRY[type].descriptionKey),
    ).toEqual(
      SECTION_TYPES.map((type) => `homepage_builder_section_description_${type}`),
    );
    expect(
      new Set(SECTION_TYPES.map((type) => SECTION_EDITOR_REGISTRY[type].editor)).size,
    ).toBe(SECTION_TYPES.length);
  });

  it("creates a typed default with the requested identity and sort order", () => {
    for (const [index, type] of SECTION_TYPES.entries()) {
      const section = SECTION_EDITOR_REGISTRY[type].createDefault(
        SECTION_ID,
        index * 10,
      );
      expect(section).toMatchObject({
        id: SECTION_ID,
        type,
        sortOrder: index * 10,
        enabled: true,
        title: null,
        subtitle: null,
        schedule: { publishAt: null, unpublishAt: null },
        products: [],
      });
      expect(section.payload).toBeDefined();
    }
  });
});

describe("normalizeSectionForEditor", () => {
  it("exports read-only content parsers with the same field-preservation contract", () => {
    const navigation = { entries: [], presentation: "CIRCLES", layout: { gap: 0 } };
    const ugc = { entries: [{ id: SECTION_ID, name: "", comment: "" }], presentation: { layout: "COLLAGE", showQuote: false, overlay: "SOFT" } };
    const before = structuredClone({ navigation, ugc });
    expect(readCategoryTilesPayload(navigation)).toEqual(navigation);
    expect(readUgcPayload(ugc)).toEqual(ugc);
    expect({ navigation, ugc }).toEqual(before);
    expect(readCategoryTilesPayload(null)).toEqual({ categoryIds: [] });
    expect(readUgcPayload(null)).toEqual({ entries: [] });
  });

  it("retains UGC identities and presentation without generating or mutating data", () => {
    const section = malformedSection("UGC");
    section.payload = {
      entries: [{ id: SECTION_ID, imageUrl: "/uploads/e2e/home.jpg", name: "", comment: "Sample layout text" }],
      presentation: { layout: "COLLAGE", featuredEntryId: SECTION_ID, showQuote: false, overlay: "STRONG" },
    };
    const before = structuredClone(section);
    expect(normalizeSectionForEditor(section).payload).toEqual(section.payload);
    expect(section).toEqual(before);
  });

  it("retains navigation mode, identities, targets, images and sparse layout", () => {
    const section = malformedSection("CATEGORY_TILES");
    section.payload = {
      entries: [{ id: SECTION_ID, link: { type: "COLLECTION", id: SECTION_ID }, imageUrl: "/uploads/e2e/home.jpg", label: "Rooms" }],
      presentation: "CIRCLES", layout: { gap: 0, overrides: { mobile: { columns: 2 } } },
    };
    const before = structuredClone(section);
    expect(normalizeSectionForEditor(section).payload).toEqual(before.payload);
    expect(section).toEqual(before);
  });

  it("never revives categoryIds when the explicit entries list is empty", () => {
    const section = malformedSection("CATEGORY_TILES");
    section.payload = { categoryIds: [SECTION_ID], entries: [], presentation: "TILES" };
    expect(normalizeSectionForEditor(section).payload).toEqual({ entries: [], presentation: "TILES" });
  });

  it("does not generate identities or presentation for old cards", () => {
    const section = malformedSection("UGC");
    section.payload = { entries: [{ name: "", comment: "" }] };
    expect(normalizeSectionForEditor(section).payload).toEqual(section.payload);
    expect(section.payload).not.toHaveProperty("presentation");
  });
  it.each(["CATEGORY_TILES", "PRODUCT_GRID", "PRODUCT_STORY"] as const)(
    "preserves %s sparse responsive settings when reopening the editor", (type) => {
      const section = malformedSection(type);
      section.payload = { layout: { overrides: { mobile: { gap: 8 } } } };
      const result = normalizeSectionForEditor(section);
      expect(result.payload).toHaveProperty("layout", { overrides: { mobile: { gap: 8 } } });
      expect(result.payload).not.toHaveProperty("layout.overrides.tablet");
    },
  );
  it("fills safe payload defaults without changing the stored section", () => {
    const original = malformedSection("USP");
    const before = structuredClone(original);

    const normalized = normalizeSectionForEditor(original);

    expect(original).toEqual(before);
    expect(normalized).not.toBe(original);
    expect(normalized).toMatchObject({
      id: SECTION_ID,
      type: "USP",
      title: "Stored title",
      subtitle: "Stored subtitle",
      enabled: false,
      sortOrder: 40,
      schedule: before.schedule,
      products: before.products,
      style: before.style,
    });
    expect(normalized.payload).toEqual({ items: [] });
  });

  it("normalizes every legacy optional payload to a render-safe typed shape", () => {
    const expected: Record<NonHeroHomepageSection["type"], Record<string, unknown>> = {
      USP: { items: [] },
      CATEGORY_TILES: { categoryIds: [] },
      PRODUCT_GRID: { columns: 4 },
      SOLUTIONS: { items: [] },
      PRODUCT_STORY: {},
      ROOM_INSPIRATION: { scenes: [] },
      UGC: { entries: [] },
      BRAND_STORY: { bullets: [] },
      CONFIDENCE: { bullets: [] },
      PROMO_BANNER: {},
      COUNTDOWN_BANNER: { endsAt: null },
    };

    for (const type of SECTION_TYPES) {
      const section = malformedSection(type);
      expect(normalizeSectionForEditor(section).payload).toEqual(expected[type]);
      expect(section.payload).toEqual({});
    }
  });

  it("keeps valid banner payload values and drops malformed ones", () => {
    const promo = malformedSection("PROMO_BANNER") as Extract<
      HomepageSection,
      { type: "PROMO_BANNER" }
    >;
    promo.payload = {
      ctaText: "Shop now",
      ctaLink: "/collections/sale",
    };
    expect(normalizeSectionForEditor(promo).payload).toEqual({
      ctaText: "Shop now",
      ctaLink: "/collections/sale",
    });

    promo.payload = {
      ctaText: 42,
      ctaLink: {},
      imageUrl: "/uploads/catalog/banner.jpg",
    } as unknown as typeof promo.payload;
    expect(normalizeSectionForEditor(promo).payload).toEqual({});

    const countdown = malformedSection("COUNTDOWN_BANNER") as Extract<
      HomepageSection,
      { type: "COUNTDOWN_BANNER" }
    >;
    countdown.payload = {
      endsAt: "2026-12-31T23:59:00.000Z",
      ctaText: "Ends soon",
    };
    expect(normalizeSectionForEditor(countdown).payload).toEqual({
      endsAt: "2026-12-31T23:59:00.000Z",
      ctaText: "Ends soon",
    });

    countdown.payload = {
      endsAt: "not-a-date",
      ctaText: "Go",
    } as unknown as typeof countdown.payload;
    expect(normalizeSectionForEditor(countdown).payload).toEqual({
      endsAt: null,
      ctaText: "Go",
    });
  });

  it("mirrors the backend banner href contract instead of a stricter regex", () => {
    const promo = malformedSection("PROMO_BANNER") as Extract<
      HomepageSection,
      { type: "PROMO_BANNER" }
    >;

    promo.payload = { ctaLink: "HTTPS://EXAMPLE.COM/SALE" };
    expect(normalizeSectionForEditor(promo).payload).toEqual({
      ctaLink: "HTTPS://EXAMPLE.COM/SALE",
    });

    promo.payload = { ctaLink: "https://exa mple.com" };
    expect(normalizeSectionForEditor(promo).payload).toEqual({});

    promo.payload = { ctaLink: "https://example.com\\evil" };
    expect(normalizeSectionForEditor(promo).payload).toEqual({});

    const solutions = malformedSection("SOLUTIONS") as Extract<
      HomepageSection,
      { type: "SOLUTIONS" }
    >;
    solutions.payload = {
      items: [{ title: "Unsafe", link: "https://" }],
    };
    expect(normalizeSectionForEditor(solutions).payload).toEqual({
      items: [{ title: "Unsafe", link: "" }],
    });

    const story = malformedSection("PRODUCT_STORY") as Extract<
      HomepageSection,
      { type: "PRODUCT_STORY" }
    >;
    story.payload = { ctaLink: "/products\\escape" };
    expect(normalizeSectionForEditor(story).payload).toEqual({});
  });

  it("keeps valid optional payload values and unknown style keys", () => {
    const section = malformedSection("PRODUCT_GRID") as Extract<
      HomepageSection,
      { type: "PRODUCT_GRID" }
    >;
    section.payload = { columns: 2 };
    section.style = { backgroundColor: "#123456", customKey: "keep" };

    const normalized = normalizeSectionForEditor(section);

    expect(normalized.payload).toEqual({ columns: 2 });
    expect(normalized.style).toEqual(section.style);
    expect(normalized.style).not.toBe(section.style);
  });

  it("drops malformed known scalar payload values", () => {
    const productStory = malformedSection("PRODUCT_STORY") as Extract<
      HomepageSection,
      { type: "PRODUCT_STORY" }
    >;
    productStory.payload = {
      imageUrl: 123,
      heading: {},
      body: [],
      ctaText: false,
      ctaLink: 42,
      productId: {},
    } as unknown as typeof productStory.payload;

    const room = malformedSection("ROOM_INSPIRATION") as Extract<
      HomepageSection,
      { type: "ROOM_INSPIRATION" }
    >;
    room.payload = {
      imageUrl: 123,
      heading: {},
      body: [],
      scenes: [],
    } as unknown as typeof room.payload;

    const brand = malformedSection("BRAND_STORY") as Extract<
      HomepageSection,
      { type: "BRAND_STORY" }
    >;
    brand.payload = {
      heading: {},
      body: 42,
      bullets: ["valid", 3, null],
    } as unknown as typeof brand.payload;

    expect(normalizeSectionForEditor(productStory).payload).toEqual({});
    expect(normalizeSectionForEditor(room).payload).toEqual({ scenes: [] });
    expect(normalizeSectionForEditor(brand).payload).toEqual({
      bullets: ["valid"],
    });
  });

  it("leaves HERO documents outside the non-HERO editor normalization path", () => {
    const hero = emptyDocument().sections[0];
    const normalized = normalizeSectionForEditor(hero);

    expect(normalized).toEqual(hero);
    expect(normalized).not.toBe(hero);
  });
});
