import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";

/**
 * Review-fix cover for the two-phase save on the new-product page: the
 * created product row exists the moment createProduct resolves, so EVERY
 * later failure (Phase A graph PATCH, Phase B stock batch) must leave the
 * operator a "continue on the edit page" pointer instead of stranding them
 * on a form whose re-submit would 409 into "slug already exists".
 *
 * Task 4 extends this to the full create orchestration: one POST, the graph
 * PATCH against the created version and always before the inventory batch,
 * client-key SKU resolution, and the failed-row-only retry contract.
 */

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

// The FAQ tab previews the shared library; keep this suite off the network.
vi.mock("@/lib/faq-api", () => ({
  faqApi: { getSharedPreview: () => Promise.resolve({ items: [] }) },
}));

const listCategories = vi.fn();
const createProduct = vi.fn();
const updateProduct = vi.fn();
const setStockBatch = vi.fn();
const searchBundleSkus = vi.fn();
const setBundleComponents = vi.fn();

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    listCategories: (...args: unknown[]) => listCategories(...args),
    createProduct: (...args: unknown[]) => createProduct(...args),
    updateProduct: (...args: unknown[]) => updateProduct(...args),
    setStockBatch: (...args: unknown[]) => setStockBatch(...args),
    searchBundleSkus: (...args: unknown[]) => searchBundleSkus(...args),
    setBundleComponents: (...args: unknown[]) => setBundleComponents(...args),
  },
  formatAmount: (value: unknown) =>
    value === null || value === undefined ? "—" : `₱${value}`,
}));

import { AdminApiError } from "@/lib/admin-auth";
import type { AdminCategoryNode, AdminProduct } from "@/lib/admin-api";
import NewProductPage from "./page";

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

const CREATED = {
  id: "created-1",
  catalogGraphVersion: 0,
  variants: [],
} as unknown as AdminProduct;

const SAVED_WITH_SKU = {
  id: "created-1",
  catalogGraphVersion: 1,
  variants: [
    {
      id: "variant-1",
      name: "Default",
      position: 0,
      sku: {
        id: "sku-1",
        skuCode: "SH-1",
        status: "ACTIVE",
        isBundle: false,
        bundleVersion: 0,
        price: "1299",
        compareAtPrice: null,
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        productWeight: null,
        packageWidth: null,
        packageHeight: null,
        packageDepth: null,
        packageWeight: null,
        volumetricWeight: null,
        onHand: 0,
        reserved: 0,
        availableInventory: 0,
      },
    },
  ],
} as unknown as AdminProduct;

/** Two settled variants, so the batch can return a MIXED result. */
const SAVED_WITH_TWO_SKUS = {
  id: "created-1",
  catalogGraphVersion: 1,
  variants: [
    {
      id: "variant-1",
      name: "Default",
      position: 0,
      sku: { id: "sku-1", skuCode: "SH-1", status: "ACTIVE", isBundle: false, bundleVersion: 0, price: "1299" },
    },
    {
      id: "variant-2",
      name: "Blue",
      position: 1,
      sku: { id: "sku-blue", skuCode: "SH-BLUE", status: "ACTIVE", isBundle: false, bundleVersion: 0, price: "1499" },
    },
  ],
} as unknown as AdminProduct;

function renderNewProductPage() {
  return render(
    <AdminI18nProvider>
      <NewProductPage />
    </AdminI18nProvider>,
  );
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  beforeSubmit?: () => Promise<void>,
  status: "DRAFT" | "ACTIVE" = "DRAFT",
): Promise<void> {
  // The typed editors are the default variant editor on this page; pricing
  // the Default candidate is what turns the draft into typed rows (Phase A).
  await user.click(await screen.findByRole("tab", { name: "选项、价格与库存" }));
  await user.type(await screen.findByLabelText("Default 的 SKU 编码"), "SH-1");
  await user.type(screen.getByLabelText("Default 的售价"), "1299");

  await user.click(screen.getByRole("tab", { name: "基本信息" }));
  // Field wraps its operator hint inside the <label>, so label queries use
  // substring regexes rather than exact text.
  await user.type(screen.getByLabelText(/商品名 \*/), "Chair");
  await user.selectOptions(screen.getByLabelText(/分类 \*/), CATEGORY.id);

  await user.click(screen.getByRole("tab", { name: "搜索与链接" }));
  await user.type(screen.getByLabelText(/Slug \*/), "chair");

  await beforeSubmit?.();
  await user.selectOptions(screen.getByRole("combobox", { name: "商品状态" }), status);
  await user.click(screen.getByRole("button", { name: status === "ACTIVE" ? "保存并发布" : "保存草稿" }));
}

