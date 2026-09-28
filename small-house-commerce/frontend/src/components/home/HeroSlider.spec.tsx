import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { emptyDocument } from "@/lib/homepage-document";
import { HeroSlider } from "./HeroSlider";
import type {
  HomepageHeroBehavior,
  HomepageHeroMedia,
  HomepageHeroSlide,
  HomepageSection,
} from "@/lib/api";

// Task 19 storefront HERO renderer contract (spec §6.1): styled via heroCss,
// slides from payload.slides, only the active slide visible, autoplay/pause
// behavior, arrows + three pagination shapes, reduced-motion off-switch,
// absolute element containers, video + sound toggle, overlay, gradient fallback
// for slides without media, preserved data-track attrs plus data-slide-id, and
// the read-only vs edit (canvas) contract.

const SECTION_ID = "00000000-0000-7000-8000-000000000001";
const SLIDE_IDS = [
  "00000000-0000-7000-8000-000000000011",
  "00000000-0000-7000-8000-000000000012",
  "00000000-0000-7000-8000-000000000013",
];
const DURATION_MS = 3000;
const MANUAL_PAUSE_MS = 12000;

const DEFAULT_BEHAVIOR: HomepageHeroBehavior = {
  autoplay: true,
  durationMs: DURATION_MS,
  transition: "FADE",
  pauseOnHover: true,
  arrows: true,
  pagination: "DOTS",
  manualPauseMs: MANUAL_PAUSE_MS,
};

function templateSlide(): HomepageHeroSlide {
  const document = emptyDocument();
  const hero = document.sections.find(({ type }) => type === "HERO");
  if (!hero || hero.type !== "HERO" || !hero.payload.slides[0]) {
    throw new Error("fixture expects a HERO with one slide");
  }
  // The editor document's slide carries the full element shapes heroCss needs;
  // the storefront payload is that same data plus resolved linkHrefs.
  return structuredClone(
    hero.payload.slides[0],
  ) as unknown as HomepageHeroSlide;
}

const IMAGE_MEDIA: HomepageHeroMedia = {
  type: "IMAGE",
  image: { url: "/uploads/hero.jpg", alt: "hero image" },
  video: null,
  mobileOverride: { enabled: false, image: null, video: null },
  fit: "COVER",
};

function slide(index: number, patch: Partial<HomepageHeroSlide> = {}): HomepageHeroSlide {
  const base = templateSlide();
  base.id = SLIDE_IDS[index];
  base.name = `Slide ${index + 1}`;
  base.sortOrder = (index + 1) * 10;
  base.media = structuredClone(IMAGE_MEDIA);
  base.elements = {
    ...base.elements,
    eyebrow: { ...(base.elements?.eyebrow ?? {}), text: "Eyebrow" },
    heading: { ...(base.elements?.heading ?? {}), text: `Heading ${index + 1}` },
    subheading: { ...(base.elements?.subheading ?? {}), text: "Subheading" },
    offer: { ...(base.elements?.offer ?? {}), text: "Limited offer" },
    ctaPrimary: {
      ...(base.elements?.ctaPrimary ?? {}),
      text: "Shop",
      linkHref: "/collections/new",
    },
    ctaSecondary: {
      ...(base.elements?.ctaSecondary ?? {}),
      text: "Learn more",
      linkHref: "/solutions",
    },
    countdown: { ...(base.elements?.countdown ?? {}), endsAt: null },
  };
  return { ...base, ...patch };
}

function section(
  slides: HomepageHeroSlide[],
  behavior: Partial<HomepageHeroBehavior> = {},
): HomepageSection {
  return {
    id: SECTION_ID,
    type: "HERO",
    title: "Home hero",
    subtitle: null,
    sortOrder: 0,
    payload: { behavior: { ...DEFAULT_BEHAVIOR, ...behavior }, slides },
  };
}

const threeSlides = (): HomepageHeroSlide[] => [slide(0), slide(1), slide(2)];

