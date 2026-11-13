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
  onPatch: ReturnType<typeof vi.fn>;
} {
  const onAddMedia = vi.fn();
  const onReorder = vi.fn();
  const onPatch = vi.fn();
  render(
    <AdminI18nProvider>
      <DetailMediaWorkspace
        blocks={[]}
        pending={false}
        scopeOptions={SCOPES}
        onAddMedia={onAddMedia}
        onPatch={onPatch}
        onMove={vi.fn()}
        onReorder={onReorder}
        onRemove={vi.fn()}
        {...overrides}
      />
    </AdminI18nProvider>,
  );
  return { onAddMedia, onReorder, onPatch };
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

describe("DetailMediaWorkspace carousel selection", () => {
  const rows = (): DetailMediaWorkspaceProps["blocks"] => [
    { type: "IMAGE", url: "/uploads/a.jpg", altText: "A", sortOrder: "0" },
    { type: "IMAGE", url: "/uploads/b.jpg", altText: "B", sortOrder: "1" },
    { type: "IMAGE", url: "/uploads/c.jpg", altText: "C", sortOrder: "2" },
    { type: "IMAGE", url: "/uploads/d.jpg", altText: "D", sortOrder: "3" },
  ];

  async function selectRows(user: ReturnType<typeof userEvent.setup>, numbers: number[]) {
    for (const number of numbers) {
      await user.click(screen.getByRole("checkbox", { name: new RegExp("选择第 " + number + " 块") }));
    }
  }

  it("marks consecutively selected rows as one carousel group", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderWorkspace({ blocks: rows() });

    await selectRows(user, [1, 2]);
    await user.click(screen.getByRole("button", { name: "设为轮播组" }));

    const patches = onPatch.mock.calls.map(([index, patch]) => [index, patch]);
    expect(patches).toEqual([
      [0, { groupKey: expect.any(String) }],
      [1, { groupKey: expect.any(String) }],
    ]);
    expect(patches[0]![1].groupKey).toBe(patches[1]![1].groupKey);
  });

  it("refuses a non-consecutive selection until the rows are adjacent", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderWorkspace({ blocks: rows() });

    await selectRows(user, [1, 3]);
    expect(screen.getByRole("button", { name: "设为轮播组" })).toBeDisabled();
    expect(screen.getByText(/轮播组必须是连续的行/)).toBeVisible();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("clears the carousel grouping from selected rows", async () => {
    const user = userEvent.setup();
    const { onPatch } = renderWorkspace({
      blocks: rows().map((row, index) =>
        index === 1 || index === 2 ? { ...row, groupKey: "existing" } : row,
      ) as DetailMediaWorkspaceProps["blocks"],
    });

    await selectRows(user, [2, 3]);
    await user.click(screen.getByRole("button", { name: "取消轮播组" }));

    expect(onPatch.mock.calls.map(([index, patch]) => [index, patch])).toEqual([
      [1, { groupKey: undefined }],
      [2, { groupKey: undefined }],
    ]);
  });
});
