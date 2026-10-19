import type { ReactNode } from "react";
import studioStyles from "./HomepageStudio.module.css";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { emptyDocument, type HomepageDocument, type HomepageSection } from "@/lib/homepage-document";
import type { HomepageDraftSnapshot, AdminCategoryNode, AdminProduct } from "@/lib/admin-api";
import {
  HomepageEditor,
  HomepageEditorProvider,
  HomepageEditorShell,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import {
  ANNOUNCEMENT_SELECTION_ID,
  HOMEPAGE_DEFAULTS_SELECTION_ID,
} from "@/components/admin/homepage/ModuleTree";

const getHomepageDraft = vi.hoisted(() => vi.fn());
const getProduct = vi.hoisted(() => vi.fn());
const listCategories = vi.hoisted(() => vi.fn());
const saveHomepageDraft = vi.hoisted(() => vi.fn());
const createHomepagePreviewToken = vi.hoisted(() => vi.fn());
const validateHomepage = vi.hoisted(() => vi.fn());
const publishHomepage = vi.hoisted(() => vi.fn());
const hasPermission = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    getHomepageDraft,
    getProduct,
    listCategories,
    saveHomepageDraft,
    createHomepagePreviewToken,
    validateHomepage,
    publishHomepage,
  },
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ status: "authed", hasPermission }),
}));
vi.mock(
  "@/components/admin/homepage/useHomepagePreviewShellData",
  async () => {
    const { FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA } = await import(
      "@/lib/homepage-preview-shell-data"
    );
    return {
      useHomepagePreviewShellData: () => ({
        ...FALLBACK_HOMEPAGE_PREVIEW_SHELL_DATA,
        degraded: false,
        loading: false,
      }),
    };
  },
);

const DRAFT_REV = 5;
const DRAFT_UPDATED_AT = "2026-09-28T02:00:00.000Z";
const PUBLISHED_AT = "2026-09-27T10:00:00.000Z";
const HERO_SECTION_ID = "00000000-0000-7000-8000-000000000001";
const USP_SECTION_ID = "00000000-0000-7000-8000-000000000902";

function draftSnapshot(
  overrides: Partial<HomepageDraftSnapshot> = {},
): HomepageDraftSnapshot {
  return {
    draft: emptyDocument(),
    draftRev: DRAFT_REV,
    draftUpdatedAt: DRAFT_UPDATED_AT,
    draftUpdatedById: "admin-42",
    published: { versionNo: 3, publishAt: PUBLISHED_AT },
    ...overrides,
  };
}

function documentWithUsp(): HomepageDocument {
  const document = emptyDocument();
  const usp: HomepageSection = {
    id: USP_SECTION_ID,
    type: "USP",
    title: "Trust strip",
    subtitle: null,
    enabled: true,
    sortOrder: 10,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload: {},
  } as HomepageSection;
  document.sections.push(usp);
  return document;
}

function documentWithHeroAfterUsp(): HomepageDocument {
  const document = documentWithUsp();
  document.sections = document.sections.map((section) =>
    section.type === "HERO" ? { ...section, sortOrder: 20 } : section,
  );
  return document;
}

function mockRect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 700,
    width: 700,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockPreviewScrollGeometry({
  preview,
  target,
  scrollTop,
  scrollHeight = 3000,
  clientHeight = 900,
  targetTop,
  targetHeight,
  scale = 1,
}: {
  preview: HTMLElement;
  target: HTMLElement;
  scrollTop: number;
  scrollHeight?: number;
  clientHeight?: number;
  targetTop: number;
  targetHeight: number;
  scale?: number;
}): { scrollTo: ReturnType<typeof vi.fn>; scrollIntoView: ReturnType<typeof vi.fn> } {
  const scrollTo = vi.fn();
  const scrollIntoView = vi.fn();
  Object.defineProperties(preview, {
    scrollTop: { configurable: true, value: scrollTop, writable: true },
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollTo: { configurable: true, value: scrollTo },
    getBoundingClientRect: {
      configurable: true,
      value: () => mockRect(100, clientHeight * scale),
    },
  });
  Object.defineProperties(target, {
    scrollIntoView: { configurable: true, value: scrollIntoView },
    getBoundingClientRect: {
      configurable: true,
      value: () =>
        mockRect(100 + (targetTop - scrollTop) * scale, targetHeight * scale),
    },
  });
  return { scrollTo, scrollIntoView };
}

const PREVIEW_PRODUCT_ID = "00000000-0000-7000-8000-000000000701";
const PREVIEW_CATEGORY_ID = "00000000-0000-7000-8000-000000000702";

function previewProduct(): AdminProduct {
  return {
    id: PREVIEW_PRODUCT_ID,
    name: "Preview product",
    slug: "preview-product",
    productCode: null,
    description: null,
    tagline: null,
    seoTitle: null,
    metaDescription: null,
    categoryId: PREVIEW_CATEGORY_ID,
    status: "ACTIVE",
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    materials: null,
    features: null,
    createdAt: DRAFT_UPDATED_AT,
    updatedAt: DRAFT_UPDATED_AT,
    catalogGraphVersion: 1,
    defaultDisplayVariantId: null,
    images: [],
    detailBlocks: [],
    variants: [
      {
        id: "00000000-0000-7000-8000-000000000705",
        name: "Default",
        position: 0,
        sku: {
          id: "00000000-0000-7000-8000-000000000706",
          skuCode: "PREVIEW-1",
          status: "ACTIVE",
          isBundle: false,
          bundleVersion: 0,
          price: "1200",
          compareAtPrice: null,
          supplierSku: null,
          supplierCost: null,
          costCurrency: null,
          landedCost: null,
          productWidth: null, productDepth: null, productHeight: null, productWeight: null,
          packageWidth: null,
          packageHeight: null,
          packageDepth: null,
          packageWeight: null,
          volumetricWeight: null,
          onHand: 4,
          reserved: 0,
          availableInventory: 4,
        },
      },
    ],
  };
}

function documentWithCatalogJoins(): HomepageDocument {
  const document = emptyDocument();
  document.sections.push(
    {
      id: "00000000-0000-7000-8000-000000000703",
      type: "PRODUCT_GRID",
      title: "Selected products",
      subtitle: null,
      enabled: true,
      sortOrder: 10,
      schedule: { publishAt: null, unpublishAt: null },
      products: [{ productId: PREVIEW_PRODUCT_ID, sortOrder: 0, badge: null }],
      payload: { columns: 2 },
    } as HomepageSection,
    {
      id: "00000000-0000-7000-8000-000000000704",
      type: "CATEGORY_TILES",
      title: "Selected categories",
      subtitle: null,
      enabled: true,
      sortOrder: 20,
      schedule: { publishAt: null, unpublishAt: null },
      products: [],
      payload: { categoryIds: [PREVIEW_CATEGORY_ID] },
    } as HomepageSection,
  );
  return document;
}

