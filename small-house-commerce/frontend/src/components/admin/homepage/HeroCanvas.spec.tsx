import { useEffect, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditor,
  HomepageEditorProvider,
  useHomepageEditor,
  type BuilderDevice,
  type SafeAreaFlags,
} from "@/components/admin/homepage/HomepageEditor";
import {
  HeroCanvas,
  HeroSlider,
  SAFE_AREA_GUIDES,
  dragDeltaToPct,
  snapValue,
} from "@/components/admin/homepage/HeroCanvas";
import {
  emptyDocument,
  emptyElement,
  type ElementLayout,
  type HeroElementKey,
  type HomepageDocument,
  type HomepageSection,
} from "@/lib/homepage-document";
import type { HomepageDraftSnapshot } from "@/lib/admin-api";

const getHomepageDraft = vi.hoisted(() => vi.fn());
const saveHomepageDraft = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: { getHomepageDraft, saveHomepageDraft },
}));

// The full-editor test below mounts the shell, which gates on PRODUCT_MANAGE.
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ status: "authed", hasPermission: () => true }),
}));

const SLIDE_ID = "00000000-0000-7000-8000-000000000111";
const SLIDE_TWO_ID = "00000000-0000-7000-8000-000000000112";
const POINTER_ID = 7;
const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 500;

type HeroSection = Extract<HomepageSection, { type: "HERO" }>;

function heroSectionOf(doc: HomepageDocument): HeroSection {
  const section = doc.sections.find(({ type }) => type === "HERO");
  if (!section || section.type !== "HERO") {
    throw new Error("fixture expects a HERO section");
  }
  return section;
}

function canvasDocument(): HomepageDocument {
  const doc = emptyDocument();
  const slide = heroSectionOf(doc).payload.slides[0];
  slide.id = SLIDE_ID;
  slide.elements.heading.text = "Build a calmer home";
  slide.elements.heading.style = { fontSize: 40 };
  return doc;
}

function twoSlideDocument(): HomepageDocument {
  const doc = canvasDocument();
  const hero = heroSectionOf(doc);
  const second = structuredClone(hero.payload.slides[0]);
  second.id = SLIDE_TWO_ID;
  second.name = "Hero 2";
  second.sortOrder = 10;
  second.elements.heading.text = "Second slide heading";
  hero.payload.slides.push(second);
  return doc;
}

function withHeadingLayout(
  doc: HomepageDocument,
  patch: Partial<ElementLayout>,
): HomepageDocument {
  const heading = heroSectionOf(doc).payload.slides[0].elements.heading;
  heading.layout = { ...heading.layout, ...patch };
  return doc;
}

function withLockedHeading(doc: HomepageDocument): HomepageDocument {
  heroSectionOf(doc).payload.slides[0].elements.heading.locked = true;
  return doc;
}

function withTabletHeadingOverride(
  doc: HomepageDocument,
  options: { withStyle: boolean },
): HomepageDocument {
  const overrides =
    heroSectionOf(doc).payload.slides[0].elements.heading.overrides;
  overrides.tablet = {
    layout: { xPct: 20, yPct: 30 },
    ...(options.withStyle ? { style: { fontSize: 30 } } : {}),
  };
  return doc;
}

const ALL_FLAGS_OFF: SafeAreaFlags = {
  header: false,
  text: false,
  mobileCrop: false,
  mediaCrop: false,
  universal: false,
};

let capturedDocument: HomepageDocument | null = null;

function Harness({
  document: doc,
  device = "desktop",
  slideId = SLIDE_ID,
  safeAreaFlags = ALL_FLAGS_OFF,
}: {
  document: HomepageDocument;
  device?: BuilderDevice;
  slideId?: string | null;
  safeAreaFlags?: SafeAreaFlags;
}): ReactNode {
  const {
    dispatch,
    setDevice,
    setSelectedSlideId,
    setSafeAreaFlags,
  } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document: doc, rev: 1, savedAt: null });
    setSelectedSlideId(slideId);
    setDevice(device);
    setSafeAreaFlags(safeAreaFlags);
  }, [
    dispatch,
    doc,
    device,
    slideId,
    safeAreaFlags,
    setDevice,
    setSelectedSlideId,
    setSafeAreaFlags,
  ]);
  return null;
}

