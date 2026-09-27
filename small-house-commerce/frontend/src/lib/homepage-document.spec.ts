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
  updateHeroBehavior,
  updateHeroElement,
  updateHeroMedia,
  updateHeroSlide,
  updateSection,
  type HeroMedia,
  type HomepageDocument,
} from "@/lib/homepage-document";

const SECTION_ID = "00000000-0000-7000-8000-000000000001";
const SLIDE_ID = "00000000-0000-7000-8000-000000000010";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function heroSection(doc: HomepageDocument) {
  const section = doc.sections.find(({ type }) => type === "HERO");
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
    doc = updateAnnouncementItem(doc, firstId, {
      text: "Free delivery",
      linkLabel: "Shop now",
      schedule: { publishAt: "2026-09-27T00:00:00.000Z", unpublishAt: null },
    });
    expect(doc.announcement.items[0]).toMatchObject({
      text: "Free delivery",
      linkLabel: "Shop now",
      schedule: { publishAt: "2026-09-27T00:00:00.000Z", unpublishAt: null },
    });
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

  it("makes every exported mutator immutable, including successful operations", () => {
    const base = emptyDocument();
    const mutators: Array<(doc: HomepageDocument) => HomepageDocument> = [
      (doc) => updateSection(doc, SECTION_ID, { title: "title" }),
      (doc) => moveSection(doc, 0, 0),
      (doc) => removeSection(doc, "missing"),
      (doc) => duplicateSection(doc, SECTION_ID),
      (doc) => updateHeroBehavior(doc, { autoplay: false }),
      (doc) => addHeroSlide(doc),
      (doc) => duplicateHeroSlide(doc, SLIDE_ID),
      (doc) => removeHeroSlide(doc, "missing"),
      (doc) => moveHeroSlide(doc, 0, 0),
      (doc) => updateHeroSlide(doc, SLIDE_ID, { enabled: false }),
      (doc) => updateHeroMedia(doc, SLIDE_ID, { type: "IMAGE" }),
      (doc) => updateHeroElement(doc, SLIDE_ID, "heading", { text: "text" }),
      (doc) => setElementOverride(doc, SLIDE_ID, "heading", "tablet", null),
      (doc) => resetElementLayout(doc, SLIDE_ID, "heading"),
      (doc) => updateAnnouncement(doc, { enabled: true }),
      (doc) => addAnnouncementItem(doc),
      (doc) => removeAnnouncementItem(doc, "missing"),
      (doc) => moveAnnouncementItem(doc, 0, 0),
      (doc) => updateAnnouncementItem(doc, "missing", { text: "text" }),
    ];

    for (const mutate of mutators) {
      const input = structuredClone(base);
      const snapshot = structuredClone(input);
      const output = mutate(input);
      expect(output).not.toBe(input);
      expect(input).toEqual(snapshot);
      expect(output).not.toBe(input);
    }
  });
});