/**
 * Same create, but with TWO matrix rows: one option group with two values
 * materializes two candidates, so the stock batch can settle a mixed result
 * (one row ok, one failed) instead of a single-row batch.
 */
async function fillTwoCandidateSubmit(
  user: ReturnType<typeof userEvent.setup>,
  beforeSubmit?: () => Promise<void>,
): Promise<void> {
  await user.click(await screen.findByRole("tab", { name: "选项、价格与库存" }));
  await user.click(screen.getByRole("button", { name: "添加选项组" }));
  await user.click(screen.getByRole("button", { name: "添加选项值" }));
  await user.click(screen.getByRole("button", { name: "添加选项值" }));
  await user.type(screen.getByLabelText("选项值 1 标签"), "Default");
  await user.type(screen.getByLabelText("选项值 2 标签"), "Blue");

  await user.type(screen.getByLabelText("Default 的 SKU 编码"), "SH-1");
  await user.type(screen.getByLabelText("Default 的售价"), "1299");
  await user.type(screen.getByLabelText("Default 的库存"), "4");
  await user.type(screen.getByLabelText("Blue 的 SKU 编码"), "SH-BLUE");
  await user.type(screen.getByLabelText("Blue 的售价"), "1499");
  await user.type(screen.getByLabelText("Blue 的库存"), "2");

  await user.click(screen.getByRole("tab", { name: "基本信息" }));
  await user.type(screen.getByLabelText(/商品名 \*/), "Chair");
  await user.selectOptions(screen.getByLabelText(/分类 \*/), CATEGORY.id);

  await user.click(screen.getByRole("tab", { name: "搜索与链接" }));
  await user.type(screen.getByLabelText(/Slug \*/), "chair");

  await beforeSubmit?.();
  await user.click(screen.getByRole("button", { name: "保存草稿" }));
}

