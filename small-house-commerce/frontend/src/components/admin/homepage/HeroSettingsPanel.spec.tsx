import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { HomepageEditorProvider, useHomepageEditor } from "./HomepageEditor";
import { HeroSettingsPanel } from "./HeroSettingsPanel";
import { emptyDocument, updateHeroElement, type HeroElementKey, type HomepageDocument } from "@/lib/homepage-document";

vi.mock("@/lib/admin-api", () => ({ adminApi: {
  listProducts: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
  listCategories: vi.fn().mockResolvedValue([]),
  listCollections: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  listLandingPages: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
  getProduct: vi.fn().mockRejectedValue(new Error("not found")),
} }));

const SLIDE = "00000000-0000-7000-8000-000000000111";
const SECOND = "00000000-0000-7000-8000-000000000112";

function fixture(): HomepageDocument {
  const document = emptyDocument();
  const hero = document.sections[0];
  if (hero.type !== "HERO") throw new Error("expected Hero");
  const slide = hero.payload.slides[0];
  slide.id = SLIDE;
  slide.name = "Calmer mornings";
  slide.elements.heading.text = "Room to breathe";
  slide.elements.heading.style.fontSize = 40;
  const second = structuredClone(slide);
  second.id = SECOND;
  second.name = "Second slide";
  second.sortOrder = 10;
  hero.payload.slides.push(second);
  return document;
}

function Setup({ document, slideId }: { document: HomepageDocument; slideId: string | null }): ReactNode {
  const { dispatch, setSelectedSlideId } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 3, savedAt: null });
    setSelectedSlideId(slideId);
  }, [dispatch, document, slideId, setSelectedSlideId]);
  return null;
}

function Probe(): ReactNode {
  const { state, dispatch, device, setDevice, selectedElementKey, setSelectedElementKey, setSelectedSlideId } = useHomepageEditor();
  return <div>
    <pre data-testid="document">{JSON.stringify(state.document)}</pre>
    <span data-testid="commits">{state.past.length}</span>
    <span data-testid="selection">{selectedElementKey ?? "none"}</span>
    <span data-testid="device">{device}</span>
    <button onClick={() => setDevice("mobile")}>program-device</button>
    <button onClick={() => setSelectedSlideId(SECOND)}>program-slide</button>
    <button onClick={() => setSelectedElementKey("ctaPrimary")}>program-element</button>
    <button onClick={() => setSelectedElementKey("heading")}>select-heading</button>
    <button onClick={() => dispatch({ type: "mutate", mutate: (document) => updateHeroElement(document, SLIDE, "heading", { text: "External heading" }) })}>external-edit</button>
    <button onClick={() => dispatch({ type: "undo" })}>undo</button>
    <button onClick={() => dispatch({ type: "redo" })}>redo</button>
  </div>;
}

