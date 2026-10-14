import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditor,
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import {
  ANNOUNCEMENT_SELECTION_ID,
  HOMEPAGE_DEFAULTS_SELECTION_ID,
  ModuleTree,
} from "@/components/admin/homepage/ModuleTree";
import {
  emptyDocument,
  type HomepageDocument,
  type HomepageSection,
  type SectionType,
} from "@/lib/homepage-document";
import type { HomepageDraftSnapshot } from "@/lib/admin-api";
import { SECTION_TYPES } from "@/lib/homepage-section-factory";

const getHomepageDraft = vi.hoisted(() => vi.fn());
const saveHomepageDraft = vi.hoisted(() => vi.fn());
const listProducts = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: { getHomepageDraft, saveHomepageDraft, listProducts },
}));

// The full-editor test below mounts the shell, which gates on PRODUCT_MANAGE.
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ status: "authed", hasPermission: () => true }),
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

const HERO_ID = "00000000-0000-7000-8000-000000000101";
const SLIDE_ONE_ID = "00000000-0000-7000-8000-000000000111";
const SLIDE_TWO_ID = "00000000-0000-7000-8000-000000000112";
const USP_ID = "00000000-0000-7000-8000-000000000102";
const GRID_ID = "00000000-0000-7000-8000-000000000103";
const STORY_ID = "00000000-0000-7000-8000-000000000104";

/** Row geometry the jsdom DOM cannot provide: stacked 240x40 boxes. */
const ROW_HEIGHT = 40;
const ROW_WIDTH = 240;

const DRAFT_REV = 5;