describe("NewProductPage two-phase save", () => {
  beforeEach(() => {
    setAdminLang("zh");
    pushMock.mockReset();
    listCategories.mockReset().mockResolvedValue([CATEGORY]);
    createProduct.mockReset();
    updateProduct.mockReset();
    setStockBatch.mockReset();
    searchBundleSkus.mockReset().mockResolvedValue([{ id: "chair", skuCode: "CHAIR", productId: "other", productName: "Chair", variantName: "Black", availableInventory: 9 }]);
    setBundleComponents.mockReset().mockResolvedValue({ version: 1, components: [], availableInventory: 0 });
  });

  afterEach(cleanup);

  async function chooseBundle(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole("tab", { name: "选项、价格与库存" }));
    await user.click(screen.getByRole("checkbox", { name: "Default 的虚拟 Bundle 模式" }));
    await user.click(screen.getByRole("button", { name: "搜索 SKU" }));
    await user.click(await screen.findByRole("button", { name: "添加 CHAIR" }));
  }

  it("creates the product and graph before saving new Bundle components against a real identity", async () => {
    const user = userEvent.setup();
    const saved = structuredClone(SAVED_WITH_SKU);
    Object.assign(saved.variants[0].sku!, { isBundle: true, bundleVersion: 0 });
    createProduct.mockResolvedValue(CREATED);
    let finishGraph!: (value: AdminProduct) => void;
    updateProduct.mockImplementation(() => new Promise(resolve => { finishGraph = resolve; }));
    renderNewProductPage();
    await fillAndSubmit(user, () => chooseBundle(user));
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(setBundleComponents).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    finishGraph(saved);
    await waitFor(() => expect(setBundleComponents).toHaveBeenCalledWith("created-1", "sku-1", { expectedVersion: 0, components: [{ componentSkuId: "chair", quantity: 1, position: 0 }] }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/products/created-1/edit"));
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("keeps failed new Bundle definitions visible and retries without creating another product", async () => {
    const user = userEvent.setup();
    const saved = structuredClone(SAVED_WITH_SKU);
    Object.assign(saved.variants[0].sku!, { isBundle: true, bundleVersion: 0 });
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(saved);
    setBundleComponents.mockRejectedValueOnce(new Error("Component save failed"));
    renderNewProductPage();
    await fillAndSubmit(user, () => chooseBundle(user));
    expect(await screen.findByText(/组件未保存/)).toBeVisible();
    expect(pushMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "重试失败的 Bundle 组件" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/products/created-1/edit"));
    expect(setBundleComponents).toHaveBeenCalledTimes(2);
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(setStockBatch).not.toHaveBeenCalled();
  });

  it("waits for both physical stock and Bundle component retries before leaving create", async () => {
    const user = userEvent.setup();
    const saved = structuredClone(SAVED_WITH_TWO_SKUS);
    Object.assign(saved.variants[0].sku!, { isBundle: true, bundleVersion: 0 });
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(saved);
    setBundleComponents.mockRejectedValueOnce(new Error("Component save failed"));
    setStockBatch.mockResolvedValueOnce([{ skuId: "sku-blue", ok: false, error: "Stock failed" }])
      .mockResolvedValueOnce([{ skuId: "sku-blue", ok: true }]);
    renderNewProductPage();
    await fillTwoCandidateSubmit(user, () => chooseBundle(user));
    await screen.findByText(/组件未保存/);
    await user.click(screen.getByRole("button", { name: "重试失败行" }));
    await waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(2));
    expect(pushMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "重试失败的 Bundle 组件" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/products/created-1/edit"));
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct).toHaveBeenCalledTimes(1);
  });

  it("keeps shared gallery identity separate from an independently selected card cover during typed create", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_SKU);
    setStockBatch.mockResolvedValue([]);
    renderNewProductPage();
    await fillAndSubmit(user, async () => {
      await user.click(screen.getByRole("tab", { name: "商品媒体" }));
      const shared = screen.getAllByLabelText("要添加的媒体 URL")[0]!.closest("section")!;
      await user.type(within(shared).getByLabelText("要添加的媒体 URL"), "/uploads/new-scene.webp");
      await user.click(within(shared).getByRole("button", { name: "添加" }));
      await user.click(screen.getByRole("button", { name: "媒体 1（封面）" }));
      expect(screen.queryByRole("button", { name: /设为场景图/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Default 卡片封面：从图库选择" }));
      await user.click(screen.getByRole("button", { name: "选择图片 1" }));
    });
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(createProduct.mock.calls[0]![0].images).toEqual([]);
    expect(updateProduct.mock.calls[0]![1].catalogGraph.media).toEqual([
      expect.objectContaining({ clientKey: "shared-media-1", url: "/uploads/new-scene.webp", isScene: false, sortOrder: 0 }),
    ]);
    expect(updateProduct.mock.calls[0]![1].catalogGraph.variants[0].cardMedia).toEqual({
      cover: { type: "IMAGE", url: "/uploads/new-scene.webp", altText: null }, hover: null,
    });
  });

  it("keeps a continue-on-edit link when the Phase A graph PATCH fails after create", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockRejectedValue(new Error("graph boom"));

    renderNewProductPage();
    await fillAndSubmit(user);

    const link = await screen.findByRole("link", { name: /继续编辑该商品/ });
    expect(link).toHaveAttribute("href", "/admin/products/created-1/edit");
    expect(pushMock).not.toHaveBeenCalled();
    // The failure message is the backend's own, not the slug-conflict copy.
    expect(await screen.findAllByText(/graph boom/)).not.toHaveLength(0);
    // Phase A never completed: the graph owns the variants, so there is
    // nothing to write stock against.
    expect(setStockBatch).not.toHaveBeenCalled();

    const save = screen.getByRole("button", { name: "保存草稿" });
    await user.click(save);
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: /继续编辑该商品/ }),
    ).toHaveAttribute("href", "/admin/products/created-1/edit");
  });

  it("creates typed ACTIVE requests as DRAFT until the final graph PATCH succeeds", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_SKU);
    setStockBatch.mockResolvedValue([]);
    renderNewProductPage();
    await fillAndSubmit(user, undefined, "ACTIVE");
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(createProduct.mock.calls[0]![0]).toMatchObject({ status: "DRAFT", images: [], variants: [] });
    expect(updateProduct.mock.calls[0]![1]).toHaveProperty("status", "ACTIVE");
  });

  it("retries the latest typed draft after a graph conflict without repeating the successful POST", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockRejectedValueOnce(new AdminApiError("catalog graph conflict", 409));
    updateProduct.mockResolvedValueOnce(SAVED_WITH_SKU);
    setStockBatch.mockResolvedValue([{ skuId: "sku-1", ok: true, onHand: 4, reserved: 0, available: 4 }]);
    renderNewProductPage();
    await fillAndSubmit(user, async () => {
      await user.click(screen.getByRole("tab", { name: "选项、价格与库存" }));
      await user.clear(screen.getByLabelText("Default 的库存"));
      await user.type(screen.getByLabelText("Default 的库存"), "4");
      await user.click(screen.getByRole("tab", { name: "商品媒体" }));
      const shared = screen.getAllByLabelText("要添加的媒体 URL")[0]!.closest("section")!;
      await user.type(within(shared).getByLabelText("要添加的媒体 URL"), "/uploads/retry-cover.webp");
      await user.click(within(shared).getByRole("button", { name: "添加" }));
      await user.click(screen.getByRole("button", { name: "Default 卡片封面：从图库选择" }));
      await user.click(screen.getByRole("button", { name: "选择图片 1" }));
    }, "ACTIVE");
    await screen.findByRole("link", { name: /继续编辑该商品/ });
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Default 卡片封面：替代文字")).toHaveValue("");
    await user.type(screen.getByLabelText("Default 卡片封面：替代文字"), "Updated card");
    await user.click(screen.getByRole("tab", { name: "选项、价格与库存" }));
    expect(screen.getByLabelText("Default 的库存")).toHaveValue("4");
    expect(screen.getByLabelText("Default 的 SKU 编码")).toHaveValue("SH-1");
    await user.click(screen.getByRole("button", { name: "保存并发布" }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(2));
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[1]![0]).toBe("created-1");
    expect(updateProduct.mock.calls[1]![1]).toHaveProperty("status", "ACTIVE");
    expect(updateProduct.mock.calls[1]![1].catalogGraph.variants[0].cardMedia.cover)
      .toEqual({ type: "IMAGE", url: "/uploads/retry-cover.webp", altText: "Updated card" });
    expect(setStockBatch).toHaveBeenCalledWith([{ skuId: "sku-1", onHand: 4, reason: "New product" }]);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/products/created-1/edit"));
  });

  it("POSTs once and leaves the graph-owned whole lists empty", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_SKU);
    setStockBatch.mockResolvedValue([
      { skuId: "sku-1", ok: true, onHand: 0, reserved: 0, available: 0 },
    ]);

    renderNewProductPage();
    await fillAndSubmit(user);

    await vi.waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
    const [payload] = createProduct.mock.calls[0] as [Record<string, unknown>];
    // The graph PATCH is the single writer for variants/media; sending them
    // through the legacy create as well would duplicate every row.
    expect(payload.variants).toEqual([]);
    expect(payload.images).toEqual([]);
    expect(payload.name).toBe("Chair");
    expect(payload.slug).toBe("chair");
  });

  it("never reintroduces a blank shared-gallery card into the create graph PATCH", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_SKU);
    setStockBatch.mockResolvedValue([
      { skuId: "sku-1", ok: true, onHand: 0, reserved: 0, available: 0 },
    ]);

    renderNewProductPage();
    await fillAndSubmit(user, async () => {
      await user.click(screen.getByRole("tab", { name: "商品媒体" }));
      await user.click(screen.getAllByRole("button", { name: "添加图片" })[0]!);
    });

    await vi.waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    const [, body] = updateProduct.mock.calls[0] as [
      string,
      { catalogGraph?: { media?: { url?: string }[] } },
    ];
    expect(body.catalogGraph?.media ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ url: "" })]),
    );
  });

  it("PATCHes the graph with the created product's version before the stock batch", async () => {
    const order: string[] = [];
    const user = userEvent.setup();
    // A non-zero baseline proves the revision comes from the POST response
    // rather than a hardcoded 0.
    createProduct.mockImplementation(async () => {
      order.push("create");
      return { ...CREATED, catalogGraphVersion: 7 } as unknown as AdminProduct;
    });
    updateProduct.mockImplementation(async () => {
      order.push("graph");
      return SAVED_WITH_SKU;
    });
    setStockBatch.mockImplementation(async () => {
      order.push("stock");
      return [{ skuId: "sku-1", ok: true, onHand: 0, reserved: 0, available: 0 }];
    });

    renderNewProductPage();
    await fillAndSubmit(user);

    await vi.waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["create", "graph", "stock"]);
    expect(updateProduct).toHaveBeenCalledWith(
      "created-1",
      expect.objectContaining({ catalogGraphVersion: 7 }),
    );
    // The created SKU is addressed by its real id, never by the draft key.
    expect(setStockBatch).toHaveBeenCalledWith([
      { skuId: "sku-1", onHand: 0, reason: "New product" },
    ]);
  });

  it("shows only the failed stock rows of a mixed batch", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_TWO_SKUS);
    // Response order deliberately reversed: results are matched by skuId.
    setStockBatch.mockResolvedValue([
      { skuId: "sku-blue", ok: true, onHand: 2, reserved: 0, available: 2 },
      { skuId: "sku-1", ok: false, error: "库存写入失败" },
    ]);

    renderNewProductPage();
    await fillTwoCandidateSubmit(user);

    expect(await screen.findByText("1 项库存写入失败（其余已保存）")).toBeInTheDocument();
    const panel = screen
      .getByText("1 项库存写入失败（其余已保存）")
      .closest("[role='alert']") as HTMLElement;
    expect(within(panel).getByText("Default")).toBeInTheDocument();
    expect(within(panel).queryByText("Blue")).not.toBeInTheDocument();
    expect(within(panel).getByText("目标库存 4")).toBeInTheDocument();
    expect(
      screen.getByText("商品已创建，但 1 项库存更新失败——请在下方重试（只重发失败的行）。"),
    ).toBeInTheDocument();
    // The product exists, so the operator keeps a way to it — but must not be
    // pushed onward while a stock row is still owed.
    expect(
      screen.getByRole("link", { name: /继续编辑该商品/ }),
    ).toHaveAttribute("href", "/admin/products/created-1/edit");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("retries only the failed stock rows and then lands on the edit page", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_TWO_SKUS);
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-blue", ok: true, onHand: 2, reserved: 0, available: 2 },
      { skuId: "sku-1", ok: false, error: "库存写入失败" },
    ]);

    renderNewProductPage();
    await fillTwoCandidateSubmit(user);
    await screen.findByText("1 项库存写入失败（其余已保存）");
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-1", ok: true, onHand: 4, reserved: 0, available: 4 },
    ]);

    await user.click(screen.getByRole("button", { name: "重试失败行" }));

    await vi.waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(2));
    expect(setStockBatch).toHaveBeenLastCalledWith([
      { skuId: "sku-1", onHand: 4, reason: "New product" },
    ]);
    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/admin/products/created-1/edit");
    });
  });

  it("keeps an unresolved draft SKU row instead of navigating away", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    // The save response only carries "SH-1": the Blue draft row can never be
    // addressed, while Default is retryable.
    updateProduct.mockResolvedValue(SAVED_WITH_SKU);
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-1", ok: false, error: "库存写入失败" },
    ]);

    renderNewProductPage();
    await fillTwoCandidateSubmit(user);

    expect(await screen.findByText("2 项库存写入失败（其余已保存）")).toBeInTheDocument();
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-1", ok: true, onHand: 4, reserved: 0, available: 4 },
    ]);
    await user.click(screen.getByRole("button", { name: "重试失败行" }));

    await vi.waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(2));
    expect(setStockBatch).toHaveBeenLastCalledWith([
      { skuId: "sku-1", onHand: 4, reason: "New product" },
    ]);
    // Blue was never written: the page must not leave it behind as if the
    // save were complete.
    const panel = screen
      .getByText("1 项库存写入失败（其余已保存）")
      .closest("[role='alert']") as HTMLElement;
    expect(within(panel).getByText("Blue")).toBeInTheDocument();
    expect(within(panel).queryByText("Default")).not.toBeInTheDocument();
    expect(screen.getByText("1 项库存更新仍失败。")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps a requested stock row the create's batch response never reports", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_TWO_SKUS);
    // Two rows are requested; only sku-1 is settled. sku-blue was never
    // confirmed written, so the create must not read as complete.
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-1", ok: true, onHand: 4, reserved: 0, available: 4 },
    ]);

    renderNewProductPage();
    await fillTwoCandidateSubmit(user);

    expect(await screen.findByText("1 项库存写入失败（其余已保存）")).toBeInTheDocument();
    const panel = screen
      .getByText("1 项库存写入失败（其余已保存）")
      .closest("[role='alert']") as HTMLElement;
    expect(within(panel).getByText("Blue")).toBeInTheDocument();
    expect(within(panel).getByText("目标库存 2")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps a requested stock row the retry's batch response never reports", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_TWO_SKUS);
    setStockBatch.mockResolvedValueOnce([
      { skuId: "sku-blue", ok: true, onHand: 2, reserved: 0, available: 2 },
      { skuId: "sku-1", ok: false, error: "库存写入失败" },
    ]);

    renderNewProductPage();
    await fillTwoCandidateSubmit(user);
    await screen.findByText("1 项库存写入失败（其余已保存）");
    // The retry is answered with an empty settlement list.
    setStockBatch.mockResolvedValueOnce([]);

    await user.click(screen.getByRole("button", { name: "重试失败行" }));

    await vi.waitFor(() => expect(setStockBatch).toHaveBeenCalledTimes(2));
    const panel = screen
      .getByText("1 项库存写入失败（其余已保存）")
      .closest("[role='alert']") as HTMLElement;
    expect(within(panel).getByText("Default")).toBeInTheDocument();
    expect(within(panel).getByText("目标库存 4")).toBeInTheDocument();
    expect(screen.getByText("1 项库存更新仍失败。")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("uses one wide sticky editor header before the product is saved", async () => {
    const view = renderNewProductPage();

    await screen.findByRole("tab", { name: "基本信息" });
    expect(
      screen.getByRole("heading", { name: "新建商品" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /返回商品列表/ })).toHaveLength(1);
    expect(screen.getByLabelText("内部商品编号")).toHaveValue("保存后自动生成");
    expect(
      view.container.querySelector(".max-w-\\[1600px\\]"),
    ).not.toBeNull();
  });

  it("never previews or requests an unsaved product", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);

    renderNewProductPage();
    await screen.findByRole("tab", { name: "基本信息" });
    await user.click(screen.getByRole("tab", { name: "预览" }));

    expect(
      screen.getByText("这是新商品，尚未保存，不会请求或打开前台商品页。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "打开已保存的前台页面" }),
    ).not.toBeInTheDocument();
    // No storefront frame is mounted at all, so nothing is fetched from the
    // public product route before the product exists.
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("navigates to the edit page when both phases succeed", async () => {
    const user = userEvent.setup();
    createProduct.mockResolvedValue(CREATED);
    updateProduct.mockResolvedValue(SAVED_WITH_SKU);
    setStockBatch.mockResolvedValue([
      { skuId: "sku-1", ok: true, onHand: 0, reserved: 0, available: 0 },
    ]);

    renderNewProductPage();
    await fillAndSubmit(user);

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/admin/products/created-1/edit");
    });
    expect(setStockBatch).toHaveBeenCalledWith([
      { skuId: "sku-1", onHand: 0, reason: "New product" },
    ]);
  });

  it("maps a create-time slug conflict to the slug copy with no continue link", async () => {
    const user = userEvent.setup();
    createProduct.mockRejectedValue(
      new AdminApiError("Products_service: slug conflict", 409),
    );

    renderNewProductPage();
    await fillAndSubmit(user);

    expect(await screen.findByText(/相同 slug/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /继续编辑该商品/ })).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
