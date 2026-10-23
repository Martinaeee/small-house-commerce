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
    images?: AdminProduct["images"];
    variants?: { sku?: { skuCode?: string | null } | null }[];
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

function image(id: string, url: string): AdminProduct["images"] {
  return [{ id, url, type: "IMAGE", altText: null, sortOrder: 1 }];
}

const PRODUCTS = [
  product({
    id: "p1",
    name: "Root Shelf",
    categoryId: "cat-storage",
    images: image("img-root", "https://cdn.test/root.jpg"),
    variants: [{ sku: { skuCode: "SH-ROOT-01" } }],
  }),
  product({
    id: "p2",
    name: "Rack",
    categoryId: "cat-shelving",
    images: image("img-rack", "https://cdn.test/rack.jpg"),
    variants: [{ sku: { skuCode: "SH-RACK-02" } }],
  }),
  product({
    id: "p3",
    name: "Draft Shelf",
    categoryId: "cat-storage",
    status: "DRAFT",
    images: image("img-draft", "https://cdn.test/draft.jpg"),
    variants: [{ sku: { skuCode: "SH-DRAFT-03" } }],
  }),
  product({
    id: "p4",
    name: "Member Chair",
    categoryId: "cat-other",
    images: image("img-chair", "https://cdn.test/chair.jpg"),
    variants: [{ sku: { skuCode: "SH-CHAIR-04" } }],
  }),
  product({
    id: "p5",
    name: "Member Lamp",
    categoryId: "cat-other",
    images: image("img-lamp", "https://cdn.test/lamp.jpg"),
    variants: [{ sku: { skuCode: "SH-LAMP-05" } }],
  }),
  product({
    id: "p6",
    name: "Candidate Table",
    categoryId: "cat-other",
    images: image("img-table", "https://cdn.test/table.jpg"),
    variants: [{ sku: { skuCode: "SH-TABLE-06" } }],
  }),
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
          ? [{ id: "p2" }, { id: "p4" }, { id: "p5" }]
          : [{ id: "p1" }, { id: "p4" }],
      total: slug === "storage-organization" ? 3 : 2,
      page: 1,
      pageSize: 24,
    }),
  );
});

async function renderDraft() {
  render(<UnifiedGroupsDraft />);
  await screen.findByText("商品分组（统一草稿）");
}

async function openStorageEditor() {
  await renderDraft();
  fireEvent.click(screen.getByRole("button", { name: "展开子分组 Storage & Organization" }));
  const storageRow = screen.getByText("Storage & Organization").closest("tr") as HTMLElement;
  fireEvent.click(within(storageRow).getByRole("button", { name: "编辑" }));
  return screen.findByRole("dialog");
}

describe("UnifiedGroupsDraft", () => {
  it("shows one merged category row with direct/subtree/active counts", async () => {
    await renderDraft();

    // storage-organization appears once (merged), not as a separate collection.
    expect(screen.getAllByText("Storage & Organization")).toHaveLength(1);
    const storageRow = screen
      .getByText("Storage & Organization")
      .closest("tr") as HTMLElement;
    expect(within(storageRow).getByText(/含子类 5/)).toBeInTheDocument();
    expect(within(storageRow).getByText(/在售 4/)).toBeInTheDocument();
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
    fireEvent.click(within(dialog).getByRole("tab", { name: "商品名单" }));
    expect(within(dialog).getByText(/商品名单（共/)).toBeInTheDocument();
    expect(within(dialog).getByText("子分类商品数")).toBeInTheDocument();
    expect(within(dialog).getAllByText("主分组").length).toBeGreaterThan(0);

    // A member that is already in the primary subtree is shown once in the effective list.
    const memberList = within(dialog).getByLabelText("商品名单");
    await waitFor(() => expect(within(memberList).getByText("Rack")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "保存（演示）" }));
    expect(await screen.findByText(/演示模式/)).toBeInTheDocument();
  });

  it("sets parent categories apart from subcategories in the tree", async () => {
    await renderDraft();
    fireEvent.click(screen.getByRole("button", { name: "展开子分组 Storage & Organization" }));

    const parentRow = screen
      .getByText("Storage & Organization")
      .closest("tr") as HTMLElement;
    const childRow = screen.getByText("Shelving & Racks").closest("tr") as HTMLElement;

    expect(within(parentRow).getByText("Storage & Organization")).toHaveClass("font-semibold");
    expect(within(childRow).getByText("Shelving & Racks")).toHaveClass("font-normal");
  });

  it("uses the same three section tabs as the original collection dialog", async () => {
    const dialog = await openStorageEditor();

    expect(within(dialog).getByRole("tab", { name: "基本信息" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(dialog).getByDisplayValue("Storage & Organization")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("商品名单")).toBeNull();

    fireEvent.click(within(dialog).getByRole("tab", { name: "页面横幅" }));
    expect(within(dialog).getByText(/标题始终使用上方的名称/)).toBeInTheDocument();
    expect(within(dialog).getByText("整页预览（已保存版本）")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("商品名单")).toBeNull();

    fireEvent.click(within(dialog).getByRole("tab", { name: "商品名单" }));
    expect(within(dialog).getByLabelText("商品名单")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存（演示）" })).toBeInTheDocument();
  });

  it("keeps the original dialog's thumbnails, SKU codes, status and totals", async () => {
    const dialog = await openStorageEditor();
    fireEvent.click(within(dialog).getByRole("tab", { name: "商品名单" }));

    await waitFor(() => expect(within(dialog).getAllByText("SH-RACK-02")).toHaveLength(2));
    expect(within(dialog).getAllByText("SH-CHAIR-04")).toHaveLength(2);
    expect(within(dialog).getAllByText("SH-LAMP-05")).toHaveLength(2);
    expect(within(dialog).getAllByText("SH-TABLE-06")).toHaveLength(1);
    expect(dialog.querySelector('img[src="https://cdn.test/rack.jpg"]')).not.toBeNull();
    expect(dialog.querySelector('img[src="https://cdn.test/chair.jpg"]')).not.toBeNull();
    expect(dialog.querySelector('img[src="https://cdn.test/table.jpg"]')).not.toBeNull();
    expect(within(dialog).getByText(/共 6 个商品/)).toBeInTheDocument();
    expect(within(dialog).getAllByText("已在名单").length).toBeGreaterThan(0);
  });

  it("reorders explicit members with the arrow controls", async () => {
    const dialog = await openStorageEditor();
    fireEvent.click(within(dialog).getByRole("tab", { name: "商品名单" }));

    const down = await within(dialog).findByRole("button", { name: "下移 Member Chair" });
    expect(within(dialog).getByRole("button", { name: "上移 Member Chair" })).toBeDisabled();
    fireEvent.click(down);
    expect(within(dialog).getByRole("button", { name: "下移 Member Chair" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "上移 Member Chair" })).not.toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "上移 Member Lamp" })).toBeDisabled();
  });

  it("uses the product page's full-width, left-aligned shell", async () => {
    const { container } = render(<UnifiedGroupsDraft />);
    await screen.findByText("商品分组（统一草稿）");

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("w-full", "max-w-none");
    expect(root).not.toHaveClass("mx-auto");
    expect(container.querySelector(".max-w-\\[1200px\\]")).toBeNull();
  });

  it("shows the selected product's thumbnail and SKU in the assignment draft", async () => {
    await renderDraft();
    fireEvent.click(screen.getByRole("button", { name: "商品归属交互稿" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("SH-ROOT-01")).toBeInTheDocument();
    expect(dialog.querySelector('img[src="https://cdn.test/root.jpg"]')).not.toBeNull();
  });
});
