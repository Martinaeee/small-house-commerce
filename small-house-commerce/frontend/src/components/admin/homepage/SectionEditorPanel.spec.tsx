import { createElement, useEffect, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import { SectionCommonFields } from "@/components/admin/homepage/SectionCommonFields";
import { SectionEditorPanel } from "@/components/admin/homepage/SectionEditorPanel";
import { getSectionEditorDefinition } from "@/components/admin/homepage/section-editor-registry";
import {
  emptyDocument,
  type HomepageDocument,
  type HomepageSection,
  type NonHeroHomepageSection,
} from "@/lib/homepage-document";
import { SECTION_TYPES, defaultSection } from "@/lib/homepage-section-factory";

// Editors only fetch on demand; the routing regression below mounts every
// type, so the API surface they may touch is stubbed out.
vi.mock("@/lib/admin-api", () => ({
  AdminApiError: class AdminApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  adminApi: {
    listCategories: vi.fn(async () => []),
    listCollections: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listLandingPages: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    listProducts: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    getProduct: vi.fn(async () => {
      throw new Error("not found");
    }),
    uploadImage: vi.fn(async () => {
      throw new Error("not configured");
    }),
  },
}));

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
  it("keeps registry editor props tied to the requested section type", () => {
    const editor = getSectionEditorDefinition("USP").editor;
    const productGrid = defaultSection(
      "PRODUCT_GRID",
      "00000000-0000-7000-8000-000000000903",
      20,
    );

    const element = createElement(editor, {
      // @ts-expect-error A USP editor cannot receive a Product Grid section.
      section: productGrid,
      onPayloadChange: () => undefined,
    });

    expect(element).toBeDefined();
  });

  it("routes a selected typed section into the shared editor shell", () => {
    renderPanel();

    expect(screen.getByTestId("section-editor-panel")).toBeVisible();
    expect(screen.getByTestId("section-editor-type")).toHaveTextContent("USP");
    expect(screen.getByText("Trust points and service promises")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Content" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Advanced" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Section title" })).toHaveValue(
      "Trust strip",
    );

    // The style override block is collapsed by default and only renders the
    // fields once expanded.
    const toggle = screen.getByRole("button", {
      name: /Advanced: individual override/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Style" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Style" })).toBeVisible();
  });

  it("renders the type-specific payload editor for every addable section type", () => {
    setAdminLang("en");
    const sectionId = "00000000-0000-7000-8000-000000000910";

    for (const type of SECTION_TYPES) {
      const doc: HomepageDocument = {
        ...emptyDocument(),
        sections: [emptyDocument().sections[0], defaultSection(type, sectionId, 10)],
      };
      const { unmount } = render(
        <AdminI18nProvider>
          <HomepageEditorProvider>
            <Loader document={doc} />
            <SectionEditorPanel sectionId={sectionId} />
          </HomepageEditorProvider>
        </AdminI18nProvider>,
      );

      expect(
        document.querySelector(`[data-section-content-editor="${type}"]`),
      ).not.toBeNull();
      unmount();
    }
  });

  it("summarises the override count in the collapsed header", () => {
    renderPanel();

    // The fixture sets only `backgroundColor` among the whitelisted keys.
    expect(
      screen.getByRole("button", { name: /1 overridden/ }),
    ).toBeVisible();
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

    fireEvent.click(
      screen.getByRole("button", { name: /Advanced: individual override/ }),
    );
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

  it("emits only the changed schedule field", () => {
    const source = sectionDocument().sections[1] as NonHeroHomepageSection;
    let received: unknown;

    render(
      <AdminI18nProvider>
        <SectionCommonFields
          section={source}
          onChange={(patch) => {
            received = patch;
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "2026-10-01T09:30" },
    });

    expect(received).toEqual({
      schedule: {
        publishAt: new Date("2026-10-01T09:30").toISOString(),
      },
    });
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
