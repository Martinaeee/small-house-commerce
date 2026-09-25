import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { ProductEditorRail } from "./ProductEditorRail";

function renderRail(overrides: Partial<ComponentProps<typeof ProductEditorRail>> = {}) {
  const props: ComponentProps<typeof ProductEditorRail> = {
    blocking: [],
    readiness: {
      checks: [
        { key: "basic", ok: true },
        { key: "priced_sku", ok: true },
        { key: "shared_media", ok: false },
        { key: "shipping", ok: false },
        { key: "default_variant", ok: true },
      ],
      warnings: [],
      complete: 3,
      total: 5,
    },
    storefront: {
      savedStatus: "ACTIVE",
      selectedStatus: "DRAFT",
      path: "/products/server-chair",
    },
    landing: { count: 2, productId: "product-1" },
    preview: {
      name: "Chair",
      coverImageUrl: "https://example.com/chair.jpg",
      priceLabel: "₱1,299",
    },
    onOpenPreview: vi.fn(),
    ...overrides,
  };

  return {
    ...render(
      <AdminI18nProvider>
        <ProductEditorRail {...props} />
      </AdminI18nProvider>,
    ),
    props,
  };
}

describe("ProductEditorRail", () => {
  beforeEach(() => {
    setAdminLang("zh");
  });

  it("opens exactly the saved storefront path and marks an unsaved status choice", () => {
    renderRail();

    expect(screen.getByRole("link", { name: "查看前台页面" })).toHaveAttribute(
      "href",
      "/products/server-chair",
    );
    expect(screen.getByText("Recommendation")).toBeInTheDocument();
    expect(screen.getByText(/尚未保存/)).toHaveTextContent("上架");
    expect(screen.getByText(/尚未保存/)).toHaveTextContent("草稿");
  });

  it("renders blocking save-path issues without claiming they are checks", () => {
    renderRail({
      blocking: [{ id: "graph:option", message: "Color 至少需要一个启用值" }],
    });

    expect(screen.getByText("Blocking")).toBeInTheDocument();
    expect(screen.getByText("保存前必须解决")).toBeInTheDocument();
    expect(screen.getByText("Color 至少需要一个启用值")).toBeInTheDocument();
    expect(screen.getByText("3/5 项已就绪")).toBeInTheDocument();
  });

  it("shows Ready only when every derived check passes without recommendations", () => {
    renderRail({
      readiness: {
        checks: [
          { key: "basic", ok: true },
          { key: "priced_sku", ok: true },
          { key: "shared_media", ok: true },
          { key: "shipping", ok: true },
          { key: "default_variant", ok: true },
        ],
        warnings: [],
        complete: 5,
        total: 5,
      },
      storefront: {
        savedStatus: "ACTIVE",
        selectedStatus: "ACTIVE",
        path: "/products/server-chair",
      },
    });

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText("Recommendation")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocking")).not.toBeInTheDocument();
  });

  it("groups secondary modules in one divided container", () => {
    renderRail();

    const storefront = screen.getByRole("heading", {
      name: "店铺状态",
    }).closest("section");
    const landing = screen.getByRole("heading", { name: "落地页" }).closest("section");
    const preview = screen.getByRole("heading", { name: "预览" }).closest("section");
    expect(storefront?.parentElement).toBe(landing?.parentElement);
    expect(landing?.parentElement).toBe(preview?.parentElement);
    expect(storefront?.parentElement).toHaveClass("divide-y");
    expect(storefront).not.toHaveClass("rounded-xl");
  });

  it("opens the form-owned Preview tab instead of keeping a second preview state", async () => {
    const user = userEvent.setup();
    const onOpenPreview = vi.fn();
    renderRail({ onOpenPreview });

    await user.click(screen.getByRole("button", { name: "打开完整预览" }));

    expect(onOpenPreview).toHaveBeenCalledTimes(1);
  });
});
