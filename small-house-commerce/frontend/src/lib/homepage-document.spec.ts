import { describe, expect, it } from "vitest";
import {
  addAnnouncementItem,
  addHeroSlide,
  clampPct,
  duplicateHeroSlide,
  duplicateSection,
  emptyDocument,
  emptyElement,
  emptySlide,
  effectiveElementStyle,
  isScheduleActive,
  moveAnnouncementItem,
  moveHeroSlide,
  moveSection,
  removeAnnouncementItem,
  removeHeroSlide,
  removeSection,
  resetElementLayout,
  setElementOverride,
  updateAnnouncement,
  updateAnnouncementItem,
  updateDefaults,
  updateHeroBehavior,
  updateHeroElement,
  updateHeroMedia,
  updateHeroSlide,
  updateSection,
  type HeroMedia,
  type HomepageDocument,
} from "@/lib/homepage-document";
import { SECTION_TYPES, defaultSection } from "@/lib/homepage-section-factory";

const SECTION_ID = "00000000-0000-7000-8000-000000000001";
const SLIDE_ID = "00000000-0000-7000-8000-000000000010";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function heroSection(doc: HomepageDocument) {
  const section = doc.sections.find(({ type }) => type === "HERO");
  if (!section || section.type !== "HERO") throw new Error("missing HERO");
  return section;
}

function heroSectionAt(doc: HomepageDocument, index: number) {
  const section = doc.sections[index];
  if (!section || section.type !== "HERO") throw new Error("missing HERO");
  return section;
}

function heroPayload(doc: HomepageDocument) {
  const payload = heroSection(doc).payload;
  if (!payload || typeof payload !== "object" || !("slides" in payload)) {
    throw new Error("missing HERO payload");
  }
  return payload;
}

function slide(doc: HomepageDocument) {
  return heroPayload(doc).slides[0];
}

function imageMedia(): HeroMedia {
  return {
    type: "IMAGE",
    image: { url: "/uploads/catalog/2026/hero.jpg", alt: "Hero" },
    video: null,
    mobileOverride: { enabled: false, image: null, video: null },
    fit: "COVER",
    focal: { x: 50, y: 50 },
    objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
  };
}

function expectFreshUnchanged(
  input: HomepageDocument,
  output: HomepageDocument,
) {
  expect(output).not.toBe(input);
  expect(output).toEqual(input);
}

function expectFreshChanged(
  input: HomepageDocument,
  snapshot: HomepageDocument,
  output: HomepageDocument,
) {
  expect(output).not.toBe(input);
  expect(input).toEqual(snapshot);
}

describe("homepage document mirror defaults", () => {
  it("matches backend emptyDocument stable ids and exact element defaults", () => {
    const doc = emptyDocument();
    const section = heroSection(doc);
    const currentSlide = section.payload.slides[0];

    // Mirrors backend/src/modules/cms/homepage-document.ts defaults.
    expect(section.id).toBe(SECTION_ID);
    expect(currentSlide.id).toBe(SLIDE_ID);
    expect(currentSlide.media).toBeNull();
    expect(currentSlide.elements.heading.layout).toEqual({
      xPct: 7.4,
      yPct: 22.8,
      widthPct: 40,
      align: "LEFT",
      verticalAlign: "TOP",
    });
    expect(currentSlide.elements.offer.chip).toEqual({
      background: "#C4552D",
      textColor: "#FFFFFF",
      borderRadius: 4,
      paddingX: 12,
      paddingY: 6,
    });
    expect(currentSlide.elements.ctaPrimary.button).toEqual({
      variant: "SOLID",
      background: null,
      textColor: null,
      borderColor: null,
      hoverBackground: null,
      hoverTextColor: null,
      borderRadius: 0,
      paddingX: 28,
      paddingY: 14,
      size: "MD",
      arrow: false,
    });
    expect(currentSlide.elements.countdown).not.toHaveProperty("enabled");
    expect(currentSlide.elements.countdown.endsAt).toBeNull();
    expect(doc.announcement).toEqual({
      enabled: false,
      rotationMs: 5000,
      items: [],
    });
  });

  it("creates schema-shaped empty elements and fresh slides", () => {
    expect(emptyElement("eyebrow").layout).toEqual({
      xPct: 7.4,
      yPct: 14,
      widthPct: 40,
      align: "LEFT",
      verticalAlign: "TOP",
    });
    const first = emptySlide(0);
    const second = emptySlide(1);
    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(1);
    expect(first.id).toMatch(UUID_RE);
    expect(second.id).toMatch(UUID_RE);
    expect(first.id).not.toBe(second.id);
    expect(first.elements.offer).toHaveProperty("chip");
    expect(first.elements.ctaPrimary).toHaveProperty("button");
    expect(first.elements.countdown).toHaveProperty("endsAt", null);
  });

  it("defaults fresh CTA buttons to arrow: false and merges arrow patches", () => {
    const freshSlide = heroPayload(emptyDocument()).slides[0];
    expect(freshSlide.elements.ctaPrimary.button.arrow).toBe(false);
    expect(freshSlide.elements.ctaSecondary.button.arrow).toBe(false);

    const on = updateHeroElement(emptyDocument(), SLIDE_ID, "ctaPrimary", {
      button: { arrow: true },
    });
    expect(slide(on).elements.ctaPrimary.button.arrow).toBe(true);

    // Untoggling writes false (a defined value is merged, not skipped).
    const off = updateHeroElement(emptyDocument(), SLIDE_ID, "ctaPrimary", {
      button: { arrow: false },
    });
    expect(slide(off).elements.ctaPrimary.button.arrow).toBe(false);
  });
});

