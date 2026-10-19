import { describe, expect, it } from "vitest";
import { makeCircularNavigation, makeUgcPresentation, resetStudioVisualFields, studioVisualOverrides } from "./homepage-content-actions";
import { emptyDocument } from "./homepage-document";
import { editorReducer, initEditorState } from "./homepage-editor-state";
import { defaultSection } from "./homepage-section-factory";

const categoryId = "00000000-0000-7000-8000-000000000701";
const entryId = "00000000-0000-7000-8000-000000000702";
const sectionId = "00000000-0000-7000-8000-000000000703";

describe("resetStudioVisualFields", () => {
  it("clears only page spacing across devices and leaves all sections and appearance untouched", () => {
    const source = emptyDocument();
    source.appearance = "STUDIO_V3";
    source.defaults = { paddingTop: 48, paddingBottom: 0, backgroundColor: "#F2EFE9", contentWidth: "STANDARD", overrides: { tablet: { paddingBottom: 12, textColor: "#111111" }, mobile: { paddingTop: 0 } } };
    const before = structuredClone(source);
    const result = resetStudioVisualFields(source, { kind: "DEFAULTS" });
    expect(result.defaults).toEqual({ backgroundColor: "#F2EFE9", contentWidth: "STANDARD", overrides: { tablet: { textColor: "#111111" } } });
    expect(result.sections).toEqual(source.sections);
    expect(result.appearance).toBe("STUDIO_V3");
    expect(source).toEqual(before);
  });

  it("clears only the specified module's spacing and real common/device gaps", () => {
    const source = emptyDocument();
    source.defaults = { paddingTop: 40 };
    const section = defaultSection("CATEGORY_TILES", sectionId, 10);
    section.style = { paddingTop: 0, textColor: "#112233", contentWidth: "NARROW", overrides: { tablet: { paddingBottom: 20 }, mobile: { paddingTop: 0, backgroundColor: "#abcdef" } } };
    section.payload = { categoryIds: [categoryId], layout: { gap: 16, columns: 3, imageRatio: "SQUARE", overrides: { tablet: { gap: 20, imageRatio: "LANDSCAPE" }, mobile: { gap: 0, columns: 2 } } } };
    source.sections.push(section);
    const before = structuredClone(source);
    const result = resetStudioVisualFields(source, { kind: "SECTION", sectionId });
    expect(result.sections[1].style).toEqual({ textColor: "#112233", contentWidth: "NARROW", overrides: { mobile: { backgroundColor: "#abcdef" } } });
    expect(result.sections[1].payload).toEqual({ categoryIds: [categoryId], layout: { columns: 3, imageRatio: "SQUARE", overrides: { tablet: { imageRatio: "LANDSCAPE" }, mobile: { columns: 2 } } } });
    expect(result.defaults).toEqual(source.defaults);
    expect(result.sections[0]).toEqual(source.sections[0]);
    expect(source).toEqual(before);
  });

  it("clears every Hero element's typography without changing its required containers or media and layout", () => {
    const source = emptyDocument();
    const hero = source.sections[0];
    if (hero.type !== "HERO") throw new Error("fixture requires HERO");
    for (const element of Object.values(hero.payload.slides[0].elements)) {
      element.style = { fontSize: 96, fontWeight: 700, lineHeight: 1.2, letterSpacing: -2, textColor: "#ffffff", textAlign: "CENTER", maxWidthPct: 70 };
      element.overrides = { tablet: { style: { fontSize: 40 } }, mobile: { style: { fontSize: 28, fontWeight: 500, textColor: "#aabbcc" }, layout: { xPct: 72 } } };
    }
    hero.payload.slides[0].elements.ctaPrimary.link = { type: "INTERNAL", path: "/collections" };
    const before = structuredClone(source);
    const result = resetStudioVisualFields(source, { kind: "HERO_TYPOGRAPHY", sectionId: hero.id });
    const next = result.sections[0];
    if (next.type !== "HERO") throw new Error("missing HERO");
    const previous = hero.payload.slides[0];
    for (const key of Object.keys(previous.elements) as Array<keyof typeof previous.elements>) {
      expect(next.payload.slides[0].elements[key]).toEqual({ ...previous.elements[key],
        style: { textColor: "#ffffff", textAlign: "CENTER", maxWidthPct: 70 },
        overrides: { mobile: { style: { textColor: "#aabbcc" }, layout: { xPct: 72 } } },
      });
    }
    expect(next.payload.slides[0].media).toEqual(previous.media);
    expect(next.payload.slides[0].overlay).toEqual(previous.overlay);
    expect(next.payload.behavior).toEqual(hero.payload.behavior);
    expect(source).toEqual(before);
  });

  it("keeps required empty Hero style and override containers and returns the same document for a no-op", () => {
    const source = emptyDocument();
    const hero = source.sections[0];
    if (hero.type !== "HERO") throw new Error("fixture requires HERO");
    hero.payload.slides[0].elements.heading.style = { fontSize: 96 };
    hero.payload.slides[0].elements.heading.overrides = { mobile: { style: { fontSize: 30 } } };
    const scope = { kind: "HERO_TYPOGRAPHY", sectionId: hero.id } as const;
    const result = resetStudioVisualFields(source, scope);
    const next = result.sections[0];
    if (next.type !== "HERO") throw new Error("missing HERO");
    expect(next.payload.slides[0].elements.heading.style).toEqual({});
    expect(next.payload.slides[0].elements.heading.overrides).toEqual({});
    expect(resetStudioVisualFields(result, scope)).toBe(result);
    expect(resetStudioVisualFields(result, { kind: "SECTION", sectionId: "missing" })).toBe(result);
    expect(resetStudioVisualFields(result, { kind: "DEFAULTS" })).toBe(result);
  });

  it("uses one reducer operation and restores every explicit value with undo and redo", () => {
    const source = emptyDocument();
    source.defaults = { paddingTop: 0, paddingBottom: 32, backgroundColor: "#112233" };
    const initial = initEditorState({ document: source, rev: 7, savedAt: null });
    const result = editorReducer(initial, { type: "mutate", mutate: (doc) => resetStudioVisualFields(doc, { kind: "DEFAULTS" }) });
    expect(result.past).toHaveLength(1);
    expect(result.dirty).toBe(true);
    const undone = editorReducer(result, { type: "undo" });
    expect(undone.document).toEqual(source);
    expect(undone.dirty).toBe(false);
    expect(editorReducer(undone, { type: "redo" }).document).toEqual(result.document);
  });

  it("counts only real visual overrides, includes explicit zero and does not count retained colors", () => {
    const source = emptyDocument();
    const story = defaultSection("PRODUCT_STORY", sectionId, 10);
    story.style = { textColor: "#112233" };
    story.payload.layout = { overrides: { mobile: { gap: 0 } } };
    const ugc = defaultSection("UGC", entryId, 20);
    ugc.style = { contentWidth: "NARROW" };
    source.sections = [story, ugc];
    source.defaults = { paddingTop: 0 };
    const before = structuredClone(source);
    expect(studioVisualOverrides(source)).toEqual({ defaults: true, sectionIds: [sectionId], heroSectionIds: [] });
    expect(source).toEqual(before);
  });
});

