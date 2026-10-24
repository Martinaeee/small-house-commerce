import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  ProductForm,
  appendImage,
  appendImageUrl,
  emptyProductFormValue,
  emptySkuFormValue,
  serializeFormValue,
  type ProductFormValue,
} from "@/components/admin/ProductForm";
import { canonicalCombinationKey, cardGraphFromLegacyForm, type AdminCatalogGraphDraft } from "@/lib/admin-product-graph";
import { adminApi } from "@/lib/admin-api";
import { en } from "@/i18n/en";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// The FAQ tab previews the shared library; this suite is about the product
// form, so the preview resolves empty instead of hitting the network. A plain
// function (not vi.fn) survives the suite's mock resets.
vi.mock("@/lib/faq-api", () => ({
  faqApi: { getSharedPreview: () => Promise.resolve({ items: [] }) },
}));

/**
 * Task 11 — the 409-trap guard. A product whose catalogGraphVersion > 0 must
 * never be edited through the legacy whole-list variants/images form:
 *  - typed payloads (options on the wire) get the new options/matrix editors;
 *  - graph products WITHOUT a typed payload get an explicit lock notice and
 *    the save path strips the legacy keys (backend would 409).
 */

function baseValue(overrides: Partial<ProductFormValue> = {}): ProductFormValue {
  return {
    ...emptyProductFormValue(),
    name: "Chair",
    slug: "chair",
    categoryId: "018f0000-0000-7000-8000-000000000000",
    variants: [],
    // emptyProductFormValue is the NEW-product default (typed editors on);
    // these overrides restore the legacy/locked derivations for each mode.
    graphTyped: false,
    graph: {
      catalogGraphVersion: 0,
      defaultDisplayVariantRef: null,
      options: [],
      variants: [],
      media: [],
    },
    ...overrides,
  };
}

