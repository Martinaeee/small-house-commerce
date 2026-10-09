import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetailBlockFormValue } from "@/components/admin/ProductForm";
import { DetailMediaWorkspace } from "@/components/admin/product-form/DetailMediaWorkspace";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

const blocks = Object.freeze([
  Object.freeze({
    type: "IMAGE" as const,
    url: "/uploads/detail-1.jpg",
    altText: "Assembly detail",
    sortOrder: "0",
  }),
  Object.freeze({
    type: "VIDEO" as const,
    url: "/uploads/detail-2.mp4",
    altText: " ",
    sortOrder: "1",
  }),
]) satisfies readonly Readonly<DetailBlockFormValue>[];

function renderWorkspace(
  overrides: Partial<React.ComponentProps<typeof DetailMediaWorkspace>> = {},
) {
  const props: React.ComponentProps<typeof DetailMediaWorkspace> = {
    blocks,
    pending: false,
    onPatch: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
    onAdd: vi.fn(),
    onAddMedia: vi.fn(),
    ...overrides,
  };
  const view = render(
    <AdminI18nProvider>
      <DetailMediaWorkspace {...props} />
    </AdminI18nProvider>,
  );
  return { ...view, props };
}

beforeEach(() => {
  setAdminLang("en");
});

describe("DetailMediaWorkspace", () => {
  it("does not carry a replacement error into another selected block", async () => {
    renderWorkspace();
    await userEvent.click(screen.getByRole("button", { name: "Edit Detail content (images / videos) media 1" }));
    fireEvent.change(document.querySelector('input[type="file"]:not([multiple])')!, { target: { files: [new File(["pdf"], "notes.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText("仅支持 JPG / PNG / WebP 图片")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Detail content (images / videos) media 2" }));
    expect(screen.queryByText("仅支持 JPG / PNG / WebP 图片")).not.toBeInTheDocument();
  });

  it("keeps detail media as thumbnails until a single block is selected", async () => {
    renderWorkspace();
    expect(screen.queryByLabelText("Detail block 1 URL")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Detail block 2 URL")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Detail content (images / videos) media 2" }));
    expect(screen.getByLabelText("Detail block 2 URL")).toHaveValue("/uploads/detail-2.mp4");
    expect(screen.queryByLabelText("Detail block 1 URL")).not.toBeInTheDocument();
    expect(document.querySelector("[data-selected-media-preview] video")).not.toBeNull();
    expect(document.querySelector('input[type="file"][multiple]')).not.toBeNull();
    expect(document.querySelectorAll('input[type="file"]:not([multiple])')).toHaveLength(1);
  });

  it("separates PDP-only media with factual summaries and narrow-safe rows", () => {
    renderWorkspace({ highlightKey: "detailBlocks.1.url" });

    expect(
      screen.getByRole("heading", { name: "Detail content (images / videos)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "PDP long-form media only. These blocks do not appear in the main product gallery or variant galleries.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Rows 2")).toBeInTheDocument();
    expect(screen.getByText("Images 1")).toBeInTheDocument();
    expect(screen.getByText("Videos 1")).toBeInTheDocument();
    expect(screen.getByText("Alt text 1/2")).toBeInTheDocument();
    expect(screen.queryByText(/Gallery switching/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shared product gallery/)).not.toBeInTheDocument();

    const list = screen.getByRole("list", { name: "PDP detail media blocks" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(list).toHaveClass("grid-cols-[repeat(auto-fill,minmax(88px,104px))]");
    expect(rows[0].querySelector("input")).toBeNull();
    expect(rows[1]).toHaveClass("ring-2");
    expect(rows[1]).toHaveAttribute("id", "product-detail-block-1");
    expect(document.getElementById("pf-row-detailBlocks.1.url")).not.toBeNull();
  });

  it("forwards type, uploader, text, ordering, removal, and add actions without mutation", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Edit Detail content (images / videos) media 1" }));
    expect(screen.getByRole("button", { name: "上传图片" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Detail content (images / videos) media 2" }));
    expect(screen.getByRole("button", { name: "上传视频" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Detail content (images / videos) media 1" }));

    await user.selectOptions(screen.getByLabelText("Detail block 1 type"), "VIDEO");
    expect(props.onPatch).toHaveBeenCalledWith(0, { type: "VIDEO" });

    fireEvent.change(screen.getByLabelText("Detail block 1 URL"), {
      target: { value: "/uploads/replacement.mp4" },
    });
    expect(props.onPatch).toHaveBeenCalledWith(0, {
      url: "/uploads/replacement.mp4",
    });

    fireEvent.change(screen.getByLabelText("Detail block 1 alt text"), {
      target: { value: "Replacement detail" },
    });
    expect(props.onPatch).toHaveBeenCalledWith(0, {
      altText: "Replacement detail",
    });

    await user.click(
      screen.getByRole("button", { name: "Move detail block 1 down" }),
    );
    expect(props.onMove).toHaveBeenCalledWith(0, 1);
    await user.click(
      screen.getByRole("button", { name: "Move detail block 2 up" }),
    );
    expect(props.onMove).toHaveBeenCalledWith(1, -1);
    await user.click(
      screen.getAllByRole("button", { name: "Remove detail block" })[0],
    );
    expect(props.onRemove).toHaveBeenCalledWith(0);

    await user.click(screen.getByRole("button", { name: "Add detail image" }));
    await user.click(screen.getByRole("button", { name: "Add detail video" }));
    expect(props.onAdd).toHaveBeenNthCalledWith(1, "IMAGE");
    expect(props.onAdd).toHaveBeenNthCalledWith(2, "VIDEO");

    rerender(
      <AdminI18nProvider>
        <DetailMediaWorkspace {...props} />
      </AdminI18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Edit Detail content (images / videos) media 1" }));
    expect(screen.getByLabelText("Detail block 1 type")).toHaveValue("IMAGE");
    expect(screen.getByLabelText("Detail block 1 URL")).toHaveValue(
      "/uploads/detail-1.jpg",
    );
    expect(blocks[0]).toEqual({
      type: "IMAGE",
      url: "/uploads/detail-1.jpg",
      altText: "Assembly detail",
      sortOrder: "0",
    });
  });
});