describe("makeUgcPresentation", () => {
  it("allocates identities only for explicit collage conversion and never moves quotes", () => {
    const source = { entries: [{ name: "Layout sample", comment: "Sample text", imageUrl: "/uploads/a.jpg" }, { name: "", comment: "", imageUrl: "/uploads/b.jpg" }] };
    const before = structuredClone(source);
    let count = 0;
    const result = makeUgcPresentation(source, "COLLAGE", () => `id-${++count}`);
    expect(source).toEqual(before);
    expect(result.entries).toEqual(source.entries.map((entry, index) => ({ ...entry, id: `id-${index + 1}` })));
    expect(result.presentation).toEqual({ layout: "COLLAGE", featuredEntryId: "id-1", showQuote: true, overlay: "SOFT" });
    const neverGenerate = () => { throw new Error("Do not regenerate saved ids"); };
    const selected = { ...result, presentation: { ...result.presentation!, featuredEntryId: "id-2", showQuote: false, overlay: "STRONG" as const } };
    const cards = makeUgcPresentation(selected, "CARDS", neverGenerate);
    expect(makeUgcPresentation(cards, "COLLAGE", neverGenerate)).toEqual(selected);
  });

  it("converts and undoes a collage as one reducer operation without regenerating redo ids", () => {
    const document = emptyDocument();
    const section = defaultSection("UGC", sectionId, 10);
    section.payload = { entries: [{ name: "Layout sample", comment: "Sample text" }] };
    document.sections.push(section);
    const initial = initEditorState({ document, rev: 7, savedAt: null });
    const converted = editorReducer(initial, { type: "mutate", mutate: (doc) => ({ ...doc, sections: doc.sections.map((row) => row.id === sectionId && row.type === "UGC"
      ? { ...row, payload: makeUgcPresentation(row.payload, "COLLAGE", () => entryId) } : row) }) });
    expect(converted.past).toHaveLength(1);
    const undone = editorReducer(converted, { type: "undo" });
    expect(undone.document).toEqual(document);
    expect(editorReducer(undone, { type: "redo" }).document).toEqual(converted.document);
  });
});

