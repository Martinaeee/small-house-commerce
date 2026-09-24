import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "p1" }),
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }),
}));

const getProduct = vi.fn();
const listCategories = vi.fn();
const updateProduct = vi.fn();
const setStock = vi.fn();
const setStockBatch = vi.fn();
const listProductLandingPages = vi.fn();

vi.mock("@/lib/admin-api", () => ({
  adminApi: {
    getProduct: (...args: unknown[]) => getProduct(...args),
    listCategories: (...args: unknown[]) => listCategories(...args),
    updateProduct: (...args: unknown[]) => updateProduct(...args),
    setStock: (...args: unknown[]) => setStock(...args),
    setStockBatch: (...args: unknown[]) => setStockBatch(...args),
    listProductLandingPages: (...args: unknown[]) =>
      listProductLandingPages(...args),
  },
}));

import EditProductPage, {
  buildSavedPreview,
  deserializeProduct,
} from "@/app/admin/(shell)/products/[id]/edit/page";
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
    supplierId: null,
    supplierSku: null,
    supplierCost: null,
    costCurrency: null,
    landedCost: null,
    price: "1299",
    compareAtPrice: null,
    productWeight: null,
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
  await user.click(screen.getByRole("button", { name: /^保存/ }));
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
    ).toEqual({ path: "/products/server-slug", status: "ACTIVE" });
  });
});

describe("EditProductPage save orchestration", () => {
  beforeEach(() => {
    setAdminLang("zh");
    refreshMock.mockReset();
    getProduct.mockReset();
    listCategories.mockReset().mockResolvedValue([CATEGORY]);
    updateProduct.mockReset();
    setStock
      .mockReset()
      .mockResolvedValue({ onHand: 0, reserved: 0, available: 0 });
    setStockBatch.mockReset();
    listProductLandingPages.mockReset().mockResolvedValue([]);
  });

  afterEach(cleanup);

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
