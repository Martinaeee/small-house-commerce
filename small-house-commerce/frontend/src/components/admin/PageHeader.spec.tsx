import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageHeader } from "@/components/admin/PageHeader";

describe("PageHeader", () => {
  it("renders the shared title, count, subtitle, and right-side actions pattern", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <PageHeader
        title="商品"
        count={5}
        subtitle="管理商品资料、SKU、价格、媒体以及前台展示。"
        actions={
          <button type="button" onClick={onCreate}>
            新建商品
          </button>
        }
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "商品 (5)" })).toBeInTheDocument();
    expect(
      screen.getByText("管理商品资料、SKU、价格、媒体以及前台展示。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建商品" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("does not reserve subtitle or actions space when they are absent", () => {
    const { container } = render(<PageHeader title="站点设置" />);

    expect(screen.getByRole("heading", { name: "站点设置" })).toBeInTheDocument();
    expect(container.querySelector('[data-page-header="subtitle"]')).toBeNull();
    expect(container.querySelector('[data-page-header="actions"]')).toBeNull();
  });
});