describe("homepage document pure mutators", () => {
  it("moves a slide and renumbers sortOrder densely", () => {
    let doc = addHeroSlide(emptyDocument());
    doc = addHeroSlide(doc);
    const originalIds = heroPayload(doc).slides.map(({ id }) => id);
    const moved = moveHeroSlide(doc, 0, 2);

    expect(heroPayload(moved).slides.map(({ id }) => id)).toEqual([
      originalIds[1],
      originalIds[2],
      originalIds[0],
    ]);
    expect(heroPayload(moved).slides.map(({ sortOrder }) => sortOrder)).toEqual(
      [0, 10, 20],
    );
    expect(doc).not.toEqual(moved);
  });

  it("duplicates a slide with a fresh UUID, suffix, and dense order", () => {
    const doc = emptyDocument();
    const source = slide(doc);
    const duplicated = duplicateHeroSlide(doc, source.id);
    const slides = heroPayload(duplicated).slides;

    expect(slides).toHaveLength(2);
    expect(slides[1].id).toMatch(UUID_RE);
    expect(slides[1].id).not.toBe(source.id);
    expect(slides[1].name).toBe("Hero 1（副本）");
    expect(slides[1].sortOrder).toBe(10);
    expect(slides[0].sortOrder).toBe(0);
    expect(doc).toEqual(emptyDocument());
  });

  it("duplicates a HERO section with a fresh section and every nested slide id", () => {
    const doc = addHeroSlide(emptyDocument());
    const original = heroSection(doc);
    const originalSlideIds = original.payload.slides.map(({ id }) => id);
    const duplicated = duplicateSection(doc, original.id);
    const sections = duplicated.sections;
    const copy = sections[1];

    expect(copy.id).toMatch(UUID_RE);
    expect(copy.id).not.toBe(original.id);
    expect(copy.sortOrder).toBe(10);
    expect(copy.type).toBe("HERO");
    if (copy.type !== "HERO") throw new Error("expected HERO copy");
    expect(copy.payload.slides).toHaveLength(originalSlideIds.length);
    expect(
      copy.payload.slides.every(({ id }) => !originalSlideIds.includes(id)),
    ).toBe(true);
    expect(copy.payload.slides.map(({ sortOrder }) => sortOrder)).toEqual([
      0, 10,
    ]);
    expect(doc.sections).toHaveLength(1);
  });

  it("regenerates Room Inspiration scene ids when duplicating a section", () => {
    const source = defaultSection(
      "ROOM_INSPIRATION",
      "00000000-0000-7000-8000-000000000120",
      10,
    );
    if (source.type !== "ROOM_INSPIRATION") throw new Error("expected room section");
    source.payload.scenes = [
      {
        id: "scene00000001",
        imageUrl: "/room.jpg",
        hotspots: [
          {
            productId: "00000000-0000-7000-8000-000000000121",
            xPct: 50,
            yPct: 50,
          },
        ],
      },
    ];
    const document: HomepageDocument = {
      ...emptyDocument(),
      sections: [...emptyDocument().sections, source],
    };

    const duplicated = duplicateSection(document, source.id);
    const original = duplicated.sections.find(({ id }) => id === source.id);
    const copy = duplicated.sections.find(({ id }) => id !== source.id && id !== heroSection(document).id);
    if (!original || original.type !== "ROOM_INSPIRATION") throw new Error("missing original");
    if (!copy || copy.type !== "ROOM_INSPIRATION") throw new Error("missing copy");

    const originalScene = original.payload.scenes?.[0];
    const copiedScene = copy.payload.scenes?.[0];
    if (!originalScene || !copiedScene) throw new Error("missing room scene");
    expect(copiedScene.id).not.toBe(originalScene.id);
    expect(copiedScene.hotspots).toEqual(originalScene.hotspots);
  });

  it.each(SECTION_TYPES)(
    "duplicates %s sections without sharing payload or product rows",
    (type) => {
      const source = defaultSection(
        type,
        "00000000-0000-7000-8000-000000000110",
        10,
      );
      source.products = [
        {
          productId: "00000000-0000-7000-8000-000000000101",
          sortOrder: 0,
          badge: "Featured",
        },
      ];
      const document: HomepageDocument = {
        ...emptyDocument(),
        sections: [...emptyDocument().sections, source],
      };

      const duplicated = duplicateSection(document, source.id);
      const copy = duplicated.sections[2];

      expect(copy.id).toMatch(UUID_RE);
      expect(copy.id).not.toBe(source.id);
      expect(copy.type).toBe(type);
      expect(copy.sortOrder).toBe(20);
      expect(copy.payload).toEqual(source.payload);
      expect(copy.payload).not.toBe(source.payload);
      expect(copy.products).toEqual(source.products);
      expect(copy.products).not.toBe(source.products);
      expect(copy.products[0]).not.toBe(source.products[0]);
      expect(duplicated.sections[0]).toEqual(document.sections[0]);
      expect(duplicated.sections[1]).toEqual(source);
    },
  );

  it("does not duplicate a section when backend sort-order capacity is full", () => {
    const document = emptyDocument();
    for (let index = 1; index < 100; index += 1) {
      document.sections.push(
        defaultSection(
          "PRODUCT_GRID",
          `00000000-0000-7000-8000-${String(2000 + index).padStart(12, "0")}`,
          index * 10,
        ),
      );
    }

    const next = duplicateSection(document, document.sections[1].id);

    expect(next.sections).toHaveLength(100);
    expect(next.sections.map(({ sortOrder }) => sortOrder)).toEqual(
      document.sections.map(({ sortOrder }) => sortOrder),
    );
  });

  it("prevents removing the last remaining slide", () => {
    const doc = emptyDocument();
    const output = removeHeroSlide(doc, SLIDE_ID);
    expectFreshUnchanged(doc, output);
  });

  it("enforces the six-slide cap for add and duplicate", () => {
    let doc = emptyDocument();
    for (let index = 0; index < 5; index += 1) doc = addHeroSlide(doc);
    expect(heroPayload(doc).slides).toHaveLength(6);
    const cappedAdd = addHeroSlide(doc);
    expectFreshUnchanged(doc, cappedAdd);
    const cappedDuplicate = duplicateHeroSlide(
      doc,
      heroPayload(doc).slides[0].id,
    );
    expectFreshUnchanged(doc, cappedDuplicate);
  });

  it("clamps layout updates and keeps width within backend minimum", () => {
    const doc = emptyDocument();
    const updated = updateHeroElement(doc, SLIDE_ID, "heading", {
      layout: { xPct: -10, yPct: 200, widthPct: 1 },
    });
    expect(slide(updated).elements.heading.layout).toMatchObject({
      xPct: 0,
      yPct: 100,
      widthPct: 5,
    });
    const nanUpdated = updateHeroElement(doc, SLIDE_ID, "heading", {
      layout: { xPct: Number.NaN, yPct: Number.NaN, widthPct: Number.NaN },
    });
    expect(slide(nanUpdated).elements.heading.layout).toMatchObject({
      xPct: 0,
      yPct: 0,
      widthPct: 5,
    });
    expect(clampPct(Number.NaN)).toBe(0);
    expect(clampPct(-1)).toBe(0);
    expect(clampPct(101)).toBe(100);
  });

  it("deep-merges styles, layouts, and subtype values without losing siblings", () => {
    let doc = updateHeroElement(emptyDocument(), SLIDE_ID, "heading", {
      style: { fontSize: 42, textColor: "#123456" },
      layout: { xPct: 20 },
    });
    doc = updateHeroElement(doc, SLIDE_ID, "heading", {
      style: { fontWeight: 700 },
      layout: { yPct: 30 },
      endsAt: "2026-09-27T12:00:00.000Z",
      button: { size: "LG" },
    } as never);
    expect(slide(doc).elements.heading.style).toMatchObject({
      fontSize: 42,
      textColor: "#123456",
      fontWeight: 700,
    });
    expect(slide(doc).elements.heading.layout).toMatchObject({
      xPct: 20,
      yPct: 30,
    });
    expect(slide(doc).elements.heading).not.toHaveProperty("endsAt");
    expect(slide(doc).elements.heading).not.toHaveProperty("button");

    doc = updateHeroElement(doc, SLIDE_ID, "offer", { chip: { paddingX: 20 } });
    expect(slide(doc).elements.offer.chip).toMatchObject({
      background: "#C4552D",
      paddingX: 20,
      paddingY: 6,
    });
    doc = updateHeroElement(doc, SLIDE_ID, "countdown", {
      endsAt: "2026-09-27T12:00:00.000Z",
      chip: { paddingX: 40 },
    } as never);
    expect(slide(doc).elements.countdown.endsAt).toBe(
      "2026-09-27T12:00:00.000Z",
    );
    expect(slide(doc).elements.countdown).not.toHaveProperty("chip");
  });

  it("initializes null media only from a complete matching source", () => {
    const doc = emptyDocument();
    const incomplete = updateHeroMedia(doc, SLIDE_ID, { type: "IMAGE" });
    expect(slide(incomplete).media).toBeNull();
    const incompleteVideo = updateHeroMedia(doc, SLIDE_ID, {
      type: "VIDEO",
      video: { url: "https://cdn.example/hero.mp4" },
    } as never);
    expect(slide(incompleteVideo).media).toBeNull();

    const image = updateHeroMedia(doc, SLIDE_ID, {
      type: "IMAGE",
      image: { url: "/uploads/catalog/2026/hero.jpg", alt: "Hero" },
    });
    expect(slide(image).media).toMatchObject({
      type: "IMAGE",
      image: { url: "/uploads/catalog/2026/hero.jpg", alt: "Hero" },
      video: null,
      fit: "COVER",
      focal: { x: 50, y: 50 },
    });

    const video = updateHeroMedia(doc, SLIDE_ID, {
      type: "VIDEO",
      video: {
        url: "https://cdn.example/hero.mp4",
        poster: null,
        autoplay: true,
        muted: true,
        loop: true,
        playsInline: true,
        showSoundToggle: false,
        pauseOffscreen: true,
      },
    });
    expect(slide(video).media).toMatchObject({ type: "VIDEO", image: null });
    expect(slide(video).media?.video?.poster).toBeNull();
  });

  it("retains independent image and video slots across media type switches", () => {
    let doc = updateHeroMedia(emptyDocument(), SLIDE_ID, imageMedia());
    const videoSource = {
      url: "https://cdn.example/hero.mp4",
      poster: "/uploads/catalog/2026/poster.jpg",
      autoplay: true,
      muted: true,
      loop: true,
      playsInline: true,
      showSoundToggle: false,
      pauseOffscreen: true,
    };

    doc = updateHeroMedia(doc, SLIDE_ID, {
      type: "VIDEO",
      video: videoSource,
    });
    expect(slide(doc).media).toMatchObject({
      type: "VIDEO",
      image: imageMedia().image,
      video: videoSource,
    });

    doc = updateHeroMedia(doc, SLIDE_ID, {
      type: "IMAGE",
      image: imageMedia().image,
    });
    expect(slide(doc).media).toMatchObject({
      type: "IMAGE",
      image: imageMedia().image,
      video: videoSource,
    });
  });

  it("merges existing media safely while preserving required sibling fields", () => {
    let doc = updateHeroMedia(emptyDocument(), SLIDE_ID, imageMedia());
    doc = updateHeroMedia(doc, SLIDE_ID, {
      image: { alt: "Updated alt" },
      mobileOverride: { enabled: true, image: imageMedia().image, video: null },
      objectPosition: { desktop: { x: 60, y: 40 }, tablet: null, mobile: null },
    } as never);
    const media = slide(doc).media;
    expect(media?.type).toBe("IMAGE");
    expect(media?.image).toEqual({
      url: "/uploads/catalog/2026/hero.jpg",
      alt: "Updated alt",
    });
    expect(media?.mobileOverride.image).toEqual(imageMedia().image);
    expect(media?.objectPosition.desktop).toEqual({ x: 60, y: 40 });
    expect(media?.video).toBeNull();
  });

  it("clamps media focal and object-position coordinates while preserving siblings", () => {
    const initialized = updateHeroMedia(emptyDocument(), SLIDE_ID, {
      type: "IMAGE",
      image: { url: "/uploads/catalog/2026/hero.jpg", alt: "Hero" },
      focal: { x: -10, y: Number.POSITIVE_INFINITY },
      objectPosition: {
        desktop: { x: Number.NaN, y: 101 },
        tablet: { x: -1, y: Number.POSITIVE_INFINITY },
        mobile: { x: Number.NEGATIVE_INFINITY, y: Number.NaN },
      },
    });
    const initializedMedia = slide(initialized).media;
    expect(initializedMedia?.focal).toEqual({ x: 0, y: 100 });
    expect(initializedMedia?.objectPosition).toEqual({
      desktop: { x: 0, y: 100 },
      tablet: { x: 0, y: 100 },
      mobile: { x: 0, y: 0 },
    });

    const existing = updateHeroMedia(initialized, SLIDE_ID, {
      focal: { x: 42 },
      objectPosition: {
        desktop: { y: 25 },
        tablet: null,
        mobile: { x: 75, y: 125 },
      },
    });
    const existingMedia = slide(existing).media;
    expect(existingMedia?.focal).toEqual({ x: 42, y: 100 });
    expect(existingMedia?.objectPosition).toEqual({
      desktop: { x: 0, y: 25 },
      tablet: null,
      mobile: { x: 75, y: 100 },
    });

    const requiredPositionsStayValid = updateHeroMedia(existing, SLIDE_ID, {
      focal: null,
      objectPosition: { desktop: null },
    } as never);
    expect(slide(requiredPositionsStayValid).media?.focal).toEqual({
      x: 42,
      y: 100,
    });
    expect(
      slide(requiredPositionsStayValid).media?.objectPosition.desktop,
    ).toEqual({ x: 0, y: 25 });
  });

  it("routes slide-id mutators to a copied HERO instead of the first HERO", () => {
    const originalDoc = emptyDocument();
    const duplicated = duplicateSection(originalDoc, SECTION_ID);
    const original = duplicated.sections[0];
    const copied = duplicated.sections[1];
    if (original.type !== "HERO" || copied.type !== "HERO") {
      throw new Error("expected two HERO sections");
    }
    const copiedSlideId = copied.payload.slides[0].id;
    const originalSlideId = original.payload.slides[0].id;

    let doc = updateHeroSlide(duplicated, copiedSlideId, {
      name: "Copied hero",
    });
    expect(heroSectionAt(doc, 0).payload.slides[0].name).toBe("Hero 1");
    expect(heroSectionAt(doc, 1).payload.slides[0].name).toBe("Copied hero");

    doc = updateHeroMedia(doc, copiedSlideId, imageMedia());
    expect(heroSectionAt(doc, 0).payload.slides[0].media).toBeNull();
    expect(heroSectionAt(doc, 1).payload.slides[0].media).toEqual(imageMedia());

    doc = updateHeroElement(doc, copiedSlideId, "heading", {
      text: "Copied heading",
      layout: { xPct: 25 },
    });
    expect(heroSectionAt(doc, 0).payload.slides[0].elements.heading.text).toBe(
      "",
    );
    expect(
      heroSectionAt(doc, 1).payload.slides[0].elements.heading,
    ).toMatchObject({
      text: "Copied heading",
      layout: { xPct: 25 },
    });

    doc = setElementOverride(doc, copiedSlideId, "heading", "mobile", {
      style: { fontSize: 18 },
    });
    expect(
      heroSectionAt(doc, 0).payload.slides[0].elements.heading.overrides.mobile,
    ).toBeUndefined();
    expect(
      heroSectionAt(doc, 1).payload.slides[0].elements.heading.overrides.mobile,
    ).toEqual({ style: { fontSize: 18 } });

    doc = resetElementLayout(doc, copiedSlideId, "heading");
    expect(
      heroSectionAt(doc, 1).payload.slides[0].elements.heading.layout,
    ).toEqual(emptyElement("heading").layout);

    const withDuplicate = duplicateHeroSlide(doc, copiedSlideId);
    expect(heroSectionAt(withDuplicate, 0).payload.slides).toHaveLength(1);
    expect(heroSectionAt(withDuplicate, 1).payload.slides).toHaveLength(2);
    expect(heroSectionAt(withDuplicate, 1).payload.slides[0].id).toBe(
      copiedSlideId,
    );

    const afterRemove = removeHeroSlide(withDuplicate, copiedSlideId);
    expect(heroSectionAt(afterRemove, 0).payload.slides[0].id).toBe(
      originalSlideId,
    );
    expect(heroSectionAt(afterRemove, 0).payload.slides).toHaveLength(1);
    expect(heroSectionAt(afterRemove, 1).payload.slides).toHaveLength(1);
  });
  it("clears a mobile override and resolves inherited styles through desktop, tablet, and mobile", () => {
    let doc = updateHeroElement(emptyDocument(), SLIDE_ID, "heading", {
      style: { fontSize: 30, textColor: "#111111" },
      layout: { xPct: 10, yPct: 20 },
    });
    doc = setElementOverride(doc, SLIDE_ID, "heading", "tablet", {
      style: { fontSize: 24 },
      layout: { xPct: 15 },
    });
    doc = setElementOverride(doc, SLIDE_ID, "heading", "mobile", {
      style: { textColor: "#222222" },
      layout: { yPct: 40 },
    });
    expect(effectiveElementStyle(slide(doc), "heading", "desktop")).toEqual({
      style: { fontSize: 30, textColor: "#111111" },
      layout: expect.objectContaining({ xPct: 10, yPct: 20 }),
    });
    expect(effectiveElementStyle(slide(doc), "heading", "tablet")).toEqual({
      style: { fontSize: 24, textColor: "#111111" },
      layout: expect.objectContaining({ xPct: 15, yPct: 20 }),
    });
    expect(effectiveElementStyle(slide(doc), "heading", "mobile")).toEqual({
      style: { fontSize: 24, textColor: "#222222" },
      layout: expect.objectContaining({ xPct: 15, yPct: 40 }),
    });
    const cleared = setElementOverride(
      doc,
      SLIDE_ID,
      "heading",
      "mobile",
      null,
    );
    expect(cleared).not.toBe(doc);
    expect(slide(cleared).elements.heading.overrides.mobile).toBeUndefined();
    expect(
      effectiveElementStyle(slide(cleared), "heading", "mobile").style,
    ).toEqual({
      fontSize: 24,
      textColor: "#111111",
    });
  });

  it("resets layout to the exact element default", () => {
    const changed = updateHeroElement(emptyDocument(), SLIDE_ID, "ctaPrimary", {
      layout: { xPct: 99, yPct: 99, widthPct: 100, align: "RIGHT" },
    });
    const reset = resetElementLayout(changed, SLIDE_ID, "ctaPrimary");
    expect(slide(reset).elements.ctaPrimary.layout).toEqual(
      emptyElement("ctaPrimary").layout,
    );
  });

  it("keeps section and hero behavior updates schema-shaped", () => {
    let doc = updateSection(emptyDocument(), SECTION_ID, {
      title: "New title",
      subtitle: "New subtitle",
      enabled: false,
      schedule: { publishAt: null, unpublishAt: null },
    });
    doc = updateHeroBehavior(doc, { durationMs: 9000, transition: "SLIDE" });
    expect(heroSection(doc)).toMatchObject({
      title: "New title",
      enabled: false,
    });
    expect(heroPayload(doc).behavior).toMatchObject({
      durationMs: 9000,
      transition: "SLIDE",
    });
  });

  it("keeps schedule windows half-open", () => {
    const now = new Date("2026-09-27T12:00:00.000Z");
    expect(
      isScheduleActive(
        { publishAt: now.toISOString(), unpublishAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isScheduleActive(
        { publishAt: null, unpublishAt: now.toISOString() },
        now,
      ),
    ).toBe(false);
    expect(isScheduleActive({ publishAt: null, unpublishAt: null }, now)).toBe(
      true,
    );
    expect(
      isScheduleActive(
        { publishAt: "2026-09-27T12:00:01.000Z", unpublishAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isScheduleActive({ publishAt: "not-a-date", unpublishAt: null }, now),
    ).toBe(false);
    expect(
      isScheduleActive({ publishAt: null, unpublishAt: "not-a-date" }, now),
    ).toBe(false);
  });

  it("orders announcement items, enforces six-item cap, and updates nested values", () => {
    let doc = emptyDocument();
    for (let index = 0; index < 6; index += 1) doc = addAnnouncementItem(doc);
    const beforeCap = structuredClone(doc);
    expect(doc.announcement.items).toHaveLength(6);
    expect(doc.announcement.items.map(({ sortOrder }) => sortOrder)).toEqual([
      0, 10, 20, 30, 40, 50,
    ]);
    expectFreshUnchanged(doc, addAnnouncementItem(doc));

    const firstId = doc.announcement.items[0].id;
    const content = {
      version: 1 as const,
      doc: {
        type: "doc" as const,
        content: [
          {
            type: "paragraph" as const,
            attrs: { textAlign: "center" as const },
            content: [{ type: "text" as const, text: "Free delivery" }],
          },
        ],
      },
    };
    const countdown = {
      endsAt: "2026-09-28T00:00:00.000Z",
      color: "#FFFFFF",
      fontFamily: "POPPINS" as const,
      fontSize: "LG" as const,
      fontWeight: 800 as const,
    };
    doc = updateAnnouncementItem(doc, firstId, {
      text: "Free delivery",
      content,
      linkLabel: "Shop now",
      schedule: { publishAt: "2026-09-27T00:00:00.000Z", unpublishAt: null },
      countdown,
    });
    expect(doc.announcement.items[0]).toMatchObject({
      text: "Free delivery",
      content,
      linkLabel: "Shop now",
      schedule: { publishAt: "2026-09-27T00:00:00.000Z", unpublishAt: null },
      countdown,
    });
    expect(doc.announcement.items[0].content).not.toBe(content);
    expect(doc.announcement.items[0].countdown).not.toBe(countdown);
    const cleared = updateAnnouncementItem(doc, firstId, { content: null });
    expect(cleared.announcement.items[0]).not.toHaveProperty("content");
    const moved = moveAnnouncementItem(doc, 0, 5);
    expect(moved.announcement.items.map(({ sortOrder }) => sortOrder)).toEqual([
      0, 10, 20, 30, 40, 50,
    ]);
    expect(moved.announcement.items[5].id).toBe(firstId);
    expect(
      removeAnnouncementItem(moved, firstId).announcement.items,
    ).toHaveLength(5);
    expect(beforeCap.announcement.items).toHaveLength(6);
  });

  it("returns a new unchanged clone for invalid targets and indices", () => {
    const doc = emptyDocument();
    const missingId = "11111111-1111-4111-8111-111111111111";
    expectFreshUnchanged(
      doc,
      updateSection(doc, missingId, { title: "ignored" }),
    );
    expectFreshUnchanged(doc, moveSection(doc, -1, 0));
    expectFreshUnchanged(doc, moveSection(doc, 0, 99));
    expectFreshUnchanged(doc, removeSection(doc, missingId));
    expectFreshUnchanged(doc, duplicateSection(doc, missingId));
    expectFreshUnchanged(
      doc,
      updateHeroSlide(doc, missingId, { name: "ignored" }),
    );
    expectFreshUnchanged(
      doc,
      updateHeroMedia(doc, missingId, { type: "IMAGE" }),
    );
    expectFreshUnchanged(
      doc,
      updateHeroElement(doc, missingId, "heading", { text: "ignored" }),
    );
    expectFreshUnchanged(
      doc,
      setElementOverride(doc, missingId, "heading", "mobile", null),
    );
    expectFreshUnchanged(doc, resetElementLayout(doc, missingId, "heading"));
    expectFreshUnchanged(doc, removeAnnouncementItem(doc, missingId));
    expectFreshUnchanged(
      doc,
      updateAnnouncementItem(doc, missingId, { text: "ignored" }),
    );
    expectFreshUnchanged(doc, moveHeroSlide(doc, -1, 0));
    expectFreshUnchanged(doc, moveAnnouncementItem(doc, 0, 99));
  });

  it("keeps successful section mutators immutable and unaliased", () => {
    const sectionInput = duplicateSection(emptyDocument(), SECTION_ID);
    const sectionSnapshot = structuredClone(sectionInput);
    const updatedSection = updateSection(
      sectionInput,
      sectionInput.sections[0].id,
      { title: "Updated title" },
    );
    expectFreshChanged(sectionInput, sectionSnapshot, updatedSection);
    expect(updatedSection.sections).not.toBe(sectionInput.sections);
    expect(updatedSection.sections[0]).not.toBe(sectionInput.sections[0]);
    expect(updatedSection.sections[0].title).toBe("Updated title");

    const moveInput = duplicateSection(emptyDocument(), SECTION_ID);
    const moveSnapshot = structuredClone(moveInput);
    const moved = moveSection(moveInput, 0, 1);
    expectFreshChanged(moveInput, moveSnapshot, moved);
    expect(moved.sections.map(({ id }) => id)).toEqual([
      moveInput.sections[1].id,
      moveInput.sections[0].id,
    ]);
    expect(moved.sections.map(({ sortOrder }) => sortOrder)).toEqual([0, 10]);
    expect(moved.sections[0]).not.toBe(moveInput.sections[1]);
    expect(moved.sections[1]).not.toBe(moveInput.sections[0]);

    const removeInput = duplicateSection(emptyDocument(), SECTION_ID);
    const removeSnapshot = structuredClone(removeInput);
    const removed = removeSection(removeInput, removeInput.sections[0].id);
    expectFreshChanged(removeInput, removeSnapshot, removed);
    expect(removed.sections).toHaveLength(1);
    expect(removed.sections[0].id).toBe(removeInput.sections[1].id);
    expect(removed.sections[0]).not.toBe(removeInput.sections[1]);

    const duplicateInput = emptyDocument();
    const duplicateSnapshot = structuredClone(duplicateInput);
    const duplicated = duplicateSection(duplicateInput, SECTION_ID);
    expectFreshChanged(duplicateInput, duplicateSnapshot, duplicated);
    expect(duplicated.sections).not.toBe(duplicateInput.sections);
    expect(duplicated.sections[1]).not.toBe(duplicateInput.sections[0]);
    if (duplicated.sections[1].type !== "HERO") {
      throw new Error("expected duplicated HERO");
    }
    expect(heroSectionAt(duplicated, 1).payload).not.toBe(
      heroSectionAt(duplicateInput, 0).payload,
    );
    expect(heroSectionAt(duplicated, 1).payload.slides[0]).not.toBe(
      heroSectionAt(duplicateInput, 0).payload.slides[0],
    );

    const behaviorInput = emptyDocument();
    const behaviorSnapshot = structuredClone(behaviorInput);
    const behaviorUpdated = updateHeroBehavior(behaviorInput, {
      autoplay: false,
      durationMs: 9000,
    });
    expectFreshChanged(behaviorInput, behaviorSnapshot, behaviorUpdated);
    expect(heroPayload(behaviorUpdated).behavior).not.toBe(
      heroPayload(behaviorInput).behavior,
    );
    expect(heroPayload(behaviorUpdated).behavior).toMatchObject({
      autoplay: false,
      durationMs: 9000,
    });
  });

  it("keeps successful slide mutators immutable and unaliased", () => {
    const addInput = emptyDocument();
    const addSnapshot = structuredClone(addInput);
    const added = addHeroSlide(addInput);
    expectFreshChanged(addInput, addSnapshot, added);
    expect(heroPayload(added).slides).toHaveLength(2);
    expect(heroPayload(added).slides).not.toBe(heroPayload(addInput).slides);
    expect(heroPayload(added).slides[0]).not.toBe(
      heroPayload(addInput).slides[0],
    );

    const duplicateInput = addHeroSlide(emptyDocument());
    const duplicateSnapshot = structuredClone(duplicateInput);
    const duplicated = duplicateHeroSlide(
      duplicateInput,
      heroPayload(duplicateInput).slides[0].id,
    );
    expectFreshChanged(duplicateInput, duplicateSnapshot, duplicated);
    expect(heroPayload(duplicated).slides).toHaveLength(3);
    expect(heroPayload(duplicated).slides[0]).not.toBe(
      heroPayload(duplicateInput).slides[0],
    );
    expect(heroPayload(duplicated).slides[2]).not.toBe(
      heroPayload(duplicateInput).slides[1],
    );

    const removeInput = addHeroSlide(emptyDocument());
    const removeSnapshot = structuredClone(removeInput);
    const removed = removeHeroSlide(
      removeInput,
      heroPayload(removeInput).slides[0].id,
    );
    expectFreshChanged(removeInput, removeSnapshot, removed);
    expect(heroPayload(removed).slides).toHaveLength(1);
    expect(heroPayload(removed).slides[0]).not.toBe(
      heroPayload(removeInput).slides[1],
    );

    const moveInput = addHeroSlide(emptyDocument());
    const moveSnapshot = structuredClone(moveInput);
    const originalSlideIds = heroPayload(moveInput).slides.map(({ id }) => id);
    const moved = moveHeroSlide(moveInput, 0, 1);
    expectFreshChanged(moveInput, moveSnapshot, moved);
    expect(heroPayload(moved).slides.map(({ id }) => id)).toEqual([
      originalSlideIds[1],
      originalSlideIds[0],
    ]);
    expect(heroPayload(moved).slides[0]).not.toBe(
      heroPayload(moveInput).slides[1],
    );
    expect(heroPayload(moved).slides[1]).not.toBe(
      heroPayload(moveInput).slides[0],
    );

    const updateInput = emptyDocument();
    const updateSnapshot = structuredClone(updateInput);
    const updated = updateHeroSlide(updateInput, SLIDE_ID, {
      enabled: false,
      overlay: { color: "#123456", opacity: 0.5, gradient: "FULL" },
    });
    expectFreshChanged(updateInput, updateSnapshot, updated);
    expect(heroPayload(updated).slides[0]).not.toBe(
      heroPayload(updateInput).slides[0],
    );
    expect(heroPayload(updated).slides[0]).toMatchObject({
      enabled: false,
      overlay: { color: "#123456", opacity: 0.5, gradient: "FULL" },
    });
  });

  it("keeps successful media and element mutators immutable and unaliased", () => {
    const mediaInput = emptyDocument();
    const mediaSnapshot = structuredClone(mediaInput);
    const mediaUpdated = updateHeroMedia(mediaInput, SLIDE_ID, imageMedia());
    expectFreshChanged(mediaInput, mediaSnapshot, mediaUpdated);
    expect(heroPayload(mediaUpdated).slides[0]).not.toBe(
      heroPayload(mediaInput).slides[0],
    );
    expect(heroPayload(mediaUpdated).slides[0].media).toEqual(imageMedia());

    const existingMediaInput = mediaUpdated;
    const existingMediaSnapshot = structuredClone(existingMediaInput);
    const existingMediaUpdated = updateHeroMedia(existingMediaInput, SLIDE_ID, {
      image: { alt: "Updated alt" },
    });
    expectFreshChanged(
      existingMediaInput,
      existingMediaSnapshot,
      existingMediaUpdated,
    );
    const inputMedia = heroPayload(existingMediaInput).slides[0].media;
    const outputMedia = heroPayload(existingMediaUpdated).slides[0].media;
    expect(outputMedia).not.toBe(inputMedia);
    expect(outputMedia?.image).not.toBe(inputMedia?.image);
    expect(outputMedia?.image?.alt).toBe("Updated alt");

    const elementInput = emptyDocument();
    const elementSnapshot = structuredClone(elementInput);
    const elementUpdated = updateHeroElement(
      elementInput,
      SLIDE_ID,
      "heading",
      {
        text: "Updated heading",
        style: { fontSize: 44 },
        layout: { xPct: 22 },
        locked: true,
      },
    );
    expectFreshChanged(elementInput, elementSnapshot, elementUpdated);
    const inputElement = heroPayload(elementInput).slides[0].elements.heading;
    const outputElement =
      heroPayload(elementUpdated).slides[0].elements.heading;
    expect(outputElement).not.toBe(inputElement);
    expect(outputElement.style).not.toBe(inputElement.style);
    expect(outputElement.layout).not.toBe(inputElement.layout);
    expect(outputElement).toMatchObject({
      text: "Updated heading",
      style: { fontSize: 44 },
      layout: { xPct: 22 },
      locked: true,
    });

    const overrideInput = setElementOverride(
      emptyDocument(),
      SLIDE_ID,
      "heading",
      "mobile",
      { style: { fontSize: 18 } },
    );
    const overrideSnapshot = structuredClone(overrideInput);
    const clearedOverride = setElementOverride(
      overrideInput,
      SLIDE_ID,
      "heading",
      "mobile",
      null,
    );
    expectFreshChanged(overrideInput, overrideSnapshot, clearedOverride);
    expect(
      heroPayload(clearedOverride).slides[0].elements.heading.overrides,
    ).not.toBe(heroPayload(overrideInput).slides[0].elements.heading.overrides);
    expect(
      heroPayload(clearedOverride).slides[0].elements.heading.overrides.mobile,
    ).toBeUndefined();

    const resetInput = updateHeroElement(emptyDocument(), SLIDE_ID, "heading", {
      layout: { xPct: 90, yPct: 90, widthPct: 90 },
    });
    const resetSnapshot = structuredClone(resetInput);
    const reset = resetElementLayout(resetInput, SLIDE_ID, "heading");
    expectFreshChanged(resetInput, resetSnapshot, reset);
    expect(heroPayload(reset).slides[0].elements.heading.layout).not.toBe(
      heroPayload(resetInput).slides[0].elements.heading.layout,
    );
    expect(heroPayload(reset).slides[0].elements.heading.layout).toEqual(
      emptyElement("heading").layout,
    );
  });

  it("keeps successful announcement mutators immutable and unaliased", () => {
    const updateInput = emptyDocument();
    const updateSnapshot = structuredClone(updateInput);
    const announcementUpdated = updateAnnouncement(updateInput, {
      enabled: true,
      rotationMs: 7000,
    });
    expectFreshChanged(updateInput, updateSnapshot, announcementUpdated);
    expect(announcementUpdated.announcement).not.toBe(updateInput.announcement);
    expect(announcementUpdated.announcement).toMatchObject({
      enabled: true,
      rotationMs: 7000,
    });

    const addInput = emptyDocument();
    const addSnapshot = structuredClone(addInput);
    const added = addAnnouncementItem(addInput);
    expectFreshChanged(addInput, addSnapshot, added);
    expect(added.announcement.items).toHaveLength(1);
    expect(added.announcement.items).not.toBe(addInput.announcement.items);

    const removeInput = addAnnouncementItem(
      addAnnouncementItem(emptyDocument()),
    );
    const removeSnapshot = structuredClone(removeInput);
    const retainedId = removeInput.announcement.items[1].id;
    const removed = removeAnnouncementItem(
      removeInput,
      removeInput.announcement.items[0].id,
    );
    expectFreshChanged(removeInput, removeSnapshot, removed);
    expect(removed.announcement.items).toHaveLength(1);
    expect(removed.announcement.items[0].id).toBe(retainedId);
    expect(removed.announcement.items[0]).not.toBe(
      removeInput.announcement.items[1],
    );

    const moveInput = addAnnouncementItem(addAnnouncementItem(emptyDocument()));
    const moveSnapshot = structuredClone(moveInput);
    const itemIds = moveInput.announcement.items.map(({ id }) => id);
    const moved = moveAnnouncementItem(moveInput, 0, 1);
    expectFreshChanged(moveInput, moveSnapshot, moved);
    expect(moved.announcement.items.map(({ id }) => id)).toEqual([
      itemIds[1],
      itemIds[0],
    ]);
    expect(moved.announcement.items[0]).not.toBe(
      moveInput.announcement.items[1],
    );
    expect(moved.announcement.items[1]).not.toBe(
      moveInput.announcement.items[0],
    );

    const itemInput = addAnnouncementItem(emptyDocument());
    const itemSnapshot = structuredClone(itemInput);
    const updatedItem = updateAnnouncementItem(
      itemInput,
      itemInput.announcement.items[0].id,
      { text: "Updated announcement", enabled: false },
    );
    expectFreshChanged(itemInput, itemSnapshot, updatedItem);
    expect(updatedItem.announcement.items[0]).not.toBe(
      itemInput.announcement.items[0],
    );
    expect(updatedItem.announcement.items[0]).toMatchObject({
      text: "Updated announcement",
      enabled: false,
    });
  });
});

describe("updateDefaults", () => {
  it("starts with empty defaults and merges patches field by field", () => {
    const doc = emptyDocument();
    expect(doc.defaults).toEqual({});

    const withBackground = updateDefaults(doc, { backgroundColor: "#F2EFE9" });
    expectFreshChanged(doc, structuredClone(doc), withBackground);
    expect(withBackground.defaults).toEqual({ backgroundColor: "#F2EFE9" });

    const withPadding = updateDefaults(withBackground, {
      paddingTop: 32,
      contentWidth: "NARROW",
    });
    expect(withPadding.defaults).toEqual({
      backgroundColor: "#F2EFE9",
      paddingTop: 32,
      contentWidth: "NARROW",
    });
  });

  it("clears a field when the patch value is undefined or an empty string", () => {
    const doc = updateDefaults(emptyDocument(), {
      backgroundColor: "#F2EFE9",
      textColor: "#292724",
    });

    const cleared = updateDefaults(doc, { backgroundColor: undefined, textColor: "" });
    expect(cleared.defaults).toEqual({});
  });

  it("creates defaults on a legacy document that has no defaults field", () => {
    const legacy = structuredClone(emptyDocument()) as HomepageDocument;
    delete legacy.defaults;
    const next = updateDefaults(legacy, {
      paddingBottom: 12,
    });
    expect(next.defaults).toEqual({ paddingBottom: 12 });
  });
});
