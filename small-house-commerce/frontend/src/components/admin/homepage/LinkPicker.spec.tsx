import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { en } from "@/i18n/en";
import { zh } from "@/i18n/zh";
import { LinkPicker } from "@/components/admin/homepage/LinkPicker";
import type { LinkValue } from "@/lib/homepage-document";
import type {
  AdminCategoryNode,
  AdminCollectionRow,
  AdminLandingPageRow,
  AdminProduct,
} from "@/lib/admin-api";

const listProducts = vi.hoisted(() => vi.fn());
const listCategories = vi.hoisted(() => vi.fn());
const listCollections = vi.hoisted(() => vi.fn());
const listLandingPages = vi.hoisted(() => vi.fn());
const getProduct = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    listProducts,
    listCategories,
    listCollections,
    listLandingPages,
    getProduct,
  },
}));

function productRow(id: string, name: string): AdminProduct {
  return {
    id,
    name,
    slug: `slug-${id}`,
    productCode: null,
    description: null,
    tagline: null,
    categoryId: "cat-root",
    status: "ACTIVE",
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    materials: null,
    features: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: [],
    detailBlocks: [],
    variants: [],
  };
}

function collectionRow(id: string, name: string): AdminCollectionRow {
  return {
    id,
    name,
    slug: `slug-${id}`,
    type: "NAVIGATION",
    description: null,
    seoTitle: null,
    seoDescription: null,
    status: "ACTIVE",
    sortOrder: 0,
    heroImage: null,
    heroStyle: null,
    _count: { products: 0 },
  };
}

function categoryNode(id: string, name: string): AdminCategoryNode {
  return { id, parentId: null, name, slug: `slug-${id}`, sortOrder: 0, imageUrl: null, status: "ACTIVE", heroStyle: null, children: [] };
}

function landingRow(id: string, name: string): AdminLandingPageRow {
  return {
    id,
    name,
    adCode: null,
    slug: `slug-${id}`,
    productId: "p-x",
    productName: "Some product",
    titleOverride: null,
    status: "ACTIVE",
    effectiveStatus: "LIVE",
    startAt: null,
    endAt: null,
    sortOrder: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    views: 0,
    orders: 0,
    conversionRate: 0,
  };
}

function PickHarness({
  initial,
  allowExternal,
  onChange,
}: {
  initial: LinkValue | null;
  allowExternal: boolean;
  onChange: (value: LinkValue | null) => void;
}) {
  // The real consumers write `value` from the editor document; this harness
  // mirrors a fully controlled wiring so picker clear/select round-trips.
  const [value, setValue] = useState<LinkValue | null>(initial);
  return (
    <LinkPicker
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      allowExternal={allowExternal}
    />
  );
}

function renderPicker(props: {
  value?: LinkValue | null;
  allowExternal?: boolean;
  onChange?: (value: LinkValue | null) => void;
} = {}) {
  const onChange = props.onChange ?? vi.fn();
  const view = render(
    <AdminI18nProvider>
      <PickHarness
        initial={props.value ?? null}
        allowExternal={props.allowExternal ?? true}
        onChange={onChange}
      />
    </AdminI18nProvider>,
  );
  return { onChange, ...view };
}

