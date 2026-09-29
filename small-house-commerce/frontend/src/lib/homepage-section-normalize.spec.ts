import { describe, expect, it } from "vitest";
import { emptyDocument, type HomepageSection, type NonHeroHomepageSection } from "@/lib/homepage-document";
import { SECTION_TYPES } from "@/lib/homepage-section-factory";
import { SECTION_EDITOR_REGISTRY } from "@/components/admin/homepage/section-editor-registry";
import { normalizeSectionForEditor } from "@/lib/homepage-section-normalize";

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
    };

    for (const type of SECTION_TYPES) {
      const section = malformedSection(type);
      expect(normalizeSectionForEditor(section).payload).toEqual(expected[type]);
      expect(section.payload).toEqual({});
    }
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

  it("leaves HERO documents outside the non-HERO editor normalization path", () => {
    const hero = emptyDocument().sections[0];
    const normalized = normalizeSectionForEditor(hero);

    expect(normalized).toEqual(hero);
    expect(normalized).not.toBe(hero);
  });
});