describe("legacy SKU product dimension serialization", () => {
  const axes = ["productWidth", "productDepth", "productHeight"] as const;
  const form = (values: Partial<NonNullable<ProductFormValue["variants"][number]["sku"]>> = {}) =>
    baseValue({ variants: [{
      name: "Default", position: "0",
      sku: { ...emptySkuFormValue(), skuCode: "DIM-1", ...values },
    }] });

  it("serializes LWH product dimensions independently from package values", () => {
    const result = serializeFormValue(form({
      productWidth: "120", productDepth: "60", productHeight: "75",
      packageWidth: "130", packageDepth: "70", packageHeight: "85",
      packageWeight: "5", volumetricWeight: "9",
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.variants![0].sku).toMatchObject({
      productWidth: 120, productDepth: 60, productHeight: 75,
      packageWidth: 130, packageDepth: 70, packageHeight: 85,
      packageWeight: 5, volumetricWeight: 9,
    });
  });

  it.each(axes)("sends empty %s as explicit null to restore inheritance", key => {
    const result = serializeFormValue(form({ [key]: "" }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.variants![0].sku).toHaveProperty(key, null);
  });

  it.each(axes)("preserves explicit zero in %s", key => {
    const result = serializeFormValue(form({ [key]: "0" }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.variants![0].sku).toHaveProperty(key, 0);
  });

  it.each(axes.flatMap(key => ["-1", "NaN", "Infinity", "-Infinity"].map(raw => ({ key, raw }))))
    ("rejects $raw at the $key field", ({ key, raw }) => {
      const result = serializeFormValue(form({ [key]: raw }));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("invalid dimension accepted");
      expect(result.fieldErrors?.[`variants.0.sku.${key}`]).toBeTruthy();
    });
});

describe("compact product specifications", () => {
  it("offers a batch import and a compact SKU table instead of repeated dimension cards", async () => {
    const user = userEvent.setup();
    const form = baseValue({ width: "120", depth: "60", height: "75", variants: [{ id: "chair", name: "3-Tier", position: "0", sku: { ...emptySkuFormValue(), id: "sku-chair", skuCode: "TIER-3" } }] });
    renderForm(form, vi.fn());
    await user.click(screen.getByRole("tab", { name: "商品规格" }));
    expect(screen.getByRole("button", { name: "批量导入" })).toBeVisible();
    expect(screen.getByRole("table", { name: "变体尺寸" })).toBeVisible();
    expect(screen.getByText("TIER-3")).toBeVisible();
    expect(screen.getByText("继承尺寸")).toBeVisible();
    expect(screen.queryByText("前台商品规格自动展示")).not.toBeInTheDocument();
  });
});

describe("SKU product dimension defaults", () => {
  it("starts new legacy SKU dimensions as inherited empty inputs", () => {
    expect(emptySkuFormValue()).toMatchObject({
      productWidth: "",
      productDepth: "",
      productHeight: "",
    });
  });
});

describe("ProductForm card snapshot serialization", () => {
  it.each([null, {
    cover: { type: "IMAGE" as const, url: "/uploads/card.webp", altText: null }, hover: null,
  }])("keeps an explicit legacy snapshot %j without leaking client identities", cardMedia => {
    const row = { id: "real-variant", clientKey: "new-key", name: "Red", position: "0", sku: null, cardMedia };
    const result = serializeFormValue(baseValue({ variants: [row] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.variants).toEqual([{ name: "Red", position: 0, cardMedia }]);
  });

  it("assigns different stable keys to newly added same-named legacy rows", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const view = renderForm(baseValue(), onSubmit);
    await openVariantsTab();
    await user.click(screen.getByRole("button", { name: "添加款式" }));
    await user.click(screen.getByRole("button", { name: "添加款式" }));
    for (const input of screen.getAllByPlaceholderText("Default")) await user.type(input, "Red");
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const rows = (onSubmit.mock.calls[0]![0] as ProductFormValue).variants;
    expect(rows[0]!.clientKey).toBeTruthy();
    expect(rows[1]!.clientKey).toBeTruthy();
    expect(rows[0]!.clientKey).not.toBe(rows[1]!.clientKey);
    expect(rows.every(row => row.cardMedia == null)).toBe(true);
  });

  it("leaves omitted metadata omitted on ordinary legacy saves", () => {
    const result = serializeFormValue(baseValue({ variants: [{ name: "Red", position: "0", sku: null }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.variants[0]).not.toHaveProperty("cardMedia");
  });
});

describe("ProductForm independent card media", () => {
  function legacyValue(): ProductFormValue {
    return baseValue({
      images: [{ id: "photo", url: "/uploads/shared.webp", type: "IMAGE", altText: "Shared", sortOrder: "0", isScene: true }],
      variants: ["Red", "Blue"].map(name => ({ id: name.toLowerCase(), name, position: "0", sku: {
        ...emptySkuFormValue(), id: `${name}-sku`, skuCode: name, price: "0", stock: "9", reserved: "2", packageWidth: "55",
      } })),
    });
  }

  it("does not materialize legacy rows just by opening the card settings", async () => {
    setAdminLang("en");
    const onSubmit = vi.fn();
    const view = renderForm(legacyValue(), onSubmit);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.queryByRole("button", { name: "Red Card cover: Choose from gallery" })).toBeInTheDocument();
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toHaveProperty("graphTyped", false);
  });

  it("materializes the latest legacy draft on the first card edit without copying to another variant", async () => {
    setAdminLang("en");
    const initial = legacyValue();
    const onSubmit = vi.fn();
    const view = renderForm(initial, onSubmit);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    const choose = screen.queryByRole("button", { name: "Red Card cover: Choose from gallery" });
    expect(choose).toBeInTheDocument();
    await userEvent.click(choose!);
    await userEvent.click(screen.getByRole("button", { name: "Choose image 1" }));
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const saved = onSubmit.mock.calls[0]![0] as ProductFormValue;
    expect(saved.graphTyped).toBe(true);
    expect(saved.graph!.variants.find(row => row.id === "red")).toMatchObject({
      cardMedia: { cover: { type: "IMAGE", url: "/uploads/shared.webp", altText: "Shared" }, hover: null },
      sku: { id: "Red-sku", packageWidth: 55, onHand: 9, reserved: 2, price: 0 },
    });
    expect(saved.graph!.variants.find(row => row.id === "blue")?.cardMedia ?? null).toBeNull();
    expect(saved.images).toEqual(initial.images);
    expect(saved.graph!.defaultDisplayVariantRef).toBeNull();
  });

  it("copies the latest unsaved shared gallery image on an explicit typed card edit", async () => {
    setAdminLang("en");
    const initial = legacyValue();
    initial.graph = cardGraphFromLegacyForm(initial);
    initial.graphTyped = true;
    initial.images[0] = { ...initial.images[0]!, url: "/uploads/unsaved-shared.webp", altText: "Latest" };
    const onSubmit = vi.fn();
    const view = renderForm(initial, onSubmit);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    await userEvent.click(screen.getByRole("button", { name: "Red Card cover: Choose from gallery" }));
    await userEvent.click(screen.getByRole("button", { name: "Choose image 1" }));
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const saved = onSubmit.mock.calls[0]![0] as ProductFormValue;
    expect(saved.graph!.variants.find(row => row.id === "red")?.cardMedia?.cover)
      .toEqual({ type: "IMAGE", url: "/uploads/unsaved-shared.webp", altText: "Latest" });
    expect(saved.graph!.variants.find(row => row.id === "blue")?.cardMedia ?? null).toBeNull();
    expect(saved.images).toEqual(initial.images);
  });

  it("uses current legacy identities for card upload targets and locks row creation during upload", async () => {
    setAdminLang("en");
    let resolveUpload!: (result: { url: string; key: string }) => void;
    const upload = vi.spyOn(adminApi, "uploadImage").mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));
    const onSubmit = vi.fn();
    const view = renderForm(legacyValue(), onSubmit);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    const input = screen.queryByLabelText("Red Card cover: Upload image");
    expect(input).toBeInTheDocument();
    await userEvent.upload(input!, new File(["image"], "cover.webp", { type: "image/webp" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("tab", { name: "Options, Pricing & Inventory" }));
    expect(screen.getByRole("button", { name: "Add variant" })).toBeDisabled();
    for (const remove of screen.getAllByRole("button", { name: "Remove variant" })) expect(remove).toBeDisabled();
    resolveUpload({ url: "/uploads/uploaded-card.webp", key: "uploaded-card.webp" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add variant" })).not.toBeInTheDocument());
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const saved = onSubmit.mock.calls[0]![0] as ProductFormValue;
    expect(saved.graph!.variants.find(row => row.id === "red")).toHaveProperty("cardMedia.cover.url", "/uploads/uploaded-card.webp");
    expect(saved.images).toHaveLength(1);
  });

  it.each(["priced", "unpriced", "no-sku"] as const)("previews the %s draft variant without changing the saved default or requiring cart context", async availability => {
    setAdminLang("en");
    const initial = legacyValue();
    initial.graph = cardGraphFromLegacyForm(initial);
    initial.graphTyped = true;
    initial.graph.defaultDisplayVariantRef = { id: "red" };
    initial.graph.variants[1]!.cardMedia = { cover: { type: "IMAGE", url: "/uploads/blue-card.webp", altText: "Blue card" }, hover: null };
    if (availability === "unpriced") initial.graph.variants[1]!.sku!.price = null;
    if (availability === "no-sku") initial.graph.variants[1]!.sku = null;
    const onSubmit = vi.fn();
    const view = renderForm(initial, onSubmit);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    await userEvent.click(screen.getByRole("button", { name: "Blue Preview this variant" }));
    const card = within(view.container.querySelector("article")!);
    expect(card.getByRole("img", { name: "Blue card" })).toHaveAttribute("src", "/uploads/blue-card.webp");
    if (availability !== "priced") expect(card.queryByTestId("price")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Cart" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Chair" })).not.toBeInTheDocument();
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toHaveProperty("graph.defaultDisplayVariantRef", { id: "red" });
  });

  it("locks card edits when the graph payload is unavailable", async () => {
    setAdminLang("en");
    const initial = legacyValue();
    initial.graph!.catalogGraphVersion = 3;
    renderForm(initial);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    expect(screen.getByRole("button", { name: "Red Card cover: Choose from gallery" })).toBeDisabled();
    expect(screen.getByLabelText("Red Card cover: Upload image")).toBeDisabled();
  });

  it("ignores a card upload result after switching to a different product's real identities", async () => {
    setAdminLang("en");
    let resolveUpload!: (result: { url: string; key: string }) => void;
    const upload = vi.spyOn(adminApi, "uploadImage").mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));
    const onSubmit = vi.fn();
    const view = renderForm(legacyValue(), onSubmit);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    await userEvent.upload(screen.getByLabelText("Red Card cover: Upload image"), new File(["image"], "cover.webp", { type: "image/webp" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const next = legacyValue();
    next.variants = next.variants.map(row => ({ ...row, id: `other-${row.id}` }));
    view.rerender(<AdminI18nProvider><ProductForm initial={next} categories={[]} onSubmit={onSubmit} submitLabel="Save changes" pending={false} error={null} savedPreview={null} /></AdminI18nProvider>);
    await act(async () => resolveUpload({ url: "/uploads/late-card.webp", key: "late-card.webp" }));
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const saved = onSubmit.mock.calls[0]![0] as ProductFormValue;
    expect(saved.graphTyped).toBe(false);
    expect(saved.variants.map(row => [row.id, row.cardMedia ?? null])).toEqual([["other-red", null], ["other-blue", null]]);
    expect(saved.images).toEqual(next.images);
  });

  it("ignores a card upload result after the form is unmounted", async () => {
    setAdminLang("en");
    let resolveUpload!: (result: { url: string; key: string }) => void;
    const upload = vi.spyOn(adminApi, "uploadImage").mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));
    const onSubmit = vi.fn();
    const view = renderForm(legacyValue(), onSubmit);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    await userEvent.upload(screen.getByLabelText("Red Card cover: Upload image"), new File(["image"], "cover.webp", { type: "image/webp" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => resolveUpload({ url: "/uploads/late-card.webp", key: "late-card.webp" }));
    expect(onSubmit).not.toHaveBeenCalled();
    const next = renderForm(legacyValue(), onSubmit);
    fireEvent.submit(next.container.querySelector("form")!);
    expect(onSubmit.mock.calls[0]![0]).toHaveProperty("graphTyped", false);
    expect((onSubmit.mock.calls[0]![0] as ProductFormValue).variants.every(row => row.cardMedia == null)).toBe(true);
  });

  it("removes gallery scene assignment controls while preserving the old flag on ordinary saves", async () => {
    setAdminLang("en");
    const onSubmit = vi.fn();
    const view = renderForm(legacyValue(), onSubmit);
    await userEvent.click(screen.getByRole("tab", { name: "Media" }));
    await userEvent.click(screen.getByRole("button", { name: en.product_media_card_cover_aria.replace("{number}", "1") }));
    expect(screen.queryByRole("button", { name: /scene image/i })).not.toBeInTheDocument();
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit.mock.calls[0]![0]).toHaveProperty("images.0.isScene", true);
  });
});

describe("ProductForm scene serialization", () => {
  it("serializes explicit scene metadata without leaking draft identities", () => {
    const result = serializeFormValue(baseValue({ images: [
      { id: "photo-a", url: "/uploads/a.webp", type: "IMAGE", altText: "", sortOrder: "2", isScene: true },
      { clientKey: "photo-b", url: "/uploads/b.webp", type: "IMAGE", altText: "", sortOrder: "5" },
    ] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.images).toEqual([
      { url: "/uploads/a.webp", type: "IMAGE", sortOrder: 2, isScene: true },
      { url: "/uploads/b.webp", type: "IMAGE", sortOrder: 5, isScene: false },
    ]);
  });

  it("gives each newly added shared row a stable unique key and false scene flag", () => {
    const first = appendImageUrl([], "/uploads/a.webp");
    const second = appendImage(first, "VIDEO");
    expect(first[0]?.clientKey).toBeTruthy();
    expect(second[1]?.clientKey).toBeTruthy();
    expect(second[1]?.clientKey).not.toBe(first[0]?.clientKey);
    expect(second.map(row => row.isScene)).toEqual([false, false]);
    expect(second[0]).toEqual(first[0]);
  });
});

const typedGraph: AdminCatalogGraphDraft = {
  catalogGraphVersion: 3,
  defaultDisplayVariantRef: null,
  options: [
    {
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
          label: "Red",
          position: 0,
          swatchHex: null,
          thumbnailUrl: null,
          thumbnailAlt: null,
          isActive: true,
        },
      ],
    },
  ],
  variants: [],
  media: [],
};

function renderForm(initial: ProductFormValue, onSubmit = vi.fn()): ReturnType<typeof render> {
  return render(
    <AdminI18nProvider>
      <ProductForm
        initial={initial}
        categories={[]}
        onSubmit={onSubmit}
        submitLabel="Save changes"
        pending={false}
        error={null}
        savedPreview={null}
      />
    </AdminI18nProvider>,
  );
}

async function openVariantsTab(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "选项、价格与库存" }));
}

describe("ProductForm confirmation-assist integration", () => {
  beforeEach(() => setAdminLang("zh"));

  function initialValue(typed = true): ProductFormValue {
    const initial = baseValue({
      width: "0", depth: "", height: "70",
      foldedWidth: "90", foldedDepth: "40", foldedHeight: "30",
      variants: [{
        id: "variant-1", clientKey: "variant-key-1", name: "Red", position: "0",
        sku: {
          ...emptySkuFormValue(), id: "sku-1", skuCode: "RED-1", price: "1299", stock: "7", reserved: "2",
          productWidth: "120", productDepth: "60", productHeight: "75", productWeight: "2",
          packageWidth: "0", packageDepth: "", packageHeight: "80", packageWeight: "", volumetricWeight: "9",
        },
      }],
    });
    if (typed) {
      initial.graphTyped = true;
      initial.graph = cardGraphFromLegacyForm(initial);
    }
    return initial;
  }

  it("keeps parent values unchanged until confirming empty-only dimensions", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = initialValue();
    const view = renderForm(initial, onSubmit);
    await user.click(screen.getByRole("tab", { name: "商品规格" }));
    await user.click(screen.getByText("解析尺寸", { selector: "summary" }));
    await user.selectOptions(screen.getByLabelText("尺寸顺序"), "LWH");
    await user.type(screen.getByLabelText("粘贴商品尺寸"), "120x60x75cm weight 5kg");
    await user.click(screen.getByRole("button", { name: "解析尺寸" }));
    expect(screen.getByLabelText(/^长/)).toHaveValue("0");
    expect(screen.getByLabelText(/^宽/)).toHaveValue("");
    expect(screen.getByLabelText(/^高/)).toHaveValue("70");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    fireEvent.submit(view.container.querySelector("form")!);
    const submitted = onSubmit.mock.calls[0][0] as ProductFormValue;
    expect(submitted).toMatchObject({ width: "0", depth: "60", height: "70", foldedWidth: "90", foldedDepth: "40", foldedHeight: "30" });
    expect(submitted.graph).toEqual(initial.graph);
    expect(submitted.variants).toEqual(initial.variants);
  });

  it("confirms replacement only into the selected folded parent dimensions", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const view = renderForm(initialValue(), onSubmit);
    await user.click(screen.getByRole("tab", { name: "商品规格" }));
    await user.click(screen.getByText("解析尺寸", { selector: "summary" }));
    await user.selectOptions(screen.getByLabelText("尺寸顺序"), "LWH");
    await user.selectOptions(screen.getByLabelText("填写目标"), "folded");
    await user.type(screen.getByLabelText("粘贴商品尺寸"), "120x60x75cm");
    await user.click(screen.getByRole("button", { name: "解析尺寸" }));
    await user.selectOptions(screen.getByLabelText("应用方式"), "replace");
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ width: "0", depth: "", height: "70", foldedWidth: "120", foldedDepth: "60", foldedHeight: "75" });
  });

  it.each([true, false])("confirms only the intended package fields in typed=%s SKU drafts", async typed => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = initialValue(typed);
    const view = renderForm(initial, onSubmit);
    await user.click(screen.getByRole("tab", { name: "包装与物流" }));
    await user.type(screen.getByLabelText("粘贴包装信息"), "130x70x85cm 5kg");
    await user.click(screen.getByRole("button", { name: "解析包装信息" }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.submit(view.container.querySelector("form")!);
    expect((onSubmit.mock.calls[0][0] as ProductFormValue)[typed ? "graph" : "variants"])
      .toEqual(initial[typed ? "graph" : "variants"]);
    onSubmit.mockClear();
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    fireEvent.submit(view.container.querySelector("form")!);
    const submitted = onSubmit.mock.calls[0][0] as ProductFormValue;
    if (typed) {
      expect(submitted.graph!.variants[0]).toEqual({
        ...initial.graph!.variants[0],
        sku: { ...initial.graph!.variants[0].sku, packageDepth: 70, packageWeight: 5 },
      });
    } else {
      expect(submitted.variants[0]).toEqual({
        ...initial.variants[0],
        sku: { ...initial.variants[0].sku, packageDepth: "70", packageWeight: "5" },
      });
    }
    expect(submitted).toMatchObject({ width: "0", depth: "", height: "70" });
  });

  it("replaces only the chosen SKU package and preserves the sibling and inventory", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = initialValue();
    const sibling = structuredClone(initial.graph!.variants[0]);
    sibling.id = "variant-2";
    sibling.clientKey = "variant-key-2";
    sibling.combinationKey = "sibling";
    sibling.name = "Blue";
    sibling.sku = { ...sibling.sku!, id: "sku-2", skuCode: "BLUE-1" };
    initial.graph!.variants.push(sibling);
    const view = renderForm(initial, onSubmit);
    await user.click(screen.getByRole("tab", { name: "包装与物流" }));
    await user.type(screen.getAllByLabelText("粘贴包装信息")[0], "130x70x85cm 5kg");
    await user.click(screen.getAllByRole("button", { name: "解析包装信息" })[0]);
    await user.selectOptions(screen.getByLabelText("应用模式"), "replace");
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    fireEvent.submit(view.container.querySelector("form")!);
    const graph = (onSubmit.mock.calls[0][0] as ProductFormValue).graph!;
    expect(graph.variants[0]).toEqual({ ...initial.graph!.variants[0], sku: {
      ...initial.graph!.variants[0].sku, packageWidth: 130, packageDepth: 70, packageHeight: 85, packageWeight: 5,
    } });
    expect(graph.variants[1]).toEqual(sibling);
  });

  it.each([true, false])("retains the confirmed typed=%s package draft after a save error and retries unchanged", async typed => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = initialValue(typed);
    const original = structuredClone(initial);
    const view = renderForm(initial, onSubmit);
    await user.click(screen.getByRole("tab", { name: "包装与物流" }));
    await user.type(screen.getByLabelText("粘贴包装信息"), "140x80x95cm 6kg");
    await user.click(screen.getByRole("button", { name: "解析包装信息" }));
    await user.selectOptions(screen.getByLabelText("应用模式"), "replace");
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = structuredClone(onSubmit.mock.calls[0][0]);
    view.rerender(<AdminI18nProvider><ProductForm initial={initial} categories={[]} onSubmit={onSubmit} submitLabel="Save changes" pending={false} error="保存失败，请重试" savedPreview={null} /></AdminI18nProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败，请重试");
    expect(screen.getByLabelText(typed ? "Red 的外包装长" : /^外包装长/)).toHaveValue("140");
    expect(screen.getByLabelText(typed ? "Red 的外包装宽" : /^外包装宽/)).toHaveValue("80");
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toEqual(submitted);
    expect(initial).toEqual(original);
  });

  it("keeps confirmed packaging after validation blocks save and retries after correcting the invalid field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = initialValue();
    initial.slug = "invalid slug";
    const view = renderForm(initial, onSubmit);
    await user.click(screen.getByRole("tab", { name: "包装与物流" }));
    await user.type(screen.getByLabelText("粘贴包装信息"), "140x80x95cm 6kg");
    await user.click(screen.getByRole("button", { name: "解析包装信息" }));
    await user.selectOptions(screen.getByLabelText("应用模式"), "replace");
    await user.click(screen.getByRole("button", { name: "应用解析值" }));
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "包装与物流" }));
    expect(screen.getByLabelText("Red 的外包装长")).toHaveValue("140");
    expect(screen.getByLabelText("Red 的外包装宽")).toHaveValue("80");
    await user.click(view.container.querySelector("#pf-tab-seo")!);
    fireEvent.change(view.container.querySelector("#pf-slug")!, { target: { value: "chair" } });
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].graph.variants[0].sku).toEqual({
      ...initial.graph!.variants[0].sku, packageWidth: 140, packageDepth: 80, packageHeight: 95, packageWeight: 6,
    });
  });

  it.each(["specs", "shipping"])("blocks the %s assist while saving", async section => {
    const user = userEvent.setup();
    render(<AdminI18nProvider><ProductForm initial={initialValue()} categories={[]} onSubmit={vi.fn()} submitLabel="Save" pending error={null} savedPreview={null} requestedSection={section === "specs" ? "specs" : "shipping"} /></AdminI18nProvider>);
    const input = screen.getByLabelText(section === "specs" ? "粘贴商品尺寸" : "粘贴包装信息");
    expect(input).toBeDisabled();
    await user.type(input, "120x60x75cm 5kg");
    expect(input).toHaveValue("");
  });

  it.each([{ section: "specs", typed: true }, { section: "shipping", typed: true }, { section: "shipping", typed: false }])("blocks the $section assist typed=$typed during an in-flight media upload", async ({ section, typed }) => {
    setAdminLang("en");
    const user = userEvent.setup();
    let resolveUpload!: (value: { url: string; key: string }) => void;
    const upload = vi.spyOn(adminApi, "uploadImage").mockReturnValue(new Promise(resolve => { resolveUpload = resolve; }));
    const view = renderForm(initialValue(typed));
    await user.click(screen.getByRole("tab", { name: "Media" }));
    fireEvent.change(screen.getAllByLabelText("Choose media to upload")[0], { target: { files: [new File(["image"], "phase1.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await user.click(view.container.querySelector(`#pf-tab-${section}`)!);
    const input = screen.getByLabelText(section === "specs" ? en.product_dimensions_assist_label : en.packaging_assist_label);
    const parseButton = screen.getByRole("button", { name: section === "specs" ? en.product_dimensions_assist_parse : en.packaging_assist_parse });
    expect(input).toBeDisabled();
    expect(parseButton).toBeDisabled();
    await act(async () => resolveUpload({ url: "/uploads/phase1.jpg", key: "phase1" }));
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "120x60x75cm 5kg");
    expect(parseButton).toBeEnabled();
  });

  it("shows expanded and folded parent inputs in LWH order without swapping values", async () => {
    const user = userEvent.setup();
    const view = renderForm(initialValue());
    await user.click(screen.getByRole("tab", { name: "商品规格" }));
    expect(Array.from(view.container.querySelectorAll<HTMLInputElement>('input[id^="pf-"]')).filter(input => ["pf-width", "pf-depth", "pf-height", "pf-foldedWidth", "pf-foldedDepth", "pf-foldedHeight"].includes(input.id)).map(input => [input.id, input.value]))
      .toEqual([["pf-width", "0"], ["pf-depth", ""], ["pf-height", "70"], ["pf-foldedWidth", "90"], ["pf-foldedDepth", "40"], ["pf-foldedHeight", "30"]]);
  });

  it.each([true, false])("shows package LWH inputs and labels in typed=%s shipping", async typed => {
    const user = userEvent.setup();
    renderForm(initialValue(typed));
    await user.click(screen.getByRole("tab", { name: "包装与物流" }));
    const labels = screen.getAllByRole("textbox").map(input => input.getAttribute("aria-label") ?? document.querySelector(`label[for="${input.id}"]`)?.textContent ?? "");
    expect(labels.filter(label => /外包装[长宽高]/.test(label)).map(label => label.match(/外包装[长宽高]/)![0]))
      .toEqual(["外包装长", "外包装宽", "外包装高"]);
  });
});

describe("ProductForm shared color specifications", () => {
  beforeEach(() => setAdminLang("zh"));

  function initialValue(bundleModes = [false, false]): ProductFormValue {
    const initial = baseValue({
      width: "80", depth: "50", height: "70", graphTyped: true,
      variants: ["Red", "Blue"].map((name, index) => ({
        id: `variant-${index + 1}`, name, position: String(index),
        sku: {
          ...emptySkuFormValue(), id: `sku-${index + 1}`,
          skuCode: `COLOR-${index}`, price: String(100 + index), stock: String(10 + index),
          isBundle: bundleModes[index], productWidth: "100", packageWidth: "110", packageWeight: "5",
        },
      })),
    });
    const converted = cardGraphFromLegacyForm(initial);
    const graph = structuredClone(typedGraph);
    graph.options[0].values.push({ ...graph.options[0].values[0], id: "value-2", label: "Blue", position: 1 });
    graph.variants = converted.variants.map((variant, index) => ({
      ...variant, name: index === 0 ? "Red" : "Blue",
      combinationKey: canonicalCombinationKey([{ optionId: "option-1", valueId: `value-${index + 1}` }]),
      optionValueRefs: [{ id: `value-${index + 1}` }],
    }));
    initial.graph = graph;
    return initial;
  }

  it("edits one packaging group for two colors while preserving their separate price and stock", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const view = renderForm(initialValue(), onSubmit);
    await user.click(screen.getByRole("tab", { name: /包装/ }));
    const widths = screen.getAllByLabelText(/外包装长/);
    expect(widths).toHaveLength(1);
    await user.clear(widths[0]);
    await user.type(widths[0], "140");
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const saved = (onSubmit.mock.calls[0][0] as ProductFormValue).graph!.variants;
    expect(saved.map(variant => variant.sku?.packageWidth)).toEqual([140, 140]);
    expect(saved.map(variant => variant.sku?.price)).toEqual([100, 101]);
    expect(saved.map(variant => variant.sku?.onHand)).toEqual([10, 11]);
  });

  it("hides own product dimensions and the parser for a pure Bundle product", async () => {
    const user = userEvent.setup();
    renderForm(initialValue([true, true]));
    await user.click(screen.getByRole("tab", { name: "商品规格" }));
    expect(screen.queryByLabelText("粘贴商品尺寸")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^长（cm）/)).not.toBeInTheDocument();
    expect(screen.getByText("产品尺寸沿用组件商品")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /包装/ }));
    expect(screen.getAllByLabelText(/外包装长/)).toHaveLength(1);
  });

  it("retains ordinary product defaults but does not offer per-Bundle product-size inputs", async () => {
    const user = userEvent.setup();
    renderForm(initialValue([false, true]));
    await user.click(screen.getByRole("tab", { name: "商品规格" }));
    await user.click(screen.getByText("解析尺寸", { selector: "summary" }));
    expect(screen.getByLabelText("粘贴商品尺寸")).toBeVisible();
    await openVariantsTab();
    expect(screen.queryByLabelText("Blue 的商品长（cm）")).not.toBeInTheDocument();
  });
});

