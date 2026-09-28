import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import { SlideList } from "@/components/admin/homepage/SlideList";
import {
  emptyDocument,
  type HeroPayload,
  type HeroSlide,
  type HomepageDocument,
  type HomepageSection,
} from "@/lib/homepage-document";

const HERO_ID = "00000000-0000-7000-8000-000000000101";
const SLIDE_ONE_ID = "00000000-0000-7000-8000-000000000111";
const SLIDE_TWO_ID = "00000000-0000-7000-8000-000000000112";
const SLIDE_THREE_ID = "00000000-0000-7000-8000-000000000113";

/** Card geometry the jsdom DOM cannot provide: stacked 240x64 boxes. */
const CARD_HEIGHT = 64;
const CARD_WIDTH = 240;

function zeroRect(): DOMRect {
  return {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function stackedRect(top: number): DOMRect {
  return {
    top,
    bottom: top + CARD_HEIGHT,
    left: 0,
    right: CARD_WIDTH,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * dnd-kit measures every droppable with `getBoundingClientRect`, which jsdom
 * always reports as a zero box — the sortable keyboard coordinate getter then
 * cannot find a neighbour below/above. Give every card a distinct, stacked
 * rect derived from its position in the list (same technique as ModuleTree).
 */
function mockCardGeometry(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      const card = this.closest("[data-slide-card]");
      if (!card?.parentElement) return zeroRect();
      const index = Array.from(card.parentElement.children).indexOf(card);
      return stackedRect(index * CARD_HEIGHT);
    },
  );
}

function imageSlide(): HeroSlide {
  return {
    ...baseSlide(),
    id: SLIDE_ONE_ID,
    name: "Hero 1",
    media: {
      type: "IMAGE",
      image: { url: "https://cdn.example.com/hero-1.jpg", alt: "Hero one" },
      video: null,
      mobileOverride: { enabled: false, image: null, video: null },
      fit: "COVER",
      focal: { x: 50, y: 50 },
      objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
    },
  };
}

function videoSlide(): HeroSlide {
  return {
    ...baseSlide(),
    id: SLIDE_TWO_ID,
    name: "Hero 2",
    enabled: false,
    sortOrder: 10,
    schedule: { publishAt: "2026-10-01T00:00:00.000Z", unpublishAt: null },
    media: {
      type: "VIDEO",
      image: null,
      video: {
        url: "https://cdn.example.com/hero-2.mp4",
        poster: "https://cdn.example.com/hero-2-poster.jpg",
        autoplay: true,
        muted: true,
        loop: true,
        playsInline: true,
        showSoundToggle: false,
        pauseOffscreen: true,
      },
      mobileOverride: { enabled: false, image: null, video: null },
      fit: "COVER",
      focal: { x: 50, y: 50 },
      objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
    },
  };
}

function emptyMediaSlide(): HeroSlide {
  return {
    ...baseSlide(),
    id: SLIDE_THREE_ID,
    name: "Hero 3",
    sortOrder: 20,
  };
}

function baseSlide(): HeroSlide {
  const base = emptyDocument().sections[0];
  if (base.type !== "HERO") throw new Error("fixture expects a HERO section");
  return structuredClone(base.payload.slides[0]);
}

function heroPayload(slides: HeroSlide[]): HeroPayload {
  const base = emptyDocument().sections[0];
  if (base.type !== "HERO") throw new Error("fixture expects a HERO section");
  return { behavior: structuredClone(base.payload.behavior), slides };
}

function slideDocument(slides: HeroSlide[]): HomepageDocument {
  const base = emptyDocument().sections[0];
  if (base.type !== "HERO") throw new Error("fixture expects a HERO section");
  const section: HomepageSection = {
    ...structuredClone(base),
    id: HERO_ID,
    title: "Hero banner",
    payload: heroPayload(slides),
  };
  return { ...emptyDocument(), sections: [section] };
}

const DOCUMENT = slideDocument([imageSlide(), videoSlide(), emptyMediaSlide()]);

function Loader({ document }: { document: HomepageDocument }): ReactNode {
  const { dispatch } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 4, savedAt: null });
  }, [dispatch, document]);
  return null;
}