function zeroRect(): DOMRect {
  return {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function stackedRect(top: number): DOMRect {
  return {
    top,
    bottom: top + ROW_HEIGHT,
    left: 0,
    right: ROW_WIDTH,
    width: ROW_WIDTH,
    height: ROW_HEIGHT,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * dnd-kit measures every droppable with `getBoundingClientRect`, which jsdom
 * always reports as a zero box — the sortable keyboard coordinate getter then
 * cannot find a neighbour below/above. Give every sortable row a distinct,
 * stacked rect derived from its position in the list.
 */
function mockRowGeometry(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      const row = this.closest("[data-section-row]");
      if (!row?.parentElement) return zeroRect();
      const index = Array.from(row.parentElement.children).indexOf(row);
      return stackedRect(index * ROW_HEIGHT);
    },
  );
}

function heroSection(): HomepageSection {
  const base = emptyDocument().sections[0];
  if (base.type !== "HERO") throw new Error("fixture expects a HERO section");
  const second = structuredClone(base.payload.slides[0]);
  second.id = SLIDE_TWO_ID;
  second.name = "Hero 2";
  second.enabled = false;
  second.sortOrder = 10;
  return {
    ...structuredClone(base),
    id: HERO_ID,
    title: "Hero banner",
    payload: {
      behavior: structuredClone(base.payload.behavior),
      slides: [
        {
          ...structuredClone(base.payload.slides[0]),
          id: SLIDE_ONE_ID,
          name: "Hero 1",
        },
        second,
      ],
    },
  };
}

function opaqueSection(
  type: Exclude<SectionType, "HERO">,
  id: string,
  title: string,
  sortOrder: number,
): HomepageSection {
  // Deliberately opaque fixtures: the tree never reads payloads, and the
  // discriminated union cannot be satisfied by a shared `{}` payload.
  return {
    id,
    type,
    title,
    subtitle: null,
    enabled: true,
    sortOrder,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload: {},
  } as unknown as HomepageSection;
}

function treeDocument(): HomepageDocument {
  return {
    schemaVersion: 1,
    sections: [
      heroSection(),
      opaqueSection("USP", USP_ID, "USP strip", 10),
      opaqueSection("PRODUCT_GRID", GRID_ID, "Featured grid", 20),
      opaqueSection("PRODUCT_STORY", STORY_ID, "Brand story", 30),
    ],
    announcement: { enabled: false, rotationMs: 5000, items: [] },
  };
}

const DOCUMENT = treeDocument();

function documentWithData(): HomepageDocument {
  const document = structuredClone(DOCUMENT);
  const grid = document.sections.find((section) => section.id === GRID_ID);
  if (!grid) throw new Error("grid fixture missing");
  grid.products = [{ productId: "product-1", sortOrder: 0, badge: "Featured" }];
  document.announcement = {
    enabled: true,
    rotationMs: 7000,
    items: [
      {
        id: "announcement-1",
        text: "Free delivery",
        link: null,
        linkLabel: null,
        textColor: "#fff",
        backgroundColor: "#000",
        schedule: { publishAt: null, unpublishAt: null },
        enabled: true,
        sortOrder: 0,
      },
    ],
  };
  return document;
}

function Loader({ document }: { document: HomepageDocument }): ReactNode {
  const { dispatch } = useHomepageEditor();
  useEffect(() => {
    dispatch({ type: "load", document, rev: DRAFT_REV, savedAt: null });
  }, [dispatch, document]);
  return null;
}

function TreeProbe(): ReactNode {
  const { state, selectedSectionId, selectedSlideId } = useHomepageEditor();
  const hero = state.document.sections.find((section) => section.type === "HERO");
  const slides = hero && hero.type === "HERO" ? hero.payload.slides : [];
  return (
    <div>
      <span data-testid="order">
        {state.document.sections.map((section) => section.id).join(",")}
      </span>
      <span data-testid="sort-orders">
        {state.document.sections.map((section) => section.sortOrder).join(",")}
      </span>
      <span data-testid="enabled">
        {state.document.sections
          .map((section) => (section.enabled ? "on" : "off"))
          .join(",")}
      </span>
      <span data-testid="slides">
        {slides
          .map((slide) => `${slide.id}:${slide.enabled ? "on" : "off"}`)
          .join(",")}
      </span>
      <span data-testid="selected-section">{selectedSectionId ?? ""}</span>
      <span data-testid="selected-slide">{selectedSlideId ?? ""}</span>
      <span data-testid="commits">{state.past.length}</span>
      <span data-testid="grid-products">
        {state.document.sections
          .find((section) => section.id === GRID_ID)
          ?.products.map((product) => product.productId)
          .join(",")}
      </span>
      <span data-testid="announcement-data">
        {state.document.announcement.items.map((item) => item.id).join(",")}
      </span>
    </div>
  );
}

function renderTree(document: HomepageDocument = DOCUMENT) {
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Loader document={document} />
        <ModuleTree />
        <TreeProbe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
}

function addSectionTrigger(): HTMLElement {
  const trigger = screen.getByRole("button", { name: "Add section" });
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("Add section trigger not found");
  }
  return trigger;
}

function openAddSectionDialog(): void {
  fireEvent.click(addSectionTrigger());
}

function text(testId: string): string {
  return screen.getByTestId(testId).textContent ?? "";
}

function sectionRow(sectionId: string): HTMLElement {
  const row = document.querySelector(`[data-section-row="${sectionId}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`section row ${sectionId} not found`);
  }
  return row;
}

/** Activates a sortable with Space, walks it with arrow keys, drops with Space. */
async function keyboardSort(
  handle: HTMLElement,
  arrows: Array<"ArrowDown" | "ArrowUp">,
): Promise<void> {
  fireEvent.keyDown(handle, { code: "Space", key: " " });
  // The keyboard sensor attaches its document listener in a macrotask.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (const code of arrows) {
    fireEvent.keyDown(document, { code, key: code });
  }
  fireEvent.keyDown(document, { code: "Space", key: " " });
  await act(async () => {});
}

function dragHandle(sectionId: string): HTMLElement {
  const handle = sectionRow(sectionId).querySelector(
    'button[aria-label="Drag to reorder"]',
  );
  if (!(handle instanceof HTMLElement)) {
    throw new Error(`drag handle for ${sectionId} not found`);
  }
  return handle;
}

describe("ModuleTree", () => {
  beforeEach(() => {
    setAdminLang("en");
    mockRowGeometry();
    getHomepageDraft.mockReset();
    saveHomepageDraft.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reorders sections through the dnd-kit keyboard sensor and renumbers sortOrder densely", async () => {
    renderTree();

    expect(text("order")).toBe(
      `${HERO_ID},${USP_ID},${GRID_ID},${STORY_ID}`,
    );

    await keyboardSort(dragHandle(HERO_ID), ["ArrowDown"]);

    expect(text("order")).toBe(
      `${USP_ID},${HERO_ID},${GRID_ID},${STORY_ID}`,
    );
    expect(text("sort-orders")).toBe("0,10,20,30");
  });

  it("walks a picked-up section further with repeated arrow keys", async () => {
    renderTree();

    await keyboardSort(dragHandle(HERO_ID), ["ArrowDown", "ArrowDown"]);

    expect(text("order")).toBe(
      `${USP_ID},${GRID_ID},${HERO_ID},${STORY_ID}`,
    );
    expect(text("sort-orders")).toBe("0,10,20,30");
  });

  it("keeps the committed order when a drag is cancelled with Escape", async () => {
    renderTree();

    const handle = dragHandle(HERO_ID);
    fireEvent.keyDown(handle, { code: "Space", key: " " });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.keyDown(document, { code: "ArrowDown", key: "ArrowDown" });
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    await act(async () => {});

    expect(text("order")).toBe(
      `${HERO_ID},${USP_ID},${GRID_ID},${STORY_ID}`,
    );
    expect(text("commits")).toBe("0");
  });

  it("hides delete on fixed sections and offers duplicate/delete only on addable ones", async () => {
    renderTree();

    expect(
      screen.getAllByRole("button", { name: "Duplicate section" }),
    ).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Delete section" })).toHaveLength(
      3,
    );
    expect(sectionRow(HERO_ID).querySelector('[aria-label="Delete section"]')).toBeNull();
    expect(sectionRow(USP_ID).querySelector('[aria-label="Duplicate section"]')).not.toBeNull();
    expect(
      sectionRow(GRID_ID).querySelector('[aria-label="Duplicate section"]'),
    ).not.toBeNull();

    fireEvent.click(
      sectionRow(GRID_ID).querySelector('[aria-label="Duplicate section"]') as HTMLElement,
    );

    expect(text("order").split(",")).toHaveLength(5);
    const order = text("order").split(",");
    expect(order[2]).toBe(GRID_ID);
    expect(order[3]).not.toBe(GRID_ID);
    expect(text("sort-orders")).toBe("0,10,20,30,40");
  });

  it("offers duplicate/delete controls for every non-HERO section type", () => {
    const allTypesDocument: HomepageDocument = {
      ...treeDocument(),
      sections: [
        heroSection(),
        ...SECTION_TYPES.map((type, index) =>
          opaqueSection(
            type,
            `00000000-0000-7000-8000-0000000002${String(index + 1).padStart(2, "0")}`,
            type,
            (index + 1) * 10,
          ),
        ),
      ],
    };

    renderTree(allTypesDocument);

    expect(screen.getAllByRole("button", { name: "Duplicate section" })).toHaveLength(SECTION_TYPES.length);
    expect(screen.getAllByRole("button", { name: "Delete section" })).toHaveLength(SECTION_TYPES.length);
    expect(document.querySelectorAll('[data-section-row]')).toHaveLength(SECTION_TYPES.length + 1);
  });

  it("exposes a keyboard-reachable Add section trigger", () => {
    renderTree();

    const trigger = addSectionTrigger();
    expect(trigger).toBeVisible();
    expect(trigger).toHaveAttribute("type", "button");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens an accessible dialog with every localized section choice and closes explicitly", () => {
    renderTree();
    openAddSectionDialog();

    expect(screen.getByRole("dialog", { name: "Add section" })).toBeVisible();
    expect(screen.getAllByRole("button").filter((button) =>
      SECTION_TYPES.some((type) => button.getAttribute("data-section-type") === type),
    )).toHaveLength(SECTION_TYPES.length);
    for (const label of [
      "USP",
      "Category Tiles",
      "Product Grid",
      "Solutions",
      "Product Story",
      "Room Inspiration",
      "UGC / Real Homes",
      "Brand Story",
      "Confidence",
      "Promo Banner",
      "Countdown Banner",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Add section" })).toBeNull();
  });

  it("inserts USP after the selected module, selects it, and commits once", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "Featured grid" }));
    openAddSectionDialog();

    fireEvent.click(screen.getByRole("button", { name: "USP" }));

    const order = text("order").split(",");
    expect(order).toEqual([HERO_ID, USP_ID, GRID_ID, order[3], STORY_ID]);
    expect(order[3]).not.toBe(GRID_ID);
    expect(text("selected-section")).toBe(order[3]);
    expect(text("commits")).toBe("1");
    expect(screen.queryByRole("dialog", { name: "Add section" })).toBeNull();
  });

  it("appends and selects a section when no module is selected", () => {
    renderTree();
    openAddSectionDialog();

    fireEvent.click(screen.getByRole("button", { name: "Confidence" }));

    const order = text("order").split(",");
    expect(order).toHaveLength(5);
    expect(order[4]).not.toBe(STORY_ID);
    expect(text("selected-section")).toBe(order[4]);
    expect(text("commits")).toBe("1");
  });

  it("restores focus to the trigger after close and Escape", () => {
    renderTree();
    const trigger = addSectionTrigger();

    trigger.focus();
    openAddSectionDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(trigger);

    openAddSectionDialog();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Add section" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("preserves existing product rows and announcement data while adding a section", () => {
    renderTree(documentWithData());
    expect(text("grid-products")).toBe("product-1");
    expect(text("announcement-data")).toBe("announcement-1");

    openAddSectionDialog();
    fireEvent.click(screen.getByRole("button", { name: "USP" }));

    expect(text("grid-products")).toBe("product-1");
    expect(text("announcement-data")).toBe("announcement-1");
    expect(screen.getByRole("button", { name: /Announcement bar/ })).toHaveTextContent(
      "Enabled",
    );
  });

  it("toggles a section's enabled state from its row", async () => {
    renderTree();

    fireEvent.click(
      sectionRow(USP_ID).querySelector('input[type="checkbox"]') as HTMLElement,
    );

    expect(text("enabled")).toBe("on,off,on,on");
    expect(text("commits")).toBe("1");

    fireEvent.click(
      sectionRow(USP_ID).querySelector('input[type="checkbox"]') as HTMLElement,
    );

    expect(text("enabled")).toBe("on,on,on,on");
    expect(text("commits")).toBe("2");
  });

  it("restores the last removed section at its index from the undo affordance", async () => {
    renderTree();

    expect(screen.queryByRole("button", { name: "Undo delete" })).toBeNull();

    fireEvent.click(
      sectionRow(GRID_ID).querySelector('[aria-label="Delete section"]') as HTMLElement,
    );

    expect(text("order")).toBe(`${HERO_ID},${USP_ID},${STORY_ID}`);
    expect(text("sort-orders")).toBe("0,10,20");
    expect(
      document.querySelector(`[data-section-row="${GRID_ID}"]`),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Undo delete" }));

    expect(text("order")).toBe(
      `${HERO_ID},${USP_ID},${GRID_ID},${STORY_ID}`,
    );
    expect(text("sort-orders")).toBe("0,10,20,30");
    expect(screen.queryByRole("button", { name: "Undo delete" })).toBeNull();
  });

  it("selects slides from the expanded HERO and sections from their rows", async () => {
    renderTree();

    // The slide list only appears for the selected HERO section.
    expect(document.querySelectorAll("[data-slide-card]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Hero banner" }));
    expect(text("selected-section")).toBe(HERO_ID);

    fireEvent.click(screen.getByRole("button", { name: "Hero 2" }));
    expect(text("selected-slide")).toBe(SLIDE_TWO_ID);
    expect(text("selected-section")).toBe(HERO_ID);
  });

  it("renders the slide list for the selected HERO with index, name and enabled state", async () => {
    renderTree();

    expect(document.querySelectorAll("[data-slide-card]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Hero banner" }));

    const cards = Array.from(
      document.querySelectorAll("[data-slide-card]"),
    ) as HTMLElement[];
    expect(cards).toHaveLength(2);
    expect(
      cards.map((card) => card.querySelector("[data-slide-index]")?.textContent),
    ).toEqual(["01", "02"]);
    expect(
      cards.map(
        (card) =>
          (card.querySelector('input[aria-label="Slide name"]') as HTMLInputElement)
            .value,
      ),
    ).toEqual(["Hero 1", "Hero 2"]);

    fireEvent.click(
      cards[0].querySelector('input[type="checkbox"]') as HTMLElement,
    );
    expect(text("slides")).toBe(`${SLIDE_ONE_ID}:off,${SLIDE_TWO_ID}:off`);
  });

  it("shows the announcement bar pseudo-node with its enabled state and selects it", async () => {
    renderTree();

    const node = screen.getByRole("button", { name: /Announcement bar/ });
    expect(node).toHaveAttribute("aria-pressed", "false");
    expect(node.textContent).toContain("Disabled");

    fireEvent.click(node);

    expect(text("selected-section")).toBe(ANNOUNCEMENT_SELECTION_ID);
    expect(node).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the homepage defaults pseudo-node and selects it", () => {
    renderTree();

    const node = screen.getByRole("button", { name: /Homepage defaults/ });
    expect(node).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(node);

    expect(text("selected-section")).toBe(HOMEPAGE_DEFAULTS_SELECTION_ID);
    expect(node).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ModuleTree in the editor shell", () => {
  beforeEach(() => {
    setAdminLang("en");
    mockRowGeometry();
    getHomepageDraft.mockReset();
    saveHomepageDraft.mockReset();
    const snapshot: HomepageDraftSnapshot = {
      draft: DOCUMENT,
      draftRev: DRAFT_REV,
      draftUpdatedAt: "2026-09-28T02:00:00.000Z",
      draftUpdatedById: "admin-42",
      published: null,
    };
    getHomepageDraft.mockResolvedValue(snapshot);
    listProducts.mockResolvedValue({
      items: [{ id: "product-1", name: "Oak table" }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches the right pane to AnnouncementSettings when the pseudo-node is selected", async () => {
    render(
      <AdminI18nProvider>
        <HomepageEditor />
      </AdminI18nProvider>,
    );
    await screen.findByRole("button", { name: "Save Draft" });

    const settingsPane = document.querySelector('[data-pane="settings"]');
    expect(settingsPane).not.toBeNull();
    expect(
      document.querySelector('[data-panel="announcement-settings"]'),
    ).toBeNull();
    expect(document.querySelector('[data-panel="settings-panel"]')).toBeNull();
    expect(
      document.querySelector('[data-panel="hero-style-settings"]'),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Announcement bar/ }));

    expect(
      document.querySelector('[data-panel="announcement-settings"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-panel="hero-style-settings"]'),
    ).toBeNull();
  });

  it("saves a newly added USP through the shell with its typed payload", async () => {
    saveHomepageDraft.mockResolvedValue({
      draftRev: DRAFT_REV + 1,
      draftUpdatedAt: "2026-09-29T03:00:00.000Z",
    });

    render(
      <AdminI18nProvider>
        <HomepageEditor />
      </AdminI18nProvider>,
    );
    await screen.findByRole("button", { name: "Save Draft" });

    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    fireEvent.click(screen.getByRole("button", { name: "USP" }));
    fireEvent.click(screen.getByRole("button", { name: "Add trust point" }));
    fireEvent.change(screen.getByRole("textbox", { name: "USP label 1" }), {
      target: { value: "Nationwide delivery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(saveHomepageDraft).toHaveBeenCalledTimes(1));
    const [draft, expectedRev] = saveHomepageDraft.mock.calls[0];
    const savedSection = (draft as HomepageDocument).sections.find(
      (section) => section.type === "USP" && section.id !== USP_ID,
    );
    expect(expectedRev).toBe(DRAFT_REV);
    expect(savedSection).toMatchObject({
      type: "USP",
      payload: { items: [{ icon: "shield", label: "Nationwide delivery" }] },
    });
  });

  it("saves Product Grid presentation changes through the existing draft path", async () => {
    saveHomepageDraft.mockResolvedValue({
      draftRev: DRAFT_REV + 1,
      draftUpdatedAt: "2026-09-29T03:00:00.000Z",
    });

    render(
      <AdminI18nProvider>
        <HomepageEditor />
      </AdminI18nProvider>,
    );
    await screen.findByRole("button", { name: "Save Draft" });

    fireEvent.click(screen.getByRole("button", { name: "Featured grid" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Grid columns" }), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(saveHomepageDraft).toHaveBeenCalledTimes(1));
    const [draft] = saveHomepageDraft.mock.calls[0];
    const savedGrid = (draft as HomepageDocument).sections.find(
      (section) => section.id === GRID_ID,
    );
    expect(savedGrid).toMatchObject({
      type: "PRODUCT_GRID",
      payload: { columns: 2 },
    });
  });
});
