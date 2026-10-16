import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

/**
 * Regression cover for the admin edit form's server-truth mapping.
 *
 * The form adopts the PATCH response as its new server truth after every
 * save. When the backend returned the raw row (no inventory enrichment),
 * `String(sku.onHand)` produced "undefined", the stock validator rejected it,
 * and the Save button silently stopped sending anything — so every edit after
 * the first looked like it had no effect on the storefront.
 *
 * Task 4 adds page-level render/API coverage for the save orchestration
 * itself (Tasks 1–3 only reorganized the presentation around it): which
 * endpoint each kind of edit reaches, in what order, with which payload, and
 * what the page shows when a phase fails.
 */

const refreshMock = vi.fn();
const navigationState = vi.hoisted(() => ({ id: "p1", searchParams: "" }));
const productFormRender = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: navigationState.id }),
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigationState.searchParams),
}));

// The FAQ tab previews the shared library; keep this suite off the network.
vi.mock("@/lib/faq-api", () => ({
  faqApi: { getSharedPreview: () => Promise.resolve({ items: [] }) },
}));

vi.mock("@/components/admin/ProductForm", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/admin/ProductForm")
  >();
  const React = await import("react");
  return {
    ...actual,
    ProductForm: (props: Parameters<typeof actual.ProductForm>[0]) => {
      productFormRender(props);
      return React.createElement(actual.ProductForm, props);
    },
  };
});

const getProduct = vi.fn();
const listCategories = vi.fn();
const updateProduct = vi.fn();
const setStock = vi.fn();
const setStockBatch = vi.fn();
const listProductLandingPages = vi.fn();
const getBundleComponents = vi.fn();
const searchBundleSkus = vi.fn();
const setBundleComponents = vi.fn();

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    getProduct: (...args: unknown[]) => getProduct(...args),
    listCategories: (...args: unknown[]) => listCategories(...args),
    updateProduct: (...args: unknown[]) => updateProduct(...args),
    setStock: (...args: unknown[]) => setStock(...args),
    setStockBatch: (...args: unknown[]) => setStockBatch(...args),
    listProductLandingPages: (...args: unknown[]) =>
      listProductLandingPages(...args),
    getBundleComponents: (...args: unknown[]) => getBundleComponents(...args),
    searchBundleSkus: (...args: unknown[]) => searchBundleSkus(...args),
    setBundleComponents: (...args: unknown[]) => setBundleComponents(...args),
  },
  formatAmount: (value: unknown) =>
    value === null || value === undefined ? "—" : `₱${value}`,
}));

import EditProductPage from "@/app/admin/(shell)/products/[id]/edit/page";
import { buildSavedPreview, deserializeProduct } from "@/lib/admin-product-graph";
import type { AdminCategoryNode, AdminProduct } from "@/lib/admin-api";

const CATEGORY = {
  id: "018f0000-0000-7000-8000-0000000000c1",
  parentId: null,
  name: "Living",
  slug: "living",
  sortOrder: 0,
  imageUrl: null,
  status: "ACTIVE",
  heroStyle: null,
  children: [],
} as AdminCategoryNode;

function skuOf(
  id: string,
  skuCode: string,
  onHand: number,
): NonNullable<AdminProduct["variants"][number]["sku"]> {
  return {
    id,
    skuCode,
    status: "ACTIVE",
    isBundle: false,
    bundleVersion: 0,
    supplierId: null,
    supplierSku: null,
    supplierCost: null,
    costCurrency: null,
    landedCost: null,
    price: "1299",
    compareAtPrice: null,
    productWidth: null, productDepth: null, productHeight: null, productWeight: null,
    packageWidth: null,
    packageHeight: null,
    packageDepth: null,
    packageWeight: null,
    volumetricWeight: null,
    onHand,
    reserved: 1,
    availableInventory: onHand - 1,
  };
}

/**
 * Legacy-v0 payload: no typed graph on the wire (no `options`/`media`), one
 * free-form variant. This is the shape the pre-graph backend still serves and
 * the one that keeps the per-SKU stock endpoint.
 */
function legacyProduct(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: "p1",
    productCode: "P-000042",
    name: "Chair",
    slug: "chair",
    description: null,
    tagline: null,
    categoryId: CATEGORY.id,
    status: "DRAFT",
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
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: [],
    detailBlocks: [],
    variants: [
      { id: "variant-1", name: "Default", position: 0, sku: skuOf("sku-1", "SH-1", 4) },
    ],
    ...overrides,
  } as AdminProduct;
}

const COLOR_OPTION = {
  id: "option-1",
  kind: "COLOR",
  name: "Color",
  position: 0,
  presentation: "TEXT",
  isMediaDriver: false,
  isActive: true,
  values: [
    {
      id: "value-1",
      label: "Default",
      position: 0,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
      isActive: true,
    },
    {
      id: "value-2",
      label: "Blue",
      position: 1,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
      isActive: true,
    },
  ],
} as unknown as NonNullable<AdminProduct["options"]>[number];

function graphVariant(
  id: string,
  name: string,
  optionValueId: string,
  sku: NonNullable<AdminProduct["variants"][number]["sku"]> | null,
): AdminProduct["variants"][number] {
  return {
    id,
    name,
    position: 0,
    // null → the adapter derives the canonical key from the assignments.
    combinationKey: null,
    optionValues: [{ optionId: "option-1", optionValueId }],
    sku,
    hasReferences: false,
  } as AdminProduct["variants"][number];
}

/**
 * Graph-aware payload: `options`/`media` present (so the form renders the
 * typed editors and the graph owns variants/media) with a non-zero
 * catalogGraphVersion, so every write must carry the optimistic revision.
 */
function typedProduct(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return legacyProduct({
    status: "ACTIVE",
    catalogGraphVersion: 3,
    defaultDisplayVariantId: "variant-1",
    options: [COLOR_OPTION],
    media: [],
    variants: [
      graphVariant("variant-1", "Default", "value-1", skuOf("sku-1", "SH-1", 4)),
      graphVariant("variant-2", "Blue", "value-2", skuOf("sku-2", "SH-BLUE", 2)),
    ],
    ...overrides,
  });
}

function renderEditPage() {
  return render(
    <AdminI18nProvider>
      <EditProductPage />
    </AdminI18nProvider>,
  );
}

/** The form renders only after product + categories settle. */
async function waitForForm(): Promise<void> {
  await screen.findByRole("tab", { name: "基本信息" });
}

async function clickSave(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
}

async function openVariantsTab(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("tab", { name: "选项、价格与库存" }));
}

async function setInput(
  user: ReturnType<typeof userEvent.setup>,
  element: HTMLElement,
  text: string,
): Promise<void> {
  await user.clear(element);
  await user.type(element, text);
}

