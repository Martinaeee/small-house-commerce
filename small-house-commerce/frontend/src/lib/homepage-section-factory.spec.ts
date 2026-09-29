import { describe, expect, it } from "vitest";
import {
  SECTION_TYPES,
  defaultSection,
  insertSection,
  updateSectionPayload,
} from "@/lib/homepage-section-factory";
import { emptyDocument, type HomepageDocument } from "@/lib/homepage-document";

const PRODUCT_ID = "00000000-0000-7000-8000-000000000101";

function documentFixture(): HomepageDocument {
  const base = emptyDocument();
  const usp = defaultSection("USP", "usp", 10);
  const grid = defaultSection("PRODUCT_GRID", "grid", 20);
  grid.products = [{ productId: PRODUCT_ID, sortOrder: 0, badge: "Featured" }];

  return {
    ...base,
    sections: [...base.sections, usp, grid],
  };
}

describe("homepage section factories", () => {
  it.each(SECTION_TYPES)("creates a backend-valid default for %s", (type) => {
    const section = defaultSection(type, `section-${type}`, 20);

    expect(section.type).toBe(type);
    expect(section.title).toBeNull();
    expect(section.subtitle).toBeNull();
    expect(section.enabled).toBe(true);
    expect(section.sortOrder).toBe(20);
    expect(section.products).toEqual([]);
    expect(section).not.toHaveProperty("style");

    switch (type) {
      case "USP":
        expect(section.payload).toEqual({ items: [] });
        break;
      case "CATEGORY_TILES":
        expect(section.payload).toEqual({ categoryIds: [] });
        break;
      case "PRODUCT_GRID":
        expect(section.payload).toEqual({});
        break;
      case "SOLUTIONS":
        expect(section.payload).toEqual({ items: [] });
        break;
      case "PRODUCT_STORY":
        expect(section.payload).toEqual({});
        break;
      case "ROOM_INSPIRATION":
        expect(section.payload).toEqual({ scenes: [] });
        break;
      case "UGC":
        expect(section.payload).toEqual({ entries: [] });
        break;
      case "BRAND_STORY":
      case "CONFIDENCE":
        expect(section.payload).toEqual({ bullets: [] });
        break;
    }
  });

  it("inserts after the selected section and renumbers only section sortOrder", () => {
    const document = documentFixture();
    const sourceGrid = document.sections.find(({ id }) => id === "grid");
    const next = insertSection(
      document,
      defaultSection("USP", "new", 0),
      document.sections[0].id,
    );

    expect(next.sections.map(({ id }) => id)).toEqual([
      document.sections[0].id,
      "new",
      "usp",
      "grid",
    ]);
    expect(next.sections.map(({ sortOrder }) => sortOrder)).toEqual([
      0, 10, 20, 30,
    ]);
    expect(next.sections.find(({ id }) => id === "grid")?.payload).toEqual(
      sourceGrid?.payload,
    );
    expect(next.sections.find(({ id }) => id === "grid")?.products).toEqual(
      sourceGrid?.products,
    );
    expect(document.sections.map(({ id }) => id)).toEqual([
      document.sections[0].id,
      "usp",
      "grid",
    ]);
  });

  it("appends when no section is selected", () => {
    const document = documentFixture();
    const next = insertSection(document, defaultSection("UGC", "ugc", 0));

    expect(next.sections.at(-1)?.id).toBe("ugc");
    expect(next.sections.at(-1)?.sortOrder).toBe(30);
  });

  it("updates a typed payload without changing section products or siblings", () => {
    const document = documentFixture();
    const next = updateSectionPayload(document, "usp", (payload) => ({
      ...payload,
      items: [{ label: "Fast delivery" }],
    }));

    expect(next).not.toBe(document);
    expect(next.sections.find(({ id }) => id === "usp")?.payload).toEqual({
      items: [{ label: "Fast delivery" }],
    });
    expect(next.sections.find(({ id }) => id === "usp")?.products).toBe(
      document.sections.find(({ id }) => id === "usp")?.products,
    );
    expect(next.sections.find(({ id }) => id === "grid")?.payload).toEqual(
      document.sections.find(({ id }) => id === "grid")?.payload,
    );
    expect(next.sections.find(({ id }) => id === "grid")?.products).toEqual(
      document.sections.find(({ id }) => id === "grid")?.products,
    );
  });

  it("returns the original document for an unknown section id", () => {
    const document = documentFixture();
    const next = updateSectionPayload(document, "missing", (payload) => payload);

    expect(next).toBe(document);
  });
});
