import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditorProvider,
  useHomepageEditor,
  type BuilderDevice,
} from "@/components/admin/homepage/HomepageEditor";
import { SettingsPanel } from "@/components/admin/homepage/SettingsPanel";
import {
  emptyDocument,
  emptyElement,
  updateHeroElement,
  type HeroElementKey,
  type HomepageDocument,
} from "@/lib/homepage-document";
import type { AdminProduct } from "@/lib/admin-api";

const listProducts = vi.hoisted(() => vi.fn());
const listCategories = vi.hoisted(() => vi.fn());
const listCollections = vi.hoisted(() => vi.fn());
const listLandingPages = vi.hoisted(() => vi.fn());
const getProduct = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    listProducts,
    listCategories,
    listCollections,
    listLandingPages,
    getProduct,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  listCollections.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  listCategories.mockResolvedValue([]);
  listLandingPages.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  getProduct.mockReset();
  getProduct.mockRejectedValue(new Error("not found"));
});

const SLIDE_ID = "00000000-0000-7000-8000-000000000111";
const SLIDE_TWO_ID = "00000000-0000-7000-8000-000000000112";
const PRODUCT_UUID = "11111111-2222-4333-8444-555555555555";

function panelDocument(): HomepageDocument {
  const doc = emptyDocument();
  const hero = doc.sections[0];
  if (hero.type !== "HERO") throw new Error("fixture expects a HERO section");
  const slide = hero.payload.slides[0];
  slide.id = SLIDE_ID;
  slide.elements.heading.text = "Build a calmer home";
  slide.elements.heading.style = { fontSize: 40, textColor: "#292724" };
  return doc;
}

function twoSlideDocument(): HomepageDocument {
  const doc = panelDocument();
  const hero = doc.sections[0];
  if (hero.type !== "HERO") throw new Error("fixture expects a HERO section");
  const second = structuredClone(hero.payload.slides[0]);
  second.id = SLIDE_TWO_ID;
  second.name = "Hero 2";
  second.sortOrder = 10;
  second.elements.heading.text = "Second slide heading";
  second.elements.heading.style = { fontSize: 20 };
  hero.payload.slides.push(second);
  return doc;
}

/** Two slides whose heading text is identical (the external value does not
 *  change across the switch, so only the keyed remount can isolate them). */
function twinHeadingDocument(): HomepageDocument {
  const doc = twoSlideDocument();
  const hero = doc.sections[0];
  if (hero.type !== "HERO") throw new Error("fixture expects a HERO section");
  hero.payload.slides[1].elements.heading.text =
    hero.payload.slides[0].elements.heading.text;
  return doc;
}

function Harness({
  document,
  elementKey,
  device = "desktop",
}: {
  document: HomepageDocument;
  elementKey: HeroElementKey;
  device?: BuilderDevice;
}): ReactNode {
  const {
    dispatch,
    setDevice,
    setSelectedElementKey,
    setSelectedSlideId,
  } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 2, savedAt: null });
    setSelectedSlideId(SLIDE_ID);
    setSelectedElementKey(elementKey);
    setDevice(device);
  }, [
    device,
    dispatch,
    document,
    elementKey,
    setDevice,
    setSelectedElementKey,
    setSelectedSlideId,
  ]);
  return null;
}

function PanelProbe(): ReactNode {
  const {
    state,
    dispatch,
    selectedElementKey,
    device,
    setDevice,
    setSelectedSlideId,
  } = useHomepageEditor();
  return (
    <div>
      <pre data-testid="document">{JSON.stringify(state.document)}</pre>
      <span data-testid="commits">{state.past.length}</span>
      <span data-testid="element-key">{selectedElementKey ?? ""}</span>
      <span data-testid="device">{device}</span>
      <button
        type="button"
        onClick={() => setSelectedSlideId(SLIDE_TWO_ID)}
      >
        switch-slide
      </button>
      <button type="button" onClick={() => setDevice("mobile")}>
        switch-device-mobile
      </button>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "commit",
            document: updateHeroElement(state.document, SLIDE_ID, "heading", {
              text: "External edit",
            }),
          })
        }
      >
        external-heading-edit
      </button>
    </div>
  );
}

