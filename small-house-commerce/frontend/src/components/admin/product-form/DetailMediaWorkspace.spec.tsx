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
    expect(rows[0]).toHaveClass("grid-cols-1");
    expect(rows[0]).toHaveClass(
      "xl:grid-cols-[120px_minmax(0,1fr)_minmax(180px,240px)_auto]",
    );
    expect(rows[1]).toHaveClass("ring-2");
    expect(rows[1]).toHaveAttribute("id", "product-detail-block-1");
    expect(document.getElementById("pf-row-detailBlocks.1.url")).not.toBeNull();
  });

  it("forwards type, uploader, text, ordering, removal, and add actions without mutation", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderWorkspace();

    expect(screen.getByRole("button", { name: "上传图片" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传视频" })).toBeInTheDocument();

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
