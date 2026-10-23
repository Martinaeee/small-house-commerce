import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionsPanel } from "./CollectionsPanel";
import type { AdminCollectionRow, AdminProduct } from "@/lib/admin-api";

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

/** Only the fields the picker reads; the full AdminProduct shape is irrelevant here. */
function productRow(
  patch: Partial<AdminProduct> & { id: string; name: string },
): AdminProduct {
  return {
    slug: patch.id,
    productCode: null,
    description: null,
    tagline: null,
    status: "ACTIVE",
    images: [],
    variants: [],
    ...patch,
  } as unknown as AdminProduct;
}

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
    // ...and no product candidates are fetched for an automatic collection.
    expect(listProducts).not.toHaveBeenCalled();
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

describe("CollectionsPanel product picker", () => {
  it("pages through the whole product list instead of stopping at 20", async () => {
    listProducts.mockImplementation(({ page }: { page?: number }) => {
      if (page === 2) {
        return Promise.resolve({
          items: Array.from({ length: 6 }, (_, i) =>
            productRow({ id: `p-${21 + i}`, name: `Product ${21 + i}` }),
          ),
          total: 26,
          page: 2,
          pageSize: 100,
        });
      }
      return Promise.resolve({
        items: Array.from({ length: 20 }, (_, i) =>
          productRow({ id: `p-${i + 1}`, name: `Product ${i + 1}` }),
        ),
        total: 26,
        page: 1,
        pageSize: 100,
      });
    });

    await openProductsSection("Chairs & Stools");

    // The 26th product is only reachable through the second page.
    expect((await screen.findAllByText("Product 26")).length).toBeGreaterThan(0);
    expect(listProducts).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByText("共 26 个商品")).toBeInTheDocument();
    expect(screen.queryByText(/仅显示前 20 个/)).toBeNull();
  });

  it("shows each product's SKU codes, never the internal product code", async () => {
    listProducts.mockResolvedValue({
      items: [
        productRow({
          id: "p-1",
          name: "Chair with SKUs",
          productCode: "P-000001",
          variants: [
            {
              id: "v-1",
              name: "Red",
              position: 0,
              sku: { id: "s-1", skuCode: "CHR-RED", status: "ACTIVE" },
            },
            {
              id: "v-2",
              name: "Blue",
              position: 1,
              sku: { id: "s-2", skuCode: "CHR-BLU", status: "ACTIVE" },
            },
          ] as unknown as AdminProduct["variants"],
        }),
        productRow({ id: "p-2", name: "Chair without SKU", productCode: "P-000002" }),
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });

    await openProductsSection("Chairs & Stools");

    expect(await screen.findByText("CHR-RED, CHR-BLU")).toBeInTheDocument();
    const noSkuRow = screen.getAllByText("Chair without SKU")[0].closest("li") as HTMLElement;
    expect(within(noSkuRow).getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/P-00000/)).toBeNull();
  });

  it("keeps the newest search result when an older response arrives later", async () => {
    let resolveFirst!: (value: {
      items: AdminProduct[];
      total: number;
      page: number;
      pageSize: number;
    }) => void;
    listProducts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    listProducts.mockResolvedValueOnce({
      items: [productRow({ id: "p-chair", name: "Dining Chair" })],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    await openProductsSection("Chairs & Stools");

    fireEvent.change(screen.getByLabelText("搜索商品"), {
      target: { value: "chair" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    const diningChairMatches = await screen.findAllByText("Dining Chair");
    expect(diningChairMatches.length).toBeGreaterThan(0);

    await act(async () => {
      resolveFirst({
        items: [productRow({ id: "p-old", name: "Stale Table" })],
        total: 1,
        page: 1,
        pageSize: 100,
      });
    });

    expect(screen.getAllByText("Dining Chair").length).toBeGreaterThan(0);
    expect(screen.queryByText("Stale Table")).toBeNull();
  });
});