describe("deserializeProduct — scene identity", () => {
  it("keeps image ids, scene flags and unique stored sort orders on hydration", () => {
    const product = legacyProduct({ images: [
      { id: "photo-a", url: "/uploads/a.webp", type: "IMAGE", altText: null, sortOrder: 2 },
      { id: "photo-b", url: "/uploads/b.webp", type: "IMAGE", altText: null, sortOrder: 5, isScene: true },
    ] });
    expect(deserializeProduct(product).images).toEqual([
      { id: "photo-a", url: "/uploads/a.webp", type: "IMAGE", altText: "", sortOrder: "2", isScene: false },
      { id: "photo-b", url: "/uploads/b.webp", type: "IMAGE", altText: "", sortOrder: "5", isScene: true },
    ]);
  });

  it("retains the existing repair of duplicate stored sort orders", () => {
    const product = legacyProduct({ images: [
      { id: "photo-a", url: "/uploads/a.webp", type: "IMAGE", altText: null, sortOrder: 4 },
      { id: "photo-b", url: "/uploads/b.webp", type: "IMAGE", altText: null, sortOrder: 4 },
    ] });
    expect(deserializeProduct(product).images.map(row => row.sortOrder)).toEqual(["0", "1"]);
  });
});

describe("deserializeProduct — stock", () => {
  it("maps the inventory figures into the editable stock box", () => {
    const value = deserializeProduct(legacyProduct());

    expect(value.variants[0].sku?.stock).toBe("4");
    expect(value.variants[0].sku?.reserved).toBe("1");
  });

  it("falls back to an empty box when the response carries no inventory figures", () => {
    // A response without onHand must not become the string "undefined" —
    // that fails validateStockEntry and blocks every later save.
    const product = legacyProduct();
    const sku = product.variants[0].sku as unknown as Record<string, unknown>;
    delete sku.onHand;
    delete sku.reserved;

    const value = deserializeProduct(product);

    expect(value.variants[0].sku?.stock).toBe("");
    expect(value.variants[0].sku?.reserved).toBe("");
  });
});

describe("edit page saved preview", () => {
  it("uses only the server product slug and status", () => {
    expect(
      buildSavedPreview(
        legacyProduct({ slug: "server-slug", status: "ACTIVE" }),
      ),
    ).toEqual({
      path: "/products/server-slug",
      status: "ACTIVE",
      variants: [
        { id: "variant-1", name: "Default", skuStatus: "ACTIVE" },
      ],
    });
  });
});