function Probe(): ReactNode {
  const { state, dispatch, device, selectedElementKey, setSelectedSlideId } =
    useHomepageEditor();
  return (
    <div>
      <pre data-testid="document">{JSON.stringify(state.document)}</pre>
      <span data-testid="past">{state.past.length}</span>
      <span data-testid="selected">{selectedElementKey ?? ""}</span>
      <span data-testid="device">{device}</span>
      <button
        type="button"
        onClick={() => {
          capturedDocument = state.document;
        }}
      >
        capture-document
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: "undo" })}
      >
        undo-document
      </button>
      <button type="button" onClick={() => setSelectedSlideId(SLIDE_TWO_ID)}>
        select-slide-two
      </button>
    </div>
  );
}

function renderCanvas(
  options: {
    document?: HomepageDocument;
    device?: BuilderDevice;
    slideId?: string | null;
    safeAreaFlags?: SafeAreaFlags;
  } = {},
) {
  const {
    document: doc = canvasDocument(),
    device = "desktop",
    slideId = SLIDE_ID,
    safeAreaFlags = ALL_FLAGS_OFF,
  } = options;
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Harness
          document={doc}
          device={device}
          slideId={slideId}
          safeAreaFlags={safeAreaFlags}
        />
        <HeroCanvas />
        <Probe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function documentFromProbe(): HomepageDocument {
  return JSON.parse(
    screen.getByTestId("document").textContent ?? "{}",
  ) as HomepageDocument;
}

function pastCount(): number {
  return Number(screen.getByTestId("past").textContent ?? "0");
}

function selectedKey(): string {
  return screen.getByTestId("selected").textContent ?? "";
}

function headingLayout(doc = documentFromProbe()): ElementLayout {
  return headingElement(doc).layout;
}

function headingElement(doc = documentFromProbe()) {
  return heroSectionOf(doc).payload.slides[0].elements.heading;
}

function element(key: HeroElementKey): HTMLElement {
  const node = document.querySelector(`[data-hero-element="${key}"]`);
  if (!(node instanceof HTMLElement)) {
    throw new Error(`missing element container for ${key}`);
  }
  return node;
}

function canvasRoot(): HTMLElement {
  const node = document.querySelector("[data-hero-canvas]");
  if (!(node instanceof HTMLElement)) {
    throw new Error("missing hero canvas root");
  }
  return node;
}

function stage(): HTMLElement {
  const node = document.querySelector("[data-hero-stage]");
  if (!(node instanceof HTMLElement)) {
    throw new Error("missing hero canvas stage");
  }
  return node;
}

function stageVar(name: string): number {
  return Number.parseFloat(stage().style.getPropertyValue(name));
}

function mockStageRect(
  width = STAGE_WIDTH,
  height = STAGE_HEIGHT,
): void {
  Object.defineProperty(stage(), "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function dragBy(
  key: HeroElementKey,
  dxPx: number,
  dyPx: number,
  options: { shift?: boolean; moves?: number } = {},
): void {
  const target = element(key);
  const moves = options.moves ?? 1;
  fireEvent.pointerDown(target, {
    clientX: 100,
    clientY: 100,
    pointerId: POINTER_ID,
    button: 0,
  });
  for (let index = 1; index <= moves; index += 1) {
    const step = index / moves;
    fireEvent.pointerMove(target, {
      clientX: 100 + dxPx * step,
      clientY: 100 + dyPx * step,
      pointerId: POINTER_ID,
      shiftKey: options.shift ?? false,
    });
  }
  fireEvent.pointerUp(target, {
    clientX: 100 + dxPx,
    clientY: 100 + dyPx,
    pointerId: POINTER_ID,
  });
}

function clickHeading(): void {
  fireEvent.click(element("heading"));
}

describe("dragDeltaToPct", () => {
  it("converts a pixel delta with the container width", () => {
    expect(dragDeltaToPct(50, 100, 1000)).toBe(60);
    expect(dragDeltaToPct(50, -100, 1000)).toBe(40);
  });

  it("clamps beyond the container to 0–100", () => {
    expect(dragDeltaToPct(50, -100000, 1000)).toBe(0);
    expect(dragDeltaToPct(50, 100000, 1000)).toBe(100);
  });

  it("returns a finite value for NaN and Infinity inputs", () => {
    expect(dragDeltaToPct(Number.NaN, 10, 1000)).toBe(1);
    expect(dragDeltaToPct(50, Number.NaN, 1000)).toBe(50);
    expect(dragDeltaToPct(50, Number.POSITIVE_INFINITY, 1000)).toBe(50);
    expect(dragDeltaToPct(50, 10, Number.POSITIVE_INFINITY)).toBe(50);
    for (const value of [
      dragDeltaToPct(Number.NaN, Number.NaN, Number.NaN),
      dragDeltaToPct(150, 10, 1000),
      dragDeltaToPct(-20, -10, 1000),
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("never divides by a zero or non-finite container width", () => {
    expect(dragDeltaToPct(30, 100, 0)).toBe(30);
    expect(dragDeltaToPct(30, 100, -50)).toBe(30);
    expect(dragDeltaToPct(30, 100, Number.NaN)).toBe(30);
  });
});

describe("snapValue", () => {
  it("snaps to the nearest guide inside the threshold", () => {
    expect(snapValue(50.4, [50])).toEqual({ value: 50, snapped: true });
    expect(snapValue(50, [49, 50.4])).toEqual({ value: 50.4, snapped: true });
  });

  it("treats the threshold boundary as inclusive", () => {
    expect(snapValue(51.5, [50], 1.5).snapped).toBe(true);
    expect(snapValue(48.5, [50], 1.5).snapped).toBe(true);
    expect(snapValue(51.6, [50], 1.5)).toEqual({
      value: 51.6,
      snapped: false,
    });
    expect(snapValue(48.4, [50], 1.5).snapped).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(snapValue(52, [50], 3)).toEqual({ value: 50, snapped: true });
    expect(snapValue(52, [50], 1)).toEqual({ value: 52, snapped: false });
  });

  it("ignores non-finite guides and reports no snap without guides", () => {
    expect(snapValue(50.2, [Number.NaN, Number.POSITIVE_INFINITY, 50])).toEqual(
      { value: 50, snapped: true },
    );
    expect(snapValue(50.2, [])).toEqual({ value: 50.2, snapped: false });
  });

  it("reports no snap for a non-finite percentage", () => {
    const result = snapValue(Number.NaN, [50]);
    expect(result.snapped).toBe(false);
    expect(Number.isNaN(result.value)).toBe(true);
  });
});

describe("HeroSlider inline contract", () => {
  it("renders the element containers read-only without selection chrome", () => {
    render(<HeroSlider section={heroSectionOf(canvasDocument())} />);
    expect(document.querySelectorAll("[data-hero-element]")).toHaveLength(7);
    expect(
      document.querySelector("[data-hero-selection-box]"),
    ).toBeNull();
    const slideNode = document.querySelector("[data-slide]");
    expect(slideNode?.getAttribute("data-slide")).toBe(SLIDE_ID);
  });

  it("marks containers selectable and reports clicks in edit mode", () => {
    const onSelectElement = vi.fn();
    render(
      <HeroSlider
        section={heroSectionOf(canvasDocument())}
        edit={{ selectedElementKey: "heading", onSelectElement }}
      />,
    );
    fireEvent.click(element("offer"));
    expect(onSelectElement).toHaveBeenCalledWith("offer");
    const box = element("heading").querySelector("[data-hero-selection-box]");
    expect(box).not.toBeNull();
    expect(box?.querySelectorAll("[data-hero-handle]")).toHaveLength(4);
  });
});

describe("HeroCanvas", () => {
  beforeEach(() => {
    setAdminLang("en");
    capturedDocument = null;
    getHomepageDraft.mockReset();
    saveHomepageDraft.mockReset();
  });

  it("renders the selected slide and falls back to the first slide", () => {
    renderCanvas({ document: twoSlideDocument() });
    expect(
      document.querySelector("[data-slide]")?.getAttribute("data-slide"),
    ).toBe(SLIDE_ID);

    fireEvent.click(screen.getByRole("button", { name: "select-slide-two" }));
    const slides = document.querySelectorAll("[data-slide]");
    expect(slides).toHaveLength(1);
    expect(slides[0].getAttribute("data-slide")).toBe(SLIDE_TWO_ID);
  });

  it("injects the selected device's effective layout into the stage", () => {
    const doc = withTabletHeadingOverride(canvasDocument(), {
      withStyle: false,
    });
    renderCanvas({ document: doc, device: "tablet", slideId: SLIDE_ID });
    expect(stageVar("--el-heading-x")).toBe(20);
    expect(stageVar("--el-heading-y")).toBe(30);
    expect(stageVar("--el-eyebrow-x")).toBe(7.4);
    expect(stageVar("--el-heading-size")).toBe(40);
  });

  it("selects an element on click and shows the toolbar with the selection box", () => {
    renderCanvas();
    expect(
      document.querySelector("[data-hero-toolbar]"),
    ).toBeNull();

    clickHeading();
    expect(selectedKey()).toBe("heading");
    expect(
      document.querySelector("[data-hero-toolbar]"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Align left" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Align middle" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reset position" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Lock" })).toBeVisible();

    const box = element("heading").querySelector("[data-hero-selection-box]");
    expect(box).not.toBeNull();
    expect(box?.querySelectorAll("[data-hero-handle]")).toHaveLength(4);
  });

  it("clears the element selection on an empty-canvas click", () => {
    renderCanvas();
    clickHeading();
    expect(selectedKey()).toBe("heading");

    fireEvent.click(canvasRoot());
    expect(selectedKey()).toBe("");
    expect(document.querySelector("[data-hero-toolbar]")).toBeNull();
  });

  it("clears the element selection with Escape", () => {
    renderCanvas();
    clickHeading();
    fireEvent.keyDown(canvasRoot(), { key: "Escape" });
    expect(selectedKey()).toBe("");
  });

  it("cycles the element selection with Tab and Shift+Tab", () => {
    renderCanvas();
    clickHeading();
    expect(selectedKey()).toBe("heading");

    expect(fireEvent.keyDown(canvasRoot(), { key: "Tab" })).toBe(false);
    expect(selectedKey()).toBe("subheading");
    expect(
      fireEvent.keyDown(canvasRoot(), { key: "Tab", shiftKey: true }),
    ).toBe(false);
    expect(selectedKey()).toBe("heading");

    fireEvent.click(element("countdown"));
    fireEvent.keyDown(canvasRoot(), { key: "Tab" });
    expect(selectedKey()).toBe("eyebrow");
  });

  it("does not intercept Tab or arrows from a focusable descendant", () => {
    renderCanvas();
    clickHeading();
    const descendant = document.createElement("button");
    descendant.type = "button";
    canvasRoot().appendChild(descendant);

    expect(fireEvent.keyDown(descendant, { key: "Tab" })).toBe(true);
    expect(selectedKey()).toBe("heading");

    const input = document.createElement("input");
    canvasRoot().appendChild(input);
    const before = pastCount();
    expect(fireEvent.keyDown(input, { key: "ArrowRight" })).toBe(true);
    expect(pastCount()).toBe(before);
    expect(headingLayout().xPct).toBe(7.4);
  });

  it("drags an element, previews live and commits exactly once on pointerup", () => {
    renderCanvas();
    mockStageRect();
    const initial = JSON.stringify(documentFromProbe());
    const target = element("heading");

    fireEvent.pointerDown(target, {
      clientX: 100,
      clientY: 100,
      pointerId: POINTER_ID,
      button: 0,
    });
    // 126px at 1000px width = 12.6% -> raw x 20, clear of every snap guide.
    fireEvent.pointerMove(target, {
      clientX: 226,
      clientY: 100,
      pointerId: POINTER_ID,
    });

    // Live preview: the injected var moves, the reducer document does not.
    expect(pastCount()).toBe(0);
    expect(JSON.stringify(documentFromProbe())).toBe(initial);
    expect(stageVar("--el-heading-x")).toBeCloseTo(20, 6);
    expect(Number.isFinite(stageVar("--el-heading-y"))).toBe(true);

    // 228px -> raw x 30.2, whose center lands 0.2 from the centerline.
    fireEvent.pointerMove(target, {
      clientX: 328,
      clientY: 100,
      pointerId: POINTER_ID,
    });
    expect(pastCount()).toBe(0);
    expect(JSON.stringify(documentFromProbe())).toBe(initial);
    expect(stageVar("--el-heading-x")).toBeCloseTo(30, 6);
    expect(
      document.querySelector("[data-hero-guide='x']"),
    ).not.toBeNull();

    fireEvent.pointerUp(target, {
      clientX: 328,
      clientY: 100,
      pointerId: POINTER_ID,
    });

    expect(pastCount()).toBe(1);
    expect(headingLayout().xPct).toBeCloseTo(30, 6);
    expect(headingLayout().yPct).toBeCloseTo(22.8, 6);
    expect(stageVar("--el-heading-x")).toBeCloseTo(30, 6);
    expect(document.querySelector("[data-hero-guide='x']")).toBeNull();
  });

  it("does not commit a pointer gesture that never moved", () => {
    renderCanvas();
    mockStageRect();
    const target = element("heading");
    fireEvent.pointerDown(target, {
      clientX: 100,
      clientY: 100,
      pointerId: POINTER_ID,
      button: 0,
    });
    fireEvent.pointerUp(target, {
      clientX: 100,
      clientY: 100,
      pointerId: POINTER_ID,
    });
    expect(pastCount()).toBe(0);
    expect(headingLayout().xPct).toBe(7.4);
  });

  it("clamps a drag beyond the container to 0–100 and never writes NaN", () => {
    renderCanvas();
    mockStageRect();
    dragBy("heading", -100000, -100000);
    const layout = headingLayout();
    expect(layout.xPct).toBe(0);
    expect(layout.yPct).toBe(0);
    expect(Number.isFinite(layout.xPct)).toBe(true);
    expect(Number.isFinite(layout.yPct)).toBe(true);

    dragBy("heading", 100000, 100000);
    expect(headingLayout().xPct).toBe(100);
    expect(headingLayout().yPct).toBe(100);
    expect(JSON.stringify(documentFromProbe())).not.toContain("NaN");
    expect(JSON.stringify(documentFromProbe())).not.toContain("Infinity");
  });

  it("keeps the element in place when the container measures zero", () => {
    renderCanvas();
    mockStageRect(0, 0);
    dragBy("heading", 200, 200);
    expect(pastCount()).toBe(0);
    expect(headingLayout().xPct).toBe(7.4);
    expect(Number.isFinite(stageVar("--el-heading-x"))).toBe(true);
  });

  it("snaps a drag to the container centerline within 1.5%", () => {
    renderCanvas();
    mockStageRect();
    // 228px at 1000px width = 22.8% -> raw x 30.2, whose center lands on 50.2.
    dragBy("heading", 228, 0);
    expect(headingLayout().xPct).toBeCloseTo(30, 6);
  });

  it("snaps a drag to another element's edge within 1.5%", () => {
    renderCanvas();
    mockStageRect();
    // 238px -> raw x 31.2, 0.2 away from ctaSecondary's left edge at 31.
    dragBy("heading", 238, 0);
    expect(headingLayout().xPct).toBeCloseTo(31, 6);
  });

  it("bypasses snapping while Shift is held", () => {
    renderCanvas();
    mockStageRect();
    dragBy("heading", 228, 0, { shift: true });
    expect(headingLayout().xPct).toBeCloseTo(30.2, 6);
  });

  it("snaps a vertical drag to the header line converted from 80px", () => {
    renderCanvas();
    mockStageRect();
    // 500px tall stage -> the header line sits at 80 / 500 * 100 = 16%.
    const headerPct = (SAFE_AREA_GUIDES.headerPx / STAGE_HEIGHT) * 100;
    // -29px at 500px height = -5.8% -> raw y 17, 1.0 away from the header line.
    dragBy("heading", 0, -29);
    expect(headingLayout().yPct).toBeCloseTo(headerPct, 6);
    expect(document.querySelector("[data-hero-guide='y']")).toBeNull();
  });

  it("shows alignment guides during the drag and removes them after", () => {
    renderCanvas();
    mockStageRect();
    const target = element("heading");
    fireEvent.pointerDown(target, {
      clientX: 100,
      clientY: 100,
      pointerId: POINTER_ID,
      button: 0,
    });
    fireEvent.pointerMove(target, {
      clientX: 328,
      clientY: 100,
      pointerId: POINTER_ID,
    });

    const guide = document.querySelector("[data-hero-guide='x']");
    expect(guide).not.toBeNull();
    expect(guide).toHaveStyle({
      left: `${SAFE_AREA_GUIDES.centerlinePct}%`,
    });

    fireEvent.pointerUp(target, {
      clientX: 328,
      clientY: 100,
      pointerId: POINTER_ID,
    });
    expect(document.querySelector("[data-hero-guide='x']")).toBeNull();
  });

  it("nudges the selected element with the arrow keys and commits once each", () => {
    renderCanvas();
    mockStageRect();
    clickHeading();
    const root = canvasRoot();

    expect(fireEvent.keyDown(root, { key: "ArrowRight" })).toBe(false);
    expect(headingLayout().xPct).toBeCloseTo(7.9, 6);
    expect(pastCount()).toBe(1);

    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(headingLayout().xPct).toBeCloseTo(7.4, 6);
    expect(pastCount()).toBe(2);

    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(headingLayout().yPct).toBeCloseTo(23.3, 6);
    fireEvent.keyDown(root, { key: "ArrowUp" });
    expect(headingLayout().yPct).toBeCloseTo(22.8, 6);
    expect(pastCount()).toBe(4);
  });

  it("converts Shift+Arrow into the 10px drag conversion", () => {
    renderCanvas();
    mockStageRect();
    clickHeading();
    // 10px at a 1000px container = 1%, not the plan's literal 5%.
    fireEvent.keyDown(canvasRoot(), { key: "ArrowRight", shiftKey: true });
    expect(headingLayout().xPct).toBeCloseTo(8.4, 6);
    expect(pastCount()).toBe(1);
  });

  it("does not move a locked element and shows the lock state in the toolbar", () => {
    renderCanvas({ document: withLockedHeading(canvasDocument()) });
    mockStageRect();
    clickHeading();
    expect(selectedKey()).toBe("heading");

    const lockButton = screen.getByRole("button", { name: "Unlock" });
    expect(lockButton).toHaveAttribute("aria-pressed", "true");

    dragBy("heading", 200, 0);
    expect(pastCount()).toBe(0);
    expect(headingLayout().xPct).toBe(7.4);
    expect(headingLayout().yPct).toBe(22.8);

    fireEvent.keyDown(canvasRoot(), { key: "ArrowRight" });
    expect(headingLayout().xPct).toBe(7.4);
    expect(pastCount()).toBe(0);

    fireEvent.click(lockButton);
    expect(headingElement().locked).toBe(false);
    expect(pastCount()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    expect(headingElement().locked).toBe(true);
    expect(pastCount()).toBe(2);
  });

  it("resets the desktop layout to the Task 8 default", () => {
    renderCanvas({ document: withHeadingLayout(canvasDocument(), { xPct: 33 }) });
    clickHeading();
    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));

    expect(headingLayout()).toEqual(emptyElement("heading").layout);
    expect(pastCount()).toBe(1);
  });

  it("makes a desktop reset a true no-op when nothing would change", () => {
    renderCanvas();
    clickHeading();
    fireEvent.click(screen.getByRole("button", { name: "capture-document" }));
    const before = capturedDocument;

    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));

    fireEvent.click(screen.getByRole("button", { name: "capture-document" }));
    expect(capturedDocument).toBe(before);
    expect(pastCount()).toBe(0);
  });

  it("removes only the device layout override on a tablet reset", () => {
    renderCanvas({
      document: withTabletHeadingOverride(canvasDocument(), {
        withStyle: true,
      }),
      device: "tablet",
    });
    clickHeading();
    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));

    const overrides =
      heroSectionOf(documentFromProbe()).payload.slides[0].elements.heading
        .overrides;
    expect(overrides.tablet?.layout).toBeUndefined();
    expect(overrides.tablet?.style).toEqual({ fontSize: 30 });
    expect(headingLayout().xPct).toBe(7.4);
    expect(pastCount()).toBe(1);
  });

  it("drops a device override that only carried a layout", () => {
    renderCanvas({
      document: withTabletHeadingOverride(canvasDocument(), {
        withStyle: false,
      }),
      device: "tablet",
    });
    clickHeading();
    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));

    const overrides =
      heroSectionOf(documentFromProbe()).payload.slides[0].elements.heading
        .overrides;
    expect(overrides.tablet).toBeUndefined();
  });

  it("makes a tablet reset a true no-op without a layout override", () => {
    renderCanvas({ device: "tablet" });
    clickHeading();
    fireEvent.click(screen.getByRole("button", { name: "capture-document" }));
    const before = capturedDocument;

    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));

    fireEvent.click(screen.getByRole("button", { name: "capture-document" }));
    expect(capturedDocument).toBe(before);
    expect(pastCount()).toBe(0);
  });

  it("writes tablet drags to the device override, never to the base layout", () => {
    renderCanvas({ device: "tablet" });
    mockStageRect();
    dragBy("heading", 100, 0);

    const heading =
      heroSectionOf(documentFromProbe()).payload.slides[0].elements.heading;
    expect(heading.layout.xPct).toBe(7.4);
    expect(heading.layout.yPct).toBe(22.8);
    expect(heading.overrides.tablet?.layout?.xPct).toBeCloseTo(17.4, 6);
    expect(heading.overrides.tablet?.layout?.yPct).toBeCloseTo(22.8, 6);
    expect(pastCount()).toBe(1);
  });

  it("writes align and vertical align enum fields device-aware", () => {
    renderCanvas();
    clickHeading();
    fireEvent.click(screen.getByRole("button", { name: "Align center" }));
    expect(headingLayout().align).toBe("CENTER");
    fireEvent.click(screen.getByRole("button", { name: "Align bottom" }));
    expect(headingLayout().verticalAlign).toBe("BOTTOM");
    expect(headingLayout().xPct).toBe(7.4);
    expect(pastCount()).toBe(2);
  });

  it("writes tablet align changes into the device override", () => {
    renderCanvas({ device: "tablet" });
    clickHeading();
    fireEvent.click(screen.getByRole("button", { name: "Align right" }));

    const heading =
      heroSectionOf(documentFromProbe()).payload.slides[0].elements.heading;
    expect(heading.overrides.tablet?.layout?.align).toBe("RIGHT");
    expect(heading.layout.align).toBe("LEFT");
    expect(pastCount()).toBe(1);
  });

  const SAFE_AREA_CASES = [
    { flag: "header", selector: '[data-safe-area="header"]' },
    { flag: "text", selector: '[data-safe-area="text"]' },
    { flag: "mobileCrop", selector: '[data-safe-area="mobileCrop"]' },
    { flag: "mediaCrop", selector: '[data-safe-area="mediaCrop"]' },
    { flag: "universal", selector: '[data-safe-area="universal"]' },
  ] as const;

  it.each(SAFE_AREA_CASES)(
    "shows exactly the $flag safe-area overlay when its flag is on",
    ({ flag }) => {
      const flags: SafeAreaFlags = { ...ALL_FLAGS_OFF };
      flags[flag] = true;
      renderCanvas({ safeAreaFlags: flags });
      for (const candidate of SAFE_AREA_CASES) {
        const node = document.querySelector(candidate.selector);
        if (candidate.flag === flag) {
          expect(node).not.toBeNull();
          expect(node).toHaveClass("pointer-events-none");
        } else {
          expect(node).toBeNull();
        }
      }
    },
  );

  it("draws every overlay from the SAFE_AREA_GUIDES constants", () => {
    renderCanvas({
      safeAreaFlags: {
        header: true,
        text: true,
        mobileCrop: true,
        mediaCrop: true,
        universal: true,
      },
    });

    expect(document.querySelector('[data-safe-area="header"]')).toHaveStyle({
      top: `${SAFE_AREA_GUIDES.headerPx}px`,
    });
    for (const name of ["text", "mediaCrop", "mobileCrop", "universal"] as const) {
      const rect = SAFE_AREA_GUIDES[name];
      expect(
        document.querySelector(`[data-safe-area="${name}"]`),
      ).toHaveStyle({
        left: `${rect.xPct}%`,
        top: `${rect.yPct}%`,
        width: `${rect.widthPct}%`,
        height: `${rect.heightPct}%`,
      });
    }
  });

  it("keeps the canvas inside the device frame with right-pane routing intact", async () => {
    getHomepageDraft.mockResolvedValue({
      draft: canvasDocument(),
      draftRev: 3,
      draftUpdatedAt: "2026-09-28T02:00:00.000Z",
      draftUpdatedById: "admin-1",
      published: null,
    } satisfies HomepageDraftSnapshot);
    saveHomepageDraft.mockResolvedValue({
      draftRev: 4,
      draftUpdatedAt: "2026-09-28T03:00:00.000Z",
    });

    render(
      <AdminI18nProvider>
        <HomepageEditor />
      </AdminI18nProvider>,
    );
    await screen.findByRole("button", { name: "Save Draft" });

    const viewport = document.querySelector("[data-preview-viewport]");
    expect(viewport).not.toBeNull();
    expect(
      viewport?.querySelector('[data-panel="hero-canvas"]'),
    ).not.toBeNull();

    fireEvent.click(element("heading"));
    expect(document.querySelector('[data-panel="settings-panel"]')).not.toBeNull();
    expect(
      document.querySelector('[data-panel="hero-media-settings"]'),
    ).toBeNull();
  });
});