function withRotation(doc: HomepageDocument, rotationMs: number): HomepageDocument {
  return { ...doc, announcement: { ...doc.announcement, rotationMs } };
}

function bump(doc: HomepageDocument): HomepageDocument {
  return withRotation(doc, doc.announcement.rotationMs + 1);
}

function savedResponse(rev = 6) {
  return { draftRev: rev, draftUpdatedAt: "2026-09-28T03:00:00.000Z" };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Drives reducer changes through the real context so the shell's autosave
 * and keyboard handling can be exercised end to end. */
function EditorProbe(): ReactNode {
  const {
    state,
    dispatch,
    setSelectedElementKey,
    setSelectedSectionId,
    setSelectedSlideId,
    selectedElementKey,
  } = useHomepageEditor();
  const hero = state.document.sections.find((section) => section.type === "HERO");
  const firstSlideId =
    hero && hero.type === "HERO" ? (hero.payload.slides[0]?.id ?? null) : null;
  return (
    <div>
      <span data-testid="rotation">{state.document.announcement.rotationMs}</span>
      <span data-testid="dirty">{state.dirty ? "dirty" : "clean"}</span>
      <button
        type="button"
        onClick={() =>
          dispatch({ type: "commit", document: bump(state.document) })
        }
      >
        commit-change
      </button>
      <button
        type="button"
        onClick={() => {
          setSelectedSlideId(firstSlideId);
          setSelectedElementKey("heading");
        }}
      >
        select-element
      </button>
      <button
        type="button"
        onClick={() => {
          setSelectedElementKey(null);
          setSelectedSlideId(firstSlideId);
        }}
      >
        select-slide
      </button>
      <button
        type="button"
        onClick={() => {
          setSelectedElementKey(null);
          setSelectedSlideId(null);
          setSelectedSectionId(ANNOUNCEMENT_SELECTION_ID);
        }}
      >
        select-announcement
      </button>
      <button
        type="button"
        onClick={() => {
          setSelectedElementKey(null);
          setSelectedSlideId(null);
          setSelectedSectionId(HOMEPAGE_DEFAULTS_SELECTION_ID);
        }}
      >
        select-defaults
      </button>
      <span data-testid="selected-element">{selectedElementKey ?? ""}</span>
      <button
        type="button"
        onClick={() => {
          setSelectedSectionId(USP_SECTION_ID);
        }}
      >
        select-nonhero
      </button>
      <button
        type="button"
        onClick={() => {
          setSelectedSectionId(HERO_SECTION_ID);
        }}
      >
        select-hero
      </button>
      <button
        type="button"
        onClick={() => {
          dispatch({
            type: "mutate",
            mutate: (document) => ({
              ...document,
              sections: document.sections.map((section) =>
                section.type === "USP"
                  ? { ...section, title: "Updated trust strip" }
                  : section,
              ),
            }),
          });
        }}
      >
        change-usp-title
      </button>
      <textarea aria-label="probe textarea" />
    </div>
  );
}

function renderHarness() {
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <HomepageEditorShell />
        <EditorProbe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function renderHarnessWithDocument(document: HomepageDocument) {
  getHomepageDraft.mockResolvedValueOnce(draftSnapshot({ draft: document }));
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <HomepageEditorShell />
        <EditorProbe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function selectPreviewDevice(view: "desktop" | "tablet" | "mobile"): void {
  const labels = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };
  fireEvent.click(within(screen.getByRole("group", { name: "Preview device" })).getByRole("button", { name: labels[view] }));
}

function renderEditor() {
  return render(
    <AdminI18nProvider>
      <HomepageEditor />
    </AdminI18nProvider>,
  );
}

describe("HomepageEditor", () => {
  beforeEach(() => {
    setAdminLang("en");
    getHomepageDraft.mockReset();
    getProduct.mockReset();
    listCategories.mockReset();
    saveHomepageDraft.mockReset();
    createHomepagePreviewToken.mockReset();
    validateHomepage.mockReset();
    publishHomepage.mockReset();
    hasPermission.mockReset();
    getHomepageDraft.mockResolvedValue(draftSnapshot());
    listCategories.mockResolvedValue([]);
    saveHomepageDraft.mockResolvedValue(savedResponse());
    createHomepagePreviewToken.mockResolvedValue({
      token: "tok-abc",
      expiresInMs: 1_800_000,
    });
    validateHomepage.mockResolvedValue({ errors: [], warnings: [] });
    publishHomepage.mockResolvedValue({
      versionNo: 8,
      publishAt: "2026-10-01T09:30:00.000Z",
    });
    hasPermission.mockReturnValue(true);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, writable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("compares only the canvas, keeps autosave idle and offers a visible way to stop comparing", async () => {
    vi.useFakeTimers();
    const document = documentWithUsp();
    document.appearance = "STUDIO_V3";
    const { container } = renderHarnessWithDocument(document);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "select-defaults" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare current appearance" }));
    expect(container.querySelector("[data-homepage-appearance]")).toBeNull();
    const toolbar = screen.getByRole("group", { name: "Preview device" });
    expect(within(toolbar).getByText("Preview only: current appearance")).toBeVisible();
    expect(screen.getByTestId("dirty")).toHaveTextContent("clean");
    await advance(5000);
    expect(saveHomepageDraft).not.toHaveBeenCalled();
    fireEvent.click(within(toolbar).getByRole("button", { name: "Stop comparing" }));
    expect(container.querySelector('[data-homepage-appearance="STUDIO_V3"]')).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Compare current appearance" })).not.toBeChecked();
    expect(screen.getByTestId("dirty")).toHaveTextContent("clean");
  });

  it("loads the draft on mount and renders the three panes with the status bar", async () => {
    renderEditor();

    expect(screen.getByText("Loading the homepage editor…")).toBeVisible();
    await screen.findByRole("button", { name: "Save Draft" });

    expect(getHomepageDraft).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-pane]")).toHaveLength(3);
    expect(
      document.querySelector('[data-pane="modules"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-pane="preview"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-pane="settings"]'),
    ).toBeInTheDocument();

    expect(
      screen.getByText(`Last saved: ${formatTime(DRAFT_UPDATED_AT)}`),
    ).toBeVisible();
    expect(screen.getByText("admin-42")).toBeVisible();
    expect(
      screen.getByText(`Last published: ${formatTime(PUBLISHED_AT)}`),
    ).toBeVisible();
    expect(screen.getByText("Version 3")).toBeVisible();
    expect(screen.getByText("Draft")).toBeVisible();
    expect(screen.getByText("Published")).toBeVisible();

    expect(screen.getByRole("button", { name: "Save Draft" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Independent preview" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Publish" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Versions" })).toHaveAttribute(
      "href",
      "/admin/homepage/versions",
    );

    expect(screen.getByTestId("homepage-status-bar").closest("[data-studio-columns]")).toBeNull();

    const style = document.querySelector("style");
    expect(style?.textContent).toContain(`#hp-hero-${HERO_SECTION_ID}`);
  });

  it("reveals the settings workspace and the exact navigation row from a publish issue", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const draft = documentWithUsp();
    draft.sections.push({ ...draft.sections[1], id: "navigation-section", type: "CATEGORY_TILES", payload: { entries: [{ id: "navigation-entry", imageUrl: "/uploads/nav.jpg", link: null }], presentation: "CIRCLES" } });
    getHomepageDraft.mockResolvedValue(draftSnapshot({ draft }));
    validateHomepage.mockResolvedValue({ errors: [{ severity: "ERROR", code: "NAVIGATION_TARGET_UNAVAILABLE", message: "Entry needs a target.", sectionId: "navigation-section", entryId: "navigation-entry" }], warnings: [] });
    renderEditor();
    await flush();
    fireEvent.click(screen.getByRole("tab", { name: "Live Preview" }));
    expect(document.querySelector('[data-pane="settings"]')).toHaveAttribute("data-pane-active", "false");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Go to slide" }));
    await flush();
    const pane = document.querySelector<HTMLElement>("[data-homepage-settings-scroll]")!;
    const scroll = vi.fn();
    pane.scrollTo = scroll;
    act(() => {
      for (let frame = 0; frame < 2; frame += 1) frames.splice(0).forEach((callback) => callback(0));
    });
    expect(pane.closest('[data-pane="settings"]')).toHaveAttribute("data-pane-active", "true");
    expect(pane.querySelector('[data-entry-id="navigation-entry"]')).not.toBeNull();
    expect(scroll).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Publish homepage" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("does not save or validate until the publish dialog is opened", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Publish" });
    await flush();

    expect(saveHomepageDraft).not.toHaveBeenCalled();
    expect(validateHomepage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await flush();
    expect(validateHomepage).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable load error when the draft cannot be fetched", async () => {
    getHomepageDraft.mockRejectedValueOnce(new AdminApiError("Nope", 500));
    renderEditor();

    expect(
      await screen.findByText("Failed to load the homepage draft."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Save Draft" })).toBeVisible();
    expect(getHomepageDraft).toHaveBeenCalledTimes(2);
  });

  it("autosaves 3s after a change with the current rev and shows Saved", async () => {
    vi.useFakeTimers();
    renderHarness();
    await flush();

    expect(saveHomepageDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    expect(screen.getByTestId("dirty")).toHaveTextContent("dirty");

    await advance(2999);
    expect(saveHomepageDraft).not.toHaveBeenCalled();

    await advance(1);
    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);
    expect(saveHomepageDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        announcement: expect.objectContaining({ rotationMs: 5001 }),
      }),
      DRAFT_REV,
    );
    expect(screen.getByText("Saved")).toBeVisible();

    await advance(6000);
    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);
  });

  it("does not autosave while the draft is clean", async () => {
    vi.useFakeTimers();
    renderHarness();
    await flush();

    await advance(10000);
    expect(saveHomepageDraft).not.toHaveBeenCalled();
  });

  it("saves immediately on Cmd/Ctrl+S and tracks the new rev", async () => {
    renderHarness();
    await flush();

    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await flush();

    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);
    expect(saveHomepageDraft).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1 }),
      DRAFT_REV,
    );
    expect(screen.getByText("Saved")).toBeVisible();

    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await flush();

    expect(saveHomepageDraft).toHaveBeenCalledTimes(2);
    expect(saveHomepageDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ schemaVersion: 1 }),
      6,
    );
  });

  it("surfaces a 409 conflict with load-latest / keep-mine choices", async () => {
    saveHomepageDraft.mockRejectedValue(
      new AdminApiError("Stale revision", 409),
    );
    renderHarness();
    await flush();

    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await flush();

    expect(screen.getByText("The draft was updated elsewhere")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Load latest (discard my changes)" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Keep mine (re-save on the latest revision)",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
  });

  it("load latest discards local changes and adopts the remote draft", async () => {
    const remote = withRotation(emptyDocument(), 7777);
    getHomepageDraft
      .mockResolvedValueOnce(draftSnapshot())
      .mockResolvedValueOnce(
        draftSnapshot({ draft: remote, draftRev: 9, draftUpdatedById: "admin-9" }),
      );
    saveHomepageDraft.mockRejectedValue(
      new AdminApiError("Stale revision", 409),
    );
    renderHarness();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await flush();
    expect(screen.getByTestId("rotation")).toHaveTextContent("5001");

    fireEvent.click(
      screen.getByRole("button", { name: "Load latest (discard my changes)" }),
    );
    await flush();

    expect(getHomepageDraft).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("rotation")).toHaveTextContent("7777");
    expect(screen.getByTestId("dirty")).toHaveTextContent("clean");
    expect(
      screen.queryByText("The draft was updated elsewhere"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("admin-9")).toBeVisible();
  });

  it("keep mine re-saves the local document on the latest revision", async () => {
    getHomepageDraft
      .mockResolvedValueOnce(draftSnapshot())
      .mockResolvedValueOnce(draftSnapshot({ draftRev: 9 }));
    saveHomepageDraft
      .mockRejectedValueOnce(new AdminApiError("Stale revision", 409))
      .mockResolvedValueOnce(savedResponse(10));
    renderHarness();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await flush();
    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Keep mine (re-save on the latest revision)",
      }),
    );
    await flush();

    expect(getHomepageDraft).toHaveBeenCalledTimes(2);
    expect(saveHomepageDraft).toHaveBeenCalledTimes(2);
    const [savedDocument, savedRev] = saveHomepageDraft.mock.calls[1];
    expect(savedRev).toBe(9);
    expect(
      (savedDocument as HomepageDocument).announcement.rotationMs,
    ).toBe(5001);
    expect(
      screen.queryByText("The draft was updated elsewhere"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeVisible();
  });

  it("shows a non-409 save error and keeps the local document", async () => {
    saveHomepageDraft.mockRejectedValue(new AdminApiError("Server exploded", 500));
    renderHarness();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await flush();

    expect(screen.getByText("Save failed")).toBeVisible();
    expect(screen.getByText("Server exploded")).toBeVisible();
    expect(screen.getByTestId("rotation")).toHaveTextContent("5001");
    expect(screen.getByTestId("dirty")).toHaveTextContent("dirty");
    expect(
      screen.queryByText("The draft was updated elsewhere"),
    ).not.toBeInTheDocument();
  });

  it("keeps undo and redo in the page actions and uses the shared document history", async () => {
    renderHarness();
    await flush();
    const actions = within(screen.getByTestId("homepage-status-bar"));
    const undo = actions.getByRole("button", { name: "Undo" });
    const redo = actions.getByRole("button", { name: "Redo" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    expect(screen.getByTestId("rotation")).toHaveTextContent("5001");
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(screen.getByTestId("rotation")).toHaveTextContent("5000");
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
    fireEvent.click(redo);
    expect(screen.getByTestId("rotation")).toHaveTextContent("5001");
    expect(redo).toBeDisabled();
  });

  it("undo/redo shortcuts walk the history and ignore unrelated keys", async () => {
    renderHarness();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    expect(screen.getByTestId("rotation")).toHaveTextContent("5002");

    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByTestId("rotation")).toHaveTextContent("5002");

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(screen.getByTestId("rotation")).toHaveTextContent("5001");

    fireEvent.keyDown(document, { key: "z", metaKey: true, shiftKey: true });
    expect(screen.getByTestId("rotation")).toHaveTextContent("5002");
  });

  it("removes keyboard shortcuts when the editor unmounts", async () => {
    const { unmount } = renderHarness();
    await flush();

    unmount();
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await flush();

    expect(saveHomepageDraft).not.toHaveBeenCalled();
  });

  it("yields Cmd/Ctrl+Z, Shift+Z and S inside text fields but keeps them outside", async () => {
    renderHarness();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    expect(screen.getByTestId("rotation")).toHaveTextContent("5001");

    const textarea = screen.getByRole("textbox", { name: "probe textarea" });
    textarea.focus();

    // Inside a text field the shell leaves the event alone so the browser's
    // native text undo/redo and save handling keep working.
    expect(fireEvent.keyDown(textarea, { key: "z", ctrlKey: true })).toBe(true);
    expect(screen.getByTestId("rotation")).toHaveTextContent("5001");
    expect(
      fireEvent.keyDown(textarea, { key: "z", ctrlKey: true, shiftKey: true }),
    ).toBe(true);
    expect(screen.getByTestId("rotation")).toHaveTextContent("5001");
    expect(fireEvent.keyDown(textarea, { key: "s", metaKey: true })).toBe(true);
    await flush();
    expect(saveHomepageDraft).not.toHaveBeenCalled();

    // Outside a text field the shortcuts still work.
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(screen.getByTestId("rotation")).toHaveTextContent("5000");

    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await flush();
    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps all Hero editing groups reachable through right-pane shortcuts", async () => {
    renderHarness();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "select-slide" }));
    const settings = document.querySelector<HTMLElement>('[data-pane="settings"]')!;
    const shortcuts = within(settings).getByRole("navigation", { name: "Hero settings shortcuts" });
    for (const name of ["Page layout", "Text", "Buttons and links", "Images and video"]) {
      expect(within(shortcuts).getByRole("button", { name })).toBeVisible();
    }
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Buttons and links" }));
    expect(settings.querySelector('details[data-settings-group="buttons"]')).toHaveAttribute("open");
    for (const key of ["eyebrow", "heading", "subheading", "offer", "countdown", "ctaPrimary", "ctaSecondary"]) {
      expect(settings.querySelector(`[data-hero-element="${key}"] textarea`)).not.toBeNull();
    }
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Images and video" }));
    expect(settings.querySelector('[data-panel="hero-media-settings"]')).not.toBeNull();
    expect(settings.querySelector('[data-hero-element="ctaPrimary"] textarea')).not.toBeNull();
  });

  it("routes the settings pane by selection priority", async () => {
    renderHarness();
    await flush();

    const panel = (name: string): Element | null =>
      document.querySelector(`[data-panel="${name}"]`);

    // Hero controls coexist; selection opens the relevant group.
    expect(panel("hero-settings")).not.toBeNull();
    expect(panel("hero-style-settings")).not.toBeNull();
    expect(panel("hero-media-settings")).not.toBeNull();
    expect(panel("settings-panel")).not.toBeNull();
    expect(panel("section-display-settings")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "select-element" }));
    expect(panel("settings-panel")).not.toBeNull();
    expect(panel("hero-media-settings")).not.toBeNull();
    expect(panel("hero-style-settings")).not.toBeNull();
    expect(panel("section-display-settings")).not.toBeNull();
    expect(document.querySelector('[data-settings-group="text"]')).toHaveAttribute("open");
    expect(within(document.querySelector<HTMLElement>('fieldset[data-hero-element="heading"]')!).getByRole("textbox", { name: "Text" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "select-slide" }));
    expect(panel("hero-media-settings")).not.toBeNull();
    expect(panel("hero-style-settings")).not.toBeNull();
    expect(panel("section-display-settings")).not.toBeNull();
    expect(panel("settings-panel")).not.toBeNull();
    expect(document.querySelector('[data-settings-group="media"]')).toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: "select-announcement" }));
    expect(panel("announcement-settings")).not.toBeNull();
    expect(panel("hero-media-settings")).toBeNull();
    expect(panel("hero-style-settings")).toBeNull();
    expect(panel("settings-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "select-defaults" }));
    expect(panel("homepage-defaults")).not.toBeNull();
    expect(panel("announcement-settings")).toBeNull();
    expect(panel("hero-style-settings")).toBeNull();
    expect(panel("settings-panel")).toBeNull();
  });

  it("opens Hero media settings when a thumbnail is clicked after editing a Hero element", async () => {
    const draftDocument = emptyDocument();
    draftDocument.sections = draftDocument.sections.map((section) =>
      section.type === "HERO" ? { ...section, title: "Hero banner" } : section,
    );
    renderHarnessWithDocument(draftDocument);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Hero banner" }));
    fireEvent.click(screen.getByRole("button", { name: "select-element" }));
    expect(document.querySelector('[data-panel="settings-panel"]')).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Hero 1: Add image or video" }),
    );

    expect(screen.getByTestId("selected-element")).toHaveTextContent("");
    expect(document.querySelector('[data-panel="hero-media-settings"]')).not.toBeNull();
    expect(document.querySelector('[data-settings-group="media"]')).toHaveAttribute("open");
    expect(document.querySelector('[data-hero-element="heading"] textarea')).not.toBeNull();
  });

  it("labels the editing canvas with the real device width and the scale it applied", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 600,
    } as DOMRect);

    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    const metrics = (): string | null =>
      document.querySelector("[data-preview-metrics]")?.textContent ?? null;

    // The desktop frame is 1440 wide; a 300px frame box is 20.83% → 21%.
    await act(async () => {});
    expect(metrics()).toBe("Scaled editing preview · 1440px · 21%");

    selectPreviewDevice("mobile");
    expect(metrics()).toBe("Scaled editing preview · 390px · 71%");
  });

  it("lays out the V3 toolbar with icon device segments, live metrics and a compact independent preview action", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    const toolbar = document.querySelector('[data-panel-head="preview"]');
    expect(toolbar).not.toBeNull();
    const segments = toolbar!.querySelector("[data-device-segments]");
    expect(segments).not.toBeNull();
    const deviceButtons = within(segments as HTMLElement).getAllByRole("button");
    expect(deviceButtons).toHaveLength(3);
    for (const button of deviceButtons) {
      expect(button.querySelector("svg")).not.toBeNull();
    }
    expect(within(segments as HTMLElement).getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-pressed", "true");

    const metrics = within(toolbar as HTMLElement).getByText(/^Scaled editing preview · 1440px · \d+%$/);
    const preview = within(toolbar as HTMLElement).getByRole("button", { name: "Independent preview" });
    expect(preview.querySelector("svg")).not.toBeNull();
    expect(preview.className).toContain("bg-cta");

    // Design order inside the single toolbar row: device segments → metrics → action.
    const order = Array.from(toolbar!.querySelectorAll("[data-preview-metrics], [data-device-segments], button"));
    expect(order.indexOf(segments as Element)).toBeLessThan(order.indexOf(metrics));
    expect(order.indexOf(metrics)).toBeLessThan(order.indexOf(preview));
  });

  it("routes a selected non-HERO section to the typed section editor and clears Hero selection", async () => {
    renderHarnessWithDocument(documentWithUsp());
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "select-element" }));
    expect(screen.getByTestId("selected-element")).toHaveTextContent("heading");
    expect(document.querySelector('[data-panel="settings-panel"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "select-nonhero" }));

    expect(screen.getByTestId("selected-element")).toHaveTextContent("");
    expect(document.querySelector('[data-testid="section-editor-panel"]')).not.toBeNull();
    expect(document.querySelector('[data-section-editor-type="USP"]')).not.toBeNull();
    expect(document.querySelector('[data-panel="settings-panel"]')).toBeNull();
    expect(document.querySelector('[data-panel="hero-style-settings"]')).toBeNull();
  });

  it("renders the whole draft in a scrollable live preview", async () => {
    renderHarnessWithDocument(documentWithUsp());
    await flush();

    const preview = document.querySelector('[data-homepage-live-preview]');
    expect(preview).not.toBeNull();
    expect(preview).toHaveClass(/overflow-y-auto/);
    expect(preview?.querySelector('[data-preview-section="HERO"]')).not.toBeNull();
    expect(preview?.querySelector('[data-preview-section="USP"]')).not.toBeNull();
    expect(within(preview as HTMLElement).getByText("Trust strip")).toBeVisible();
  });

  it("applies homepage defaults to sections in the live preview", async () => {
    const draft = documentWithUsp();
    draft.defaults = { backgroundColor: "#F2EFE9", paddingTop: 40 };
    renderHarnessWithDocument(draft);
    await flush();

    const preview = document.querySelector('[data-homepage-live-preview]');
    const usp = preview?.querySelector('[data-preview-section="USP"]');
    const shell = usp?.querySelector("section");
    expect(shell).toHaveStyle({ backgroundColor: "#F2EFE9", paddingTop: "40px" });
  });

  it("applies homepage defaults to an unstyled Hero in the live preview", async () => {
    const draft = emptyDocument();
    delete draft.sections[0].style;
    draft.defaults = {
      backgroundColor: "#F2EFE9",
      textColor: "#112233",
      contentWidth: "NARROW",
      paddingTop: 40,
      paddingBottom: 24,
    };
    renderHarnessWithDocument(draft);
    await flush();

    const hero = document.querySelector('[data-preview-section="HERO"] [data-hero-slider]');
    expect(hero).toHaveClass("mx-auto", "max-w-[840px]");
    expect(hero).toHaveStyle({
      backgroundColor: "#F2EFE9",
      color: "#112233",
      paddingTop: "40px",
      paddingBottom: "24px",
    });
  });

  it("centers a selected preview module within the internal viewport", async () => {
    renderHarnessWithDocument(documentWithUsp());
    await flush();

    const preview = document.querySelector<HTMLElement>("[data-homepage-live-preview]");
    const target = preview?.querySelector<HTMLElement>(
      `[data-preview-section-id="${USP_SECTION_ID}"]`,
    );
    expect(preview).not.toBeNull();
    expect(target).not.toBeNull();
    const { scrollTo } = mockPreviewScrollGeometry({
      preview: preview!,
      target: target!,
      scrollTop: 0,
      targetTop: 1400,
      targetHeight: 200,
    });

    fireEvent.click(screen.getByRole("button", { name: "Trust strip" }));

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 1050 });
  });

  it("clamps a selected final module to the bottom of the complete preview", async () => {
    renderHarnessWithDocument(documentWithUsp());
    await flush();

    const preview = document.querySelector<HTMLElement>("[data-homepage-live-preview]");
    const target = preview?.querySelector<HTMLElement>(
      `[data-preview-section-id="${USP_SECTION_ID}"]`,
    );
    expect(preview).not.toBeNull();
    expect(target).not.toBeNull();
    const { scrollTo } = mockPreviewScrollGeometry({
      preview: preview!,
      target: target!,
      scrollTop: 0,
      targetTop: 2800,
      targetHeight: 100,
      scale: 0.42,
    });

    fireEvent.click(screen.getByRole("button", { name: "Trust strip" }));

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 2100 });
  });

  it("keeps the complete preview still when the selected module is visible", async () => {
    renderHarnessWithDocument(documentWithUsp());
    await flush();

    const preview = document.querySelector<HTMLElement>("[data-homepage-live-preview]");
    const target = preview?.querySelector<HTMLElement>(
      `[data-preview-section-id="${USP_SECTION_ID}"]`,
    );
    expect(preview).not.toBeNull();
    expect(target).not.toBeNull();
    const { scrollTo, scrollIntoView } = mockPreviewScrollGeometry({
      preview: preview!,
      target: target!,
      scrollTop: 1000,
      targetTop: 1150,
      targetHeight: 100,
    });

    fireEvent.click(screen.getByRole("button", { name: "Trust strip" }));

    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("repositions the selected module when the preview device changes", async () => {
    renderHarnessWithDocument(documentWithUsp());
    await flush();

    const preview = document.querySelector<HTMLElement>("[data-homepage-live-preview]");
    const target = preview?.querySelector<HTMLElement>(
      `[data-preview-section-id="${USP_SECTION_ID}"]`,
    );
    expect(preview).not.toBeNull();
    expect(target).not.toBeNull();
    mockPreviewScrollGeometry({
      preview: preview!,
      target: target!,
      scrollTop: 0,
      targetTop: 1400,
      targetHeight: 200,
    });
    fireEvent.click(screen.getByRole("button", { name: "Trust strip" }));

    const { scrollTo } = mockPreviewScrollGeometry({
      preview: preview!,
      target: target!,
      scrollTop: 1050,
      scrollHeight: 4000,
      clientHeight: 844,
      targetTop: 2500,
      targetHeight: 100,
      scale: 0.42,
    });
    selectPreviewDevice("mobile");

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 2128 });
  });

  it("keeps live preview sections in draft sort order", async () => {
    renderHarnessWithDocument(documentWithHeroAfterUsp());
    await flush();

    const preview = document.querySelector("[data-homepage-live-preview]");
    const types = [...(preview?.querySelectorAll("[data-preview-section]") ?? [])].map(
      (section) => section.getAttribute("data-preview-section"),
    );

    expect(types.slice(0, 2)).toEqual(["USP", "HERO"]);
  });

  it("hydrates selected product and category joins for the live preview", async () => {
    getProduct.mockResolvedValue(previewProduct());
    const category: AdminCategoryNode = {
      id: PREVIEW_CATEGORY_ID,
      parentId: null,
      name: "Preview category",
      slug: "preview-category",
      sortOrder: 0,
      imageUrl: "https://example.com/category.jpg",
      status: "ACTIVE",
      heroStyle: null,
      children: [],
    };
    listCategories.mockResolvedValue([category]);

    renderHarnessWithDocument(documentWithCatalogJoins());
    await flush();
    await flush();

    const preview = document.querySelector("[data-homepage-live-preview]");
    expect(within(preview as HTMLElement).getAllByText("Preview product").length).toBeGreaterThan(0);
    expect(
      within(preview as HTMLElement).getByText("Preview category"),
    ).toBeVisible();
    expect(within(preview as HTMLElement).queryByText(PREVIEW_PRODUCT_ID)).toBeNull();
    expect(within(preview as HTMLElement).queryByText(PREVIEW_CATEGORY_ID)).toBeNull();
  });


  it("updates the full preview from an unsaved section mutation", async () => {
    renderHarnessWithDocument(documentWithUsp());
    await flush();

    const preview = document.querySelector("[data-homepage-live-preview]");
    expect(preview).not.toBeNull();
    expect(within(preview as HTMLElement).getByText("Trust strip")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "change-usp-title" }));

    expect(within(preview as HTMLElement).getByText("Updated trust strip")).toBeVisible();
    expect(within(preview as HTMLElement).queryByText("Trust strip")).toBeNull();
  });

  it("switches back to Hero settings when selecting a Hero element from a non-Hero section", async () => {
    renderHarnessWithDocument(documentWithUsp());
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "select-nonhero" }));
    expect(document.querySelector('[data-testid="section-editor-panel"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "select-element" }));

    expect(screen.getByTestId("selected-element")).toHaveTextContent("heading");
    expect(document.querySelector('[data-panel="settings-panel"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="section-editor-panel"]')).toBeNull();
  });

  it("keeps Hero element selection when reselecting the same Hero section", async () => {
    renderHarness();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "select-element" }));
    expect(screen.getByTestId("selected-element")).toHaveTextContent("heading");
    expect(document.querySelector('[data-panel="settings-panel"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "select-hero" }));

    expect(screen.getByTestId("selected-element")).toHaveTextContent("heading");
    expect(document.querySelector('[data-panel="settings-panel"]')).not.toBeNull();
  });

  it("preserves the legacy storefront-equivalent Hero height without display settings", async () => {
    const draft = emptyDocument();
    const heroSection = draft.sections[0];
    if (heroSection.type !== "HERO") throw new Error("fixture requires HERO");
    delete heroSection.payload.display;
    getHomepageDraft.mockResolvedValueOnce(draftSnapshot({ draft }));
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    fireEvent.click(screen.getByRole("tab", { name: "Live Preview" }));

    const hero = document.querySelector<HTMLElement>(
      '[data-preview-section="HERO"]',
    );
    expect(hero).toHaveStyle({ height: "648px" });

    selectPreviewDevice("tablet");
    expect(hero).toHaveStyle({ height: "960px" });

    selectPreviewDevice("mobile");
    expect(hero).toHaveStyle({ height: "487.5px" });
  });

  it("lets new SCREEN Heroes grow instead of fixing their preview wrapper height", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });
    fireEvent.click(screen.getByRole("tab", { name: "Live Preview" }));
    const hero = document.querySelector<HTMLElement>('[data-preview-section="HERO"]')!;
    expect(hero.style.height).toBe("");
    for (const name of ["Tablet", "Mobile"]) {
      selectPreviewDevice(name === "Tablet" ? "tablet" : "mobile");
      expect(hero.style.height).toBe("");
    }
  });

  it("switches the full-width preview device without a device frame", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    fireEvent.click(screen.getByRole("tab", { name: "Live Preview" }));

    const surface = document.querySelector("[data-full-width-preview]");
    expect(surface).toHaveStyle({ width: "100%" });
    expect(surface).toHaveAttribute("data-preview-device", "desktop");
    expect(surface).toHaveAttribute("data-full-width-preview", "true");

    const viewport = surface?.querySelector("[data-preview-viewport]");
    expect(viewport).toHaveStyle({ width: "1440px", height: "900px" });
    expect(viewport).toHaveStyle({ transform: "scale(0.42)" });

    selectPreviewDevice("tablet");
    expect(viewport).toHaveStyle({ width: "768px", height: "1024px" });
    expect(surface).toHaveAttribute("data-preview-device", "tablet");

    selectPreviewDevice("mobile");
    expect(viewport).toHaveStyle({ width: "390px", height: "844px" });
    expect(surface).toHaveAttribute("data-preview-device", "mobile");
  });

  it("switches panes with the narrow-layout tab switcher", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Modules",
      "Live Preview",
      "Settings",
    ]);
    expect(screen.getByRole("tab", { name: "Modules" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const modulesPane = document.querySelector('[data-pane="modules"]');
    const previewPane = document.querySelector('[data-pane="preview"]');
    const settingsPane = document.querySelector('[data-pane="settings"]');
    expect(modulesPane).not.toHaveClass(studioStyles.inactive);
    expect(previewPane).toHaveClass(studioStyles.inactive);
    expect(settingsPane).toHaveClass(studioStyles.inactive);

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(modulesPane).toHaveClass(studioStyles.inactive);
    expect(settingsPane).not.toHaveClass(studioStyles.inactive);
    expect(previewPane).toHaveClass(studioStyles.inactive);
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps the settings scroll marker on one body below its fixed panel header", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });
    const settings = document.querySelector<HTMLElement>('[data-pane="settings"]')!;
    const bodies = settings.querySelectorAll<HTMLElement>("[data-homepage-settings-scroll]");
    expect(settings).not.toHaveAttribute("data-homepage-settings-scroll");
    expect(bodies).toHaveLength(1);
    expect(settings.querySelector('[data-panel-head="settings"]')).not.toBeNull();
    expect(bodies[0].contains(settings.querySelector('[data-panel-head="settings"]'))).toBe(false);
  });

  it("keeps the current settings target and device in the fixed header without editing the draft", async () => {
    const fixture = documentWithUsp();
    fixture.sections.find((section) => section.type === "USP")!.title = "Room details";
    renderHarnessWithDocument(fixture);
    await flush();
    const header = document.querySelector<HTMLElement>('[data-panel-head="settings"]')!;
    expect(header).toHaveTextContent("Desktop");
    fireEvent.click(screen.getByRole("button", { name: "select-nonhero" }));
    expect(within(header).getByRole("heading", { name: "Room details" })).toBeVisible();
    selectPreviewDevice("mobile");
    expect(header).toHaveTextContent("Mobile");
    fireEvent.click(screen.getByRole("button", { name: "select-defaults" }));
    expect(within(header).getByRole("heading", { name: /Homepage defaults/i })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "select-announcement" }));
    expect(within(header).getByRole("heading", { name: /Announcement/i })).toBeVisible();
    expect(header).toHaveTextContent("Mobile");
    expect(screen.getByTestId("dirty")).toHaveTextContent("clean");
    expect(saveHomepageDraft).not.toHaveBeenCalled();
  });

  it("gives each desktop pane an independent scroll container", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    const shell = document.querySelector("[data-homepage-editor-shell]");
    expect(shell).toHaveClass(studioStyles.studio);
    const columns = document.querySelector("[data-studio-columns]");
    expect(columns).toHaveClass(studioStyles.columns);
    expect(columns?.contains(screen.getByTestId("homepage-status-bar"))).toBe(false);

    for (const name of ["modules", "preview", "settings"]) {
      const pane = document.querySelector(`[data-pane="${name}"]`);
      expect(pane).toHaveClass(studioStyles.panel);
      const body = pane?.querySelector(`[data-panel-body="${name}"]`);
      expect(body).not.toBeNull();
      if (name === "preview") {
        expect(body?.querySelector("[data-homepage-live-preview]")).toHaveClass("overflow-y-auto");
      } else {
        expect(body).toHaveClass(studioStyles.panelBody);
      }
    }
    expect(document.querySelector('[data-panel-head="modules"]')).not.toBeNull();
    expect(document.querySelector('[data-panel-head="preview"]')).toBe(screen.getByRole("group", { name: "Preview device" }));
  });

  it("clamps keyboard rail resizing to 360–560 without changing the draft", async () => {
    renderHarness();
    await flush();
    const separator = screen.getByRole("separator", { name: "Resize settings panel" });
    for (let step = 0; step < 20; step += 1) fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "560");
    expect(document.querySelector("[data-studio-columns]")).toHaveStyle({ "--homepage-settings-width": "560px" });
    for (let step = 0; step < 20; step += 1) fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "360");
    expect(document.querySelector("[data-studio-columns]")).toHaveStyle({ "--homepage-settings-width": "360px" });
    expect(screen.getByTestId("dirty")).toHaveTextContent("clean");
  });

  it("resizes the settings pane and keeps the preview surface flat", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    const separator = screen.getByRole("separator", { name: "Resize settings panel" });
    expect(separator).toHaveAttribute("aria-valuenow", "360");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "376");

    const surface = document.querySelector("[data-preview-surface]");
    expect(surface).not.toBeNull();
    expect(surface).not.toHaveClass("rounded-xl", "border", "bg-card");
  });

  it("shows every pane in the desktop grid above 1280px, never via the hidden attribute", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    for (const name of ["modules", "preview", "settings"]) {
      const pane = document.querySelector(`[data-pane="${name}"]`);
      expect(pane).not.toBeNull();
      expect(pane).not.toHaveAttribute("hidden");
      expect(pane).toHaveClass(studioStyles.panel);
    }
  });

  it("wires the status bar save button and the publish dialog", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await flush();
    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(
      screen.getByRole("dialog", { name: "Publish homepage" }),
    ).toBeVisible();
    await flush();
    expect(validateHomepage).toHaveBeenCalledTimes(1);
  });

  // --- Task 17: preview draft, permission gate, publish integration --------

  it("does not save emptyDocument rev 0 when Cmd+S fires during the initial load (R44/①)", async () => {
    let resolveDraft: (snapshot: HomepageDraftSnapshot) => void = () => {};
    getHomepageDraft.mockReturnValue(
      new Promise<HomepageDraftSnapshot>((resolve) => {
        resolveDraft = resolve;
      }),
    );
    renderHarness();
    await flush();

    expect(screen.getByText("Loading the homepage editor…")).toBeVisible();
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await flush();

    expect(saveHomepageDraft).not.toHaveBeenCalled();

    await act(async () => {
      resolveDraft(draftSnapshot());
      await Promise.resolve();
    });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await flush();

    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);
    expect(saveHomepageDraft).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1 }),
      DRAFT_REV,
    );
  });

  it("opens tablet preview from the device toolbar rather than the save and publish bar", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });
    const toolbar = screen.getByRole("group", { name: "Preview device" });
    selectPreviewDevice("tablet");
    fireEvent.click(within(toolbar).getByRole("button", { name: "Independent preview" }));
    await flush();
    expect(open).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("&view=tablet"), "_blank", "noopener,noreferrer");
    expect(screen.getAllByRole("button", { name: "Independent preview" })).toHaveLength(1);
    expect(screen.getByTestId("homepage-status-bar")).not.toHaveTextContent("Independent preview");
  });

  it("keeps the requested tablet view and fallback label if the device changes while signing", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    let resolveToken!: (value: { token: string; expiresInMs: number }) => void;
    createHomepagePreviewToken.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
    renderEditor();
    await flush();
    selectPreviewDevice("tablet");
    fireEvent.click(screen.getByRole("button", { name: "Independent preview" }));
    await flush();
    selectPreviewDevice("mobile");
    await act(async () => { resolveToken({ token: "tablet-request", expiresInMs: 1800000 }); });
    expect(String(open.mock.calls[0][0])).toContain("&view=tablet");
    expect(screen.getByRole("link", { name: "Open ready preview · Tablet" })).toHaveAttribute("href", expect.stringContaining("&view=tablet"));
  });

  it("does not open a token if only the saved revision changes during signing", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    let resolveToken!: (value: { token: string; expiresInMs: number }) => void;
    createHomepagePreviewToken.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
    renderEditor();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Independent preview" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await flush();
    await act(async () => { resolveToken({ token: "earlier-revision", expiresInMs: 1800000 }); });
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /^Open ready preview/ })).toBeNull();
    expect(screen.getByText("The draft changed or could not be saved. Save it and try preview again.")).toBeVisible();
  });

  it.each(["desktop", "tablet", "mobile"] as const)("opens a signed %s preview and retains a manual link even if noopener returns null", async (view) => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    createHomepagePreviewToken.mockResolvedValue({
      token: "tok a/b+c=",
      expiresInMs: 1_800_000,
    });
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    selectPreviewDevice(view);
    fireEvent.click(screen.getByRole("button", { name: "Independent preview" }));
    await flush();

    expect(createHomepagePreviewToken).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0];
    expect(url).toBe(`/preview/homepage?token=${encodeURIComponent("tok a/b+c=")}&view=${view}`);
    const manual = screen.getByRole("link", { name: /^Open ready preview/ });
    expect(manual).toHaveAttribute("href", String(url));
    expect(manual).toHaveAttribute("rel", "noopener noreferrer");
    expect(manual).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(target).toBe("_blank");
    expect(features).toContain("noopener");
    expect(features).toContain("noreferrer");
    openSpy.mockRestore();
  });

  it.each(["desktop", "tablet", "mobile"] as const)("saves a dirty draft before minting its token for %s", async (view) => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderHarness();
    await screen.findByRole("button", { name: "Independent preview" });
    selectPreviewDevice(view);

    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    expect(screen.getByTestId("dirty")).toHaveTextContent("dirty");
    fireEvent.click(screen.getByRole("button", { name: "Independent preview" }));
    await flush();

    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);
    expect(createHomepagePreviewToken).toHaveBeenCalledTimes(1);
    expect(saveHomepageDraft.mock.invocationCallOrder[0]).toBeLessThan(
      createHomepagePreviewToken.mock.invocationCallOrder[0],
    );
    expect(openSpy).toHaveBeenCalledTimes(1);
    openSpy.mockRestore();
  });

  it.each([409, 500])("neither signs nor opens when preview's save fails with %s", async (status) => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    saveHomepageDraft.mockRejectedValue(new AdminApiError("Save failed", status));
    renderHarness(); await flush();
    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    selectPreviewDevice("mobile");
    fireEvent.click(screen.getByRole("button", { name: "Independent preview" }));
    await flush();
    expect(createHomepagePreviewToken).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /^Open ready preview/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Independent preview" })).toBeEnabled();
  });

  it("disables the independent action while signing and invalidates the ready link after another edit", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    let resolveToken!: (value: { token: string; expiresInMs: number }) => void;
    createHomepagePreviewToken.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
    renderHarness(); await flush();
    selectPreviewDevice("mobile");
    const preview = screen.getByRole("button", { name: "Independent preview" });
    fireEvent.click(preview); await flush();
    expect(preview).toBeDisabled();
    fireEvent.click(preview);
    expect(createHomepagePreviewToken).toHaveBeenCalledTimes(1);
    await act(async () => { resolveToken({ token: "signed", expiresInMs: 1800000 }); });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /^Open ready preview/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    expect(screen.queryByRole("link", { name: /^Open ready preview/ })).toBeNull();
  });

  it("does not open an older document if edits continue during both save attempts", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const saves: Array<(result: ReturnType<typeof savedResponse>) => void> = [];
    saveHomepageDraft.mockImplementation(() => new Promise((resolve) => { saves.push(resolve); }));
    renderHarness(); await flush();
    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    selectPreviewDevice("mobile");
    fireEvent.click(screen.getByRole("button", { name: "Independent preview" })); await flush();
    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    await act(async () => { saves[0](savedResponse(6)); });
    expect(saves).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    await act(async () => { saves[1](savedResponse(7)); });
    expect(createHomepagePreviewToken).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /^Open ready preview/ })).toBeNull();
    expect(screen.getByText("The draft changed or could not be saved. Save it and try preview again.")).toBeVisible();
  });

  it("does not open when the draft changes while the token is in flight", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    let resolveToken!: (value: { token: string; expiresInMs: number }) => void;
    createHomepagePreviewToken.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
    renderHarness(); await flush();
    selectPreviewDevice("mobile");
    fireEvent.click(screen.getByRole("button", { name: "Independent preview" })); await flush();
    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    await act(async () => { resolveToken({ token: "old", expiresInMs: 1800000 }); });
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /^Open ready preview/ })).toBeNull();
  });

  it("disables the preview buttons for the session when the token endpoint answers 503", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    createHomepagePreviewToken.mockRejectedValue(
      new AdminApiError("Homepage preview is not configured", 503),
    );
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    const button = screen.getByRole("button", { name: "Independent preview" });
    fireEvent.click(button);
    await flush();

    expect(openSpy).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Preview is not configured");
    expect(screen.getByRole("button", { name: "Independent preview" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /^Open ready preview/ })).toBeNull();

    fireEvent.click(button);
    await flush();
    expect(createHomepagePreviewToken).toHaveBeenCalledTimes(1);
    openSpy.mockRestore();
  });

  it("keeps preview enabled with a readable inline error on non-503 token failures", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    createHomepagePreviewToken.mockRejectedValue(
      new AdminApiError("Token service exploded", 500),
    );
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    fireEvent.click(screen.getByRole("button", { name: "Independent preview" }));
    await flush();

    expect(screen.getByText("Token service exploded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Independent preview" })).toBeEnabled();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("shows a readable permission message instead of a load error without PRODUCT_MANAGE (R44/⑦)", async () => {
    hasPermission.mockReturnValue(false);
    renderEditor();
    await flush();

    expect(
      screen.getByText("Your account cannot access the homepage builder."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "PRODUCT_MANAGE permission is required — ask a super admin to grant it.",
      ),
    ).toBeVisible();
    expect(getHomepageDraft).not.toHaveBeenCalled();
  });

  it("saves the dirty draft before validating when the publish dialog opens", async () => {
    renderHarness();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await flush();

    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);
    const [savedDocument, savedRev] = saveHomepageDraft.mock.calls[0];
    expect(
      (savedDocument as HomepageDocument).announcement.rotationMs,
    ).toBe(5001);
    expect(savedRev).toBe(DRAFT_REV);
    expect(validateHomepage).toHaveBeenCalledTimes(1);
    expect(saveHomepageDraft.mock.invocationCallOrder[0]).toBeLessThan(
      validateHomepage.mock.invocationCallOrder[0],
    );
  });

  it("aborts publishing with an error when the pre-publish save fails", async () => {
    saveHomepageDraft.mockRejectedValue(
      new AdminApiError("Server exploded", 500),
    );
    renderHarness();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "commit-change" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await flush();

    expect(saveHomepageDraft).toHaveBeenCalledTimes(1);
    expect(validateHomepage).not.toHaveBeenCalled();
    expect(publishHomepage).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "The draft could not be saved, so publishing was cancelled.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: "Publish homepage" }),
    ).toBeVisible();
  });
});
