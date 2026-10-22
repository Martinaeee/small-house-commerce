import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionsPanel } from "./CollectionsPanel";
import type { AdminCollectionRow } from "@/lib/admin-api";

const listCollections = vi.hoisted(() => vi.fn());
const listProducts = vi.hoisted(() => vi.fn());
const updateCollection = vi.hoisted(() => vi.fn());
const setCollectionProducts = vi.hoisted(() => vi.fn());
const getCollectionProducts = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: { listCollections, listProducts, updateCollection, setCollectionProducts },
}));
vi.mock("@/lib/api", () => ({ api: { getCollectionProducts } }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({ status: "authed", hasPermission: () => true }),
}));

function collectionRow(
  patch: Partial<AdminCollectionRow> & { id: string; name: string; slug: string },
): AdminCollectionRow {
  return {
    type: "NAVIGATION",
    description: null,
    seoTitle: null,
    seoDescription: null,
    status: "ACTIVE",
    sortOrder: 0,
    heroImage: null,
    heroStyle: null,
    _count: { products: 0 },
    ...patch,
  };
}

const ALL_PRODUCTS = collectionRow({
  id: "collection-all",
  name: "All Products",
  slug: "all-products",
  type: "SYSTEM",
  sortOrder: 8,
});
const CHAIRS = collectionRow({
  id: "collection-chairs",
  name: "Chairs & Stools",
  slug: "chairs-stools",
  sortOrder: 4,
});

beforeEach(() => {
  vi.clearAllMocks();
  listCollections.mockResolvedValue({
    items: [ALL_PRODUCTS, CHAIRS],
    total: 2,
    page: 1,
    pageSize: 100,
  });
  listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  getCollectionProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 48 });
  updateCollection.mockResolvedValue(ALL_PRODUCTS);
  setCollectionProducts.mockResolvedValue(undefined);
});

async function openProductsSection(collectionName: string) {
  render(<CollectionsPanel />);
  const nameCell = await screen.findByText(collectionName);
  const row = nameCell.closest("tr");
  if (!row) throw new Error(`row for ${collectionName} not found`);
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "编辑" }));
  const tabs = await screen.findByRole("tablist", { name: "编辑集合分区" });
  fireEvent.click(within(tabs).getByRole("tab", { name: "商品名单" }));
}

describe("CollectionsPanel All Products", () => {
  it("shows 全部 in the count column instead of a misleading zero", async () => {
    render(<CollectionsPanel />);
    const nameCell = await screen.findByText("All Products");
    const row = nameCell.closest("tr") as HTMLElement;
    expect(within(row).getByText("全部")).toBeInTheDocument();
    // A normal collection keeps the numeric count.
    const chairsRow = screen.getByText("Chairs & Stools").closest("tr") as HTMLElement;
    expect(within(chairsRow).getByText("0")).toBeInTheDocument();
  });

  it("explains the automatic membership instead of offering a picker", async () => {
    await openProductsSection("All Products");

    expect(await screen.findByTestId("all-products-automatic")).toHaveTextContent(
      "全部在售商品",
    );
    // The hand-maintained list is pointless here: no add/search UI.
    expect(screen.queryByText("添加商品")).toBeNull();
    expect(screen.queryByText(/当前名单/)).toBeNull();
  });

  it("saves without writing a membership list for All Products", async () => {
    await openProductsSection("All Products");

    fireEvent.click(screen.getByRole("button", { name: "保存全部" }));

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    expect(setCollectionProducts).not.toHaveBeenCalled();
    expect(await screen.findByText(/已保存/)).toBeInTheDocument();
  });

  it("keeps the membership editor for a normal collection", async () => {
    await openProductsSection("Chairs & Stools");

    expect(await screen.findByText(/当前名单/)).toBeInTheDocument();
    expect(screen.getByText("添加商品")).toBeInTheDocument();
    expect(screen.queryByTestId("all-products-automatic")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "保存全部" }));
    await waitFor(() => expect(setCollectionProducts).toHaveBeenCalledWith("collection-chairs", []));
  });
});