describe("LinkPicker", () => {
  beforeEach(() => {
    setAdminLang("en");
    vi.clearAllMocks();
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    listCollections.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    listCategories.mockResolvedValue([]);
    listLandingPages.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    getProduct.mockReset();
    getProduct.mockRejectedValue(new Error("not found"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("searches products and stores {type:'PRODUCT', id}", async () => {
    vi.useFakeTimers();
    listProducts.mockResolvedValue({
      items: [productRow("p1", "Oak Side Table")],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const { onChange } = renderPicker();

    fireEvent.change(screen.getByRole("combobox", { name: "Link type" }), {
      target: { value: "PRODUCT" },
    });
    // Initial load fires without a debounce delay.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20, search: undefined }),
    );

    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "oak" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(listProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "oak" }),
    );

    fireEvent.click(
      within(screen.getByLabelText("Pick a Product")).getByRole("button", {
        name: "Oak Side Table",
      }),
    );

    // The wire value the consumer receives is the complete PRODUCT link.
    expect(onChange).toHaveBeenLastCalledWith({ type: "PRODUCT", id: "p1" });
  });

  it("rejects an http:// external url and accepts https://", async () => {
    vi.useFakeTimers();
    const { onChange } = renderPicker();

    fireEvent.change(screen.getByRole("combobox", { name: "Link type" }), {
      target: { value: "EXTERNAL" },
    });
    const urlInput = screen.getByRole("textbox", {
      name: "External URL (https only)",
    });

    fireEvent.change(urlInput, { target: { value: "http://insecure.example" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // The type switch itself targets null; the invalid URL must never commit
    // any EXTERNAL value.
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "EXTERNAL" }),
    );
    expect(screen.getByText("Only https:// links are allowed.")).toBeVisible();

    fireEvent.change(urlInput, {
      target: { value: "https://example.com/landing" },
    });
    fireEvent.blur(urlInput);

    expect(onChange).toHaveBeenLastCalledWith({
      type: "EXTERNAL",
      url: "https://example.com/landing",
    });
    expect(screen.queryByText("Only https:// links are allowed.")).toBeNull();
  });

  it("clears the value back to null", () => {
    const { onChange } = renderPicker({
      value: { type: "EXTERNAL", url: "https://example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear link" }));

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("combobox", { name: "Link type" })).toHaveValue("");
  });

  it("shows the selected entity name from the loaded option list and the id fallback when not loaded", async () => {
    vi.useFakeTimers();
    listProducts.mockResolvedValue({
      items: [productRow("p1", "Oak Side Table")],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const first = renderPicker({ value: { type: "PRODUCT", id: "p1" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText(/Oak Side Table \(resolves to a storefront link\)/),
    ).toBeVisible();
    first.unmount();

    listLandingPages.mockResolvedValue({
      items: [landingRow("lp2", "10.10 Sale")],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderPicker({ value: { type: "LANDING", id: "missing-lp" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The id is shown honestly when the selected entity is not in the loaded list.
    expect(screen.getByText(/missing-lp \(resolves to a storefront link\)/)).toBeVisible();
  });

  it("resolves a PRODUCT name by targeted lookup when the id is not in the loaded list", async () => {
    vi.useFakeTimers();
    listProducts.mockResolvedValue({
      items: [productRow("p2", "Other Table")],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    getProduct.mockResolvedValue({ id: "p1", name: "Oak Side Table" });

    renderPicker({ value: { type: "PRODUCT", id: "p1" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getProduct).toHaveBeenCalledWith("p1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText(/Oak Side Table \(resolves to a storefront link\)/),
    ).toBeVisible();
  });

  it("hides the External option when allowExternal is false", () => {
    const first = renderPicker({ allowExternal: false });
    const select = screen.getByRole("combobox", { name: "Link type" });
    expect(within(select).queryByText("External URL")).toBeNull();
    first.unmount();

    renderPicker({ allowExternal: true });
    expect(
      within(screen.getByRole("combobox", { name: "Link type" })).getByText(
        "External URL",
      ),
    ).toBeVisible();
  });

  it("switches between entity types and to External", async () => {
    vi.useFakeTimers();
    listCollections.mockResolvedValue({
      items: [collectionRow("c1", "Living Room")],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    listCategories.mockResolvedValue([
      categoryNode("cat1", "Sofas"),
      categoryNode("cat2", "Nested"),
    ]);
    listLandingPages.mockResolvedValue({
      items: [landingRow("lp1", "10.10 Home Sale")],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const { onChange } = renderPicker();
    const select = screen.getByRole("combobox", { name: "Link type" });

    fireEvent.change(select, { target: { value: "COLLECTION" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(
      within(screen.getByLabelText("Pick a Collection")).getByRole("button", {
        name: "Living Room",
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ type: "COLLECTION", id: "c1" });

    fireEvent.change(screen.getByRole("combobox", { name: "Link type" }), {
      target: { value: "CATEGORY" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(
      within(screen.getByLabelText("Pick a Category")).getByRole("button", {
        name: "Sofas",
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ type: "CATEGORY", id: "cat1" });

    fireEvent.change(screen.getByRole("combobox", { name: "Link type" }), {
      target: { value: "LANDING" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(
      within(screen.getByLabelText("Pick a Landing page")).getByRole("button", {
        name: "10.10 Home Sale",
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ type: "LANDING", id: "lp1" });

    fireEvent.change(screen.getByRole("combobox", { name: "Link type" }), {
      target: { value: "EXTERNAL" },
    });
    expect(
      screen.getByRole("textbox", { name: "External URL (https only)" }),
    ).toBeVisible();
  });

  it("links to edit the product only when the value is a PRODUCT", async () => {
    vi.useFakeTimers();
    const first = renderPicker({ value: { type: "PRODUCT", id: "p1" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const link = screen.getByRole("link", { name: "Edit this product" });
    expect(link).toHaveAttribute("href", "/admin/products/p1/edit");
    expect(link).toHaveAttribute("target", "_blank");
    first.unmount();

    renderPicker({ value: { type: "COLLECTION", id: "c1" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("link", { name: "Edit this product" })).toBeNull();
  });
});

describe("LinkPicker i18n parity (Task 11 rename)", () => {
  it("renames the LANDING type key to LANDING in both dictionaries", () => {
    expect(zh.homepage_builder_link_type_LANDING).toBe("落地页");
    expect(en.homepage_builder_link_type_LANDING).toBe("Landing page");
    expect(
      (zh as Record<string, unknown>)["homepage_builder_link_type_LANDING_PAGE"],
    ).toBeUndefined();
    expect(
      (en as Record<string, unknown>)["homepage_builder_link_type_LANDING_PAGE"],
    ).toBeUndefined();
  });

  it("declares the new LinkPicker keys in both dictionaries with parity", () => {
    const keys = [
      "homepage_builder_link_search_placeholder" as const,
      "homepage_builder_link_pick_title" as const,
      "homepage_builder_link_empty_results" as const,
    ];
    for (const key of keys) {
      expect(zh[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });
});