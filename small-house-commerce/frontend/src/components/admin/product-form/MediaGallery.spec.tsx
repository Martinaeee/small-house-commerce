import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { MediaGallery, type MediaGalleryItem } from "./MediaGallery";

const ITEMS: MediaGalleryItem[] = [
  { key: "0", url: "https://cdn.example.com/a.jpg", type: "IMAGE", altText: "A" },
  { key: "1", url: "https://cdn.example.com/b.jpg", type: "IMAGE", altText: "B" },
  { key: "2", url: "https://cdn.example.com/c.jpg", type: "IMAGE", altText: "C" },
];

function rect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 104,
    height: 104,
    top,
    left: 0,
    right: 104,
    bottom: top + 104,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockTileGeometry(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      const tile = this.closest("li");
      if (!tile?.parentElement) return rect(0);
      const index = Array.from(tile.parentElement.children).indexOf(tile);
      return rect(index * 120);
    },
  );
}

async function keyboardSort(handle: HTMLElement, arrows: string[]): Promise<void> {
  fireEvent.keyDown(handle, { code: "Space", key: " " });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (const code of arrows) {
    fireEvent.keyDown(document, { code, key: code });
  }
  fireEvent.keyDown(document, { code: "Space", key: " " });
  await act(async () => {});
}

function renderGallery(onReorder?: (from: number, to: number) => void) {
  return render(
    <AdminI18nProvider>
      <MediaGallery
        items={ITEMS}
        scope="Detail"
        pending={false}
        indexed
        labels={{
          type: (number) => `Type ${number}`,
          url: (number) => `URL ${number}`,
          alt: (number) => `Alt ${number}`,
          previous: (number) => `Up ${number}`,
          next: (number) => `Down ${number}`,
          remove: "Remove",
        }}
        onUpload={async () => {}}
        onPatch={vi.fn()}
        onMove={vi.fn()}
        onReorder={onReorder}
        onRemove={vi.fn()}
      />
    </AdminI18nProvider>,
  );
}

describe("MediaGallery drag reorder", () => {
  beforeEach(() => {
    setAdminLang("en");
    mockTileGeometry();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reorders through the dnd-kit keyboard sensor", async () => {
    const onReorder = vi.fn();
    renderGallery(onReorder);

    await keyboardSort(
      screen.getByRole("button", { name: "Drag to reorder item 1" }),
      ["ArrowDown"],
    );

    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it("keeps the arrow buttons as a non-drag fallback", () => {
    renderGallery(undefined);
    // Without onReorder there is no drag handle.
    expect(
      screen.queryByRole("button", { name: "Drag to reorder item 1" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Down / })).toHaveLength(3);
  });
});
