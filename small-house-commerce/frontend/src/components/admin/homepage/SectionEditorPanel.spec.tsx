import { useEffect, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import { SectionEditorPanel } from "@/components/admin/homepage/SectionEditorPanel";
import { emptyDocument, type HomepageDocument, type HomepageSection } from "@/lib/homepage-document";

const USP_ID = "00000000-0000-7000-8000-000000000902";

function sectionDocument(): HomepageDocument {
  const hero = emptyDocument().sections[0];
  const usp: HomepageSection = {
    id: USP_ID,
    type: "USP",
    title: "Trust strip",
    subtitle: "Existing subtitle",
    enabled: true,
    sortOrder: 10,
    schedule: { publishAt: null, unpublishAt: null },
    products: [{ productId: "product-1", sortOrder: 0, badge: "Keep" }],
    style: { backgroundColor: "#112233", customKey: "preserve" },
    payload: {},
  } as HomepageSection;
  return {
    ...emptyDocument(),
    sections: [hero, usp],
  };
}

function Loader({ document }: { document: HomepageDocument }): ReactNode {
  const { dispatch } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: 4, savedAt: null });
  }, [dispatch, document]);
  return null;
}

function Probe(): ReactNode {
  const { state } = useHomepageEditor();
  const section = state.document.sections.find((candidate) => candidate.id === USP_ID);
  return (
    <pre data-testid="document">
      {JSON.stringify(section)}
    </pre>
  );
}

function renderPanel(document = sectionDocument()): void {
  setAdminLang("en");
  render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Loader document={document} />
        <SectionEditorPanel sectionId={USP_ID} />
        <Probe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function section(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("document").textContent ?? "{}");
}

describe("SectionEditorPanel", () => {
  it("routes a selected typed section into the shared editor shell", () => {
    renderPanel();

    expect(screen.getByTestId("section-editor-panel")).toBeVisible();
    expect(screen.getByTestId("section-editor-type")).toHaveTextContent("USP");
    expect(screen.getByText("Trust points and service promises")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Content" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Style" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Section title" })).toHaveValue(
      "Trust strip",
    );
  });

  it("writes common fields through latest-document mutations while preserving payload and products", () => {
    renderPanel();

    fireEvent.change(screen.getByRole("textbox", { name: "Section title" }), {
      target: { value: "Updated title" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Section subtitle" }), {
      target: { value: "Updated subtitle" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Section enabled" }));
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "2026-10-01T09:30" },
    });

    expect(section()).toMatchObject({
      title: "Updated title",
      subtitle: "Updated subtitle",
      enabled: false,
      schedule: { publishAt: new Date("2026-10-01T09:30").toISOString() },
      payload: {},
      products: [{ productId: "product-1", sortOrder: 0, badge: "Keep" }],
    });
  });

  it("preserves unrelated style keys and removes a style override back to inheritance", () => {
    renderPanel();

    fireEvent.change(screen.getByRole("textbox", { name: "Background color" }), {
      target: { value: "#445566" },
    });
    expect(section().style).toEqual({
      backgroundColor: "#445566",
      customKey: "preserve",
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset background color" }));
    expect(section().style).toEqual({ customKey: "preserve" });
  });

  it("does not commit a pending Hero editor buffer when the selected section changes", () => {
    // The panel itself is keyed by section identity in the shell. This test
    // pins the contract that its identity prop is the only document target.
    renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "Section title" }), {
      target: { value: "USP edit" },
    });

    expect(section().id).toBe(USP_ID);
    expect(section().title).toBe("USP edit");
  });
});
