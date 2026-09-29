import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { emptyDocument, type HomepageDocument, type HomepageSection } from "@/lib/homepage-document";
import type { HomepageDraftSnapshot } from "@/lib/admin-api";
import {
  HomepageEditor,
  HomepageEditorProvider,
  HomepageEditorShell,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import { ANNOUNCEMENT_SELECTION_ID } from "@/components/admin/homepage/ModuleTree";

const getHomepageDraft = vi.hoisted(() => vi.fn());
const saveHomepageDraft = vi.hoisted(() => vi.fn());
const createHomepagePreviewToken = vi.hoisted(() => vi.fn());
const validateHomepage = vi.hoisted(() => vi.fn());
const publishHomepage = vi.hoisted(() => vi.fn());
const hasPermission = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    getHomepageDraft,
    saveHomepageDraft,
    createHomepagePreviewToken,
    validateHomepage,
    publishHomepage,
  },
}));

vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ status: "authed", hasPermission }),
}));

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
    saveHomepageDraft.mockReset();
    createHomepagePreviewToken.mockReset();
    validateHomepage.mockReset();
    publishHomepage.mockReset();
    hasPermission.mockReset();
    getHomepageDraft.mockResolvedValue(draftSnapshot());
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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
    expect(screen.getByRole("button", { name: "Preview Draft" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Publish" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Versions" })).toHaveAttribute(
      "href",
      "/admin/homepage/versions",
    );

    const style = document.querySelector("style");
    expect(style?.textContent).toContain(`#hp-hero-${HERO_SECTION_ID}`);
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

  it("routes the settings pane by selection priority", async () => {
    renderHarness();
    await flush();

    const panel = (name: string): Element | null =>
      document.querySelector(`[data-panel="${name}"]`);

    // Nothing selected yet: the hero style (section/slide) panel is the default.
    expect(panel("hero-style-settings")).not.toBeNull();
    expect(panel("hero-media-settings")).toBeNull();
    expect(panel("settings-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "select-element" }));
    expect(panel("settings-panel")).not.toBeNull();
    expect(panel("hero-media-settings")).toBeNull();
    expect(panel("hero-style-settings")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "select-slide" }));
    expect(panel("hero-media-settings")).not.toBeNull();
    expect(panel("hero-style-settings")).not.toBeNull();
    expect(panel("settings-panel")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "select-announcement" }));
    expect(panel("announcement-settings")).not.toBeNull();
    expect(panel("hero-media-settings")).toBeNull();
    expect(panel("hero-style-settings")).toBeNull();
    expect(panel("settings-panel")).toBeNull();
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

  it("switches the preview device including tablet", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    // The preview pane only carries the device switcher once it is the
    // active narrow-layout pane (below 1280px it starts on Modules).
    fireEvent.click(screen.getByRole("tab", { name: "Live Preview" }));

    expect(document.querySelector("[data-preview-viewport]")).toHaveStyle({
      width: "1440px",
    });

    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));
    expect(document.querySelector("[data-preview-viewport]")).toHaveStyle({
      width: "768px",
    });
    expect(screen.getAllByText("Tablet").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(document.querySelector("[data-preview-viewport]")).toHaveStyle({
      width: "390px",
    });
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
    // Narrow layout: only the active pane is visible, through the
    // `max-[1279px]:hidden` class (Tailwind v4 preflight makes the `hidden`
    // attribute `!important`, so it can never be used with the desktop grid).
    expect(modulesPane).not.toHaveClass(/max-\[1279px\]\:hidden/);
    expect(previewPane).toHaveClass(/max-\[1279px\]\:hidden/);
    expect(settingsPane).toHaveClass(/max-\[1279px\]\:hidden/);

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(modulesPane).toHaveClass(/max-\[1279px\]\:hidden/);
    expect(settingsPane).not.toHaveClass(/max-\[1279px\]\:hidden/);
    expect(previewPane).toHaveClass(/max-\[1279px\]\:hidden/);
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows every pane in the desktop grid above 1280px, never via the hidden attribute", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    // Tailwind v4 preflight maps `[hidden]` to `display: none !important`
    // (a bare `min-[1280px]:block` cannot override it), so a pane that keeps
    // the hidden attribute stays invisible in the desktop three-pane grid.
    // The desktop layout must rely on classes alone.
    for (const name of ["modules", "preview", "settings"]) {
      const pane = document.querySelector(`[data-pane="${name}"]`);
      expect(pane).not.toBeNull();
      expect(pane).not.toHaveAttribute("hidden");
      expect(pane).toHaveClass(/min-\[1280px\]\:block/);
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

  it("opens the draft preview with a fresh token in a new tab", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    createHomepagePreviewToken.mockResolvedValue({
      token: "tok a/b+c=",
      expiresInMs: 1_800_000,
    });
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    fireEvent.click(screen.getByRole("button", { name: "Preview Draft" }));
    await flush();

    expect(createHomepagePreviewToken).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0];
    expect(url).toBe(
      `/preview/homepage?token=${encodeURIComponent("tok a/b+c=")}`,
    );
    expect(target).toBe("_blank");
    expect(features).toContain("noopener");
    expect(features).toContain("noreferrer");
    openSpy.mockRestore();
  });

  it("disables the preview button for the session when the token endpoint answers 503", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    createHomepagePreviewToken.mockRejectedValue(
      new AdminApiError("Homepage preview is not configured", 503),
    );
    renderEditor();
    await screen.findByRole("button", { name: "Save Draft" });

    const button = screen.getByRole("button", { name: "Preview Draft" });
    fireEvent.click(button);
    await flush();

    expect(openSpy).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Preview is not configured");

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

    fireEvent.click(screen.getByRole("button", { name: "Preview Draft" }));
    await flush();

    expect(screen.getByText("Token service exploded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Preview Draft" })).toBeEnabled();
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
