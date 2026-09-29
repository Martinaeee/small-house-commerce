import { describe, expect, it } from "vitest";
import {
  SECTION_TYPES,
  defaultSection,
  insertSection,
  updateSectionPayload,
} from "@/lib/homepage-section-factory";
import { emptyDocument, type HomepageDocument } from "@/lib/homepage-document";

const PRODUCT_ID = "00000000-0000-7000-8000-000000000101";
const HERO_ID = "00000000-0000-7000-8000-000000000001";
const USP_ID = "00000000-0000-7000-8000-000000000102";
const GRID_ID = "00000000-0000-7000-8000-000000000103";
const NEW_ID = "00000000-0000-7000-8000-000000000104";
const UGC_ID = "00000000-0000-7000-8000-000000000105";

function documentFixture(): HomepageDocument {
  const base = emptyDocument();
  const usp = defaultSection("USP", USP_ID, 10);
  const grid = defaultSection("PRODUCT_GRID", GRID_ID, 20);
  grid.products = [{ productId: PRODUCT_ID, sortOrder: 0, badge: "Featured" }];

  return {
    ...base,
    sections: [...base.sections, usp, grid],
  };
}

describe("homepage section factories", () => {
  it.each(SECTION_TYPES)("creates a backend-valid default for %s", (type) => {
    const section = defaultSection(
      type,
      "00000000-0000-7000-8000-000000000106",
      20,
    );

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

  it("rejects section ids that are not UUIDs and sort orders outside the backend bounds", () => {
    expect(() => defaultSection("USP", "not-a-uuid", 20)).toThrow(
      "Section id must be a UUID",
    );
    expect(() => defaultSection("USP", NEW_ID, -1)).toThrow(
      "Section sortOrder must be an integer from 0 to 999",
    );
    expect(() => defaultSection("USP", NEW_ID, 1.5)).toThrow(
      "Section sortOrder must be an integer from 0 to 999",
    );
    expect(() => defaultSection("USP", NEW_ID, 1000)).toThrow(
      "Section sortOrder must be an integer from 0 to 999",
    );
  });
  it("does not insert a section when backend sort-order capacity is full", () => {
    const document = emptyDocument();
    for (let index = 1; index < 100; index += 1) {
      document.sections.push(
        defaultSection(
          "PRODUCT_GRID",
          `00000000-0000-7000-8000-${String(1000 + index).padStart(12, "0")}`,
          index * 10,
        ),
      );
    }

    const next = insertSection(
      document,
      defaultSection(
        "USP",
        "00000000-0000-7000-8000-000000002000",
        999,
      ),
    );

    expect(next).toBe(document);
    expect(next.sections).toHaveLength(100);
    expect(Math.max(...next.sections.map(({ sortOrder }) => sortOrder))).toBe(
      990,
    );
  });

  it("inserts after the selected section and renumbers only section sortOrder", () => {
    const document = documentFixture();
    const sourceGrid = document.sections.find(({ id }) => id === GRID_ID);
    const next = insertSection(
      document,
      defaultSection("USP", NEW_ID, 0),
      document.sections[0].id,
    );

    expect(next.sections.map(({ id }) => id)).toEqual([
      HERO_ID,
      NEW_ID,
      USP_ID,
      GRID_ID,
    ]);
    expect(next.sections.map(({ sortOrder }) => sortOrder)).toEqual([
      0, 10, 20, 30,
    ]);
    expect(next.sections.find(({ id }) => id === GRID_ID)?.payload).toEqual(
      sourceGrid?.payload,
    );
    expect(next.sections.find(({ id }) => id === GRID_ID)?.products).toEqual(
      sourceGrid?.products,
    );
    expect(document.sections.map(({ id }) => id)).toEqual([
      HERO_ID,
      USP_ID,
      GRID_ID,
    ]);
  });


  it("deep-clones inserted payloads and product rows", () => {
    const document = documentFixture();
    const sourceGrid = document.sections.find(({ id }) => id === GRID_ID)!;
    const next = insertSection(document, sourceGrid, HERO_ID);
    const insertedGrid = next.sections.find(
      ({ id }, index) => id === GRID_ID && index !== document.sections.findIndex(({ id: currentId }) => currentId === GRID_ID),
    )!;

    insertedGrid.products.push({ productId: PRODUCT_ID, sortOrder: 1, badge: null });
    if (insertedGrid.type === "PRODUCT_GRID") insertedGrid.payload.columns = 4;

    expect(sourceGrid.products).toHaveLength(1);
    expect(sourceGrid.payload).toEqual({});
  });
  it("appends when no section is selected", () => {
    const document = documentFixture();
    const next = insertSection(document, defaultSection("UGC", UGC_ID, 0));

    expect(next.sections.at(-1)?.id).toBe(UGC_ID);
    expect(next.sections.at(-1)?.sortOrder).toBe(30);
  });


  it("updates a typed payload without changing section products or siblings", () => {
    const document = documentFixture();
    const next = updateSectionPayload(document, USP_ID, "USP", (payload) => ({
      ...payload,
      items: [{ label: "Fast delivery" }],
    }));

    expect(next).not.toBe(document);
    expect(next.sections.find(({ id }) => id === USP_ID)?.payload).toEqual({
      items: [{ label: "Fast delivery" }],
    });
    expect(next.sections.find(({ id }) => id === USP_ID)?.products).toBe(
      document.sections.find(({ id }) => id === USP_ID)?.products,
    );
    expect(next.sections.find(({ id }) => id === GRID_ID)?.payload).toEqual(
      document.sections.find(({ id }) => id === GRID_ID)?.payload,
    );
    expect(next.sections.find(({ id }) => id === GRID_ID)?.products).toEqual(
      document.sections.find(({ id }) => id === GRID_ID)?.products,
    );
  });

  it("detaches a payload before passing it to a mutating updater", () => {
    const document = documentFixture();
    const next = updateSectionPayload(document, USP_ID, "USP", (payload) => {
      payload.items?.push({ label: "Mutated" });
      return payload;
    });

    expect(next.sections.find(({ id }) => id === USP_ID)?.payload).toEqual({
      items: [{ label: "Mutated" }],
    });
    expect(document.sections.find(({ id }) => id === USP_ID)?.payload).toEqual({
      items: [],
    });
  });

  it("returns the original document when the requested type is HERO", () => {
    const document = documentFixture();
    const next = updateSectionPayload(document, HERO_ID, "USP", (payload) => payload);

    expect(next).toBe(document);
  });
  it("returns the original document when the requested type does not match", () => {
    const document = documentFixture();
    const next = updateSectionPayload(
      document,
      USP_ID,
      "PRODUCT_GRID",
      (payload) => ({ ...payload, columns: 4 }),
    );

    expect(next).toBe(document);
  });

  it("returns the original document for an unknown section id", () => {
    const document = documentFixture();
    const next = updateSectionPayload(document, "missing", "USP", (payload) => payload);

    expect(next).toBe(document);
  });
});