describe("ProductForm SKU dimension integration", () => {
  it("copies current product defaults through the matrix into the submitted draft", async () => {
    setAdminLang("zh");
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const view = renderForm(baseValue({
      width: "100", depth: "50", height: "70", graphTyped: true,
      graph: structuredClone(typedGraph),
    }), onSubmit);
    await openVariantsTab();
    await user.type(screen.getByLabelText("Red 的 SKU 编码"), "DIM-RED");
    await user.type(screen.getByLabelText("Red 的售价"), "1000");
    expect(screen.getByText("继承商品：100 cm")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "应用商品尺寸到全部已有 SKU" }));
    await user.click(screen.getByRole("button", { name: "编辑规格组" }));
    expect(screen.getByRole("tab", { name: "商品规格" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("Red 长（cm）")).toHaveValue("100");
    expect(screen.getByLabelText("Red 宽（cm）")).toHaveValue("50");
    expect(screen.getByLabelText("Red 高（cm）")).toHaveValue("70");
    await user.click(screen.getByRole("button", { name: "取消编辑" }));
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((onSubmit.mock.calls[0][0] as ProductFormValue).graph!.variants[0].sku)
      .toMatchObject({ productWidth: 100, productDepth: 50, productHeight: 70 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderFormWithError(
  initial: ProductFormValue,
  error: string,
): ReturnType<typeof render> {
  return render(
    <AdminI18nProvider>
      <ProductForm
        initial={initial}
        categories={[]}
        onSubmit={vi.fn()}
        submitLabel="Save changes"
        pending={false}
        error={error}
        savedPreview={null}
      />
    </AdminI18nProvider>,
  );
}

/**
 * The problem rail. Blocking problems live inside the sticky chrome, say what
 * is wrong in the operator's language, and carry the repair — so a rejected
 * save never leaves the operator guessing.
 */
describe("ProductForm problem rail", () => {
  beforeEach(() => {
    setAdminLang("zh");
  });

  const brokenOption: AdminCatalogGraphDraft = {
    ...typedGraph,
    options: [
      {
        ...typedGraph.options[0],
        values: typedGraph.options[0].values.map((value) => ({
          ...value,
          isActive: false,
        })),
      },
    ],
  };

  it("keeps the problem inside the sticky header so scrolling never hides it", async () => {
    const user = userEvent.setup();
    renderForm(baseValue({ graphTyped: true, graph: brokenOption }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    const rail = screen.getByRole("alert");
    expect(rail.textContent).toContain("1 个问题待处理");
    expect(rail.textContent).toContain("启用的选项 Color 至少需要一个启用的选项值。");
    expect(rail.closest(".sticky")).not.toBeNull();
    const variantsTab = screen.getByRole("tab", {
      name: /选项、价格与库存/,
    });
    expect(
      within(variantsTab).getByLabelText("1 个阻断问题"),
    ).toHaveClass("bg-admin-error");
  });

  it("repairs the graph in one click and clears itself", async () => {
    const user = userEvent.setup();
    renderForm(baseValue({ graphTyped: true, graph: brokenOption }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await user.click(screen.getByRole("button", { name: "查看" }));

    expect(screen.getByText("前台至少需要一个可选项才能渲染选择器，所以启用中的选项不能没有启用的选项值。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "停用这个选项" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "选项、价格与库存" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("turns a raw backend rejection into the same translated card", async () => {
    const user = userEvent.setup();
    renderFormWithError(
      baseValue({ graphTyped: true, graph: brokenOption }),
      "Validation failed: catalogGraph.options: Active option Color must have at least one active value.",
    );

    const rail = screen.getByRole("alert");
    expect(rail.textContent).toContain("启用的选项 Color 至少需要一个启用的选项值。");
    expect(rail.textContent).not.toContain("Validation failed");

    await user.click(screen.getByRole("button", { name: "查看" }));
    expect(
      screen.getByRole("button", { name: "停用这个选项" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /跳到该选项/ }));
    expect(screen.getByRole("tab", { name: "选项、价格与库存" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps an unrecognized rejection readable and copyable", async () => {
    const user = userEvent.setup();
    renderFormWithError(
      baseValue({ graphTyped: true, graph: typedGraph }),
      "Validation failed: slug: A product with this slug already exists.",
    );

    await user.click(screen.getByRole("button", { name: "查看" }));
    // The collapsed line and the expanded card both carry the text.
    expect(
      screen.getAllByText("slug: A product with this slug already exists."),
    ).not.toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "复制错误信息" }),
    ).toBeInTheDocument();
  });
});

describe("ProductForm variants tab modes", () => {
  beforeEach(() => {
    setAdminLang("zh");
  });

  it("opens and focuses exact legacy SKU inputs across same-page requests without timers", () => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const scrollIntoView = vi.spyOn(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const initial = baseValue({
      variants: [
        {
          name: "Legacy 1",
          position: "0",
          sku: {
            skuCode: "LEGACY-1",
            status: "ACTIVE",
            isBundle: false,
            bundleVersion: 0,
            price: "1299",
            compareAtPrice: "",
            supplierSku: "",
            supplierCost: "",
            costCurrency: "",
            landedCost: "",
            productWidth: "", productDepth: "", productHeight: "", productWeight: "",
            packageWidth: "",
            packageHeight: "",
            packageDepth: "",
            packageWeight: "",
            volumetricWeight: "",
            id: "sku-legacy-1",
            stock: "5",
            reserved: "0",
          },
        },
        {
          name: "Legacy 2",
          position: "1",
          sku: {
            skuCode: "LEGACY-2",
            status: "ACTIVE",
            isBundle: false,
            bundleVersion: 0,
            price: "1399",
            compareAtPrice: "",
            supplierSku: "",
            supplierCost: "",
            costCurrency: "",
            landedCost: "",
            productWidth: "", productDepth: "", productHeight: "", productWeight: "",
            packageWidth: "",
            packageHeight: "",
            packageDepth: "",
            packageWeight: "",
            volumetricWeight: "",
            id: "sku-legacy-2",
            stock: "3",
            reserved: "0",
          },
        },
      ],
    });
    const renderRequested = (requestedSkuCode: string | null) => (
      <AdminI18nProvider>
        <ProductForm
          initial={initial}
          categories={[]}
          onSubmit={vi.fn()}
          pending={false}
          error={null}
          savedPreview={null}
          requestedSection="variants"
          requestedSkuCode={requestedSkuCode}
        />
      </AdminI18nProvider>
    );

    const view = render(renderRequested("LEGACY-2"));
    expect(
      screen.getByLabelText(/SKU 编码/, {
        selector: "#pf-variants-1-sku-code",
      }),
    ).toHaveFocus();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "center" });

    view.rerender(renderRequested("LEGACY-1"));
    expect(
      screen.getByLabelText(/SKU 编码/, {
        selector: "#pf-variants-0-sku-code",
      }),
    ).toHaveFocus();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "center" });

    view.rerender(renderRequested("UNKNOWN"));
    expect(
      screen.getByLabelText(/SKU 编码/, {
        selector: "#pf-variants-0-sku-code",
      }),
    ).toHaveFocus();
  });

  it("shows the typed editors for graph payloads and hides Add variant", async () => {
    renderForm(baseValue({ graphTyped: true, graph: typedGraph }));
    await openVariantsTab();

    expect(
      screen.getByRole("button", { name: /添加选项组/ }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: "添加款式" })).not.toBeInTheDocument();
    expect(screen.getByText(/候选款式/)).toBeInTheDocument();
  });

  it("locks variant, media, and shipping editing for graph products without a typed payload", async () => {
    const user = userEvent.setup();
    const locked: AdminCatalogGraphDraft = {
      ...typedGraph,
      catalogGraphVersion: 2,
      options: [],
    };
    renderForm(
      baseValue({
        graphTyped: false,
        graph: locked,
        images: [
          {
            url: "https://example.com/locked.jpg",
            type: "IMAGE",
            altText: "Locked",
            sortOrder: "0",
          },
        ],
      }),
    );
    await openVariantsTab();

    expect(screen.getByRole("alert")).toHaveTextContent(/类型化选项图/);
    expect(screen.queryByRole("button", { name: "添加款式" })).not.toBeInTheDocument();

    // Media tab: the gallery is locked too (images writes would 409).
    await user.click(screen.getByRole("tab", { name: "商品媒体" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(
      within(screen.getByRole("list", { name: "共享媒体卡片" })).getByRole(
        "listitem",
      ),
    ).toHaveAttribute("draggable", "false");

    // Shipping tab: sku fields are locked as well.
    await user.click(screen.getByRole("tab", { name: "包装与物流" }));
    expect(screen.getByText(/物流字段编辑已暂停/)).toBeInTheDocument();
  });

  it("keeps the legacy editor for version-0 products", async () => {
    renderForm(baseValue());
    await openVariantsTab();

    expect(screen.getByRole("button", { name: "添加款式" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /添加选项组/ })).not.toBeInTheDocument();
  });

  it("blocks submit with the graph validation errors before serializing", async () => {
    const user = userEvent.setup();
    const badGraph: AdminCatalogGraphDraft = {
      ...typedGraph,
      options: [
        {
          ...typedGraph.options[0],
          values: [
            {
              id: "value-1",
              label: "Red",
              position: 0,
              swatchHex: null,
              thumbnailUrl: null,
              thumbnailAlt: null,
              isActive: true,
            },
            {
              id: "value-2",
              label: "red",
              position: 1,
              swatchHex: null,
              thumbnailUrl: null,
              thumbnailAlt: null,
              isActive: true,
            },
          ],
        },
      ],
    };
    const onSubmit = vi.fn();
    renderForm(baseValue({ graphTyped: true, graph: badGraph }));
    await openVariantsTab();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "选项 Color 中存在重复的启用值标签：red。",
    );
  });

  it("localizes empty active-option graph validation in Chinese", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(
      baseValue({
        graphTyped: true,
        graph: {
          ...typedGraph,
          options: [{ ...typedGraph.options[0], values: [] }],
        },
      }),
      onSubmit,
    );

    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "启用的选项 Color 至少需要一个启用的选项值。",
    );
  });

  it("localizes structural graph validation in English with interpolation", async () => {
    setAdminLang("en");
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(
      baseValue({
        graphTyped: true,
        graph: {
          ...typedGraph,
          options: [{ ...typedGraph.options[0], values: [] }],
        },
      }),
      onSubmit,
    );

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Active option Color must have at least one active value.",
    );
  });

  it("uses stable tab keys, translated labels, and roving keyboard navigation", async () => {
    renderForm(baseValue());

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.id)).toEqual([
      "pf-tab-basic",
      "pf-tab-media",
      "pf-tab-variants",
      "pf-tab-specs",
      "pf-tab-shipping",
      "pf-tab-seo",
      "pf-tab-faq",
      "pf-tab-preview",
    ]);
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "基本信息",
      "商品媒体",
      "选项、价格与库存",
      "商品规格",
      "包装与物流",
      "搜索与链接",
      "FAQ",
      "预览",
    ]);
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");

    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-media",
    );
    expect(document.activeElement).toBe(tabs[1]);

    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-preview",
    );
    expect(document.activeElement).toBe(tabs[7]);
  });

  it("activates an unselected focused tab with Enter and Space", () => {
    renderForm(baseValue());

    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[0]);
    tabs[5].focus();
    expect(tabs[5]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-basic",
    );
    fireEvent.keyDown(tabs[5], { key: "Enter" });
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-seo",
    );

    tabs[7].focus();
    expect(tabs[7]).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(tabs[7], { key: " " });
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-preview",
    );
  });

  it("gives the product FAQ its own tab instead of the bottom of Basic Info", async () => {
    const user = userEvent.setup();
    renderForm(baseValue());

    // Basic Info no longer buries the FAQ editor at its end.
    expect(
      screen.queryByRole("heading", { name: "FAQ 与购买说明" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "FAQ" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-faq",
    );
    expect(
      screen.getByRole("heading", { name: "FAQ 与购买说明" }),
    ).toBeInTheDocument();
  });

  it("serializes blank and filled SEO fields independently from storefront copy", () => {
    const filled = serializeFormValue(
      baseValue({
        description: "Product body",
        tagline: "Hero tagline",
        seoTitle: "  Search title  ",
        metaDescription: "  Search description  ",
      }),
    );
    expect(filled).toMatchObject({
      ok: true,
      value: {
        description: "Product body",
        tagline: "Hero tagline",
        seoTitle: "Search title",
        metaDescription: "Search description",
      },
    });

    const blank = serializeFormValue(
      baseValue({ seoTitle: "   ", metaDescription: "   " }),
    );
    expect(blank).toMatchObject({
      ok: true,
      value: { seoTitle: null, metaDescription: null },
    });
  });

  it("edits independent SEO fields and uses saved variant identities for links", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AdminI18nProvider>
        <ProductForm
          initial={baseValue({
            status: "ACTIVE",
            description: "Storefront body",
            tagline: "Hero tagline",
            seoTitle: "Old SEO title",
            metaDescription: "Old meta description",
          })}
          categories={[]}
          onSubmit={onSubmit}
          pending={false}
          error={null}
          savedPreview={{
            path: "/products/saved-chair",
            status: "ACTIVE",
            variants: [
              {
                id: "00000000-0000-7000-8000-000000000001",
                name: "Red / Small",
                skuStatus: "ACTIVE",
              },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "搜索与链接" }));
    await user.clear(screen.getByLabelText(/SEO 标题/));
    await user.type(screen.getByLabelText(/SEO 标题/), "New SEO title");
    await user.clear(screen.getByLabelText(/Meta 描述/));
    await user.type(screen.getByLabelText(/Meta 描述/), "New meta description");

    expect(
      screen.getByText(
        "https://luwag.ph/products/saved-chair?variant=00000000-0000-7000-8000-000000000001",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "保存更改" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      seoTitle: "New SEO title",
      metaDescription: "New meta description",
      description: "Storefront body",
      tagline: "Hero tagline",
    });
  });

  it("uses translated section names in the Chinese validation summary", async () => {
    const user = userEvent.setup();
    renderForm(baseValue({ slug: "not a valid slug" }));

    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "请修正标红字段后重试。（出错位置：搜索与链接）",
    );
  });

  it("uses a coherent English validation summary", async () => {
    setAdminLang("en");
    const user = userEvent.setup();
    renderForm(baseValue({ slug: "not a valid slug" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "Please fix the highlighted fields and try again. (Sections: SEO & Links)",
    );
  });

  it("submits exactly once with the selected status through one primary action", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(baseValue({ status: "DRAFT" }), onSubmit);

    await user.selectOptions(screen.getByLabelText("状态"), "ACTIVE");
    expect(screen.getByRole("button", { name: "保存并发布" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存并发布" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ status: "ACTIVE" });
  });

  it("uses saved ACTIVE truth to label an unchanged active save as changes", () => {
    render(
      <AdminI18nProvider>
        <ProductForm
          initial={baseValue({ status: "ACTIVE" })}
          categories={[]}
          onSubmit={vi.fn()}
          submitLabel="ignored"
          pending={false}
          error={null}
          savedPreview={{ path: "/products/chair", status: "ACTIVE" }}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("button", { name: "保存更改" })).toBeInTheDocument();
  });

  it("disables the one primary save action while pending", () => {
    render(
      <AdminI18nProvider>
        <ProductForm
          initial={baseValue()}
          categories={[]}
          onSubmit={vi.fn()}
          pending
          error={null}
          savedPreview={null}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
  });

  it("uses the unpublish action for the disabled wire status", () => {
    renderForm(baseValue({ status: "DISABLED" }));
    expect(screen.getByRole("button", { name: "保存并下架" })).toBeInTheDocument();
  });

  it("renders a coherent English navigation block through the existing provider", () => {
    setAdminLang("en");
    renderForm(baseValue());

    expect(screen.getByRole("tab", { name: "Basic Info" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Media" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Options, Pricing & Inventory" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Specifications" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Shipping" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "SEO & Links" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "FAQ" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
  });

  it("routes graph media URL validation errors to the media tab", async () => {
    const user = userEvent.setup();
    const badGraph: AdminCatalogGraphDraft = {
      ...typedGraph,
      media: [
        {
          clientKey: "media-bad",
          url: "not-a-url",
          type: "IMAGE",
          altText: null,
          sortOrder: 0,
          optionValueRef: null,
          variantRef: null,
        },
      ],
    };
    renderForm(baseValue({ graphTyped: true, graph: badGraph }));

    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(screen.getByRole("tab", { name: "商品媒体" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-media",
    );
  });

  it("reveals shared and detail field errors inside the extracted media workspaces", async () => {
    const user = userEvent.setup();
    renderForm(
      baseValue({
        images: [
          {
            url: "not-a-url",
            type: "IMAGE",
            altText: "Shared image",
            sortOrder: "0",
          },
        ],
        detailBlocks: [
          {
            type: "IMAGE",
            url: "/uploads/detail.jpg",
            altText: "x".repeat(256),
            sortOrder: "0",
          },
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(screen.getByRole("tab", { name: "商品媒体" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("图片网址必须是有效链接。")).toBeVisible();
    expect(screen.getByText("Alt 文本不能超过 255 个字符。")).toBeVisible();
    expect(screen.getByLabelText("媒体 1 的网址")).toBeVisible();
    expect(screen.getByLabelText("媒体 1 的网址")).toHaveFocus();
  });

  it("opens and focuses a scoped media row when the problem rail jumps to it", async () => {
    const user = userEvent.setup();
    const badScopedGraph: AdminCatalogGraphDraft = {
      ...structuredClone(typedGraph),
      options: typedGraph.options.map((option) => ({
        ...structuredClone(option),
        isMediaDriver: true,
      })),
      media: [
        {
          id: "media-bad-scoped",
          url: "not-a-url",
          type: "IMAGE",
          altText: null,
          sortOrder: 0,
          optionValueRef: { id: "value-1" },
          variantRef: null,
        },
      ],
    };
    renderForm(baseValue({ graphTyped: true, graph: badScopedGraph }));

    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await user.click(screen.getByRole("button", { name: "查看" }));
    await user.click(screen.getByRole("button", { name: /跳到该选项/ }));

    const scope = screen
      .getByLabelText("Color / Red 媒体摘要")
      .closest("details");
    expect(scope).toHaveAttribute("open");
    expect(screen.getByLabelText("Red 1 的媒体 URL")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByLabelText("Red 1 的媒体 URL")).toHaveFocus();
    });
  });

  it("preserves character-by-character typed shipping decimals", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const graph: AdminCatalogGraphDraft = {
      ...typedGraph,
      variants: [
        {
          id: "variant-1",
          name: "Red",
          position: 0,
          combinationKey: canonicalCombinationKey([{ optionId: "option-1", valueId: "value-1" }]),
          optionValueRefs: [{ id: "value-1" }],
          sku: {
            id: "sku-1",
            skuCode: "RED-1",
            status: "ACTIVE",
            isBundle: false,
            bundleVersion: 0,
            supplierSku: null,
            supplierCost: null,
            costCurrency: null,
            landedCost: null,
            price: 1299,
            compareAtPrice: null,
            productWidth: null, productDepth: null, productHeight: null, productWeight: null,
            packageWidth: null,
            packageHeight: null,
            packageDepth: null,
            packageWeight: null,
            volumetricWeight: null,
            onHand: 0,
          },
        },
      ],
    };
    renderForm(baseValue({ graphTyped: true, graph }), onSubmit);

    await user.click(screen.getByRole("tab", { name: "包装与物流" }));
    const weight = screen.getByLabelText("Red 的产品净重");
    await user.type(weight, "1.5");
    expect(weight).toHaveValue("1.5");

    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0].graph?.variants[0].sku?.productWeight).toBe(1.5);

    onSubmit.mockClear();
    await user.clear(weight);
    await user.paste("25.");
    expect(weight).toHaveValue("25.");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0].graph?.variants[0].sku?.productWeight).toBe(25);
  });
});

/**
 * Task 3 — remaining localization, concise help copy, error-to-section
 * routing, and jsdom-verifiable responsive/a11y contracts.
 */
describe("ProductForm Task 3 localization and structure", () => {
  beforeEach(() => {
    setAdminLang("zh");
  });

  const legacyWithSku = baseValue({
    variants: [
      {
        name: "Default",
        position: "0",
        sku: {
          skuCode: "SH-1",
          status: "ACTIVE",
          isBundle: false,
          bundleVersion: 0,
          price: "1299",
          compareAtPrice: "",
          supplierSku: "",
          supplierCost: "",
          costCurrency: "",
          landedCost: "",
          productWidth: "", productDepth: "", productHeight: "", productWeight: "",
          packageWidth: "",
          packageHeight: "",
          packageDepth: "",
          packageWeight: "",
          volumetricWeight: "",
          id: "sku-1",
          stock: "5",
          reserved: "0",
        },
      },
    ],
  });

  it("translates enum option labels while the payload keeps wire values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(baseValue({ room: "BEDROOM" }), onSubmit);

    expect(screen.getByRole("option", { name: "卧室" })).toHaveAttribute(
      "value",
      "BEDROOM",
    );
    expect(screen.queryByRole("option", { name: /BEDROOM/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      room: "BEDROOM",
      name: "Chair",
      slug: "chair",
    });
  });

  it("keeps workflow guidance collapsed and lightly groups Basic Info", () => {
    renderForm(baseValue());

    expect(screen.queryByText(/上架流程（新商品按此顺序操作）/)).not.toBeInTheDocument();
    const help = screen.getByText("上架与保存帮助").closest("details");
    expect(help).not.toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "前台商品信息" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "运营属性" })).toBeInTheDocument();
  });

  it("marks recommendation tabs in amber without turning them into blocking errors", () => {
    renderForm(baseValue({ tagline: "", description: "" }));

    const seoTab = screen.getByRole("tab", { name: /搜索与链接/ });
    expect(within(seoTab).getByLabelText("1 条建议")).toHaveClass("bg-admin-warning");
    expect(
      within(seoTab).queryByLabelText(/阻断问题/),
    ).not.toBeInTheDocument();
  });

  it("keeps a wrapping sticky header with a horizontally scrollable tab row", () => {
    renderForm(baseValue());

    expect(screen.getByRole("tablist").className).toContain("overflow-x-auto");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeInTheDocument();
  });

  it("keeps the wide side rail below the sticky editor header", () => {
    renderForm(baseValue());

    const rail = screen.getByRole("heading", { name: "发布检查" }).closest("aside");
    expect(rail).not.toBeNull();
    expect(rail?.className).toContain("xl:top-52");
  });

  it("routes a shipping-field error to the shipping tab", async () => {
    const user = userEvent.setup();
    renderForm(
      baseValue({
        variants: [
          {
            ...legacyWithSku.variants[0],
            sku: legacyWithSku.variants[0].sku
              ? { ...legacyWithSku.variants[0].sku!, packageWidth: "abc" }
              : null,
          },
        ],
      }),
    );
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-shipping",
    );
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("包装与物流");
  });

  it("routes a dimension error to the specs tab", async () => {
    const user = userEvent.setup();
    renderForm(baseValue({ width: "abc" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-specs",
    );
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("商品规格");
  });

  it("renders the field-level validation message in Chinese, not the English default", async () => {
    const user = userEvent.setup();
    renderForm(baseValue({ width: "abc" }));
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    // The per-field error under the width input (its own role=alert) is the
    // translated zh sentence — serializeFormValue must receive the active
    // translator, not fall back to the English dictionary.
    expect(screen.getByText("长 必须是数字。")).toBeInTheDocument();
  });

  it("renders one stock input and one primary submit per form (no duplicate ids)", async () => {
    renderForm(legacyWithSku);
    await openVariantsTab();

    expect(document.querySelectorAll('[id="pf-variants-0-stock"]')).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "保存草稿" })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "在售" })).toHaveAttribute("value", "ACTIVE");
    expect(screen.getByRole("option", { name: "停售" })).toHaveAttribute("value", "DISABLED");
  });

  it("shows the stable product number as read-only in Basic Info", () => {
    render(
      <AdminI18nProvider>
        <ProductForm
          initial={baseValue()}
          categories={[]}
          onSubmit={vi.fn()}
          pending={false}
          error={null}
          savedPreview={{ path: "/products/chair", status: "DRAFT" }}
          identity={{
            name: "Chair",
            productCode: "P-000042",
            coverImageUrl: null,
            updatedAt: "2026-09-24T08:15:00.000Z",
          }}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "Chair" })).toBeInTheDocument();
    expect(screen.getByLabelText("内部商品编号")).toHaveValue("P-000042");
    expect(screen.getByLabelText("内部商品编号")).toHaveAttribute("readonly");
    expect(screen.getByText(/上次保存/)).toBeInTheDocument();
  });

  it("labels an unsaved new product and explains when its number is generated", () => {
    renderForm(baseValue());

    expect(screen.getByRole("heading", { name: "新建商品" })).toBeInTheDocument();
    expect(screen.getByLabelText("内部商品编号")).toHaveValue("保存后自动生成");
    expect(screen.getByLabelText("内部商品编号")).toHaveAttribute("readonly");
  });

  it("preserves detail-media payload fields and keeps all three media lines disjoint", async () => {
    setAdminLang("en");
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const graph = baseValue().graph!;
    renderForm(
      baseValue({
        images: [
          {
            url: "/uploads/shared.jpg",
            type: "IMAGE",
            altText: "Shared",
            sortOrder: "0",
          },
        ],
        detailBlocks: [
          {
            type: "IMAGE",
            url: "/uploads/detail-a.jpg",
            altText: "Detail A",
            sortOrder: "0",
          },
          {
            type: "IMAGE",
            url: "/uploads/detail-b.jpg",
            altText: "Detail B",
            sortOrder: "1",
          },
        ],
        graph: {
          ...graph,
          media: [
            {
              id: "scoped-media",
              url: "/uploads/scoped.jpg",
              type: "IMAGE",
              altText: "Scoped",
              sortOrder: 0,
              optionValueRef: { id: "value-scoped" },
              variantRef: null,
            },
          ],
        },
      }),
      onSubmit,
    );
    await user.click(screen.getByRole("tab", { name: "Media" }));

    await user.click(screen.getByRole("button", { name: "Edit Detail content (images / videos) media 1" }));
    fireEvent.change(screen.getByLabelText("Detail block 1 alt text"), {
      target: { value: "Detail A updated" },
    });
    await user.click(
      screen.getByRole("button", { name: "Move detail block 1 down" }),
    );
    await user.click(screen.getByRole("button", { name: "Add detail video" }));
    fireEvent.change(screen.getByLabelText("Detail block 3 URL"), {
      target: { value: "/uploads/detail-c.mp4" },
    });
    fireEvent.change(screen.getByLabelText("Detail block 3 alt text"), {
      target: { value: "Detail C" },
    });

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]?.[0] as ProductFormValue;
    expect(submitted.detailBlocks).toEqual([
      {
        type: "IMAGE",
        url: "/uploads/detail-b.jpg",
        altText: "Detail B",
        sortOrder: "0",
      },
      {
        type: "IMAGE",
        url: "/uploads/detail-a.jpg",
        altText: "Detail A updated",
        sortOrder: "1",
      },
      {
        type: "VIDEO",
        url: "/uploads/detail-c.mp4",
        altText: "Detail C",
        sortOrder: "2",
      },
    ]);
    expect(submitted.images).toEqual([
      {
        url: "/uploads/shared.jpg",
        type: "IMAGE",
        altText: "Shared",
        sortOrder: "0",
      },
    ]);
    expect(submitted.graph?.media).toEqual([
      expect.objectContaining({
        id: "scoped-media",
        optionValueRef: { id: "value-scoped" },
        variantRef: null,
      }),
    ]);
    expect(submitted.graph?.media).toHaveLength(1);
  });

  it("keeps shared-media rows parent-owned while the workspace remounts", async () => {
    setAdminLang("en");
    const user = userEvent.setup();
    renderForm(
      baseValue({
        images: [
          {
            url: "https://example.com/a.jpg",
            type: "IMAGE",
            altText: "Original",
            sortOrder: "0",
          },
          { url: "", type: "IMAGE", altText: "", sortOrder: "1" },
        ],
      }),
    );
    await user.click(screen.getByRole("tab", { name: "Media" }));

    expect(screen.getByText("Rows 2")).toBeInTheDocument();
    expect(screen.getByText("Usable 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Media 1 (cover)" }));
    await user.selectOptions(screen.getByLabelText("Media 1 type"), "VIDEO");
    await user.clear(screen.getByLabelText("Media 1 alt text"));
    await user.type(screen.getByLabelText("Media 1 alt text"), "Updated");

    await user.click(screen.getByRole("tab", { name: "Basic Info" }));
    await user.click(screen.getByRole("tab", { name: "Media" }));
    await user.click(screen.getByRole("button", { name: "Media 1 (cover)" }));

    expect(screen.getByLabelText("Media 1 type")).toHaveValue("VIDEO");
    expect(screen.getByLabelText("Media 1 alt text")).toHaveValue("Updated");

    await user.click(screen.getByRole("button", { name: "Add photo" }));
    expect(screen.getByText("Rows 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Media 3" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps explicit keyboard media reordering with translated controls that wrap", async () => {
    const user = userEvent.setup();
    renderForm(
      baseValue({
        images: [
          { url: "https://example.com/a.jpg", type: "IMAGE", altText: "", sortOrder: "0" },
          { url: "https://example.com/b.jpg", type: "IMAGE", altText: "", sortOrder: "1" },
        ],
      }),
    );
    await user.click(screen.getByRole("tab", { name: "商品媒体" }));

    const moveLeft = screen.getByRole("button", { name: "将媒体 1 左移" });
    expect(moveLeft).toBeDisabled();
    expect(screen.getByRole("button", { name: "将媒体 1 右移" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "设为封面" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "移除媒体" })).toHaveLength(2);
    expect(screen.getByText("封面")).toBeInTheDocument();
    expect(moveLeft.closest("[data-media-actions]")).not.toBeNull();
  });

  it("renders a coherent English basic tab", () => {
    setAdminLang("en");
    renderForm(baseValue({ room: "BEDROOM" }));

    expect(screen.getByLabelText(/Name \*/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bedroom" })).toHaveAttribute(
      "value",
      "BEDROOM",
    );
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.queryByText(/上架流程/)).not.toBeInTheDocument();
  });

  it("pairs identity and category fields before the compact full-width description", () => {
    const { container } = renderForm(baseValue());
    const grid = container.querySelector("#pf-name")?.closest(".grid");
    expect([...grid!.querySelectorAll("input, select, textarea")].map((control) => control.id)).toEqual([
      "pf-name", "pf-product-code", "pf-category", "pf-tagline", "pf-description",
    ]);
    expect(container.querySelector("#pf-product-code")).toHaveAttribute("readonly");
    expect(container.querySelector("#pf-description")).toHaveAttribute("rows", "3");
  });

  it("gives the editing column the remaining width beside a fixed 280px rail", () => {
    const { container } = renderForm(baseValue());

    const panel = container.querySelector("#pf-panel-basic");
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass("gap-6");
    const grid = panel?.parentElement;
    expect(grid).toHaveClass("xl:grid-cols-[minmax(0,1fr)_280px]");
    expect(grid?.querySelector("aside")).not.toBeNull();
  });
});

