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

describe("Hero typography fallback precedence", () => {
  it("keeps saved variables before appearance defaults and original renderer fallbacks", () => {
    const source = slide(0);
    render(<HeroSlider section={section([source], { autoplay: false })} />);
    expect(element("heading").style.fontSize).toBe("var(--el-heading-size, var(--hp-hero-fallback-size, 2.25rem))");
    expect(element("heading").style.fontWeight).toBe("var(--el-heading-weight, var(--hp-hero-fallback-weight, 600))");
    expect(element("heading").style.lineHeight).toBe("var(--el-heading-lh, var(--hp-hero-fallback-lh, inherit))");
    expect(element("heading").style.letterSpacing).toBe("var(--el-heading-ls, var(--hp-hero-fallback-ls, inherit))");
  });
});

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

  it("expands explicit mobile SCREEN geometry to contain a colliding title and CTA without saving pixels", async () => {
    const first = slide(0);
    for (const value of Object.values(first.elements ?? {})) value.text = "";
    first.elements!.heading!.text = "A long furniture heading";
    first.elements!.ctaPrimary!.text = "Shop now";
    first.elements!.heading!.layout = { xPct: 0, yPct: 0, widthPct: 100, align: "LEFT" };
    first.elements!.ctaPrimary!.layout = { xPct: 0, yPct: 0, widthPct: 100, align: "LEFT" };
    const fixture = section([first], { autoplay: false });
    fixture.payload.display = { overrides: { mobile: { heightMode: "SCREEN" } } };
    const original = structuredClone(fixture);
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-hero-slider") ? 390 : 0;
    });
    const readStyle = window.getComputedStyle.bind(window);
    const elementWidth = vi.spyOn(window, "getComputedStyle").mockImplementation((node, pseudo) => {
      const style = readStyle(node, pseudo);
      if (node.hasAttribute("data-hero-element")) style.width = "358px";
      return style;
    });
    const elementHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.heroElement === "heading" ? 220 : this.dataset.heroElement === "ctaPrimary" ? 48 : 0;
    });
    try {
      render(<HeroSlider section={fixture} previewDevice="mobile" previewViewportHeight={180} interactionMode="preview" />);
      await advance(50);
      expect(wrapper().dataset.readableReady).toBe("true");
      expect(wrapper().style.getPropertyValue("--hp-readable-height")).toBe("312px");
      expect(element("ctaPrimary").style.getPropertyValue("--hp-safe-y")).toBe("248px");
      expect(fixture).toEqual(original);
    } finally {
      width.mockRestore(); elementWidth.mockRestore(); elementHeight.mockRestore();
    }
  });

  it("applies inherited section presentation to the Hero root", () => {
    render(
      <HeroSlider
        section={{
          ...section([slide(0)]),
          style: {
            backgroundColor: "#F2EFE9",
            textColor: "#112233",
            contentWidth: "NARROW",
            paddingTop: 40,
            paddingBottom: 24,
          },
        }}
      />,
    );

    expect(wrapper()).toHaveClass("mx-auto", "max-w-[840px]");
    expect(wrapper()).toHaveStyle({
      backgroundColor: "#F2EFE9",
      color: "#112233",
      paddingTop: "40px",
      paddingBottom: "24px",
    });
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

  it("renders no trailing arrow when the CTA button lacks the arrow flag (legacy shape)", () => {
    // A legacy stored button predates the optional `arrow` field; the renderer
    // must treat absence as false and keep the label-free layout.
    const legacy = slide(0, {
      elements: {
        ...slide(0).elements,
        ctaPrimary: {
          ...slide(0).elements!.ctaPrimary!,
          button: { variant: "SOLID" },
        },
      },
    });
    render(<HeroSlider section={section([legacy])} />);
    const cta = element("ctaPrimary").querySelector("a");
    expect(cta?.querySelector("[data-hero-btn-arrow]")).toBeNull();
  });

  it("renders a trailing arrow glyph on the CTA when arrow is true (storefront read-only)", () => {
    const arrowed = slide(0, {
      elements: {
        ...slide(0).elements,
        ctaPrimary: {
          ...slide(0).elements!.ctaPrimary!,
          button: {
            ...(slide(0).elements!.ctaPrimary!.button ?? {}),
            arrow: true,
          },
        },
      },
    });
    render(<HeroSlider section={section([arrowed])} />);
    const cta = element("ctaPrimary").querySelector("a");
    const glyph = cta?.querySelector("[data-hero-btn-arrow]");
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    // The glyph trails the label (last element inside the anchor).
    expect(cta?.lastElementChild?.getAttribute("data-hero-btn-arrow")).not.toBeNull();
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

  it("marks non-active slide wrappers inert so they are not focusable", async () => {
    render(<HeroSlider section={section(threeSlides())} />);
    const slides = slideWrappers();
    expect(slides[0].hasAttribute("inert")).toBe(false);
    expect(slides[1].hasAttribute("inert")).toBe(true);
    expect(slides[2].hasAttribute("inert")).toBe(true);
    // aria-hidden contract is kept alongside inert
    expect(slides[1].getAttribute("aria-hidden")).toBe("true");

    // rotating moves inert to the new non-active set
    await advance(DURATION_MS);
    const after = slideWrappers();
    expect(after[0].hasAttribute("inert")).toBe(true);
    expect(after[1].hasAttribute("inert")).toBe(false);
  });

  it("renders the heading element as an h1 in read-only mode (storefront)", () => {
    render(<HeroSlider section={section([slide(0)])} />);
    const heading = element("heading");
    const h1 = heading.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toContain("Heading 1");
    // the CTA anchors are links, not headings; the subheading is not an h1
    expect(element("subheading").querySelector("h1")).toBeNull();
  });

  it("keeps the heading render as a non-h1 in edit mode (admin canvas)", () => {
    render(
      <HeroSlider
        section={section([slide(0)])}
        edit={{ selectedElementKey: null, onSelectElement: () => undefined }}
      />,
    );
    expect(element("heading").querySelector("h1")).toBeNull();
  });

  it("resets the unmuted sound state when the slide rotates", async () => {
    const videoSlide = (index: number): HomepageHeroSlide =>
      slide(index, {
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
    render(<HeroSlider section={section([videoSlide(0), videoSlide(1)])} />);

    const toggle = document.querySelector("[data-hero-sound-toggle]");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle as HTMLElement);
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(slideWrappers()[0].querySelector("video")?.muted).toBe(false);

    // rotate to slide B: the unmute must not leak over
    await advance(DURATION_MS);
    const nextToggle = document.querySelector("[data-hero-sound-toggle]");
    expect(nextToggle?.getAttribute("aria-pressed")).toBe("false");
    expect(slideWrappers()[1].querySelector("video")?.muted).toBe(true);
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

    it("surrounds the selected CTA with eight resize handles", () => {
      render(
        <HeroSlider
          section={section([slide(0)])}
          edit={{
            selectedElementKey: "ctaPrimary",
            onSelectElement: () => undefined,
          }}
        />,
      );

      const cta = element("ctaPrimary");
      const frame = cta.querySelector("[data-hero-cta-frame]");
      expect(frame).not.toBeNull();
      const directions = Array.from(
        frame!.querySelectorAll("[data-hero-resize-handle]"),
      ).map((node) => node.getAttribute("data-hero-resize-handle"));
      expect(directions).toEqual([
        "nw",
        "n",
        "ne",
        "e",
        "se",
        "s",
        "sw",
        "w",
      ]);
      // The CTA uses its own button frame instead of the old dashed box.
      expect(cta.querySelector("[data-hero-selection-box]")).toBeNull();
    });

    it("only shows resize handles for the selected CTA in edit mode", () => {
      render(
        <HeroSlider
          section={section([slide(0)])}
          edit={{
            selectedElementKey: "heading",
            onSelectElement: () => undefined,
          }}
        />,
      );
      expect(
        element("ctaPrimary").querySelector("[data-hero-cta-frame]"),
      ).toBeNull();
      expect(
        element("heading").querySelector("[data-hero-selection-box]"),
      ).not.toBeNull();
    });

    it("keeps resize handles out of the live storefront", () => {
      render(<HeroSlider section={section([slide(0)])} />);
      expect(document.querySelector("[data-hero-cta-frame]")).toBeNull();
      expect(document.querySelector("[data-hero-resize-handle]")).toBeNull();
    });

    it("scales the trailing arrow gap with the label font size", () => {
      const arrowed = slide(0, {
        elements: {
          ...slide(0).elements,
          ctaPrimary: {
            ...slide(0).elements!.ctaPrimary!,
            button: {
              ...(slide(0).elements!.ctaPrimary!.button ?? {}),
              arrow: true,
            },
          },
        },
      });
      render(<HeroSlider section={section([arrowed])} />);
      const glyph = element("ctaPrimary").querySelector<SVGElement>(
        "[data-hero-btn-arrow]",
      );
      expect(glyph).not.toBeNull();
      expect(glyph?.style.marginLeft).toBe("0.43em");
    });

    it("keeps saved desktop padding and derives tablet and mobile values", () => {
      const responsive = slide(0, {
        elements: {
          ...slide(0).elements,
          ctaPrimary: {
            ...slide(0).elements!.ctaPrimary!,
            button: {
              ...slide(0).elements!.ctaPrimary!.button,
              size: "LG",
              paddingX: 40,
              paddingY: 20,
            },
          },
        },
      });
      render(
        <HeroSlider
          section={section([responsive])}
          previewDevice="mobile"
          edit={{ selectedElementKey: null, onSelectElement: () => undefined }}
        />,
      );

      const button = element("ctaPrimary").querySelector<HTMLElement>(
        "[data-hero-button]",
      );
      expect(button).not.toBeNull();
      expect(button).toHaveAttribute("data-hero-button-size", "LG");
      expect(button?.style.getPropertyValue("--hp-hero-button-padding-x-desktop")).toBe("40px");
      expect(button?.style.getPropertyValue("--hp-hero-button-padding-y-desktop")).toBe("20px");
      expect(button?.style.getPropertyValue("--hp-hero-button-padding-x-tablet")).toBe("34px");
      expect(button?.style.getPropertyValue("--hp-hero-button-padding-y-tablet")).toBe("17px");
      expect(button?.style.getPropertyValue("--hp-hero-button-padding-x-mobile")).toBe("28px");
      expect(button?.style.getPropertyValue("--hp-hero-button-padding-y-mobile")).toBe("14px");
      expect(button?.style.padding).toBe("");
    });

    it("shows no placeholder watermark for elements without content", () => {
      const empty = slide(0, {
        elements: {
          ...slide(0).elements,
          heading: { ...(slide(0).elements?.heading ?? {}), text: "" },
          subheading: { ...(slide(0).elements?.subheading ?? {}), text: "   " },
          countdown: { ...(slide(0).elements?.countdown ?? {}), endsAt: null },
        },
      });
      const onSelectElement = vi.fn();
      render(
        <HeroSlider
          section={section([empty])}
          edit={{ selectedElementKey: null, onSelectElement }}
        />,
      );

      expect(document.querySelector("[data-hero-element-placeholder]")).toBeNull();
      expect(element("heading").textContent).toBe("");
      expect(element("subheading").textContent).toBe("");
      expect(element("countdown").textContent).toBe("");

      // The empty block stays clickable so the canvas can still select it.
      fireEvent.click(element("heading"));
      expect(onSelectElement).toHaveBeenCalledWith("heading");
    });

    it("renders the arrow in edit mode so the canvas matches the storefront", () => {
      const arrowed = slide(0, {
        elements: {
          ...slide(0).elements,
          ctaPrimary: {
            ...slide(0).elements!.ctaPrimary!,
            button: {
              ...(slide(0).elements!.ctaPrimary!.button ?? {}),
              arrow: true,
            },
          },
        },
      });
      render(
        <HeroSlider
          section={section([arrowed])}
          edit={{ selectedElementKey: null, onSelectElement: () => undefined }}
        />,
      );
      const cta = element("ctaPrimary");
      expect(cta.querySelector("a")).toBeNull();
      expect(cta.querySelector("[data-hero-btn-arrow]")).not.toBeNull();
    });
  });

  describe("swipe", () => {
    /**
     * jsdom ships no PointerEvent, so the gesture is dispatched as a plain
     * event carrying the coordinates React reads (clientX/clientY/pointerId).
     */
    function pointer(
      target: HTMLElement,
      type: "pointerdown" | "pointermove" | "pointerup",
      clientX: number,
      clientY: number,
    ): void {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 1 },
        isPrimary: { value: true },
        button: { value: 0 },
        pointerType: { value: "touch" },
      });
      fireEvent(target, event);
    }

    function swipe(from: [number, number], to: [number, number]): void {
      const root = wrapper();
      pointer(root, "pointerdown", from[0], from[1]);
      pointer(root, "pointermove", to[0], to[1]);
      pointer(root, "pointerup", to[0], to[1]);
    }

    it("advances to the next slide when the hero is swiped left", () => {
      render(<HeroSlider section={section(threeSlides())} />);
      swipe([600, 300], [420, 306]);
      expect(activeIndex()).toBe(1);
    });

    it("wraps to the last slide when the hero is swiped right", () => {
      render(<HeroSlider section={section(threeSlides())} />);
      swipe([420, 300], [600, 306]);
      expect(activeIndex()).toBe(2);
    });

    it("keeps the slide when the drag is shorter than the swipe distance", () => {
      render(<HeroSlider section={section(threeSlides())} />);
      swipe([600, 300], [575, 302]);
      expect(activeIndex()).toBe(0);
    });

    it("keeps the slide when the gesture is vertical so the page can scroll", () => {
      render(<HeroSlider section={section(threeSlides())} />);
      swipe([600, 300], [588, 430]);
      expect(activeIndex()).toBe(0);
    });

    it("swallows the click that follows a swipe so a swipe over a CTA does not open it", () => {
      const hashed = slide(0, {
        elements: {
          ...slide(0).elements,
          ctaPrimary: { ...slide(0).elements!.ctaPrimary!, linkHref: "#shop" },
        },
      });
      render(<HeroSlider section={section([hashed, slide(1), slide(2)])} />);
      const link = element("ctaPrimary").querySelector("a") as HTMLAnchorElement;
      swipe([600, 300], [420, 306]);
      // fireEvent returns false when the default action (the navigation) was
      // prevented by the slider.
      expect(fireEvent.click(link)).toBe(false);
    });

    it("leaves an ordinary CTA click alone", () => {
      const hashed = slide(0, {
        elements: {
          ...slide(0).elements,
          ctaPrimary: { ...slide(0).elements!.ctaPrimary!, linkHref: "#shop" },
        },
      });
      render(<HeroSlider section={section([hashed, slide(1), slide(2)])} />);
      const link = element("ctaPrimary").querySelector("a") as HTMLAnchorElement;
      expect(fireEvent.click(link)).toBe(true);
    });

    it("rotates and paginates in the signed draft preview", async () => {
      render(
        <HeroSlider section={section(threeSlides())} interactionMode="preview" />,
      );
      expect(document.querySelectorAll("[data-pag-dot]")).toHaveLength(3);
      await advance(DURATION_MS);
      expect(activeIndex()).toBe(1);
    });

    it("swipes in the signed draft preview too", () => {
      render(
        <HeroSlider section={section(threeSlides())} interactionMode="preview" />,
      );
      swipe([600, 300], [420, 306]);
      expect(activeIndex()).toBe(1);
    });

    it("stops the browser from dragging the hero photo, which would hijack a swipe", () => {
      render(<HeroSlider section={section(threeSlides())} />);
      const image = slideWrappers()[0].querySelector("img") as HTMLElement;
      const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
      // dispatchEvent returns false when the default action was prevented.
      expect(image.dispatchEvent(dragStart)).toBe(false);
    });
  });
});

function screenWithin(root: HTMLElement, selector: string): HTMLElement | null {
  const node = root.querySelector(selector);
  return node instanceof HTMLElement ? node : null;
}