import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { ProductFormErrorRail } from "@/components/admin/product-form/ProductFormErrorRail";
import type { AdminProductIssue } from "@/lib/admin-product-issues";

/**
 * The rail itself: one line while collapsed, one card per problem when
 * expanded, and a copy action for anything the client cannot explain.
 */

function issue(overrides: Partial<AdminProductIssue> = {}): AdminProductIssue {
  return {
    id: "issue-1",
    message: "启用的选项 color 至少需要一个启用的选项值。",
    detail: "前台至少需要一个可选项才能渲染选择器。",
    tab: "variants",
    highlightKey: "option-color",
    actions: [
      { kind: "disable-option", label: "停用这个选项", optionKey: "option-color" },
    ],
    ...overrides,
  };
}

function renderRail(
  issues: AdminProductIssue[],
  onAction = vi.fn(),
  onJump = vi.fn(),
): ReturnType<typeof render> {
  return render(
    <AdminI18nProvider>
      <ProductFormErrorRail issues={issues} onAction={onAction} onJump={onJump} />
    </AdminI18nProvider>,
  );
}

beforeEach(() => {
  setAdminLang("zh");
});

describe("ProductFormErrorRail", () => {
  it("renders nothing when there is no problem", () => {
    renderRail([]);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the count and the first problem without expanding", () => {
    renderRail([issue(), issue({ id: "issue-2", message: "第二个问题" })]);

    const rail = screen.getByRole("alert");
    expect(rail.textContent).toContain("2 个问题待处理");
    expect(rail.textContent).toContain("启用的选项 color 至少需要一个启用的选项值。");
    expect(screen.queryByText("第二个问题")).not.toBeInTheDocument();
  });

  it("expands to one card per problem with its detail and repairs", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderRail([issue()], onAction);

    await user.click(screen.getByRole("button", { name: "查看" }));
    expect(
      screen.getByText("前台至少需要一个可选项才能渲染选择器。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "停用这个选项" }));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "disable-option", optionKey: "option-color" }),
    );

    await user.click(screen.getByRole("button", { name: "收起" }));
    expect(
      screen.queryByText("前台至少需要一个可选项才能渲染选择器。"),
    ).not.toBeInTheDocument();
  });

  it("jumps to the offending row", async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    renderRail([issue()], vi.fn(), onJump);

    await user.click(screen.getByRole("button", { name: "查看" }));
    await user.click(screen.getByRole("button", { name: /跳到该选项/ }));

    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: "issue-1" }));
  });

  it("copies an unexplained problem and confirms it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderRail([
      issue({
        message: "slug: A product with this slug already exists.",
        highlightKey: undefined,
        actions: [{ kind: "copy", label: "复制错误信息" }],
      }),
    ]);

    await user.click(screen.getByRole("button", { name: "查看" }));
    await user.click(screen.getByRole("button", { name: "复制错误信息" }));

    expect(writeText).toHaveBeenCalledWith(
      "slug: A product with this slug already exists.",
    );
    expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  });
});