describe("makeCircularNavigation", () => {
  it("converts only on request and does not invent a cover image", () => {
    const source = { categoryIds: [categoryId], layout: { gap: 0 } };
    const before = structuredClone(source);
    const result = makeCircularNavigation(source, () => entryId);
    expect(source).toEqual(before);
    expect(result).toEqual({ entries: [{ id: entryId, link: { type: "CATEGORY", id: categoryId } }], presentation: "CIRCLES", layout: { gap: 0 } });
    expect(result).not.toHaveProperty("categoryIds");
    expect(result.entries?.[0]).not.toHaveProperty("imageUrl");
  });

  it("preserves explicit empty/new entries and their image/target bindings", () => {
    const neverGenerate = () => { throw new Error("Existing identities must not be regenerated"); };
    expect(makeCircularNavigation({ entries: [], categoryIds: [categoryId] }, neverGenerate)).toEqual({ entries: [], presentation: "CIRCLES" });
    const source = { entries: [{ id: entryId, imageUrl: "/uploads/e2e/nav.jpg", link: { type: "COLLECTION" as const, id: categoryId } }], presentation: "TILES" as const };
    expect(makeCircularNavigation(source, neverGenerate)).toEqual({ ...source, presentation: "CIRCLES" });
  });

  it("uses the existing reducer as one undoable conversion with stable redo identities", () => {
    const document = emptyDocument();
    const section = defaultSection("CATEGORY_TILES", sectionId, 10);
    section.payload = { categoryIds: [categoryId] };
    document.sections.push(section);
    const before = structuredClone(document);
    const initial = initEditorState({ document, rev: 7, savedAt: null });
    const converted = editorReducer(initial, { type: "mutate", mutate: (doc) => ({
      ...doc, sections: doc.sections.map((row) => row.id === sectionId && row.type === "CATEGORY_TILES"
        ? { ...row, payload: makeCircularNavigation(row.payload, () => entryId) } : row),
    }) });
    expect(converted.past).toHaveLength(1);
    expect(converted.document.sections[1].payload).toHaveProperty("entries.0.id", entryId);
    const undone = editorReducer(converted, { type: "undo" });
    expect(undone.document).toEqual(before);
    expect(undone.dirty).toBe(false);
    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.document).toEqual(converted.document);
    expect(document).toEqual(before);
  });
});
