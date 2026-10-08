import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
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

function Probe(): ReactNode {
  const { state } = useHomepageEditor();
  return (
    <pre data-testid="defaults">{JSON.stringify(state.document.defaults)}</pre>
  );
}

function renderPanel(document = emptyDocument()): void {
  setAdminLang("en");
  render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Loader document={document} />
        <HomepageDefaultsPanel />
        <Probe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function defaults(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("defaults").textContent ?? "{}");
}

describe("HomepageDefaultsPanel", () => {
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