function mount(document = fixture(), slideId: string | null = SLIDE) {
  return render(<AdminI18nProvider><HomepageEditorProvider>
    <Setup document={document} slideId={slideId} />
    <section data-homepage-settings-scroll><HeroSettingsPanel /></section>
    <Probe />
  </HomepageEditorProvider></AdminI18nProvider>);
}
function current(): HomepageDocument {
  return JSON.parse(screen.getByTestId("document").textContent ?? "{}");
}
function slide(id = SLIDE) {
  const hero = current().sections[0];
  if (hero.type !== "HERO") throw new Error("expected Hero");
  const result = hero.payload.slides.find((item) => item.id === id);
  if (!result) throw new Error("expected slide");
  return result;
}
function fieldset(key: HeroElementKey): HTMLElement {
  const result = document.querySelector<HTMLElement>(`[data-hero-element="${key}"]`);
  if (!result) throw new Error(`missing element ${key}`);
  return result;
}
function shortcut(name: string): void {
  fireEvent.click(within(screen.getByRole("navigation", { name: "Hero settings shortcuts" })).getByRole("button", { name }));
}
/** The text group shows one editor at a time; pick the element first. */
function pickText(name: string): void {
  fireEvent.click(within(screen.getByRole("group", { name: "Text elements" })).getByRole("button", { name }));
}
function openAdvanced(key: HeroElementKey): void {
  const details = fieldset(key).querySelector("details")!;
  fireEvent.click(within(details).getByText("Advanced", { selector: "summary" }));
}
async function advance(ms = 1000): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  setAdminLang("en");
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HeroSettingsPanel", () => {
  it("separates layout, text, links, media, overlay, behavior and spacing without editing the document", () => {
    mount();
    const before = current();
    expect([...document.querySelectorAll('[data-panel="hero-settings"] > details')].map(node => node.getAttribute('data-settings-group')))
      .toEqual(["layout", "text", "buttons", "media", "overlay", "behavior", "advanced"]);
    const layout = document.querySelector<HTMLElement>('[data-settings-group="layout"]')!;
    fireEvent.click(within(layout).getByRole("button", { name: /banner/i }));
    const updated = current().sections[0];
    expect(updated.type === "HERO" && updated.payload.display?.heightMode).toBe("BANNER");
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(current()).toEqual(before);
  });

  it("shows one text editor at a time while preserving all seven elements and canvas selection", async () => {
    mount();
    shortcut("Text");
    const chooser = screen.getByRole("group", { name: "Text elements" });
    expect(within(fieldset("heading")).getByRole("textbox", { name: "Text" })).toBeVisible();
    expect(fieldset("offer")).not.toBeVisible();
    fireEvent.click(within(chooser).getByRole("button", { name: "Offer" }));
    expect(fieldset("heading")).not.toBeVisible();
    const input = within(fieldset("offer")).getByRole("textbox", { name: "Offer text" });
    fireEvent.change(input, { target: { value: "A smaller footprint" } });
    fireEvent.blur(input);
    await advance();
    expect(slide().elements.offer.text).toBe("A smaller footprint");
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
    expect(Object.keys(slide().elements)).toHaveLength(7);
  });
  it("uses the same first-slide fallback for media, overlay and text when no slide is selected", () => {
    mount(fixture(), null);
    shortcut("Images and video");
    const media = document.querySelector<HTMLElement>('[data-settings-group="media"]')!;
    expect(within(media).getByRole("button", { name: "Image" })).toBeVisible();
    shortcut("Page layout");
    const layout = document.querySelector<HTMLElement>('[data-settings-group="layout"]')!;
    expect(within(layout).getByRole("group", { name: "Fit mode" })).toBeVisible();
    fireEvent.click(screen.getByText("Text overlay and readability", { selector: "summary" }));
    expect(screen.getByRole("slider", { name: "Overlay opacity" })).toBeVisible();
    expect(screen.getByTestId("commits")).toHaveTextContent("0");
  });

  it.each([
    ["eyebrow", "Text", "A considered home"],
    ["heading", "Text", "Space for every day"],
    ["subheading", "Text", "Furniture for small spaces"],
    ["offer", "Offer text", "Make room for more"],
    ["countdown", "Text", "The collection arrives soon"],
    ["ctaPrimary", "Text", "Explore the collection"],
    ["ctaSecondary", "Text", "Find your room"],
  ] as const)("edits %s through its own fieldset without changing canvas selection", async (key, label, text) => {
    mount();
    shortcut(key === "ctaPrimary" || key === "ctaSecondary" ? "Buttons and links" : "Text");
    if (key !== "ctaPrimary" && key !== "ctaSecondary") pickText(key === "offer" ? "Offer" : key.charAt(0).toUpperCase() + key.slice(1));
    const input = within(fieldset(key)).getByRole("textbox", { name: label });
    input.focus();
    fireEvent.change(input, { target: { value: text.slice(0, -1) } });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: text } });
    await advance(300);
    expect(input).toHaveFocus();
    expect(slide().elements[key].text).toBe(text);
    expect(slide(SECOND).elements[key].text).not.toBe(text);
    expect(screen.getByTestId("selection")).toHaveTextContent("none");
    expect(screen.getByTestId("commits")).toHaveTextContent("1");
  });

  it.each(["program-device", "program-slide", "program-element"])("cancels an unblurred buffered draft on %s", async (change) => {
    mount();
    shortcut("Text");
    const input = within(fieldset("heading")).getByRole("textbox", { name: "Text" });
    fireEvent.change(input, { target: { value: "Uncommitted draft" } });
    fireEvent.click(screen.getByRole("button", { name: change }));
    await advance();
    expect(slide().elements.heading.text).toBe("Room to breathe");
    expect(slide(SECOND).elements.heading.text).toBe("Room to breathe");
    expect(screen.getByTestId("commits")).toHaveTextContent("0");
  });

  it("commits a real blur to the original element before switching device", async () => {
    mount();
    shortcut("Text");
    const input = within(fieldset("heading")).getByRole("textbox", { name: "Text" });
    fireEvent.change(input, { target: { value: "Committed first" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "program-device" }));
    await advance();
    expect(slide().elements.heading.text).toBe("Committed first");
    expect(slide(SECOND).elements.heading.text).toBe("Room to breathe");
    expect(screen.getByTestId("commits")).toHaveTextContent("1");
  });

  it("preserves concurrent edits when a delayed color applies to the latest document", async () => {
    mount();
    shortcut("Buttons and links");
    openAdvanced("ctaPrimary");
    const swatch = within(fieldset("ctaPrimary")).getByLabelText("Background: Pick color");
    fireEvent.input(swatch, { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: "external-edit" }));
    await advance();
    expect(slide().elements.ctaPrimary.button.background).toBe("#123456");
    expect(slide().elements.heading.text).toBe("External heading");
  });

  it("scrolls only the right pane and leaves every group mounted", async () => {
    mount();
    const wholePage = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const container = document.querySelector<HTMLElement>("[data-homepage-settings-scroll]")!;
    const buttons = document.querySelector<HTMLElement>('[data-settings-group="buttons"]')!;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ top: 50 } as DOMRect);
    vi.spyOn(buttons, "getBoundingClientRect").mockReturnValue({ top: 500 } as DOMRect);
    vi.spyOn(document.querySelector<HTMLElement>('[data-panel="hero-settings"] header')!, "getBoundingClientRect").mockReturnValue({ height: 120 } as DOMRect);
    container.scrollTop = 80;
    const before = current();
    shortcut("Buttons and links");
    await advance(20);
    expect(buttons).toHaveAttribute("open");
    expect(container.scrollTo).toHaveBeenLastCalledWith({ top: 394, behavior: "smooth" });
    expect(wholePage).not.toHaveBeenCalled();
    for (const key of ["eyebrow", "heading", "subheading", "offer", "countdown", "ctaPrimary", "ctaSecondary"] as const) {
      expect(fieldset(key).querySelector("textarea")).not.toBeNull();
      expect(fieldset(key).querySelector("details")).not.toHaveAttribute("open");
    }
    expect(current()).toEqual(before);
    expect(screen.getByTestId("commits")).toHaveTextContent("0");
  });

  it("reveals the canvas-selected element and retains the current slide/device context", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "program-element" }));
    expect(screen.getByTestId("selection")).toHaveTextContent("ctaPrimary");
    expect(document.querySelector("[data-hero-settings-context]")).toHaveTextContent(/Primary/i);
    expect(document.querySelector('[data-settings-group="buttons"]')).toHaveAttribute("open");
    expect(within(fieldset("ctaPrimary")).getByRole("combobox", { name: "Link type" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "select-heading" }));
    expect(document.querySelector('[data-settings-group="text"]')).toHaveAttribute("open");
    expect(within(fieldset("heading")).getByRole("textbox", { name: "Text" })).toBeVisible();
    expect(document.querySelector("[data-hero-settings-context]")).toHaveTextContent(/Heading/i);
    fireEvent.click(screen.getByRole("button", { name: "program-device" }));
    fireEvent.click(screen.getByRole("button", { name: "program-slide" }));
    await advance(20);
    expect(document.querySelector("[data-hero-settings-context]")).toHaveTextContent(/Second slide.*Heading.*Mobile/i);
    expect(screen.getByTestId("commits")).toHaveTextContent("0");
  });

  it("keeps width, height, carousel, overlay, safe area, focal and video controls reachable", () => {
    const document_ = fixture();
    const hero = document_.sections[0];
    if (hero.type !== "HERO") throw new Error("expected Hero");
    hero.payload.slides[0].media = {
      type: "VIDEO", image: null, fit: "CONTAIN",
      video: { url: "/uploads/studio-video.mp4", poster: "/uploads/studio-poster.jpg", autoplay: true, muted: true, loop: true, playsInline: true, showSoundToggle: false, pauseOffscreen: true },
      mobileOverride: { enabled: false, image: null, video: null },
      focal: { x: 50, y: 50 },
      objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
    };
    mount(document_);
    shortcut("Page layout");
    const layout = document.querySelector<HTMLElement>('[data-settings-group="layout"]')!;
    expect(within(layout).getByRole("group", { name: "Hero height" })).toBeVisible();
    expect(within(layout).getByLabelText("Media focal point preview")).toBeVisible();
    const behavior = screen.getByText("Carousel behavior and display", { selector: "summary" });
    expect(behavior.parentElement).not.toHaveAttribute("open");
    fireEvent.click(behavior);
    expect(within(behavior.parentElement as HTMLElement).getByRole("checkbox", { name: "Autoplay" })).toBeVisible();
    fireEvent.click(screen.getByText("Text overlay and readability", { selector: "summary" }));
    expect(screen.getByRole("slider", { name: "Overlay opacity" })).toBeVisible();
    shortcut("Images and video");
    const media = document.querySelector<HTMLElement>('[data-settings-group="media"]')!;
    expect(within(media).getByRole("button", { name: "Video" })).toBeVisible();
    expect(within(media).getByRole("checkbox", { name: "Text safe area" })).toBeVisible();
    expect(within(media).getByRole("checkbox", { name: "Muted" })).toBeVisible();
    expect(within(media).getByRole("checkbox", { name: "Loop" })).toBeVisible();
    expect(within(media).getByRole("checkbox", { name: "Plays inline (iOS)" })).toBeVisible();
    shortcut("Text");
    pickText("Countdown");
    expect(within(fieldset("countdown")).getByLabelText("Countdown ends at")).toBeVisible();
    pickText("Offer");
    openAdvanced("offer");
    expect(within(fieldset("offer")).getByRole("textbox", { name: "Background" })).toBeVisible();
  });

  it("reopens the edited document without losing links, countdown or per-device typography", async () => {
    const first = mount();
    shortcut("Buttons and links");
    const primary = within(fieldset("ctaPrimary"));
    fireEvent.change(primary.getByRole("combobox", { name: "Link type" }), { target: { value: "EXTERNAL" } });
    const path = primary.getByRole("textbox", { name: "External URL (https only)" });
    fireEvent.change(path, { target: { value: "https://example.com/small-spaces" } });
    fireEvent.blur(path);
    shortcut("Text");
    fireEvent.change(within(fieldset("countdown")).getByLabelText("Countdown ends at"), { target: { value: "2026-11-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "program-device" }));
    openAdvanced("heading");
    const size = within(fieldset("heading")).getByRole("textbox", { name: "Font size" });
    fireEvent.change(size, { target: { value: "28" } });
    fireEvent.blur(size);
    await advance();
    const saved = current();
    first.unmount();
    mount(saved);
    expect(slide().elements.ctaPrimary.link).toEqual({ type: "EXTERNAL", url: "https://example.com/small-spaces" });
    expect(slide().elements.countdown.endsAt).toBe(new Date("2026-11-01T10:00").toISOString());
    expect(slide().elements.heading.style.fontSize).toBe(40);
    expect(slide().elements.heading.overrides.mobile?.style?.fontSize).toBe(28);
  });
});
