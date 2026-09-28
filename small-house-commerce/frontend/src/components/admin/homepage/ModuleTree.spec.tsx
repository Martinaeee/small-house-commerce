import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  HomepageEditor,
  HomepageEditorProvider,
  useHomepageEditor,
} from "@/components/admin/homepage/HomepageEditor";
import {
  ANNOUNCEMENT_SELECTION_ID,
  ModuleTree,
} from "@/components/admin/homepage/ModuleTree";
import {
  emptyDocument,
  type HomepageDocument,
  type HomepageSection,
  type SectionType,
} from "@/lib/homepage-document";
import type { HomepageDraftSnapshot } from "@/lib/admin-api";

const getHomepageDraft = vi.hoisted(() => vi.fn());
const saveHomepageDraft = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: { getHomepageDraft, saveHomepageDraft },
}));

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
  };
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
    </div>
  );
}

function renderTree() {
  return render(
    <AdminI18nProvider>
      <HomepageEditorProvider>
        <Loader document={DOCUMENT} />
        <ModuleTree />
        <TreeProbe />
      </HomepageEditorProvider>
    </AdminI18nProvider>,
  );
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
    ).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete section" })).toHaveLength(
      2,
    );
    expect(sectionRow(HERO_ID).querySelector('[aria-label="Delete section"]')).toBeNull();
    expect(sectionRow(USP_ID).querySelector('[aria-label="Duplicate section"]')).toBeNull();
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
});
