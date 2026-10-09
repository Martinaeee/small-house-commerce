import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageFormValue } from "@/components/admin/ProductForm";
import { SharedMediaWorkspace } from "@/components/admin/product-form/SharedMediaWorkspace";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

const images = Object.freeze([
  Object.freeze({
    url: "/uploads/hero.jpg",
    type: "IMAGE" as const,
    altText: "Hero image",
    sortOrder: "0",
  }),
  Object.freeze({
    url: "/uploads/demo.mp4",
    type: "VIDEO" as const,
    altText: "   ",
    sortOrder: "1",
  }),
  Object.freeze({
    url: "",
    type: "IMAGE" as const,
    altText: "",
    sortOrder: "2",
  }),
]) satisfies readonly Readonly<ImageFormValue>[];

function renderWorkspace(
  overrides: Partial<React.ComponentProps<typeof SharedMediaWorkspace>> = {},
) {
  const props: React.ComponentProps<typeof SharedMediaWorkspace> = {
    images,
    pending: false,
    onPatch: vi.fn(),
    onMove: vi.fn(),
    onReorder: vi.fn(),
    onSetCover: vi.fn(),
    onRemove: vi.fn(),
    onAdd: vi.fn(),
    onAddImageUrl: vi.fn(),
    ...overrides,
  };
  const view = render(
    <AdminI18nProvider>
      <SharedMediaWorkspace {...props} />
    </AdminI18nProvider>,
  );
  return { ...view, props };
}

beforeEach(() => {
  setAdminLang("en");
});

