import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { HomepageLivePreview } from "./HomepageLivePreview";
import { defaultSection } from "@/lib/homepage-section-factory";

vi.mock("@/lib/fonts", () => ({ poppins: { className: "font-poppins", variable: "--font-poppins" } }));
vi.mock("./useHomepagePreviewShellData", async () => {
  const { FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA } = await import("@/lib/homepage-preview-shell-data");
  return { useHomepagePreviewShellData: () => ({ ...FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA, degraded: false, loading: false }) };
});
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import { HomepageDefaultsPanel } from "@/components/admin/homepage/HomepageDefaultsPanel";
import { emptyDocument, type HomepageDocument } from "@/lib/homepage-document";

function Loader({ document }: { document: HomepageDocument }): ReactNode {
  const { dispatch } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 1, savedAt: null });
  }, [dispatch, document]);
  return null;
}

function Probe({ preview }: { preview: boolean }): ReactNode {
  const { state, dispatch, device, setDevice, compareCurrentAppearance } = useHomepageEditor();
  return (
    <>
      <button onClick={() => setDevice("mobile")}>switch-mobile</button>
      <button onClick={() => setDevice("desktop")}>switch-desktop</button>
      <button onClick={() => dispatch({ type: "undo" })}>test-undo</button>
      <button onClick={() => dispatch({ type: "redo" })}>test-redo</button>
      <output data-testid="dirty">{String(state.dirty)}</output>
      <output data-testid="past">{state.past.length}</output>
      <pre data-testid="defaults">{JSON.stringify(state.document.defaults ?? {})}</pre>
      <pre data-testid="homepage-document">{JSON.stringify(state.document)}</pre>
      {preview ? <HomepageLivePreview document={state.document} device={device} selectedSectionId={null} compareCurrentAppearance={compareCurrentAppearance} /> : null}
    </>
  );
}

function renderPanel(document = emptyDocument(), preview = false): void {
  setAdminLang("en");
  render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Loader document={document} />
        <HomepageDefaultsPanel />
        <Probe preview={preview} />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function defaults(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("defaults").textContent ?? "{}");
}

function readDocument(): HomepageDocument {
  return JSON.parse(screen.getByTestId("homepage-document").textContent ?? "{}");
}