function SlideProbe(): ReactNode {
  const { state, selectedSlideId } = useHomepageEditor();
  const hero = state.document.sections.find((section) => section.type === "HERO");
  return (
    <div>
      <pre data-testid="payload">
        {JSON.stringify(hero && hero.type === "HERO" ? hero.payload : null)}
      </pre>
      <span data-testid="commits">{state.past.length}</span>
      <span data-testid="selected-slide">{selectedSlideId ?? ""}</span>
    </div>
  );
}

function renderSlides(document: HomepageDocument = DOCUMENT) {
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Loader document={document} />
        <SlideList sectionId={HERO_ID} />
        <SlideProbe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function payload(): HeroPayload {
  return JSON.parse(screen.getByTestId("payload").textContent ?? "{}") as HeroPayload;
}

function commits(): string {
  return screen.getByTestId("commits").textContent ?? "";
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[data-slide-card]")).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

function card(slideId: string): HTMLElement {
  const found = document.querySelector(`[data-slide-card="${slideId}"]`);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`slide card ${slideId} not found`);
  }
  return found;
}

function dragHandle(slideId: string): HTMLElement {
  const handle = card(slideId).querySelector(
    'button[aria-label="Drag to reorder"]',
  );
  if (!(handle instanceof HTMLElement)) {
    throw new Error(`drag handle for ${slideId} not found`);
  }
  return handle;
}