describe("SharedMediaWorkspace", () => {
  it("offers a larger selected preview and visible cover/remove actions without hover", async () => {
    const { container } = renderWorkspace();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Media 2" }));
    const editor = container.querySelector("#shared-media-editor")!;
    expect(editor.querySelector("[data-selected-media-preview] video")).not.toBeNull();
    expect(within(editor as HTMLElement).getByRole("button", { name: "Set as cover" })).toBeEnabled();
    expect(within(editor as HTMLElement).getByRole("button", { name: "Remove media" })).toBeEnabled();
    expect(container.querySelector("#product-media-image-1 [data-media-actions]")).toHaveClass("opacity-100", "pointer-events-auto");
  });

  it("shows compact cards and a factual summary without dropping blank rows", () => {
    renderWorkspace({ highlightKey: "images.2.url" });

    expect(screen.getByRole("heading", { name: "Shared product gallery" })).toBeInTheDocument();
    expect(screen.getByText("Rows 3")).toBeInTheDocument();
    expect(screen.getByText("Usable 2")).toBeInTheDocument();
    expect(screen.getByText("Images 2")).toBeInTheDocument();
    expect(screen.getByText("Videos 1")).toBeInTheDocument();
    expect(screen.getByText("Alt text 1/3")).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Shared media cards" });
    expect(list).toHaveClass(
      "grid-cols-[repeat(auto-fill,minmax(88px,104px))]",
    );
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(cards[2]).toHaveAttribute("id", "product-media-image-2");
    expect(cards[2]).toHaveClass("ring-2");

    expect(screen.getByText("Order 1")).toBeInTheDocument();
    expect(screen.getByText("Order 2")).toBeInTheDocument();
    expect(screen.getByText("Order 3")).toBeInTheDocument();
    expect(screen.getByText("Cover")).toBeInTheDocument();
    expect(screen.getByText("No image yet")).toBeInTheDocument();
  });

  it("reveals per-card actions on hover and focus without removing them from the DOM", () => {
    renderWorkspace();

    const actions = document.querySelectorAll("[data-media-actions]");
    expect(actions).toHaveLength(3);
    for (const action of actions) {
      expect(action).toHaveClass(
        "opacity-0",
        "group-hover:opacity-100",
        "group-focus-within:opacity-100",
      );
    }
    expect(
      screen.getAllByRole("button", { name: "Remove media" }),
    ).toHaveLength(3);
    expect(
      screen.getAllByRole("button", { name: "Move media 1 right" }),
    ).toHaveLength(1);
  });

  it("forwards the add row to the gallery owner", () => {
    const { props } = renderWorkspace();

    fireEvent.change(screen.getByLabelText("Image URL to add"), {
      target: { value: "https://cdn.example.com/new.jpg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));

    expect(props.onAddImageUrl).toHaveBeenCalledWith(
      "https://cdn.example.com/new.jpg",
    );
  });

  it("blocks drag and action callbacks while editing is pending", () => {
    const { props } = renderWorkspace({ pending: true });
    const cards = within(
      screen.getByRole("list", { name: "Shared media cards" }),
    ).getAllByRole("listitem");

    expect(cards[0]).toHaveAttribute("draggable", "false");
    expect(screen.getByRole("button", { name: "Add photo" })).toBeDisabled();

    const dataTransfer = { effectAllowed: "none" };
    fireEvent.dragStart(cards[0], { dataTransfer });
    fireEvent.drop(cards[2], { dataTransfer });

    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("keeps the expanded editor attached to a card after it moves", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Media 2" }));
    expect(screen.getByLabelText("Media 2 URL")).toHaveValue(
      "/uploads/demo.mp4",
    );

    await user.click(screen.getByRole("button", { name: "Move media 2 left" }));
    const reordered = [
      { ...images[1], sortOrder: "0" },
      { ...images[0], sortOrder: "1" },
      images[2],
    ];
    rerender(
      <AdminI18nProvider>
        <SharedMediaWorkspace {...props} images={reordered} />
      </AdminI18nProvider>,
    );

    expect(screen.getByLabelText("Media 1 URL")).toHaveValue(
      "/uploads/demo.mp4",
    );
  });

  it("forwards every edit and ordering action without mutating its controlled value", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Media 1 (cover)" }));
    expect(screen.getByRole("button", { name: "上传图片" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Media 1 URL"), {
      target: { value: "/uploads/replacement.jpg" },
    });
    expect(props.onPatch).toHaveBeenCalledWith(0, {
      url: "/uploads/replacement.jpg",
    });

    fireEvent.change(screen.getByLabelText("Media 1 alt text"), {
      target: { value: "Replacement hero" },
    });
    expect(props.onPatch).toHaveBeenCalledWith(0, {
      altText: "Replacement hero",
    });

    await user.selectOptions(screen.getByLabelText("Media 1 type"), "VIDEO");
    expect(props.onPatch).toHaveBeenCalledWith(0, { type: "VIDEO" });

    await user.click(screen.getByText("Advanced (sort order)"));
    fireEvent.change(screen.getByLabelText("Media 1 sort order"), {
      target: { value: "7" },
    });
    expect(props.onPatch).toHaveBeenCalledWith(0, { sortOrder: "7" });

    await user.click(screen.getByRole("button", { name: "Move media 1 right" }));
    expect(props.onMove).toHaveBeenCalledWith(0, 1);
    await user.click(screen.getByRole("button", { name: "Move media 2 left" }));
    expect(props.onMove).toHaveBeenCalledWith(1, -1);
    await user.click(screen.getAllByRole("button", { name: "Set as cover" })[0]);
    expect(props.onSetCover).toHaveBeenCalledWith(1);
    await user.click(screen.getAllByRole("button", { name: "Remove media" })[0]);
    expect(props.onRemove).toHaveBeenCalledWith(0);

    const cards = within(
      screen.getByRole("list", { name: "Shared media cards" }),
    ).getAllByRole("listitem");
    const dataTransfer = { effectAllowed: "none" };
    fireEvent.dragStart(cards[0], { dataTransfer });
    fireEvent.dragOver(cards[2], { dataTransfer });
    fireEvent.drop(cards[2], { dataTransfer });
    expect(props.onReorder).toHaveBeenCalledWith(0, 2);

    await user.click(screen.getByRole("button", { name: "Add photo" }));
    await user.click(screen.getByRole("button", { name: "Add video" }));
    expect(props.onAdd).toHaveBeenNthCalledWith(1, "IMAGE");
    expect(props.onAdd).toHaveBeenNthCalledWith(2, "VIDEO");

    rerender(
      <AdminI18nProvider>
        <SharedMediaWorkspace {...props} />
      </AdminI18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Media 1 (cover)" }));
    expect(screen.getByLabelText("Media 1 URL")).toHaveValue(
      "/uploads/hero.jpg",
    );
    expect(images[0]).toEqual({
      url: "/uploads/hero.jpg",
      type: "IMAGE",
      altText: "Hero image",
      sortOrder: "0",
    });
  });
});