describe("ProductForm live Default baseline", () => {
  it("saves the real option after a price-only Default becomes obsolete", async () => {
    setAdminLang("zh");
    const initial = baseValue({ variants: [{ id: "red", name: "Red", position: "0", sku: { ...emptySkuFormValue(), skuCode: "RED", price: "4499", stock: "6" } }] });
    const graph = cardGraphFromLegacyForm(initial);
    graph.variants.unshift({ clientKey: "variant-", name: "Default", position: 0, combinationKey: "", optionValueRefs: [], sku: { ...structuredClone(graph.variants[0].sku!), skuCode: "", onHand: 0 } });
    graph.defaultDisplayVariantRef = { clientKey: "variant-" };
    const before = structuredClone(graph);
    const onSubmit = vi.fn();
    const view = renderForm({ ...initial, graphTyped: true, graph }, onSubmit);
    await openVariantsTab();
    fireEvent.change(screen.getByLabelText("Red 的 SKU 编码"), { target: { value: "RED-UPDATED" } });
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const saved = onSubmit.mock.calls[0]![0] as ProductFormValue;
    expect(saved.graph!.variants).toHaveLength(1);
    expect(saved.graph!.variants[0]).toMatchObject({ id: "red", sku: { skuCode: "RED-UPDATED", price: 4499, onHand: 6 } });
    expect(saved.graph!.defaultDisplayVariantRef).toBeNull();
    expect(graph).toEqual(before);
  });
});

