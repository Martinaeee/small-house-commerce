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
  const oneBlock = [
    {
      url: "https://example.com/a.jpg",
      type: "IMAGE" as const,
      altText: "",
      sortOrder: "0",
      optionValueId: "",
      variantId: "",
    },
  ];

  it("makes the thumbnail itself the drag surface when reordering is wired", () => {
    renderWorkspace({ blocks: oneBlock });
    // The picture people grab is the sortable activator; the ⠿ is only a hint.
    expect(
      document.querySelector('[aria-roledescription="sortable"]'),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-media-drag-handle]"),
    ).toHaveAttribute("aria-hidden", "true");
  });

  it("stays read-only when no reorder handler is provided", () => {
    renderWorkspace({ onReorder: undefined, blocks: oneBlock });
    expect(
      document.querySelector('[aria-roledescription="sortable"]'),
    ).toBeNull();
    expect(document.querySelector("[data-media-drag-handle]")).toBeNull();
  });
});

describe("DetailMediaWorkspace carousel groups", () => {
  it("merges every media added while the mode is on into one swipeable group", async () => {
    const user = userEvent.setup();
    const { onAddMedia } = renderWorkspace();

    await user.click(screen.getByRole("checkbox", { name: /合并为轮播图组/ }));
    await user.type(
      screen.getByLabelText("要添加的媒体 URL"),
      "https://example.com/one.jpg",
    );
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.type(
      screen.getByLabelText("要添加的媒体 URL"),
      "https://example.com/two.jpg",
    );
    await user.click(screen.getByRole("button", { name: "添加" }));

    expect(onAddMedia).toHaveBeenCalledTimes(2);
    const [, , firstOpts] = onAddMedia.mock.calls[0]!;
    const [, , secondOpts] = onAddMedia.mock.calls[1]!;
    expect(firstOpts?.groupKey).toEqual(expect.any(String));
    expect(secondOpts?.groupKey).toBe(firstOpts?.groupKey);
  });

  it("starts a fresh group each time the mode is toggled off and on", async () => {
    const user = userEvent.setup();
    const { onAddMedia } = renderWorkspace();
    const toggle = screen.getByRole("checkbox", { name: /合并为轮播图组/ });

    await user.click(toggle);
    await user.type(screen.getByLabelText("要添加的媒体 URL"), "https://example.com/a.jpg");
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(toggle);
    await user.click(toggle);
    await user.type(screen.getByLabelText("要添加的媒体 URL"), "https://example.com/b.jpg");
    await user.click(screen.getByRole("button", { name: "添加" }));

    const firstGroup = onAddMedia.mock.calls[0]?.[2]?.groupKey;
    const secondGroup = onAddMedia.mock.calls[1]?.[2]?.groupKey;
    expect(secondGroup).toEqual(expect.any(String));
    expect(secondGroup).not.toBe(firstGroup);
  });

  it("labels grouped rows with a carousel chip", () => {
    renderWorkspace({
      blocks: [
        { type: "IMAGE", url: "/uploads/a.jpg", altText: "A", sortOrder: "0", groupKey: "set-1" },
        { type: "IMAGE", url: "/uploads/b.jpg", altText: "B", sortOrder: "1", groupKey: "set-1" },
        { type: "IMAGE", url: "/uploads/c.jpg", altText: "C", sortOrder: "2" },
      ],
    });

    const chips = screen.getAllByText(/轮播 1/);
    expect(chips).toHaveLength(2);
    expect(screen.queryByText(/轮播 2/)).not.toBeInTheDocument();
  });
});