describe("HomepageDefaultsPanel", () => {
  it("requires an explicit module target and clears only that target as one undoable operation", () => {
    const doc = emptyDocument();
    doc.appearance = "STUDIO_V3";
    doc.defaults = { paddingTop: 32 };
    const first = defaultSection("CATEGORY_TILES", "00000000-0000-7000-8000-000000000811", 10);
    first.style = { paddingTop: 0, textColor: "#112233" };
    first.payload.layout = { gap: 16, columns: 3, imageRatio: "SQUARE" };
    const second = defaultSection("PRODUCT_STORY", "00000000-0000-7000-8000-000000000812", 20);
    second.style = { paddingBottom: 48 };
    doc.sections = [first, second];
    renderPanel(doc);
    const apply = screen.getByRole("button", { name: "Apply module spacing" });
    expect(apply).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Target module" })).toHaveValue("");
    fireEvent.change(screen.getByRole("combobox", { name: "Target module" }), { target: { value: first.id } });
    expect(apply).toBeEnabled();
    expect(screen.getByRole("button", { name: "Apply Hero typography" })).toBeDisabled();
    fireEvent.click(apply);
    const converted = readDocument();
    const updated = converted.sections[0];
    if (updated.type !== "CATEGORY_TILES") throw new Error("missing category tiles");
    expect(updated.style).toEqual({ textColor: "#112233" });
    expect(updated.payload.layout).toEqual({ columns: 3, imageRatio: "SQUARE" });
    expect(converted.sections[1]).toEqual(second);
    expect(converted.defaults).toEqual(doc.defaults);
    expect(screen.getByTestId("past")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "test-undo" }));
    expect(readDocument()).toEqual(doc);
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: "test-redo" }));
    expect(readDocument()).toEqual(converted);
  });

  it("applies only page spacing while keeping colors, width and section overrides", () => {
    const doc = emptyDocument();
    doc.appearance = "STUDIO_V3";
    doc.defaults = { paddingTop: 0, backgroundColor: "#112233", contentWidth: "NARROW", overrides: { mobile: { paddingBottom: 40 } } };
    renderPanel(doc);
    fireEvent.click(screen.getByRole("button", { name: "Apply page default spacing" }));
    expect(readDocument()).toEqual({ ...doc, defaults: { backgroundColor: "#112233", contentWidth: "NARROW" } });
    expect(screen.getByTestId("past")).toHaveTextContent("1");
  });

  it("requires the selected Hero target before clearing its typography", () => {
    const doc = emptyDocument();
    doc.appearance = "STUDIO_V3";
    const hero = doc.sections[0];
    if (hero.type !== "HERO") throw new Error("fixture requires HERO");
    hero.payload.slides[0].elements.heading.style = { fontSize: 96, textColor: "#ffffff" };
    renderPanel(doc);
    const apply = screen.getByRole("button", { name: "Apply Hero typography" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Target module" }), { target: { value: hero.id } });
    fireEvent.click(apply);
    const updated = readDocument().sections[0];
    if (updated.type !== "HERO") throw new Error("missing HERO");
    expect(updated.payload.slides[0].elements.heading.style).toEqual({ textColor: "#ffffff" });
    expect(updated.payload.slides[0].elements.heading.layout).toEqual(hero.payload.slides[0].elements.heading.layout);
    expect(screen.getByTestId("past")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "test-undo" }));
    expect(readDocument()).toEqual(doc);
  });

  it("temporarily compares the same real content without changing document, history or dirty status", () => {
    const doc = emptyDocument();
    doc.appearance = "STUDIO_V3";
    doc.sections = [defaultSection("BRAND_STORY", "00000000-0000-7000-8000-000000000813", 10)];
    doc.sections[0].title = "Layout illustration";
    renderPanel(doc, true);
    expect(screen.getByRole("heading", { name: "Layout illustration" }).closest("[data-homepage-appearance]")).not.toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare current appearance" }));
    expect(screen.getByRole("heading", { name: "Layout illustration" }).closest("[data-homepage-appearance]")).toBeNull();
    expect(readDocument()).toEqual(doc);
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("past")).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "switch-mobile" }));
    expect(screen.getByRole("checkbox", { name: "Compare current appearance" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare current appearance" }));
    expect(screen.getByRole("heading", { name: "Layout illustration" }).closest("[data-homepage-appearance]")).toHaveAttribute("data-homepage-device", "mobile");
    expect(readDocument()).toEqual(doc);
  });

  it("recognizes clean layouts without treating retained colors or width as custom spacing", () => {
    const doc = emptyDocument();
    doc.appearance = "STUDIO_V3";
    doc.defaults = { backgroundColor: "#112233" };
    const section = defaultSection("BRAND_STORY", "00000000-0000-7000-8000-000000000813", 10);
    section.style = { contentWidth: "NARROW" };
    doc.sections = [section];
    renderPanel(doc);
    expect(screen.getByText("All sections use the V3 layout defaults.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply page default spacing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply module spacing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply Hero typography" })).toBeDisabled();
    expect(readDocument()).toEqual(doc);
  });

  it("selects a common appearance without clearing device defaults and can restore it", () => {
    const document = emptyDocument();
    document.defaults = { paddingTop: 0, overrides: { mobile: { paddingBottom: 0 } } };
    renderPanel(document);
    fireEvent.click(screen.getByRole("radio", { name: "V3 airy appearance" }));
    expect(JSON.parse(screen.getByTestId("homepage-document").textContent ?? "{}")).toEqual({ ...document, appearance: "STUDIO_V3" });
    fireEvent.click(screen.getByRole("button", { name: "switch-mobile" }));
    expect(screen.getByRole("radio", { name: "V3 airy appearance" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Current appearance" }));
    expect(JSON.parse(screen.getByTestId("homepage-document").textContent ?? "{}")).toEqual(document);
  });

  it("edits only the mobile default and restores its inheritance without erasing common values", () => {
    const doc = emptyDocument();
    doc.defaults = { contentWidth: "STANDARD", paddingTop: 30 };
    renderPanel(doc);
    fireEvent.click(screen.getByRole("button", { name: "switch-mobile" }));
    expect(screen.getByRole("spinbutton", { name: "Top spacing (px)" })).toHaveValue(30);
    const padding = screen.getByRole("spinbutton", { name: "Top spacing (px)" });
    fireEvent.change(padding, { target: { value: "0" } }); fireEvent.blur(padding);
    expect(defaults()).toEqual({ contentWidth: "STANDARD", paddingTop: 30, overrides: { mobile: { paddingTop: 0 } } });
    fireEvent.click(screen.getByRole("button", { name: "Reset top spacing" }));
    expect(defaults()).toEqual({ contentWidth: "STANDARD", paddingTop: 30 });
  });

  it("edits the homepage default style through the document mutator", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Homepage defaults" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Background color" }), {
      target: { value: "#F2EFE9" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Content width" }), {
      target: { value: "NARROW" },
    });

    expect(defaults()).toEqual({ backgroundColor: "#F2EFE9", contentWidth: "NARROW" });
  });

  it("uses the 'not set' placeholder rather than the inherit wording", () => {
    renderPanel();

    expect(screen.getByRole("textbox", { name: "Background color" })).toHaveAttribute(
      "placeholder",
      "Not set",
    );
  });

  it("resets a single default back to unset", () => {
    renderPanel();

    fireEvent.change(screen.getByRole("textbox", { name: "Background color" }), {
      target: { value: "#F2EFE9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset background color" }));

    expect(defaults()).toEqual({});
  });
});