/** Activates a sortable with Space, walks it with arrow keys, drops with Space. */
async function keyboardSort(
  handle: HTMLElement,
  arrows: Array<"ArrowDown" | "ArrowUp">,
): Promise<void> {
  fireEvent.keyDown(handle, { code: "Space", key: " " });
  // The keyboard sensor attaches its document listener in a macrotask.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (const code of arrows) {
    fireEvent.keyDown(document, { code, key: code });
  }
  fireEvent.keyDown(document, { code: "Space", key: " " });
  await act(async () => {});
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("SlideList", () => {
  beforeEach(() => {
    setAdminLang("en");
    mockCardGeometry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders a card per slide with index, thumbnail, schedule badge and selection", () => {
    renderSlides();

    expect(cards()).toHaveLength(3);
    expect(
      within(card(SLIDE_ONE_ID)).getByText("01"),
    ).toBeVisible();
    expect(within(card(SLIDE_TWO_ID)).getByText("02")).toBeVisible();
    expect(within(card(SLIDE_THREE_ID)).getByText("03")).toBeVisible();

    expect(
      card(SLIDE_ONE_ID).querySelector("img")?.getAttribute("src"),
    ).toBe("https://cdn.example.com/hero-1.jpg");
    // A VIDEO card shows its poster as the thumbnail.
    expect(
      card(SLIDE_TWO_ID).querySelector("img")?.getAttribute("src"),
    ).toBe("https://cdn.example.com/hero-2-poster.jpg");
    // No media yet: the placeholder copy replaces the thumbnail.
    expect(
      within(card(SLIDE_THREE_ID)).getByText("No media"),
    ).toBeVisible();

    expect(within(card(SLIDE_TWO_ID)).getByText("Scheduled")).toBeVisible();
    expect(within(card(SLIDE_ONE_ID)).queryByText("Scheduled")).toBeNull();
    expect(within(card(SLIDE_THREE_ID)).queryByText("Scheduled")).toBeNull();

    fireEvent.click(within(card(SLIDE_TWO_ID)).getByRole("button", { name: "Hero 2" }));
    expect(screen.getByTestId("selected-slide")).toHaveTextContent(SLIDE_TWO_ID);
  });

  it("adds slides up to the backend cap of six", () => {
    renderSlides();

    const add = screen.getByRole("button", { name: "Add slide" });
    expect(add).not.toBeDisabled();

    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);

    expect(cards()).toHaveLength(6);
    expect(payload().slides.map((slide) => slide.sortOrder)).toEqual([
      0, 10, 20, 30, 40, 50,
    ]);
    expect(screen.getByRole("button", { name: "Add slide" })).toBeDisabled();
  });

  it("duplicates a slide with a fresh id right after its source", () => {
    renderSlides();

    fireEvent.click(
      within(card(SLIDE_ONE_ID)).getByRole("button", { name: "Duplicate slide" }),
    );

    const slides = payload().slides;
    expect(slides).toHaveLength(4);
    expect(slides[0].id).toBe(SLIDE_ONE_ID);
    expect(slides[1].id).not.toBe(SLIDE_ONE_ID);
    expect(slides[1].name).toContain("（副本）");
    expect(slides[1].sortOrder).toBe(10);
    expect(slides.map((slide) => slide.sortOrder)).toEqual([0, 10, 20, 30]);
  });

  it("deletes a slide and blocks deleting the last remaining one", () => {
    const { unmount } = renderSlides();

    fireEvent.click(
      within(card(SLIDE_TWO_ID)).getByRole("button", { name: "Delete slide" }),
    );

    expect(payload().slides.map((slide) => slide.id)).toEqual([
      SLIDE_ONE_ID,
      SLIDE_THREE_ID,
    ]);
    unmount();

    renderSlides(slideDocument([imageSlide()]));
    const deleteButton = within(card(SLIDE_ONE_ID)).getByRole("button", {
      name: "Delete slide",
    });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute(
      "title",
      "At least one slide is required",
    );

    fireEvent.click(deleteButton);
    expect(payload().slides).toHaveLength(1);
  });

  it("reorders slides through the dnd-kit keyboard sensor", async () => {
    renderSlides();

    await keyboardSort(dragHandle(SLIDE_ONE_ID), ["ArrowDown"]);

    expect(payload().slides.map((slide) => slide.id)).toEqual([
      SLIDE_TWO_ID,
      SLIDE_ONE_ID,
      SLIDE_THREE_ID,
    ]);
    expect(payload().slides.map((slide) => slide.sortOrder)).toEqual([0, 10, 20]);
    expect(commits()).toBe("1");
  });

  it("moves a slide with the up/down fallback buttons", () => {
    renderSlides();

    fireEvent.click(
      within(card(SLIDE_THREE_ID)).getByRole("button", { name: "Move up" }),
    );

    expect(payload().slides.map((slide) => slide.id)).toEqual([
      SLIDE_ONE_ID,
      SLIDE_THREE_ID,
      SLIDE_TWO_ID,
    ]);

    fireEvent.click(
      within(card(SLIDE_ONE_ID)).getByRole("button", { name: "Move down" }),
    );

    expect(payload().slides.map((slide) => slide.id)).toEqual([
      SLIDE_THREE_ID,
      SLIDE_ONE_ID,
      SLIDE_TWO_ID,
    ]);
    expect(commits()).toBe("2");
  });

  it("disables the up/down fallback at the list edges", () => {
    renderSlides();

    expect(
      within(card(SLIDE_ONE_ID)).getByRole("button", { name: "Move up" }),
    ).toBeDisabled();
    expect(
      within(card(SLIDE_THREE_ID)).getByRole("button", { name: "Move down" }),
    ).toBeDisabled();
    expect(
      within(card(SLIDE_ONE_ID)).getByRole("button", { name: "Move down" }),
    ).not.toBeDisabled();
  });

  it("commits a slide name edit once per typing burst", async () => {
    vi.useFakeTimers();
    renderSlides();

    const nameInput = within(card(SLIDE_ONE_ID)).getByRole("textbox", {
      name: "Slide name",
    });

    fireEvent.change(nameInput, { target: { value: "H" } });
    fireEvent.change(nameInput, { target: { value: "Hero one" } });

    expect(payload().slides[0].name).toBe("Hero 1");
    expect(commits()).toBe("0");

    await advance(300);

    expect(payload().slides[0].name).toBe("Hero one");
    expect(commits()).toBe("1");

    fireEvent.blur(nameInput);
    expect(commits()).toBe("1");
  });

  it("toggles the per-slide enabled switch", () => {
    renderSlides();

    fireEvent.click(
      within(card(SLIDE_ONE_ID)).getByRole("checkbox", { name: "Slide enabled" }),
    );

    expect(payload().slides[0].enabled).toBe(false);
    expect(payload().slides[1].enabled).toBe(false);
    expect(commits()).toBe("1");
  });
});