function renderPanel(
  options: {
    elementKey?: HeroElementKey;
    device?: BuilderDevice;
    document?: HomepageDocument;
    panelElementKey?: HeroElementKey;
    embedded?: boolean;
  } = {},
) {
  const { elementKey = "heading", device = "desktop", document = panelDocument() } =
    options;
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Harness document={document} elementKey={elementKey} device={device} />
        <SettingsPanel elementKey={options.panelElementKey} embedded={options.embedded} />
        <PanelProbe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function document_(): HomepageDocument {
  return JSON.parse(
    screen.getByTestId("document").textContent ?? "{}",
  ) as HomepageDocument;
}

function slideById(slideId: string) {
  const hero = document_().sections[0];
  if (hero.type !== "HERO") throw new Error("expected a HERO section");
  const slide = hero.payload.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new Error(`expected slide ${slideId}`);
  return slide;
}

function slideElement(key: HeroElementKey) {
  return slideById(SLIDE_ID).elements[key];
}

function heading() {
  return slideElement("heading");
}

/**
 * Element snapshots are structured clones: every assertion must re-read the
 * element after a commit, otherwise it inspects the pre-commit document.
 */
function offerChip() {
  const offer = slideElement("offer");
  if (!("chip" in offer)) throw new Error("expected an offer element");
  return offer.chip;
}

function ctaButton(key: "ctaPrimary" | "ctaSecondary" = "ctaPrimary") {
  const cta = slideElement(key);
  if (!("button" in cta)) throw new Error("expected a CTA element");
  return cta.button;
}

function countdownElement() {
  const countdown = slideElement("countdown");
  if (!("endsAt" in countdown)) throw new Error("expected a countdown element");
  return countdown;
}

function commits(): string {
  return screen.getByTestId("commits").textContent ?? "";
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("SettingsPanel", () => {
  it("edits an explicitly embedded element without replacing the canvas selection", () => {
    setAdminLang("en");
    renderPanel({ elementKey: "heading", panelElementKey: "offer", embedded: true });
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
    const typography = screen.getByText("Typography").closest("details");
    expect(typography).not.toBeNull();
    expect(typography).not.toHaveAttribute("open");
    const text = screen.getByRole("textbox", { name: "Offer text" });
    fireEvent.change(text, { target: { value: "A little more room" } });
    fireEvent.blur(text);
    expect(slideElement("offer").text).toBe("A little more room");
    expect(heading().text).toBe("Build a calmer home");
    expect(screen.getByTestId("element-key")).toHaveTextContent("heading");
  });

  beforeEach(() => {
    setAdminLang("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("edits the heading text once per typing burst through mutate", async () => {
    vi.useFakeTimers();
    renderPanel();

    const textarea = screen.getByRole("textbox", { name: "Text" });

    fireEvent.change(textarea, { target: { value: "B" } });
    fireEvent.change(textarea, { target: { value: "Build" } });

    expect(heading().text).toBe("Build a calmer home");
    expect(commits()).toBe("0");

    await advance(299);
    expect(commits()).toBe("0");

    await advance(1);
    expect(heading().text).toBe("Build");
    expect(commits()).toBe("1");

    fireEvent.blur(textarea);
    expect(commits()).toBe("1");
  });

  it("keeps both edits when a text buffer and a colour buffer expire in the same flush", async () => {
    vi.useFakeTimers();
    renderPanel();

    const textarea = screen.getByRole("textbox", { name: "Text" });
    const hex = screen.getByRole("textbox", { name: "Text color" });
    fireEvent.change(textarea, { target: { value: "EDITED TEXT" } });
    fireEvent.change(hex, { target: { value: "#112233" } });

    // One advance expires both 300 ms timers in the same flush, so both
    // commits were prepared from the same pre-edit snapshot.
    await advance(300);

    expect(heading().text).toBe("EDITED TEXT");
    expect(heading().style.textColor).toBe("#112233");
    expect(commits()).toBe("2");
  });

  it("clears a typography value back to inherit", () => {
    renderPanel();

    expect(heading().style.fontSize).toBe(40);

    fireEvent.click(
      screen.getByRole("button", { name: "Font size: Reset to inherit" }),
    );

    expect("fontSize" in heading().style).toBe(false);
    expect(heading().style.textColor).toBe("#292724");
    expect(commits()).toBe("1");
  });

  it("coalesces a typography numeric edit into one history entry", async () => {
    vi.useFakeTimers();
    renderPanel();

    const size = screen.getByRole("textbox", { name: "Font size" });

    fireEvent.change(size, { target: { value: "4" } });
    fireEvent.change(size, { target: { value: "48" } });
    fireEvent.change(size, { target: { value: "48.5" } });

    expect(commits()).toBe("0");
    await advance(799);
    expect(commits()).toBe("0");

    await advance(1);
    expect(heading().style.fontSize).toBe(48.5);
    expect(commits()).toBe("1");

    fireEvent.blur(size);
    expect(commits()).toBe("1");
  });

  it("clamps position numerics and resets the layout", async () => {
    vi.useFakeTimers();
    renderPanel();

    const x = screen.getByRole("textbox", { name: "X (%)" });
    fireEvent.change(x, { target: { value: "150" } });
    await advance(800);
    expect(heading().layout.xPct).toBe(100);

    const width = screen.getByRole("textbox", { name: "Width (%)" });
    fireEvent.change(width, { target: { value: "1" } });
    await advance(800);
    expect(heading().layout.widthPct).toBe(5);

    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));
    expect(heading().layout).toEqual(emptyElement("heading").layout);
    expect(commits()).toBe("3");
  });

  it("toggles the element lock", () => {
    renderPanel();

    const lock = screen.getByRole("checkbox", { name: "Lock" });
    expect(lock).not.toBeChecked();

    fireEvent.click(lock);

    expect(heading().locked).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Unlock" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Unlock" }));
    expect(heading().locked).toBe(false);
  });

  it("toggles the CTA trailing arrow through one commit per click", () => {
    renderPanel({ elementKey: "ctaPrimary" });

    const arrow = screen.getByRole("checkbox", { name: "Show arrow" });
    expect(arrow).not.toBeChecked();
    // The fresh default is false (arrow: false), not merely absent.
    expect(ctaButton().arrow).toBe(false);

    fireEvent.click(arrow);

    // A discrete toggle commits once through the same mutate/commit path.
    expect(ctaButton().arrow).toBe(true);
    expect(commits()).toBe("1");
    expect(screen.getByRole("checkbox", { name: "Show arrow" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Show arrow" }));

    // Untoggling writes false (a defined falsy value is merged, not skipped).
    expect(ctaButton().arrow).toBe(false);
    expect(commits()).toBe("2");
  });

  it("writes mobile edits to the device override and resets it to the desktop value", async () => {
    vi.useFakeTimers();
    renderPanel({ device: "mobile" });

    expect(screen.getByText("This device override")).toBeVisible();

    // The field shows the effective (inherited desktop) value.
    const size = screen.getByRole("textbox", { name: "Font size" });
    expect(size).toHaveValue("40");

    fireEvent.change(size, { target: { value: "32" } });
    await advance(800);

    expect(heading().overrides.mobile?.style?.fontSize).toBe(32);
    expect(heading().style.fontSize).toBe(40);
    expect(commits()).toBe("1");

    fireEvent.click(
      screen.getByRole("button", { name: "Reset to desktop value" }),
    );

    expect(heading().overrides.mobile).toBeUndefined();
    expect(commits()).toBe("2");
  });

  it("hides the responsive group on the desktop device", () => {
    renderPanel();

    expect(screen.queryByText("This device override")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reset to desktop value" }),
    ).toBeNull();
  });

  it("commits the offer chip style set and labels the offer text", async () => {
    vi.useFakeTimers();
    renderPanel({ elementKey: "offer" });

    expect(screen.getByText("Offer chip")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Offer text" })).toBeVisible();

    const background = screen.getByRole("textbox", { name: "Background" });
    fireEvent.change(background, { target: { value: "#112233" } });
    await advance(300);
    expect(offerChip().background).toBe("#112233");

    const radius = screen.getByRole("textbox", { name: "Border radius (px)" });
    fireEvent.change(radius, { target: { value: "12" } });
    await advance(800);
    expect(offerChip().borderRadius).toBe(12);

    const paddingX = screen.getByRole("textbox", { name: "Padding X (px)" });
    fireEvent.change(paddingX, { target: { value: "20" } });
    await advance(800);
    expect(offerChip().paddingX).toBe(20);

    const paddingY = screen.getByRole("textbox", { name: "Padding Y (px)" });
    fireEvent.change(paddingY, { target: { value: "10" } });
    await advance(800);
    expect(offerChip().paddingY).toBe(10);
  });

  it("commits the CTA button style set and clears a colour to null", async () => {
    vi.useFakeTimers();
    renderPanel({ elementKey: "ctaPrimary" });

    expect(screen.getByText("Button")).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "Button variant" }), {
      target: { value: "OUTLINE" },
    });
    expect(ctaButton().variant).toBe("OUTLINE");

    const background = screen.getByRole("textbox", { name: "Background" });
    fireEvent.change(background, { target: { value: "#445566" } });
    await advance(300);
    expect(ctaButton().background).toBe("#445566");

    fireEvent.click(
      screen.getByRole("button", { name: "Background: Reset to inherit" }),
    );
    expect(ctaButton().background).toBeNull();

    const hoverText = screen.getByRole("textbox", { name: "Hover text color" });
    fireEvent.change(hoverText, { target: { value: "#FFFFFF" } });
    await advance(300);
    expect(ctaButton().hoverTextColor).toBe("#FFFFFF");
    fireEvent.click(
      screen.getByRole("button", { name: "Hover text color: Reset to inherit" }),
    );
    expect(ctaButton().hoverTextColor).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Button size" }), {
      target: { value: "LG" },
    });
    expect(ctaButton().size).toBe("LG");

    const radius = screen.getByRole("textbox", { name: "Border radius (px)" });
    fireEvent.change(radius, { target: { value: "8" } });
    await advance(800);
    expect(ctaButton().borderRadius).toBe(8);
  });

  it("commits the countdown endsAt as ISO and clears it back to null", () => {
    renderPanel({ elementKey: "countdown" });

    const input = screen.getByLabelText("Countdown ends at");
    expect(input).toHaveAttribute("type", "datetime-local");

    fireEvent.change(input, { target: { value: "2026-10-01T09:30" } });

    expect(countdownElement().endsAt).toBe(
      new Date("2026-10-01T09:30").toISOString(),
    );

    fireEvent.change(input, { target: { value: "" } });
    expect(countdownElement().endsAt).toBeNull();
  });

  it("commits a CTA link through the LinkPicker entity picker", async () => {
    vi.useFakeTimers();
    listProducts.mockResolvedValue({
      items: [
        {
          id: PRODUCT_UUID,
          name: "Oak Side Table",
        } as AdminProduct,
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderPanel({ elementKey: "ctaPrimary" });

    fireEvent.change(screen.getByRole("combobox", { name: "Link type" }), {
      target: { value: "PRODUCT" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(
      within(screen.getByLabelText("Pick a Product")).getByRole("button", {
        name: "Oak Side Table",
      }),
    );

    const cta = slideElement("ctaPrimary");
    expect(cta.link).toEqual({ type: "PRODUCT", id: PRODUCT_UUID });
  });

  it("renders the style groups only for the matching element key", () => {
    const first = renderPanel({ elementKey: "heading" });
    expect(screen.queryByText("Offer chip")).toBeNull();
    expect(screen.queryByText("Button")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Link type" })).toBeNull();
    first.unmount();

    const second = renderPanel({ elementKey: "offer" });
    expect(screen.getByText("Offer chip")).toBeVisible();
    expect(screen.queryByText("Button")).toBeNull();
    second.unmount();

    renderPanel({ elementKey: "ctaSecondary" });
    expect(screen.getByText("Button")).toBeVisible();
    expect(screen.queryByText("Offer chip")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Link type" })).toBeVisible();
  });
});

describe("SettingsPanel device targeting", () => {
  beforeEach(() => {
    setAdminLang("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps desktop edits on the base element when the tablet override exists", async () => {
    vi.useFakeTimers();
    const doc = panelDocument();
    const hero = doc.sections[0];
    if (hero.type !== "HERO") throw new Error("fixture expects a HERO section");
    hero.payload.slides[0].elements.heading.overrides.tablet = {
      style: { fontSize: 24 },
    };
    renderPanel({ document: doc, device: "desktop" });

    const size = screen.getByRole("textbox", { name: "Font size" });
    expect(size).toHaveValue("40");

    fireEvent.change(size, { target: { value: "44" } });
    await advance(800);

    expect(heading().style.fontSize).toBe(44);
    expect(heading().overrides.tablet?.style?.fontSize).toBe(24);
  });

  it("clears a single typography override property and drops the empty override", async () => {
    vi.useFakeTimers();
    const doc = panelDocument();
    const hero = doc.sections[0];
    if (hero.type !== "HERO") throw new Error("fixture expects a HERO section");
    hero.payload.slides[0].elements.heading.overrides.mobile = {
      style: { fontSize: 24 },
    };
    renderPanel({ document: doc, device: "mobile" });

    fireEvent.click(
      screen.getByRole("button", { name: "Font size: Reset to inherit" }),
    );

    expect(heading().overrides.mobile).toBeUndefined();
    expect(heading().style.fontSize).toBe(40);
    expect(screen.getByTestId("device")).toHaveTextContent("mobile");
  });
});

describe("SettingsPanel target scoping", () => {
  beforeEach(() => {
    setAdminLang("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not leak a pending text draft into a newly selected slide", async () => {
    vi.useFakeTimers();
    renderPanel({ document: twoSlideDocument() });

    const textarea = screen.getByRole("textbox", { name: "Text" });
    expect(textarea).toHaveValue("Build a calmer home");
    fireEvent.change(textarea, { target: { value: "DRAFT FOR SLIDE ONE" } });

    // A selection change without a blur (a programmatic switch or a click on a
    // non-focusable target) must not carry the pending draft to slide two.
    fireEvent.click(screen.getByRole("button", { name: "switch-slide" }));
    await advance(300);

    expect(slideById(SLIDE_TWO_ID).elements.heading.text).toBe(
      "Second slide heading",
    );
    expect(slideById(SLIDE_ID).elements.heading.text).toBe("Build a calmer home");
    // The remount drops the stale draft instead of showing it on slide two.
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue(
      "Second slide heading",
    );
    expect(commits()).toBe("0");
  });

  it("isolates two targets that hold the same value while a draft is pending", async () => {
    vi.useFakeTimers();
    renderPanel({ document: twinHeadingDocument() });

    const textarea = screen.getByRole("textbox", { name: "Text" });
    fireEvent.change(textarea, { target: { value: "PENDING DRAFT" } });

    // The external value is identical on both slides, so adoption alone cannot
    // cancel the timer — only the keyed remount can.
    fireEvent.click(screen.getByRole("button", { name: "switch-slide" }));
    await advance(300);

    expect(slideById(SLIDE_TWO_ID).elements.heading.text).toBe(
      "Build a calmer home",
    );
    expect(slideById(SLIDE_ID).elements.heading.text).toBe("Build a calmer home");
    expect(commits()).toBe("0");
  });

  it("does not leak a pending numeric draft into a newly selected device", async () => {
    vi.useFakeTimers();
    renderPanel({ document: twoSlideDocument() });

    const size = screen.getByRole("textbox", { name: "Font size" });
    fireEvent.change(size, { target: { value: "99" } });

    fireEvent.click(screen.getByRole("button", { name: "switch-device-mobile" }));
    await advance(800);

    expect(slideById(SLIDE_ID).elements.heading.style.fontSize).toBe(40);
    expect(slideById(SLIDE_ID).elements.heading.overrides.mobile).toBeUndefined();
    // The mobile field now shows the inherited desktop value, not the draft.
    expect(screen.getByRole("textbox", { name: "Font size" })).toHaveValue("40");
    expect(commits()).toBe("0");
  });

  it("still flushes the draft to the original target on blur before a switch", async () => {
    vi.useFakeTimers();
    renderPanel({ document: twoSlideDocument() });

    const textarea = screen.getByRole("textbox", { name: "Text" });
    fireEvent.change(textarea, { target: { value: "Slide one edit" } });
    fireEvent.blur(textarea);

    expect(slideById(SLIDE_ID).elements.heading.text).toBe("Slide one edit");
    expect(commits()).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "switch-slide" }));
    await advance(300);

    expect(slideById(SLIDE_ID).elements.heading.text).toBe("Slide one edit");
    expect(slideById(SLIDE_TWO_ID).elements.heading.text).toBe(
      "Second slide heading",
    );
    expect(commits()).toBe("1");
  });

  it("cancels a pending draft when the same field changes externally", async () => {
    vi.useFakeTimers();
    renderPanel();

    const textarea = screen.getByRole("textbox", { name: "Text" });
    fireEvent.change(textarea, { target: { value: "STALE DRAFT" } });

    fireEvent.click(screen.getByRole("button", { name: "external-heading-edit" }));
    expect(heading().text).toBe("External edit");

    // The adopted external value invalidates the pending draft: the timer must
    // not fire it over the newer document state.
    await advance(300);

    expect(heading().text).toBe("External edit");
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue(
      "External edit",
    );
    expect(commits()).toBe("1");
  });
});

describe("SettingsPanel colour picker", () => {
  beforeEach(() => {
    setAdminLang("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the swatch with the stored colour and commits a pick once through mutate", () => {
    renderPanel();

    const swatch = screen.getByLabelText("Text color: Pick color");
    expect(swatch).toHaveAttribute("type", "color");
    expect(swatch).toHaveValue("#292724");

    fireEvent.change(swatch, { target: { value: "#112233" } });

    // A pick is discrete: exactly one synchronous commit, no debounce flush.
    expect(heading().style.textColor).toBe("#112233");
    expect(commits()).toBe("1");

    // Picking the already stored colour is a no-op: still one history entry.
    fireEvent.change(swatch, { target: { value: "#112233" } });
    expect(commits()).toBe("1");
  });

  it("shows the neutral default for an inherited colour without committing on mount", () => {
    renderPanel({ elementKey: "ctaPrimary" });

    // CTA button colours default to null (inherit): the swatch must show a
    // concrete neutral without writing anything.
    const swatch = screen.getByLabelText("Background: Pick color");
    expect(swatch).toHaveValue("#808080");
    expect(ctaButton().background).toBeNull();
    expect(commits()).toBe("0");

    fireEvent.change(swatch, { target: { value: "#445566" } });

    expect(ctaButton().background).toBe("#445566");
    expect(commits()).toBe("1");
  });

  it("keeps a pending text draft when a swatch pick commits first", async () => {
    vi.useFakeTimers();
    renderPanel();

    const textarea = screen.getByRole("textbox", { name: "Text" });
    fireEvent.change(textarea, { target: { value: "PENDING TEXT" } });

    const swatch = screen.getByLabelText("Text color: Pick color");
    fireEvent.change(swatch, { target: { value: "#112233" } });

    // The pick commits immediately through mutate; the still-pending text
    // draft must survive (it applies to the latest document, not a pre-pick
    // snapshot — ledger Ruling 32).
    expect(heading().style.textColor).toBe("#112233");
    expect(commits()).toBe("1");

    await advance(300);

    expect(heading().text).toBe("PENDING TEXT");
    expect(heading().style.textColor).toBe("#112233");
    expect(commits()).toBe("2");
  });

  it("keeps the hex text path and returns the swatch to the neutral default on clear", async () => {
    vi.useFakeTimers();
    renderPanel({ elementKey: "ctaPrimary" });

    const hex = screen.getByRole("textbox", { name: "Background" });
    fireEvent.change(hex, { target: { value: "#445566" } });
    await advance(300);
    expect(ctaButton().background).toBe("#445566");
    expect(screen.getByLabelText("Background: Pick color")).toHaveValue(
      "#445566",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Background: Reset to inherit" }),
    );

    expect(ctaButton().background).toBeNull();
    expect(screen.getByLabelText("Background: Pick color")).toHaveValue(
      "#808080",
    );
    expect(commits()).toBe("2");
  });
});
