import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { emptyDocument, type HomepageDocument, type SectionStyle } from "@/lib/homepage-document";
import { defaultSection } from "@/lib/homepage-section-factory";
import { HomepageEditorProvider, useHomepageEditor } from "./HomepageEditor";
import { SectionDisplaySettings } from "./SectionDisplaySettings";
import { HeroMediaSettings } from "./HeroMediaSettings";
import { HeroStyleSettings } from "./HeroStyleSettings";

const HERO_ID = "00000000-0000-7000-8000-000000000701";
const CATEGORY_ID = "00000000-0000-7000-8000-000000000702";

function fixture(): HomepageDocument {
  const doc = emptyDocument();
  const hero = doc.sections[0];
  if (hero.type !== "HERO") throw new Error("fixture requires HERO");
  hero.id = HERO_ID;
  hero.payload.slides[0].media = { type: "IMAGE", image: { url: "/uploads/furniture.jpg", alt: "Furniture" }, video: null,
    mobileOverride: { enabled: false, image: null, video: null }, fit: "COVER", focal: { x: 50, y: 50 },
    objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null } };
  doc.sections.push(defaultSection("CATEGORY_TILES", CATEGORY_ID, 10));
  return doc;
}

function Harness({ document, media }: { document: HomepageDocument; media: boolean }): ReactNode {
  const {
    dispatch, setSelectedSlideId, setDevice, setSelectedSectionId,
  } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 1, savedAt: null });
    const hero = document.sections.find((section) => section.type === "HERO");
    setSelectedSlideId(hero?.type === "HERO" ? hero.payload.slides[0].id : null);
  }, [dispatch, document, setSelectedSlideId]);
  return <>
    {["desktop", "tablet", "mobile"].map((device) => <button key={device} onClick={() => setDevice(device as "desktop" | "tablet" | "mobile")}>switch-{device}</button>)}
    {document.sections.map((section) => <button key={section.id} onClick={() => setSelectedSectionId(section.id)}>select-{section.id}</button>)}
    <SectionDisplaySettings />
    {media ? <HeroMediaSettings /> : null}
    <HeroStyleSettings />
    <Probe />
  </>;
}

function Probe(): ReactNode {
  const { state } = useHomepageEditor();
  return <pre data-testid="display-document">{JSON.stringify(state.document)}</pre>;
}

function renderPanel(document = fixture(), media = false) {
  render(<AdminI18nProvider><HomepageEditorProvider>
    <Harness document={document} media={media} />
  </HomepageEditorProvider></AdminI18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: `select-${document.sections[0].id}` }));
}
function read(): HomepageDocument { return JSON.parse(screen.getByTestId("display-document").textContent!); }
function hero() {
  const section = read().sections.find((value) => value.id === HERO_ID);
  if (!section || section.type !== "HERO") throw new Error("missing HERO");
  return section;
}
function heroStyle(): SectionStyle | undefined { return hero().style as SectionStyle | undefined; }
function category() {
  const section = read().sections.find((value) => value.id === CATEGORY_ID);
  if (!section || section.type !== "CATEGORY_TILES") throw new Error("missing category");
  return section;
}
function device(name: "desktop" | "tablet" | "mobile") { fireEvent.click(screen.getByRole("button", { name: `switch-${name}` })); }
function select(label: string, value: string) { fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value } }); }