describe("ProductForm media add helpers", () => {
  it.each([
    [[1], "2"],
    [[2], "3"],
    [[10, 20], "21"],
  ])("appends after existing sort orders %j without changing the cover", (orders, expected) => {
    const images = orders.map((order) => ({
      url: `/uploads/${order}.jpg`, type: "IMAGE" as const,
      altText: "", sortOrder: String(order),
    }));
    for (const next of [appendImageUrl(images, "/uploads/new.jpg"), appendImage(images, "IMAGE")]) {
      expect(next.slice(0, -1)).toEqual(images);
      expect(next.at(-1)?.sortOrder).toBe(expected);
      expect(Math.min(...next.map((image) => Number(image.sortOrder)))).toBe(orders[0]);
    }
  });

  it("appends an uploaded image row with the next sort order", () => {
    const rows = appendImageUrl([], "/uploads/a.jpg");
    expect(rows).toEqual([
      { clientKey: "shared-media-1", url: "/uploads/a.jpg", type: "IMAGE", altText: "", sortOrder: "0", isScene: false },
    ]);

    const next = appendImageUrl(rows, "/uploads/b.jpg");
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      clientKey: "shared-media-2",
      url: "/uploads/b.jpg",
      type: "IMAGE",
      altText: "",
      sortOrder: "1",
      isScene: false,
    });
  });
});