describe("EditProductPage save orchestration", () => {
  beforeEach(() => {
    setAdminLang("zh");
    navigationState.id = "p1";
    navigationState.searchParams = "";
    productFormRender.mockReset();
    refreshMock.mockReset();
    getProduct.mockReset();
    listCategories.mockReset().mockResolvedValue([CATEGORY]);
    updateProduct.mockReset();
    setStock
      .mockReset()
      .mockResolvedValue({ onHand: 0, reserved: 0, available: 0 });
    setStockBatch.mockReset();
    listProductLandingPages.mockReset().mockResolvedValue([]);
    getBundleComponents.mockReset().mockResolvedValue({ version: 4, components: [{ id: "binding", componentSkuId: "chair", quantity: 2, position: 0, componentSkuCode: "CHAIR", componentProductName: "Chair", componentVariantName: "Black", availableInventory: 9, status: "ACTIVE", productStatus: "ACTIVE", isBundle: false }], availableInventory: 4 });
    searchBundleSkus.mockReset().mockResolvedValue([{ id: "chair", skuCode: "CHAIR", productId: "other", productName: "Chair", variantName: "Black", availableInventory: 9 }]);
    setBundleComponents.mockReset().mockResolvedValue({ version: 5, components: [], availableInventory: 0 });
  });

  afterEach(cleanup);

  it.each(["DRAFT", "ACTIVE"] as const)("submits a newly assigned legacy-v0 cover when saving as %s", async (status) => {
    const user = userEvent.setup();
    const images = [{ id: "photo-a", url: "/uploads/desk.webp", type: "IMAGE" as const, altText: "Desk cover", sortOrder: 0, isScene: true }];
    const product = legacyProduct({ images, variants: [{ id: "variant-1", name: "Walnut & Black", position: 0, cardMedia: null, sku: skuOf("sku-1", "TB006", 4) }] });
    const cover = { cover: { type: "IMAGE" as const, url: "/uploads/desk.webp", altText: "Desk cover" }, hover: null };
    const saved = typedProduct({
      status, catalogGraphVersion: 1, images,
      options: [{ ...COLOR_OPTION, values: [{ ...COLOR_OPTION.values[0], label: "Walnut & Black" }] }],
      variants: [{ ...graphVariant("variant-1", "Walnut & Black", "value-1", skuOf("sku-1", "TB006", 4)), cardMedia: cover }],
      media: images.map(image => ({ ...image, optionValueId: null, variantId: null })),
    });
    getProduct.mockResolvedValue(product);
    updateProduct.mockResolvedValue(saved);
    renderEditPage();
    await waitForForm();
    await user.selectOptions(screen.getByRole("combobox", { name: "商品状态" }), status);
    await user.click(screen.getByRole("tab", { name: "商品媒体" }));
    await user.click(screen.getByRole("button", { name: "Walnut & Black 卡片封面：从图库选择" }));
    await user.click(screen.getByRole("button", { name: "选择图片 1" }));
    await clickSave(user);

    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    const body = updateProduct.mock.calls[0]![1];
    expect(body.catalogGraphVersion).toBe(0);
    expect(body.catalogGraph.options).toHaveLength(1);
    expect(body.catalogGraph.options[0]).toHaveProperty("clientKey");
    expect(body.catalogGraph.options[0]).not.toHaveProperty("id");
    expect(body.catalogGraph.options[0].values[0]).toMatchObject({ label: "Walnut & Black", clientKey: expect.any(String) });
    expect(body.catalogGraph.options[0].values[0]).not.toHaveProperty("id");
    expect(body.catalogGraph.variants).toEqual([expect.objectContaining({
      id: "variant-1", cardMedia: cover,
      sku: expect.objectContaining({ skuCode: "TB006", price: 1299 }),
      optionValueRefs: [{ clientKey: body.catalogGraph.options[0].values[0].clientKey }],
    })]);
    expect(body.catalogGraph.media).toEqual([]);
    expect(body.catalogGraph.retirements.variantIds).toEqual([]);
    expect(body.catalogGraph.retirements.mediaIds).toEqual([]);
    expect(body).not.toHaveProperty("variants");
    expect(body).not.toHaveProperty("images");
    expect(setStockBatch).not.toHaveBeenCalled();
    expect(setStock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: /^保存/ })).toBeEnabled());
    await clickSave(user);
    expect(updateProduct).toHaveBeenCalledTimes(1);
  });

  it("maps every legacy sibling by its saved identity during cover materialization", async () => {
    const user = userEvent.setup();
    const images = [{ id: "photo-a", url: "/uploads/desk.webp", type: "IMAGE" as const, altText: null, sortOrder: 0, isScene: true }];
    const siblingCard = { cover: { type: "IMAGE" as const, url: "/uploads/black.webp", altText: "Black" }, hover: null };
    const siblingSku = { ...skuOf("sku-2", "TB007", 8), packageWidth: 90, packageWeight: 14, supplierCost: "50", costCurrency: "CNY" };
    const product = legacyProduct({ images, variants: [
      { id: "variant-1", name: "Walnut & Black", position: 0, sku: skuOf("sku-1", "TB006", 4) },
      { id: "variant-2", name: "Black", position: 1, sku: siblingSku, cardMedia: siblingCard },
    ] });
    getProduct.mockResolvedValue(product);
    updateProduct.mockResolvedValue(product);
    renderEditPage();
    await waitForForm();
    await user.click(screen.getByRole("tab", { name: "商品媒体" }));
    await user.click(screen.getByRole("button", { name: "Walnut & Black 卡片封面：从图库选择" }));
    await user.click(screen.getByRole("button", { name: "选择图片 1" }));
    await clickSave(user);
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    const graph = updateProduct.mock.calls[0]![1].catalogGraph;
    expect(graph.variants.map((row: { id: string }) => row.id)).toEqual(["variant-1", "variant-2"]);
    expect(graph.variants[1]).toMatchObject({ id: "variant-2", cardMedia: siblingCard, sku: { skuCode: "TB007", packageWidth: 90, packageWeight: 14, supplierCost: 50, costCurrency: "CNY" } });
    expect(graph.media).toEqual([]);
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("writes changed legacy stock only after the cover graph has saved", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const product = legacyProduct({ images: [{ id: "photo", url: "/uploads/desk.webp", type: "IMAGE", altText: null, sortOrder: 0 }] });
    getProduct.mockResolvedValue(product);
    updateProduct.mockImplementation(async () => { order.push("graph"); return product; });
    setStockBatch.mockImplementation(async () => { order.push("stock"); return [{ skuId: "sku-1", ok: true, onHand: 6, reserved: 1, available: 5 }]; });
    renderEditPage();
    await waitForForm();
    await user.click(screen.getByRole("tab", { name: "商品媒体" }));
    await user.click(screen.getByRole("button", { name: "Default 卡片封面：从图库选择" }));
    await user.click(screen.getByRole("button", { name: "选择图片 1" }));
    await openVariantsTab(user);
    await setInput(user, screen.getByLabelText("Default 的库存"), "6");
    await clickSave(user);
    await waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["graph", "stock"]);
    expect(setStockBatch).toHaveBeenCalledWith([{ skuId: "sku-1", onHand: 6, reason: "Product form" }]);
    expect(setStock).not.toHaveBeenCalled();
  });

  it("saves a newly materialized Bundle definition only after its real SKU identity exists", async () => {
    const user = userEvent.setup();
    const product = typedProduct({ status: "DRAFT" });
    product.variants[1].sku = null;
    const saved = structuredClone(product);
    saved.catalogGraphVersion = 4;
    saved.variants[1].sku = { ...skuOf("real-bundle", "SET-BLUE", 0), isBundle: true, bundleVersion: 0 };
    getProduct.mockResolvedValue(product);
    let finishGraph!: (value: AdminProduct) => void;
    updateProduct.mockImplementation(() => new Promise(resolve => { finishGraph = resolve; }));
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);
    await user.type(screen.getByLabelText("Blue 的 SKU 编码"), "SET-BLUE");
    await user.type(screen.getByLabelText("Blue 的售价"), "2499");
    await user.click(screen.getByRole("checkbox", { name: "Blue 的虚拟 Bundle 模式" }));
    await user.click(screen.getByRole("button", { name: "搜索 SKU" }));
    await user.click(await screen.findByRole("button", { name: "添加 CHAIR" }));
    await clickSave(user);
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(setBundleComponents).not.toHaveBeenCalled();
    finishGraph(saved);
    await waitFor(() => expect(setBundleComponents).toHaveBeenCalledWith("p1", "real-bundle", { expectedVersion: 0, components: [{ componentSkuId: "chair", quantity: 1, position: 0 }] }));
    expect(setStock).not.toHaveBeenCalled();
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("uses the latest edited draft once after a newly materialized definition failed", async () => {
    const user = userEvent.setup();
    const product = typedProduct({ status: "DRAFT" });
    product.variants[1].sku = null;
    const saved = structuredClone(product);
    saved.catalogGraphVersion = 4;
    saved.variants[1].sku = { ...skuOf("real-bundle", "SET-BLUE", 0), isBundle: true, bundleVersion: 0 };
    getProduct.mockResolvedValueOnce(product).mockResolvedValue(saved);
    updateProduct.mockResolvedValue(saved);
    getBundleComponents.mockResolvedValue({ version: 0, components: [], availableInventory: 0 });
    setBundleComponents.mockRejectedValueOnce(new Error("Temporary failure"));
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);
    await user.type(screen.getByLabelText("Blue 的 SKU 编码"), "SET-BLUE");
    await user.type(screen.getByLabelText("Blue 的售价"), "2499");
    await user.click(screen.getByRole("checkbox", { name: "Blue 的虚拟 Bundle 模式" }));
    await user.click(screen.getByRole("button", { name: "搜索 SKU" }));
    await user.click(await screen.findByRole("button", { name: "添加 CHAIR" }));
    await clickSave(user);
    await screen.findByText(/组件未保存/);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Blue 的虚拟 Bundle 模式" })).toBeDisabled());
    await user.click(screen.getByRole("button", { name: "搜索 SKU" }));
    await user.click(await screen.findByRole("button", { name: "添加 CHAIR" }));
    await setInput(user, screen.getByLabelText("CHAIR 的组件数量"), "3");
    await clickSave(user);
    await waitFor(() => expect(screen.queryByRole("button", { name: "重试失败的 Bundle 组件" })).not.toBeInTheDocument());
    expect(setBundleComponents).toHaveBeenCalledTimes(2);
    expect(setBundleComponents.mock.calls[1]).toEqual(["p1", "real-bundle", { expectedVersion: 0, components: [{ componentSkuId: "chair", quantity: 3, position: 0 }] }]);
    expect(updateProduct).toHaveBeenCalledTimes(1);
  });

  it("clears the previous product's failed Bundle queue during client navigation", async () => {
    const user = userEvent.setup();
    const product = typedProduct({ status: "DRAFT" });
    Object.assign(product.variants[0].sku!, { isBundle: true, bundleVersion: 4 });
    getProduct.mockResolvedValue(product);
    setBundleComponents.mockRejectedValue(new Error("Temporary failure"));
    const view = renderEditPage();
    await waitForForm();
    await openVariantsTab(user);
    await setInput(user, await screen.findByLabelText("CHAIR 的组件数量"), "3");
    await clickSave(user);
    await screen.findByRole("button", { name: "重试失败的 Bundle 组件" });
    await waitFor(() => expect(document.querySelector('button[type="submit"]')).toBeEnabled());
    getProduct.mockResolvedValue(typedProduct({ id: "p2", name: "Desk", status: "DRAFT" }));
    navigationState.id = "p2";
    view.rerender(<AdminI18nProvider><EditProductPage /></AdminI18nProvider>);
    await screen.findByDisplayValue("Desk");
    expect(screen.queryByRole("button", { name: "重试失败的 Bundle 组件" })).not.toBeInTheDocument();
    expect(screen.queryByText(/组件未保存/)).not.toBeInTheDocument();
    await clickSave(user);
    expect(setBundleComponents).toHaveBeenCalledTimes(1);
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("saves a component-only edit without a product no-op or physical stock write", async () => {
    const user = userEvent.setup();
    const product = typedProduct({ status: "DRAFT" });
    Object.assign(product.variants[0].sku!, { isBundle: true, bundleVersion: 4 });
    getProduct.mockResolvedValue(product);
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);
    await screen.findByText("Chair / Black");
    await setInput(user, screen.getByLabelText("CHAIR 的组件数量"), "3");
    await clickSave(user);
    await waitFor(() => expect(setBundleComponents).toHaveBeenCalledWith("p1", "sku-1", { expectedVersion: 4, components: [{ componentSkuId: "chair", quantity: 3, position: 0 }] }));
    expect(updateProduct).not.toHaveBeenCalled();
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("shows a partial result and retries only the failed Bundle definition", async () => {
    const user = userEvent.setup();
    const product = typedProduct({ status: "DRAFT" });
    Object.assign(product.variants[0].sku!, { isBundle: true, bundleVersion: 4 });
    getProduct.mockResolvedValue(product);
    setBundleComponents.mockRejectedValueOnce(new Error("Version conflict"));
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);
    await screen.findByText("Chair / Black");
    await setInput(user, screen.getByLabelText("CHAIR 的组件数量"), "3");
    await clickSave(user);
    expect(await screen.findByText(/组件未保存/)).toBeVisible();
    expect(refreshMock).not.toHaveBeenCalled();
    const retry = await screen.findByRole("button", { name: "重试失败的 Bundle 组件" });
    await user.click(retry);
    await waitFor(() => expect(setBundleComponents).toHaveBeenCalledTimes(2));
    expect(setBundleComponents.mock.calls[1]).toEqual(["p1", "sku-1", { expectedVersion: 4, components: [{ componentSkuId: "chair", quantity: 3, position: 0 }] }]);
    expect(updateProduct).not.toHaveBeenCalled();
    expect(setStockBatch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "重试失败的 Bundle 组件" })).not.toBeInTheDocument());
  });

  it("does not resubmit successful definitions after a partial multi-Bundle save", async () => {
    const user = userEvent.setup();
    const product = typedProduct({ status: "DRAFT" });
    product.variants.forEach(row => Object.assign(row.sku!, { isBundle: true, bundleVersion: 4 }));
    const fresh = structuredClone(product);
    fresh.variants[0].sku!.bundleVersion = 5;
    getProduct.mockResolvedValueOnce(product).mockResolvedValue(fresh);
    setBundleComponents.mockResolvedValueOnce({ version: 5 }).mockRejectedValueOnce(new Error("Second definition failed"));
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);
    const quantities = await screen.findAllByLabelText("CHAIR 的组件数量");
    await setInput(user, quantities[0], "3");
    await setInput(user, quantities[1], "4");
    await clickSave(user);
    await screen.findByText(/组件未保存/);
    await waitFor(() => expect(document.querySelector('button[type="submit"]')).toBeEnabled());
    await clickSave(user);
    await waitFor(() => expect(setBundleComponents).toHaveBeenCalledTimes(3));
    expect(setBundleComponents.mock.calls.map(call => call[1])).toEqual(["sku-1", "sku-2", "sku-2"]);
  });

  it("does not announce a complete save after stock retry while Bundle components still failed", async () => {
    const user = userEvent.setup();
    const product = typedProduct({ status: "DRAFT" });
    Object.assign(product.variants[0].sku!, { isBundle: true, bundleVersion: 4 });
    getProduct.mockResolvedValue(product);
    setBundleComponents.mockRejectedValue(new Error("Component save failed"));
    setStockBatch.mockResolvedValueOnce([{ skuId: "sku-2", ok: false, error: "Stock write failed" }])
      .mockResolvedValueOnce([{ skuId: "sku-2", ok: true }]);
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);
    await setInput(user, await screen.findByLabelText("CHAIR 的组件数量"), "3");
    await setInput(user, screen.getByLabelText("Blue 的库存"), "7");
    await clickSave(user);
    await screen.findByText(/组件未保存/);
    const retryStock = screen.getByRole("button", { name: "重试失败行" });
    await user.click(retryStock);
    await waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/组件未保存/)).toBeVisible();
    expect(screen.getByRole("button", { name: "重试失败的 Bundle 组件" })).toBeVisible();
  });

  it("saves a card-only snapshot without rewriting gallery scene flags or real SKU identity", async () => {
    const user = userEvent.setup();
    const media = [
      { id: "photo-a", url: "/uploads/same.webp", type: "IMAGE" as const, altText: null, sortOrder: 0, isScene: true, optionValueId: null, variantId: null },
      { id: "photo-b", url: "/uploads/same.webp", type: "IMAGE" as const, altText: "Second photo", sortOrder: 1, isScene: false, optionValueId: null, variantId: null },
    ];
    const product = typedProduct({ images: media, media });
    getProduct.mockResolvedValue(product);
    updateProduct.mockResolvedValue(typedProduct({ catalogGraphVersion: 4, images: media, media }));
    renderEditPage();
    await waitForForm();
    await user.click(screen.getByRole("tab", { name: "商品媒体" }));
    await user.click(screen.getByRole("button", { name: "Default 卡片封面：从图库选择" }));
    await user.click(screen.getByRole("button", { name: "选择图片 2" }));
    await clickSave(user);
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    const body = updateProduct.mock.calls[0]![1];
    expect(body.catalogGraph.variants).toEqual([expect.objectContaining({
      id: "variant-1",
      cardMedia: { cover: { type: "IMAGE", url: "/uploads/same.webp", altText: "Second photo" }, hover: null },
    })]);
    expect(body.catalogGraph.variants[0]).not.toHaveProperty("sku");
    expect(body.catalogGraph.media).toEqual([]);
    expect(body.catalogGraph.retirements.mediaIds).toEqual([]);
    expect(body).not.toHaveProperty("images");
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("keeps card, SKU, packaging and stock drafts after a graph version conflict", async () => {
    const user = userEvent.setup();
    const media = [
      { id: "photo-a", url: "/uploads/a.webp", type: "IMAGE" as const, altText: null, sortOrder: 0, isScene: true, optionValueId: null, variantId: null },
      { id: "photo-b", url: "/uploads/b.webp", type: "IMAGE" as const, altText: null, sortOrder: 1, isScene: false, optionValueId: null, variantId: null },
    ];
    const product = typedProduct({ images: media, media });
    product.variants[0]!.sku!.packageWidth = 55;
    getProduct.mockResolvedValue(product);
    updateProduct.mockRejectedValue(Object.assign(new Error("Catalog graph version conflict"), { status: 409 }));
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);
    await setInput(user, screen.getByLabelText("Default 的售价"), "1499");
    await setInput(user, screen.getByLabelText("Default 的库存"), "7");
    await user.click(screen.getByRole("tab", { name: "商品媒体" }));
    await user.click(screen.getByRole("button", { name: "Default 卡片封面：从图库选择" }));
    await user.click(screen.getByRole("button", { name: "选择图片 1" }));
    await user.click(screen.getByRole("button", { name: "Default 悬停图片：从图库选择" }));
    await user.click(screen.getByRole("button", { name: "选择图片 2" }));
    await clickSave(user);
    expect(await screen.findByText("Catalog graph version conflict")).toBeInTheDocument();
    await openVariantsTab(user);
    expect(screen.getByLabelText("Default 的售价")).toHaveValue("1499");
    expect(screen.getByLabelText("Default 的库存")).toHaveValue("7");
    await user.click(screen.getByRole("tab", { name: "商品媒体" }));
    expect(screen.getByLabelText("Default 卡片封面：替代文字")).toBeInTheDocument();
    expect(screen.getByLabelText("Default 悬停图片：替代文字")).toBeInTheDocument();
    await clickSave(user);
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(2));
    for (const [, body] of updateProduct.mock.calls) {
      expect(body.catalogGraph.variants).toEqual([expect.objectContaining({
        id: "variant-1",
        cardMedia: {
          cover: { type: "IMAGE", url: "/uploads/a.webp", altText: null },
          hover: { type: "IMAGE", url: "/uploads/b.webp", altText: null },
        },
        sku: expect.objectContaining({ price: 1499, packageWidth: 55 }),
      })]);
      expect(body.catalogGraph.media).toEqual([]);
      expect(body.catalogGraph.retirements.mediaIds).toEqual([]);
    }
    expect(getProduct).toHaveBeenCalledTimes(1);
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("forwards only canonical variants and SKU search context across same-page query changes", async () => {
    navigationState.searchParams = "section=variants&sku=E2E-CS-BLUE-M";
    getProduct.mockResolvedValue(typedProduct());

    const view = renderEditPage();
    await waitForForm();
    expect(productFormRender.mock.lastCall?.[0]).toMatchObject({
      requestedSection: "variants",
      requestedSkuCode: "E2E-CS-BLUE-M",
    });

    navigationState.searchParams = "section=variants&sku=E2E-CS-BLUE-L";
    view.rerender(
      <AdminI18nProvider>
        <EditProductPage />
      </AdminI18nProvider>,
    );
    expect(productFormRender.mock.lastCall?.[0]).toMatchObject({
      requestedSection: "variants",
      requestedSkuCode: "E2E-CS-BLUE-L",
    });

    navigationState.searchParams = "section=media&sku=SH-BLUE";
    view.rerender(
      <AdminI18nProvider>
        <EditProductPage />
      </AdminI18nProvider>,
    );
    expect(productFormRender.mock.lastCall?.[0]).toMatchObject({
      requestedSection: null,
      requestedSkuCode: null,
    });

    navigationState.searchParams = "section=variants&sku=%20%20";
    view.rerender(
      <AdminI18nProvider>
        <EditProductPage />
      </AdminI18nProvider>,
    );
    expect(productFormRender.mock.lastCall?.[0]).toMatchObject({
      requestedSection: "variants",
      requestedSkuCode: null,
    });
  });

  it("uses one wide sticky editor header for saved identity and navigation", async () => {
    getProduct.mockResolvedValue(legacyProduct());

    const view = renderEditPage();
    await waitForForm();

    expect(screen.getByRole("heading", { name: "Chair" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "编辑商品" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /返回商品列表/ })).toHaveLength(1);
    expect(screen.getByLabelText("内部商品编号")).toHaveValue("P-000042");
    expect(
      view.container.querySelector(".max-w-\\[1600px\\]"),
    ).not.toBeNull();
  });

  it("sends no PATCH and no stock request for a no-op save", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(legacyProduct());
    renderEditPage();
    await waitForForm();

    await clickSave(user);

    expect(await screen.findByText("没有需要保存的更改。")).toBeInTheDocument();
    expect(updateProduct).not.toHaveBeenCalled();
    expect(setStock).not.toHaveBeenCalled();
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("PATCHes only the changed scalar on a scalar-only save", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(legacyProduct());
    updateProduct.mockResolvedValue(legacyProduct({ name: "Chair 2" }));
    renderEditPage();
    await waitForForm();

    await setInput(user, screen.getByLabelText(/商品名 \*/), "Chair 2");
    await clickSave(user);

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(updateProduct).toHaveBeenCalledWith("p1", { name: "Chair 2" });
    expect(setStock).not.toHaveBeenCalled();
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("PATCHes independent SEO fields without replaying storefront copy", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(
      legacyProduct({
        description: "Product body",
        tagline: "Hero tagline",
        seoTitle: null,
        metaDescription: null,
      }),
    );
    updateProduct.mockResolvedValue(
      legacyProduct({
        description: "Product body",
        tagline: "Hero tagline",
        seoTitle: "Search title",
        metaDescription: "Search description",
      }),
    );
    renderEditPage();
    await waitForForm();

    await user.click(screen.getByRole("tab", { name: "搜索与链接" }));
    await setInput(user, screen.getByLabelText(/SEO 标题/), "Search title");
    await setInput(
      user,
      screen.getByLabelText(/Meta 描述/),
      "Search description",
    );
    await clickSave(user);

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(updateProduct).toHaveBeenCalledWith("p1", {
      seoTitle: "Search title",
      metaDescription: "Search description",
    });
  });

  it("PATCHes the graph with the current catalogGraphVersion on a graph-only save", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(typedProduct());
    updateProduct.mockResolvedValue(
      typedProduct({ catalogGraphVersion: 4 }),
    );
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await clickSave(user);

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    const [id, body] = updateProduct.mock.calls[0] as [
      string,
      Record<string, never> & {
        catalogGraphVersion?: number;
        catalogGraph?: { variants: { id?: string }[] };
        variants?: unknown;
        images?: unknown;
      },
    ];
    expect(id).toBe("p1");
    expect(body.catalogGraphVersion).toBe(3);
    expect(body.catalogGraph?.variants).toHaveLength(1);
    expect(body.catalogGraph?.variants[0].id).toBe("variant-1");
    // Typed payloads never carry the legacy whole-list keys.
    expect(body.variants).toBeUndefined();
    expect(body.images).toBeUndefined();
    expect(setStockBatch).not.toHaveBeenCalled();
    expect(setStock).not.toHaveBeenCalled();
  });

  it("never reintroduces a blank shared-gallery card into a typed graph PATCH", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(typedProduct());
    updateProduct.mockResolvedValue(typedProduct({ catalogGraphVersion: 4 }));
    renderEditPage();
    await waitForForm();

    await user.click(screen.getByRole("tab", { name: "商品媒体" }));
    await user.click(screen.getAllByRole("button", { name: "添加图片" })[0]!);
    await openVariantsTab(user);
    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await clickSave(user);

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    const [, body] = updateProduct.mock.calls[0] as [
      string,
      { catalogGraph?: { media?: { url?: string }[] } },
    ];
    expect(body.catalogGraph?.media ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ url: "" })]),
    );
  });

  it("sends scalar and graph changes in one product update", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(typedProduct());
    updateProduct.mockResolvedValue(
      typedProduct({ name: "Chair 2", catalogGraphVersion: 4 }),
    );
    renderEditPage();
    await waitForForm();

    await setInput(user, screen.getByLabelText(/商品名 \*/), "Chair 2");
    await openVariantsTab(user);
    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await clickSave(user);

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    const [, body] = updateProduct.mock.calls[0] as [
      string,
      { name?: string; catalogGraphVersion?: number; catalogGraph?: unknown },
    ];
    expect(body.name).toBe("Chair 2");
    expect(body.catalogGraphVersion).toBe(3);
    expect(body.catalogGraph).toBeDefined();
  });

  it("sends a stock-only save through the legacy per-SKU endpoint", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(legacyProduct());
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText(/^库存/), "7");
    await clickSave(user);

    await vi.waitFor(() => expect(setStock).toHaveBeenCalledTimes(1));
    expect(setStock).toHaveBeenCalledWith({
      skuId: "sku-1",
      onHand: 7,
      reason: "Product form",
    });
    expect(updateProduct).not.toHaveBeenCalled();
    expect(setStockBatch).not.toHaveBeenCalled();
    // Server truth is re-read so the form shows what actually settled.
    await vi.waitFor(() => expect(getProduct).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("商品已保存，库存已更新。")).toBeInTheDocument();
  });

  it("completes the graph update before the stock batch", async () => {
    const order: string[] = [];
    const user = userEvent.setup();
    getProduct.mockResolvedValue(typedProduct());
    updateProduct.mockImplementation(async () => {
      order.push("product");
      return typedProduct({ catalogGraphVersion: 4 });
    });
    setStockBatch.mockImplementation(async () => {
      order.push("stock");
      return [
        { skuId: "sku-1", ok: true, onHand: 9, reserved: 0, available: 9 },
      ];
    });
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await setInput(user, screen.getByLabelText("Default 的库存"), "9");
    await clickSave(user);

    await vi.waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["product", "stock"]);
    expect(setStockBatch).toHaveBeenCalledWith([
      { skuId: "sku-1", onHand: 9, reason: "Product form" },
    ]);
  });

  it("never sends legacy whole lists for a graph product without a typed payload", async () => {
    const user = userEvent.setup();
    const locked = typedProduct({
      catalogGraphVersion: 2,
      options: undefined,
      media: undefined,
    });
    getProduct.mockResolvedValue(locked);
    updateProduct.mockResolvedValue(locked);
    renderEditPage();
    await waitForForm();

    await setInput(user, screen.getByLabelText(/商品名 \*/), "Chair 2");
    await clickSave(user);

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(updateProduct).toHaveBeenCalledWith("p1", { name: "Chair 2" });
    expect(setStock).not.toHaveBeenCalled();
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("resolves a variant added in this save by SKU code on the legacy path", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(legacyProduct());
    updateProduct.mockResolvedValue(
      legacyProduct({
        variants: [
          {
            id: "variant-1",
            name: "Default",
            position: 0,
            sku: skuOf("sku-1", "SH-1", 4),
          },
          {
            id: "variant-2",
            name: "Blue",
            position: 1,
            sku: skuOf("sku-2", "SH-BLUE", 0),
          },
        ],
      }),
    );
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await user.click(screen.getByRole("button", { name: "添加款式" }));
    await setInput(user, screen.getAllByLabelText(/款式名称 \*/)[1], "Blue");
    await user.click(screen.getAllByLabelText(/启用 SKU/)[1]);
    await setInput(user, screen.getAllByLabelText(/SKU 编码 \*/)[1], "SH-BLUE");
    await setInput(user, screen.getAllByLabelText(/^库存/)[1], "5");
    await clickSave(user);

    await vi.waitFor(() => expect(setStock).toHaveBeenCalledTimes(1));
    // The created variant had no SKU id when the form was built: it is matched
    // back by SKU code against the PATCH response.
    expect(setStock).toHaveBeenCalledWith({
      skuId: "sku-2",
      onHand: 5,
      reason: "Product form",
    });
    const [, body] = updateProduct.mock.calls[0] as [
      string,
      { variants?: unknown[] },
    ];
    expect(body.variants).toHaveLength(2);
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("does not write inventory when the graph PATCH fails", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(typedProduct());
    updateProduct.mockRejectedValue(new Error("graph boom"));
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await setInput(user, screen.getByLabelText("Default 的库存"), "9");
    await clickSave(user);

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(setStockBatch).not.toHaveBeenCalled();
    expect(setStock).not.toHaveBeenCalled();
    // Nothing was saved, so the backend message is shown verbatim.
    expect(await screen.findByText("graph boom")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("resolves a browser-created SKU to its real id from the graph response", async () => {
    const user = userEvent.setup();
    // "Blue" exists as a candidate but has no persisted variant row yet.
    getProduct.mockResolvedValue(
      typedProduct({
        variants: [
          graphVariant("variant-1", "Default", "value-1", skuOf("sku-1", "SH-1", 4)),
        ],
      }),
    );
    updateProduct.mockResolvedValue(
      typedProduct({
        catalogGraphVersion: 4,
        variants: [
          graphVariant("variant-1", "Default", "value-1", skuOf("sku-1", "SH-1", 4)),
          graphVariant("variant-3", "Blue", "value-2", skuOf("sku-blue", "SH-BLUE", 5)),
        ],
      }),
    );
    setStockBatch.mockResolvedValue([
      { skuId: "sku-blue", ok: true, onHand: 5, reserved: 0, available: 5 },
    ]);
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Blue 的 SKU 编码"), "SH-BLUE");
    await setInput(user, screen.getByLabelText("Blue 的库存"), "5");
    await clickSave(user);

    await vi.waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(1));
    expect(setStockBatch).toHaveBeenCalledWith([
      { skuId: "sku-blue", onHand: 5, reason: "Product form" },
    ]);
    expect(setStock).not.toHaveBeenCalled();
  });

  /**
   * Saves a product change plus two stock rows, and settles the batch with a
   * failing row. The response order is deliberately REVERSED relative to the
   * request, so a positional matcher would mislabel the failure.
   */
  async function submitWithOneFailingStockRow(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    getProduct.mockResolvedValue(typedProduct());
    updateProduct.mockResolvedValue(typedProduct({ catalogGraphVersion: 4 }));
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-2", ok: false, error: "库存写入失败" },
      { skuId: "sku-1", ok: true, onHand: 9, reserved: 0, available: 9 },
    ]);
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await setInput(user, screen.getByLabelText("Default 的库存"), "9");
    await setInput(user, screen.getByLabelText("Blue 的库存"), "5");
    await clickSave(user);
  }

  it("keeps the product save, refetches server truth, and shows only the failed stock row", async () => {
    const user = userEvent.setup();
    await submitWithOneFailingStockRow(user);

    expect(await screen.findByText("1 项库存写入失败（其余已保存）")).toBeInTheDocument();
    const panel = screen
      .getByText("1 项库存写入失败（其余已保存）")
      .closest("[role='alert']") as HTMLElement;
    // Matched by skuId, not by response position: the failing row is Blue's.
    expect(within(panel).getByText("Blue")).toBeInTheDocument();
    expect(within(panel).queryByText("Default")).not.toBeInTheDocument();
    expect(within(panel).getByText("目标库存 5")).toBeInTheDocument();
    expect(within(panel).getByText("库存写入失败")).toBeInTheDocument();
    // The product phase succeeded, so the copy must not claim it was lost.
    expect(
      screen.getByText("商品已保存，但 1 项库存更新失败——请在下方重试（只重发失败的行）。"),
    ).toBeInTheDocument();
    expect(updateProduct).toHaveBeenCalledTimes(1);
    // Server truth re-read: what actually settled is what the form shows.
    await vi.waitFor(() => expect(getProduct).toHaveBeenCalledTimes(2));
  });

  it("retries exactly the failed rows and never replays the product PATCH", async () => {
    const user = userEvent.setup();
    await submitWithOneFailingStockRow(user);
    await screen.findByText("1 项库存写入失败（其余已保存）");
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-2", ok: true, onHand: 5, reserved: 0, available: 5 },
    ]);

    await user.click(screen.getByRole("button", { name: "重试失败行" }));

    await vi.waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(2));
    // Only the failed row, addressed by its real SKU id — the successful row
    // (sku-1) is never written twice.
    expect(setStockBatch).toHaveBeenLastCalledWith([
      { skuId: "sku-2", onHand: 5, reason: "Product form" },
    ]);
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("库存已更新。")).toBeInTheDocument();
    await vi.waitFor(() => expect(getProduct).toHaveBeenCalledTimes(3));
  });

  it("keeps a requested stock row the save's batch response never reports", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(typedProduct());
    updateProduct.mockResolvedValue(typedProduct({ catalogGraphVersion: 4 }));
    // Two rows are requested; the response settles only sku-1. sku-2 was
    // never confirmed written, so it must not read as success.
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-1", ok: true, onHand: 9, reserved: 0, available: 9 },
    ]);
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await setInput(user, screen.getByLabelText("Default 的库存"), "9");
    await setInput(user, screen.getByLabelText("Blue 的库存"), "5");
    await clickSave(user);

    expect(await screen.findByText("1 项库存写入失败（其余已保存）")).toBeInTheDocument();
    const panel = screen
      .getByText("1 项库存写入失败（其余已保存）")
      .closest("[role='alert']") as HTMLElement;
    expect(within(panel).getByText("Blue")).toBeInTheDocument();
    expect(within(panel).getByText("目标库存 5")).toBeInTheDocument();
    expect(screen.queryByText("商品已保存，库存已更新。")).not.toBeInTheDocument();
  });

  it("keeps a requested stock row the retry's batch response never reports", async () => {
    const user = userEvent.setup();
    await submitWithOneFailingStockRow(user);
    await screen.findByText("1 项库存写入失败（其余已保存）");
    // The retry is answered with an empty settlement list: nothing came back
    // for the row that was sent.
    setStockBatch.mockResolvedValueOnce([]);

    await user.click(screen.getByRole("button", { name: "重试失败行" }));

    await vi.waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(2));
    const panel = screen
      .getByText("1 项库存写入失败（其余已保存）")
      .closest("[role='alert']") as HTMLElement;
    expect(within(panel).getByText("Blue")).toBeInTheDocument();
    expect(within(panel).getByText("目标库存 5")).toBeInTheDocument();
    expect(screen.queryByText("库存已更新。")).not.toBeInTheDocument();
    expect(screen.getByText("1 项库存更新仍失败。")).toBeInTheDocument();
  });

  it("keeps initial batch failures visible when the server-truth refresh fails", async () => {
    const user = userEvent.setup();
    getProduct
      .mockResolvedValueOnce(typedProduct())
      .mockRejectedValueOnce(new Error("refresh boom"));
    updateProduct.mockResolvedValue(typedProduct({ catalogGraphVersion: 4 }));
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-1", ok: true, onHand: 9, reserved: 0, available: 9 },
      { skuId: "sku-2", ok: false, error: "库存写入失败" },
    ]);
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await setInput(user, screen.getByLabelText("Default 的库存"), "9");
    await setInput(user, screen.getByLabelText("Blue 的库存"), "5");
    await clickSave(user);

    expect(await screen.findByText("1 项库存写入失败（其余已保存）")).toBeInTheDocument();
    const panel = screen
      .getByText("1 项库存写入失败（其余已保存）")
      .closest("[role='alert']") as HTMLElement;
    expect(within(panel).getByText("Blue")).toBeInTheDocument();
    expect(screen.getByText(/refresh boom/)).toBeInTheDocument();
  });

  it("removes successful retry rows even when the follow-up refresh fails", async () => {
    const user = userEvent.setup();
    getProduct
      .mockResolvedValueOnce(typedProduct())
      .mockResolvedValueOnce(typedProduct({ catalogGraphVersion: 4 }))
      .mockRejectedValueOnce(new Error("refresh boom"));
    updateProduct.mockResolvedValue(typedProduct({ catalogGraphVersion: 4 }));
    setStockBatch
      .mockResolvedValueOnce([
        { skuId: "sku-1", ok: true, onHand: 9, reserved: 0, available: 9 },
        { skuId: "sku-2", ok: false, error: "库存写入失败" },
      ])
      .mockResolvedValueOnce([
        { skuId: "sku-2", ok: true, onHand: 5, reserved: 0, available: 5 },
      ]);
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await setInput(user, screen.getByLabelText("Default 的库存"), "9");
    await setInput(user, screen.getByLabelText("Blue 的库存"), "5");
    await clickSave(user);
    await screen.findByText("1 项库存写入失败（其余已保存）");
    await user.click(screen.getByRole("button", { name: "重试失败行" }));

    expect(await screen.findByText("refresh boom")).toBeInTheDocument();
    expect(screen.queryByText("1 项库存写入失败（其余已保存）")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试失败行" })).not.toBeInTheDocument();
    expect(setStockBatch).toHaveBeenCalledTimes(2);
  });

  it("keeps an unresolved draft SKU row visible when the retryable rows settle", async () => {
    const user = userEvent.setup();
    // "Blue" is drafted with a SKU code the save response never returns, so its
    // stock row can never be addressed — while "Default" is retryable.
    getProduct.mockResolvedValue(
      typedProduct({
        variants: [
          graphVariant("variant-1", "Default", "value-1", skuOf("sku-1", "SH-1", 4)),
        ],
      }),
    );
    updateProduct.mockResolvedValue(
      typedProduct({
        catalogGraphVersion: 4,
        variants: [
          graphVariant("variant-1", "Default", "value-1", skuOf("sku-1", "SH-1", 4)),
        ],
      }),
    );
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-1", ok: false, error: "库存写入失败" },
    ]);
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Blue 的 SKU 编码"), "SH-BLUE");
    await setInput(user, screen.getByLabelText("Blue 的库存"), "5");
    await setInput(user, screen.getByLabelText("Default 的库存"), "9");
    await clickSave(user);

    await screen.findByText("2 项库存写入失败（其余已保存）");
    // Retry succeeds for the row that has an id.
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-1", ok: true, onHand: 9, reserved: 0, available: 9 },
    ]);
    await user.click(screen.getByRole("button", { name: "重试失败行" }));

    await vi.waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(2));
    expect(setStockBatch).toHaveBeenLastCalledWith([
      { skuId: "sku-1", onHand: 9, reason: "Product form" },
    ]);
    // The unresolved row was never written: it must not vanish behind a
    // success notice just because the retryable row settled.
    const panel = screen
      .getByText("1 项库存写入失败（其余已保存）")
      .closest("[role='alert']") as HTMLElement;
    expect(within(panel).getByText("Blue")).toBeInTheDocument();
    expect(within(panel).queryByText("Default")).not.toBeInTheDocument();
    expect(screen.queryByText("库存已更新。")).not.toBeInTheDocument();
    expect(screen.getByText("1 项库存更新仍失败。")).toBeInTheDocument();
  });

  it("adopts the saved product's version and SKU identities on the next save", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(typedProduct());
    updateProduct
      .mockResolvedValueOnce(
        typedProduct({
          catalogGraphVersion: 4,
          variants: [
            graphVariant("variant-1", "Default", "value-1", {
              ...skuOf("sku-1", "SH-1", 4),
              price: "1599",
            }),
            graphVariant("variant-2", "Blue", "value-2", skuOf("sku-2", "SH-BLUE", 2)),
          ],
        }),
      )
      .mockResolvedValueOnce(typedProduct({ catalogGraphVersion: 5 }));
    setStockBatch.mockResolvedValue([
      { skuId: "sku-1", ok: true, onHand: 9, reserved: 0, available: 9 },
    ]);
    renderEditPage();
    await waitForForm();
    await openVariantsTab(user);

    await setInput(user, screen.getByLabelText("Default 的售价"), "1599");
    await clickSave(user);
    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    // The PATCH response became the form's server truth.
    expect(await screen.findByDisplayValue("1599")).toBeInTheDocument();

    await setInput(user, screen.getByLabelText("Default 的售价"), "1799");
    await setInput(user, screen.getByLabelText("Default 的库存"), "9");
    await clickSave(user);

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(2));
    const [, body] = updateProduct.mock.calls[1] as [
      string,
      {
        catalogGraphVersion?: number;
        catalogGraph?: { variants: unknown[] };
      },
    ];
    // The optimistic revision comes from the FIRST response — resending the
    // stale 3 would 409, and a re-minted client key would recreate the SKU.
    expect(body.catalogGraphVersion).toBe(4);
    expect(JSON.stringify(body.catalogGraph?.variants)).not.toContain(
      "clientKey",
    );
    await vi.waitFor(() =>
      expect(setStockBatch).toHaveBeenCalledWith([
        { skuId: "sku-1", onHand: 9, reason: "Product form" },
      ]),
    );
  });

  it("derives savedPreview from server truth and updates it after a save", async () => {
    const user = userEvent.setup();
    getProduct.mockResolvedValue(legacyProduct());
    updateProduct.mockResolvedValue(
      legacyProduct({ slug: "chair-2", status: "ACTIVE" }),
    );
    renderEditPage();
    await waitForForm();

    // Unpublished: nothing to preview, so no storefront request is made.
    await user.click(screen.getByRole("tab", { name: "预览" }));
    expect(
      screen.getByText("已保存版本目前未上架，不会请求或打开前台商品页。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "打开已保存的前台页面" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "搜索与链接" }));
    await setInput(user, screen.getByLabelText(/Slug \*/), "chair-2");
    await user.selectOptions(screen.getByLabelText("商品状态"), "ACTIVE");
    await clickSave(user);

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("tab", { name: "预览" }));
    expect(
      await screen.findByRole("link", { name: "打开已保存的前台页面" }),
    ).toHaveAttribute("href", "/products/chair-2");
  });
});
