import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedGroupsDraft } from "./UnifiedGroupsDraft";
import type {
  AdminCategoryNode,
  AdminCollectionRow,
  AdminProduct,
} from "@/lib/admin-api";

const listCategories = vi.hoisted(() => vi.fn());
const listCollections = vi.hoisted(() => vi.fn());
const listProducts = vi.hoisted(() => vi.fn());
const getCollectionProducts = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api", () => ({
  adminApi: { listCategories, listCollections, listProducts },
}));
vi.mock("@/lib/api", () => ({ api: { getCollectionProducts } }));

function category(
  patch: Partial<AdminCategoryNode> & { id: string; name: string; slug: string },
): AdminCategoryNode {
  return {
    parentId: null,
    sortOrder: 0,
    imageUrl: null,
    status: "ACTIVE",
    heroStyle: null,
    children: [],
    ...patch,
  };
}

function collection(
  patch: Partial<AdminCollectionRow> & { id: string; name: string; slug: string },
): AdminCollectionRow {
  return {
    type: "MARKETING",
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

function product(
  patch: Pick<AdminProduct, "id" | "name" | "categoryId"> & {
    status?: AdminProduct["status"];
  },
): AdminProduct {
  return {
    slug: patch.id,
    productCode: null,
    description: null,
    tagline: null,
    status: patch.status ?? "ACTIVE",
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
    createdAt: "",
    updatedAt: "",
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: [],
    detailBlocks: [],
    variants: [],
    ...patch,
  } as unknown as AdminProduct;
}

const SHELVING = category({
  id: "cat-shelving",
  parentId: "cat-storage",
  name: "Shelving & Racks",
  slug: "shelving-racks",
  sortOrder: 1,
});
const STORAGE = category({
  id: "cat-storage",
  name: "Storage & Organization",
  slug: "storage-organization",
  sortOrder: 2,
  children: [SHELVING],
});

const PRODUCTS = [
  product({ id: "p1", name: "Root Shelf", categoryId: "cat-storage" }),
  product({ id: "p2", name: "Rack", categoryId: "cat-shelving" }),
  product({ id: "p3", name: "Draft Shelf", categoryId: "cat-storage", status: "DRAFT" }),
  product({ id: "p4", name: "New Arrival Chair", categoryId: "cat-storage" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  listCategories.mockResolvedValue([STORAGE]);
  listCollections.mockResolvedValue({
    items: [
      collection({
        id: "col-storage",
        name: "Storage & Organization",
        slug: "storage-organization",
        type: "NAVIGATION",
        sortOrder: 2,
        _count: { products: 1 },
      }),
      collection({
        id: "col-new",
        name: "New Arrivals",
        slug: "new-arrivals",
        sortOrder: 7,
        _count: { products: 2 },
      }),
    ],
    total: 2,
    page: 1,
    pageSize: 100,
  });
  listProducts.mockResolvedValue({
    items: PRODUCTS,
    total: PRODUCTS.length,
    page: 1,
    pageSize: 100,
  });
  getCollectionProducts.mockImplementation((slug: string) =>
    Promise.resolve({
      items:
        slug === "storage-organization"
          ? [{ id: "p2" }, { id: "p4" }]
          : [{ id: "p1" }, { id: "p4" }],
      total: 2,
      page: 1,
      pageSize: 24,
    }),
  );
});

async function renderDraft() {
  render(<UnifiedGroupsDraft />);
  await screen.findByText("商品分组（统一草稿）");
}

describe("UnifiedGroupsDraft", () => {
  it("shows one merged category row with direct/subtree/active counts", async () => {
    await renderDraft();

    // storage-organization appears once (merged), not as a separate collection.
    expect(screen.getAllByText("Storage & Organization")).toHaveLength(1);
    const storageRow = screen
      .getByText("Storage & Organization")
      .closest("tr") as HTMLElement;
    expect(within(storageRow).getByText(/含子类 4/)).toBeInTheDocument();
    expect(within(storageRow).getByText(/在售 3/)).toBeInTheDocument();
    expect(screen.getByText("New Arrivals")).toBeInTheDocument();
  });

  it("switches tabs between all groups, categories and marketing collections", async () => {
    await renderDraft();

    fireEvent.click(screen.getByRole("button", { name: "营销集合" }));
    expect(screen.getByText("New Arrivals")).toBeInTheDocument();
    expect(screen.queryByText("Storage & Organization")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "商品分类" }));
    expect(screen.getByText("Storage & Organization")).toBeInTheDocument();
    expect(screen.queryByText("New Arrivals")).toBeNull();
  });

  it("expands a category and opens the unified editor with primary/member rows", async () => {
    await renderDraft();

    fireEvent.click(screen.getByRole("button", { name: "展开子分组 Storage & Organization" }));
    expect(screen.getByText("Shelving & Racks")).toBeInTheDocument();

    const storageRow = screen
      .getByText("Storage & Organization")
      .closest("tr") as HTMLElement;
    fireEvent.click(within(storageRow).getByRole("button", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("商品名单")).toBeInTheDocument();
    expect(within(dialog).getByText("子分类商品数")).toBeInTheDocument();
    expect(within(dialog).getAllByText("主分组").length).toBeGreaterThan(0);

    // A member that is already in the primary subtree is still listed once.
    await waitFor(() => expect(within(dialog).getByText("Rack")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "保存（演示）" }));
    expect(await screen.findByText(/演示模式/)).toBeInTheDocument();
  });
});