function wrapper(): HTMLElement {
  const node = document.querySelector("[data-hero-slider]");
  if (!(node instanceof HTMLElement)) throw new Error("missing hero slider root");
  return node;
}

function slideWrappers(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[data-slide]")).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

function activeIndex(): number {
  const index = slideWrappers().findIndex(
    (node) => node.getAttribute("aria-hidden") !== "true",
  );
  if (index < 0) throw new Error("no active slide");
  return index;
}

function element(key: string): HTMLElement {
  const node = document.querySelector(`[data-hero-element="${key}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`missing element ${key}`);
  return node;
}

function reducedMotionStub(): (query: string) => MediaQueryList {
  return (query: string): MediaQueryList =>
    ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("HeroSlider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders only the first slide's media eagerly and marks the rest aria-hidden", () => {
    render(<HeroSlider section={section(threeSlides())} />);
    const slides = slideWrappers();
    expect(slides).toHaveLength(3);
    expect(slides[0].getAttribute("aria-hidden")).toBeNull();
    expect(slides[1].getAttribute("aria-hidden")).toBe("true");
    expect(slides[2].getAttribute("aria-hidden")).toBe("true");

    const first = slides[0].querySelector("img");
    expect(first?.getAttribute("loading")).toBeNull();
    const second = slides[1].querySelector("img");
    expect(second?.getAttribute("loading")).toBe("lazy");
  });

  it.each([
    { name: "advances after durationMs", advanceBy: DURATION_MS, expected: 1 },
    {
      name: "does not advance before durationMs has elapsed",
      advanceBy: DURATION_MS - 1,
      expected: 0,
    },
  ])("autoplay $name", async ({ advanceBy, expected }) => {
    render(<HeroSlider section={section(threeSlides())} />);
    expect(activeIndex()).toBe(0);
    await advance(advanceBy);
    expect(activeIndex()).toBe(expected);
  });

  it("pauses on hover when behavior.pauseOnHover is set and resumes on leave", async () => {
    render(<HeroSlider section={section(threeSlides())} />);
    fireEvent.mouseEnter(wrapper());
    await advance(DURATION_MS * 3);
    expect(activeIndex()).toBe(0);

    fireEvent.mouseLeave(wrapper());
    await advance(DURATION_MS);
    expect(activeIndex()).toBe(1);
  });

  it("pauses autoplay for manualPauseMs after a manual jump", async () => {
    render(<HeroSlider section={section(threeSlides())} />);
    fireEvent.click(
      document.querySelector(
        "[data-hero-next]",
      ) as HTMLElement,
    );
    expect(activeIndex()).toBe(1);

    await advance(DURATION_MS);
    expect(activeIndex()).toBe(1); // still inside the manual pause window

    // Exactly at the pause boundary the clock crosses it once and the rotation
    // resumes (total clock = DURATION_MS + MANUAL_PAUSE_MS - 1ms, so the very
    // next tick would be after the window).
    await advance(MANUAL_PAUSE_MS - 1);
    expect(activeIndex()).toBe(2);
  });

  it("keeps autoplay running regardless of hover when pauseOnHover is off", async () => {
    const behavior: Partial<HomepageHeroBehavior> = { pauseOnHover: false };
    render(<HeroSlider section={section(threeSlides(), behavior)} />);
    fireEvent.mouseEnter(wrapper());
    await advance(DURATION_MS * 2);
    expect(activeIndex()).toBe(2);
  });

  it("renders dots pagination with one button per slide", async () => {
    render(<HeroSlider section={section(threeSlides())} />);
    const dots = document.querySelectorAll("[data-pag-dot]");
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute("aria-label", "Go to slide 1");
    fireEvent.click(dots[1]);
    expect(activeIndex()).toBe(1);
  });

  it("renders the 01 / 03 counter pagination", async () => {
    render(
      <HeroSlider
        section={section(threeSlides(), { pagination: "COUNTER" })}
      />,
    );
    const counter = document.querySelector("[data-pag-counter]");
    expect(counter?.textContent).toMatch(/01\s*\/\s*03/);
    fireEvent.click(
      document.querySelector("[data-hero-next]") as HTMLElement,
    );
    expect(counter?.textContent).toMatch(/02\s*\/\s*03/);
  });

  it("renders a progress bar pagination", async () => {
    render(
      <HeroSlider
        section={section(threeSlides(), { pagination: "PROGRESS" })}
      />,
    );
    const progress = document.querySelector("[data-pag-progress]");
    expect(progress).not.toBeNull();
    expect(
      progress?.querySelector('[role="progressbar"]'),
    ).not.toBeNull();
  });

  it("hides arrows and pagination when behavior.arrows is off", async () => {
    render(<HeroSlider section={section(threeSlides(), { arrows: false })} />);
    expect(document.querySelector("[data-hero-arrows]")).toBeNull();
    // pagination stays, only arrows are gated by behavior.arrows
    expect(document.querySelector("[data-pag-dots]")).not.toBeNull();
  });

  it("disables autoplay and transitions under prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", vi.fn(reducedMotionStub()));
    render(<HeroSlider section={section(threeSlides())} />);
    expect(activeIndex()).toBe(0);

    await advance(DURATION_MS * 3);
    expect(activeIndex()).toBe(0); // no autoplay

    const slide0 = slideWrappers()[0];
    expect(slide0.style.transition).toBe("none");
  });

  it("renders a CTA as an anchor with track attrs only when linkHref is set", () => {
    render(<HeroSlider section={section([slide(0)])} />);
    const primary = element("ctaPrimary");
    expect(primary.querySelector("a")).not.toBeNull();
    expect(screenWithin(primary, "a")?.getAttribute("href")).toBe("/collections/new");
    expect(screenWithin(primary, "a")?.getAttribute("data-track-event")).toBe(
      "HeroClick",
    );
    expect(screenWithin(primary, "a")?.getAttribute("data-section-id")).toBe(
      SECTION_ID,
    );
    expect(screenWithin(primary, "a")?.getAttribute("data-section-position")).toBe(
      "1",
    );

    const secondary = element("ctaSecondary");
    expect(screenWithin(secondary, "a")?.getAttribute("data-section-position")).toBe(
      "2",
    );
  });

  it("renders no CTA when its linkHref is null but keeps the text elements", () => {
    const noPrimary = slide(0, {
      elements: {
        ...slide(0).elements,
        ctaPrimary: {
          ...slide(0).elements!.ctaPrimary!,
          text: "Shop",
          linkHref: null,
        },
      },
    });
    render(<HeroSlider section={section([noPrimary])} />);
    expect(element("ctaPrimary").querySelector("a")).toBeNull();
    expect(element("ctaSecondary").querySelector("a")).not.toBeNull();
    // non-CTA text elements still render
    expect(element("heading").textContent).toContain("Heading");
    expect(element("offer").textContent).toContain("Limited offer");
  });

  it("keeps the gradient fallback for a slide without media", () => {
    const noMedia = slide(0, { media: null });
    render(<HeroSlider section={section([noMedia])} />);
    expect(document.querySelector("[data-hero-media-fallback]")).not.toBeNull();
  });

  it("keeps the overlay gradient on the slide", () => {
    render(<HeroSlider section={section([slide(0)])} />);
    const overlay = document.querySelector("[data-hero-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("style")).toContain("gradient");
  });

  it("keeps data-track attributes and adds data-slide-id on the slide wrapper", () => {
    render(<HeroSlider section={section([slide(0)])} />);
    const slideA = slideWrappers()[0];
    expect(slideA.getAttribute("data-slide")).toBe(SLIDE_IDS[0]);
    expect(slideA.getAttribute("data-slide-id")).toBe(SLIDE_IDS[0]);
  });

  it("renders the video media through ViewportVideo with a sound toggle", async () => {
    const videoSlide = slide(0, {
      media: {
        type: "VIDEO",
        image: null,
        video: {
          url: "/uploads/hero.mp4",
          poster: "/uploads/hero-poster.jpg",
          autoplay: true,
          muted: true,
          loop: true,
          playsInline: true,
          showSoundToggle: true,
          pauseOffscreen: true,
        },
        mobileOverride: { enabled: false, image: null, video: null },
        fit: "COVER",
      },
    });
    render(<HeroSlider section={section([videoSlide])} />);
    const slider = wrapper();
    const video = slider.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("data-video-mode")).toBe("HERO");
    expect(video?.muted).toBe(true);

    const toggle = document.querySelector("[data-hero-sound-toggle]");
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLElement);
    expect(video?.muted).toBe(false);
    fireEvent.click(toggle as HTMLElement);
    expect(video?.muted).toBe(true);
  });

  it("renders the mobile override media when enabled", () => {
    const overrideSlide = slide(0, {
      media: {
        type: "IMAGE",
        image: { url: "/uploads/hero.jpg", alt: "hero image" },
        video: null,
        mobileOverride: {
          enabled: true,
          image: { url: "/uploads/hero-mobile.jpg", alt: "mobile hero" },
          video: null,
        },
        fit: "COVER",
      },
    });
    render(<HeroSlider section={section([overrideSlide])} />);
    const mobile = document.querySelector("[data-hero-mobile-media]");
    expect(mobile).not.toBeNull();
    const mobileImg = mobile?.querySelector("img");
    expect(mobileImg?.getAttribute("src")).toBe("/uploads/hero-mobile.jpg");
    // the desktop media layer stays present (hidden on mobile by CSS)
    expect(document.querySelector("[data-hero-media]")).not.toBeNull();
  });

  it("leaves the slider interactive in read-only mode (arrows advance slides)", async () => {
    render(<HeroSlider section={section(threeSlides())} />);
    fireEvent.click(document.querySelector("[data-hero-prev]") as HTMLElement);
    expect(activeIndex()).toBe(2); // wraps from the start
  });

  describe("edit contract", () => {
    it("disables autoplay, arrows and pagination while edit is active", async () => {
      render(
        <HeroSlider
          section={section(threeSlides())}
          edit={{ selectedElementKey: null, onSelectElement: () => undefined }}
        />,
      );
      await advance(DURATION_MS * 3);
      expect(activeIndex()).toBe(0);
      expect(document.querySelector("[data-hero-arrows]")).toBeNull();
      expect(
        document.querySelector(
          "[data-pag-dots], [data-pag-counter], [data-pag-progress]",
        ),
      ).toBeNull();
    });

    it("reports element clicks and marks the selected element with a dashed outline", () => {
      const onSelectElement = vi.fn();
      render(
        <HeroSlider
          section={section([slide(0)])}
          edit={{ selectedElementKey: "heading", onSelectElement }}
        />,
      );
      fireEvent.click(element("offer"));
      expect(onSelectElement).toHaveBeenCalledWith("offer");

      const box = element("heading").querySelector("[data-hero-selection-box]");
      expect(box).not.toBeNull();
      expect(box?.querySelectorAll("[data-hero-handle]")).toHaveLength(4);
    });

    it("does not render CTA anchors in edit mode (canvas keeps them draggable)", () => {
      render(
        <HeroSlider
          section={section([slide(0)])}
          edit={{ selectedElementKey: null, onSelectElement: () => undefined }}
        />,
      );
      expect(element("ctaPrimary").querySelector("a")).toBeNull();
      expect(element("ctaPrimary").querySelector("span")).not.toBeNull();
    });
  });
});

function screenWithin(root: HTMLElement, selector: string): HTMLElement | null {
  const node = root.querySelector(selector);
  return node instanceof HTMLElement ? node : null;
}