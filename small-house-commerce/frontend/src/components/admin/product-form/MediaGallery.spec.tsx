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

  it("reorders when the thumbnail is the drag activator", async () => {
    const onReorder = vi.fn();
    renderGallery(onReorder);

    await keyboardSort(
      screen.getByRole("button", { name: "Edit Detail media 1" }),
      ["ArrowDown"],
    );

    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it("keeps the drag hint decorative so the thumbnail stays the only control", () => {
    renderGallery(vi.fn());

    const hint = document.querySelector("[data-media-drag-handle]");
    expect(hint).not.toBeNull();
    expect(hint).toHaveAttribute("aria-hidden", "true");
  });

  it("leaves the arrow buttons out of the drag surface", async () => {
    const onMove = vi.fn();
    const onReorder = vi.fn();
    render(
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
          onMove={onMove}
          onReorder={onReorder}
          onRemove={vi.fn()}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Down 1" }));

    expect(onMove).toHaveBeenCalledWith("0", 1);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("keeps the arrow buttons as a non-drag fallback", () => {
    renderGallery(undefined);
    // Without onReorder the tile is not a drag surface.
    expect(document.querySelector("[data-media-drag-handle]")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Down / })).toHaveLength(3);
  });
});