beforeEach(() => { setAdminLang("en"); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("SectionDisplaySettings", () => {
  it("shows automatic category layout separately from an explicit column count", () => {
    const doc = fixture(); doc.appearance = "STUDIO_V3";
    renderPanel(doc); device("mobile");
    fireEvent.click(screen.getByRole("button", { name: `select-${CATEGORY_ID}` }));
    expect(screen.getByRole("combobox", { name: "Columns" })).toHaveValue("");
    select("Columns", "3");
    expect(category().payload.layout?.overrides?.mobile?.columns).toBe(3);
    select("Columns", "");
    expect(category().payload.layout).toBeUndefined();
  });

  it("clears a height override when the inheritance option is selected", () => {
    renderPanel(); device("mobile"); select("Hero height", "NATURAL");
    select("Hero height", "");
    expect(hero().payload.display?.overrides).toBeUndefined();
  });
  it("selects automatic copy flow per device without overwriting saved element coordinates", () => {
    renderPanel();
    const before = structuredClone(hero().payload.slides[0].elements);
    device("mobile");
    select("Copy layout", "AUTO");
    expect(hero().payload.display?.overrides?.mobile?.contentLayout).toBe("AUTO");
    expect(hero().payload.slides[0].elements).toEqual(before);
    device("desktop");
    expect(screen.getByRole("combobox", { name: "Copy layout" })).toHaveValue("");
    device("mobile");
    select("Copy layout", "");
    expect(hero().payload.display?.overrides).toBeUndefined();
  });
  it("exposes Hero height immediately and keeps mobile height/fit isolated from common width", () => {
    renderPanel(fixture(), true);
    expect(screen.getByRole("heading", { name: "Hero display" })).toBeVisible();
    device("mobile");
    select("Hero height", "NATURAL");
    select("Fit mode", "CONTAIN");
    expect(hero().payload.display).toEqual({ heightMode: "SCREEN", overrides: { mobile: { heightMode: "NATURAL" } } });
    expect(hero().payload.slides[0].media!.fit).toBe("COVER");
    expect(hero().payload.slides[0].media!.fitOverrides).toEqual({ mobile: "CONTAIN" });
    device("desktop");
    expect(screen.getByRole("combobox", { name: "Hero height" })).toHaveValue("SCREEN");
    select("Content width", "STANDARD");
    device("mobile");
    expect(screen.getByRole("combobox", { name: "Content width" })).toHaveValue("STANDARD");
    expect(screen.getByRole("combobox", { name: "Hero height" })).toHaveValue("NATURAL");
    expect(screen.getByRole("combobox", { name: "Fit mode" })).toHaveValue("CONTAIN");
  });

  it("merges buffered mobile padding with a discrete width change", () => {
    renderPanel(); device("mobile");
    const padding = screen.getByRole("spinbutton", { name: "Top spacing (px)" });
    fireEvent.change(padding, { target: { value: "42" } });
    expect(heroStyle()?.overrides?.mobile?.paddingTop).toBeUndefined();
    select("Content width", "STANDARD");
    fireEvent.blur(padding);
    expect(heroStyle()?.overrides?.mobile).toEqual({ contentWidth: "STANDARD", paddingTop: 42 });
  });

  it("flushes a blurred style edit to its original section and device before selection changes", async () => {
    renderPanel(); device("mobile");
    const padding = screen.getByRole("spinbutton", { name: "Top spacing (px)" });
    fireEvent.change(padding, { target: { value: "12" } });
    fireEvent.blur(padding);
    fireEvent.click(screen.getByRole("button", { name: `select-${CATEGORY_ID}` }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(heroStyle()?.overrides?.mobile?.paddingTop).toBe(12);
    expect(read().sections.find((section) => section.id === CATEGORY_ID)?.style).toBeUndefined();
    expect(hero().style?.paddingTop).toBeUndefined();
  });

  it("writes only the edited layout field and resets display without deleting media overrides", () => {
    renderPanel(fixture(), true); device("mobile");
    select("Hero height", "NATURAL"); select("Fit mode", "CONTAIN");
    fireEvent.click(screen.getByRole("button", { name: "Restore section display inheritance" }));
    expect(hero().payload.display).toEqual({ heightMode: "SCREEN" });
    expect(hero().payload.slides[0].media!.fitOverrides).toEqual({ mobile: "CONTAIN" });
    fireEvent.click(screen.getByRole("button", { name: `select-${CATEGORY_ID}` }));
    expect(screen.getByRole("combobox", { name: "Columns" })).toHaveValue("2");
    const gap = screen.getByRole("textbox", { name: "Grid gap (px)" });
    fireEvent.change(gap, { target: { value: "0" } }); fireEvent.blur(gap);
    expect(category().payload.layout).toEqual({ overrides: { mobile: { gap: 0 } } });
  });

  it("cancels an unblurred pending input on unmount instead of writing to the new selection", async () => {
    renderPanel(); device("mobile");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Top spacing (px)" }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: `select-${CATEGORY_ID}` }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(heroStyle()?.overrides?.mobile?.paddingTop).toBeUndefined();
    expect(read().sections.find((section) => section.id === CATEGORY_ID)?.style).toBeUndefined();
  });

  it("shows legacy two-column grids on every device until an explicit layout edit", () => {
    const doc = fixture();
    const grid = defaultSection("PRODUCT_GRID", CATEGORY_ID, 10);
    grid.payload.columns = 2;
    doc.sections = [grid];
    renderPanel(doc);
    for (const name of ["desktop", "tablet", "mobile"] as const) {
      device(name);
      expect(screen.getByRole("combobox", { name: "Columns" })).toHaveValue("2");
    }
    const saved = read().sections[0];
    if (saved.type !== "PRODUCT_GRID") throw new Error("missing grid");
    expect(saved.payload.layout).toBeUndefined();
  });

  it("shows appearance gap defaults and restores device inheritance without storing defaults", () => {
    const doc = fixture();
    doc.appearance = "STUDIO_V3";
    const story = defaultSection("PRODUCT_STORY", CATEGORY_ID, 10);
    doc.sections = [story];
    renderPanel(doc);
    const gap = () => screen.getByRole("textbox", { name: "Grid gap (px)" });
    const layout = () => {
      const saved = read().sections[0];
      if (saved.type !== "PRODUCT_STORY") throw new Error("missing story");
      return saved.payload.layout;
    };
    expect(gap()).toHaveValue("48");
    fireEvent.blur(gap());
    expect(layout()).toBeUndefined();
    device("tablet");
    expect(gap()).toHaveValue("28");
    device("mobile");
    expect(gap()).toHaveValue("20");
    fireEvent.change(gap(), { target: { value: "0" } }); fireEvent.blur(gap());
    expect(layout()).toEqual({ overrides: { mobile: { gap: 0 } } });
    fireEvent.click(screen.getByRole("button", { name: "Restore module layout inheritance" }));
    expect(gap()).toHaveValue("20");
    expect(layout()).toBeUndefined();
    expect(read().appearance).toBe("STUDIO_V3");
  });

  it("does not expose grid controls on unrelated modules", () => {
    const doc = fixture();
    doc.sections = [defaultSection("USP", CATEGORY_ID, 10)];
    renderPanel(doc);
    expect(screen.queryByRole("combobox", { name: "Columns" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Image ratio" })).toBeNull();
  });
});
