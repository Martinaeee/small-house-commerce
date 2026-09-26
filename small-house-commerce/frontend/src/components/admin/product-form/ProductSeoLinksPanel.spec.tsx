import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  ProductSeoLinksPanel,
  type SavedProductLinkContext,
} from "./ProductSeoLinksPanel";

const savedProduct: SavedProductLinkContext = {
  path: "/products/saved-chair",
  status: "ACTIVE",
  variants: [
    {
      id: "00000000-0000-7000-8000-000000000001",
      name: "Red / Small",
      skuStatus: "ACTIVE",
    },
    {
      id: "00000000-0000-7000-8000-000000000002",
      name: "Blue / Small",
      skuStatus: "DISABLED",
    },
    { id: "", name: "Unsaved", skuStatus: "ACTIVE" },
  ],
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ProductSeoLinksPanel>> = {},
) {
  const props: React.ComponentProps<typeof ProductSeoLinksPanel> = {
    productName: "Space-saving Chair",
    slug: "draft-chair",
    seoTitle: "Compact Chair",
    metaDescription: "A chair for flexible Filipino homes.",
    fallbackDescription: "Storefront fallback description.",
    savedProduct,
    onSeoTitleChange: vi.fn(),
    onMetaDescriptionChange: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <AdminI18nProvider>
        <ProductSeoLinksPanel {...props} />
      </AdminI18nProvider>,
    ),
    props,
  };
}

beforeEach(() => {
  setAdminLang("zh");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProductSeoLinksPanel", () => {
  it("edits independent SEO fields with advisory counts and a generated canonical", () => {
    const { props } = renderPanel();

    expect(screen.getByLabelText(/SEO 标题/)).toHaveValue("Compact Chair");
    expect(screen.getByText("13 / 60")).toBeVisible();
    expect(screen.getByLabelText(/Meta 描述/)).toHaveValue(
      "A chair for flexible Filipino homes.",
    );
    expect(screen.getByText("36 / 160")).toBeVisible();
    expect(screen.getByText("Compact Chair | LUWAG Living")).toBeVisible();
    expect(screen.getByLabelText(/Canonical（系统生成）/)).toHaveValue(
      "https://luwag.ph/products/draft-chair",
    );
    expect(screen.getByLabelText(/Canonical（系统生成）/)).toHaveAttribute(
      "readonly",
    );

    fireEvent.change(screen.getByLabelText(/SEO 标题/), {
      target: { value: "SEO override" },
    });
    expect(props.onSeoTitleChange).toHaveBeenLastCalledWith("SEO override");
  });

  it("builds product and variant URLs only from saved truth and real active ids", () => {
    renderPanel();

    expect(screen.getByText("https://luwag.ph/products/saved-chair")).toBeVisible();
    expect(
      screen.getByText(
        "https://luwag.ph/products/saved-chair?variant=00000000-0000-7000-8000-000000000001",
      ),
    ).toBeVisible();
    expect(screen.getByText("Red / Small")).toBeVisible();
    expect(screen.queryByText("Blue / Small")).not.toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("copies without an alert and shows transient copied feedback", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderPanel();

    await user.click(screen.getByRole("button", { name: "复制商品链接" }));

    expect(writeText).toHaveBeenCalledWith(
      "https://luwag.ph/products/saved-chair",
    );
    expect(screen.getByText("已复制")).toBeVisible();
    expect(alert).not.toHaveBeenCalled();
  });

  it("does not invent public links for an unsaved product", () => {
    renderPanel({ savedProduct: null });

    expect(screen.getByText("保存商品后才会生成真实商品与款式链接。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "复制商品链接" })).not.toBeInTheDocument();
  });
});