describe("ProductForm PDP banner and selling-point switch", () => {
  beforeEach(() => setAdminLang("zh"));

  it("serializes the banner, trimming copy and turning blank colours into nulls", () => {
    const result = serializeFormValue(baseValue({
      sellingPointsVisibility: "HIDE",
      pdpBannerEnabled: true,
      pdpBannerText: "  Weekend offer  ",
      pdpBannerBackground: " ",
      pdpBannerTextColor: "#FFFFFF",
    }));
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      sellingPointsVisibility: "HIDE",
      pdpBannerEnabled: true,
      pdpBannerText: "Weekend offer",
      pdpBannerBackground: null,
      pdpBannerTextColor: "#FFFFFF",
    });
  });

  it("blocks a save whose banner colour is not #rrggbb and keeps the typed copy", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(baseValue({
      pdpBannerEnabled: true,
      pdpBannerText: "Weekend offer",
      pdpBannerBackground: "#123456",
      pdpBannerTextColor: "",
    }), onSubmit);

    expect(screen.getByRole("textbox", { name: "横幅文案" })).toHaveValue("Weekend offer");
    const background = screen.getByPlaceholderText("#a85238");
    await user.clear(background);
    await user.type(background, "red");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(await screen.findByText("请填 #rrggbb 格式的颜色，例如 #244c3c")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(background);
    await user.type(background, "#abcdef");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      pdpBannerEnabled: true,
      pdpBannerText: "Weekend offer",
      pdpBannerBackground: "#abcdef",
      pdpBannerTextColor: "",
    });
  });
});
