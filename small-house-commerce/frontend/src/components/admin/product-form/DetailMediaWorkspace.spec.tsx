import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import {
  DetailMediaWorkspace,
  type DetailMediaWorkspaceProps,
} from "./DetailMediaWorkspace";

const SCOPES = [
  { value: "", label: "共享" },
  { value: "option:ov-black", label: "颜色 = 黑" },
  { value: "variant:v-1", label: "黑色 / 小号" },
];

function renderWorkspace(
  overrides: Partial<DetailMediaWorkspaceProps> = {},
): {
  onAddMedia: ReturnType<typeof vi.fn>;
  onReorder: ReturnType<typeof vi.fn>;
} {
  const onAddMedia = vi.fn();
  const onReorder = vi.fn();
  render(
    <AdminI18nProvider>
      <DetailMediaWorkspace
        blocks={[]}
        pending={false}
        scopeOptions={SCOPES}
        onAddMedia={onAddMedia}
        onPatch={vi.fn()}
        onMove={vi.fn()}
        onReorder={onReorder}
        onRemove={vi.fn()}
        {...overrides}
      />
    </AdminI18nProvider>,
  );
  return { onAddMedia, onReorder };
}

describe("DetailMediaWorkspace batch scope", () => {
  it("applies the selected scope to every media added from the upload row", async () => {
    const user = userEvent.setup();
    const { onAddMedia } = renderWorkspace();

    await user.selectOptions(screen.getByLabelText("归属"), "option:ov-black");
    await user.type(
      screen.getByLabelText("要添加的媒体 URL"),
      "https://example.com/new.jpg",
    );
    await user.click(screen.getByRole("button", { name: "添加" }));

    expect(onAddMedia).toHaveBeenCalledWith(
      { url: "https://example.com/new.jpg", type: "IMAGE" },
      { optionValueId: "ov-black", variantId: "" },
    );
  });

  it("switches back to shared without leaking the previous scope", async () => {
    const user = userEvent.setup();
    const { onAddMedia } = renderWorkspace();

    await user.selectOptions(screen.getByLabelText("归属"), "variant:v-1");
    await user.selectOptions(screen.getByLabelText("归属"), "");
    await user.type(
      screen.getByLabelText("要添加的媒体 URL"),
      "https://example.com/shared.jpg",
    );
    await user.click(screen.getByRole("button", { name: "添加" }));

    expect(onAddMedia).toHaveBeenCalledWith(
      { url: "https://example.com/shared.jpg", type: "IMAGE" },
      { optionValueId: "", variantId: "" },
    );
  });

  it("labels each thumbnail with its resolved scope", () => {
    renderWorkspace({
      blocks: [
        {
          url: "https://example.com/a.jpg",
          type: "IMAGE",
          altText: "",
          sortOrder: "0",
          optionValueId: "",
          variantId: "v-1",
        },
      ],
    });

    const badge = screen
      .getAllByText("黑色 / 小号")
      .find((element) => element.tagName === "SPAN");
    expect(badge).toBeInTheDocument();
  });

  it("moves the two explanation paragraphs behind the title question mark", () => {
    renderWorkspace();
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(
      "仅用于 PDP 长图 / 视频详情；不会进入商品主图库或款式图库。",
    );
    expect(tip).toHaveTextContent(
      "显示在图集下方的详情区；顺序即前台展示顺序，用 ↑ ↓ 调整。",
    );
    expect(tip.closest("p")).toBeNull();
  });
});

describe("DetailMediaWorkspace drag affordance", () => {
  it("renders a drag handle per thumbnail when reordering is wired", () => {
    renderWorkspace({
      blocks: [
        {
          url: "https://example.com/a.jpg",
          type: "IMAGE",
          altText: "",
          sortOrder: "0",
          optionValueId: "",
          variantId: "",
        },
      ],
    });
    expect(
      screen.getByRole("button", { name: "拖动排序第 1 张" }),
    ).toBeInTheDocument();
  });

  it("stays read-only when no reorder handler is provided", () => {
    renderWorkspace({
      onReorder: undefined,
      blocks: [
        {
          url: "https://example.com/a.jpg",
          type: "IMAGE",
          altText: "",
          sortOrder: "0",
          optionValueId: "",
          variantId: "",
        },
      ],
    });
    expect(
      screen.queryByRole("button", { name: "拖动排序第 1 张" }),
    ).not.toBeInTheDocument();
  });
});
