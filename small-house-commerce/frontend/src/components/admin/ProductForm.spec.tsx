import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  ProductForm,
  emptyProductFormValue,
  type ProductFormValue,
} from "@/components/admin/ProductForm";
import type { AdminCatalogGraphDraft } from "@/lib/admin-product-graph";

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
    renderForm(baseValue({ graphTyped: false, graph: locked }));
    await openVariantsTab();

    expect(screen.getByRole("alert")).toHaveTextContent(/类型化选项图/);
    expect(screen.queryByRole("button", { name: "添加款式" })).not.toBeInTheDocument();

    // Media tab: the gallery is locked too (images writes would 409).
    await user.click(screen.getByRole("tab", { name: "商品媒体" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);

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
      "pf-tab-preview",
    ]);
    expect(tabs.map((tab) => tab.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "基本信息",
      "商品媒体",
      "选项、价格与库存",
      "商品规格",
      "包装与物流",
      "搜索与链接",
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
    expect(document.activeElement).toBe(tabs[6]);
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

    tabs[6].focus();
    expect(tabs[6]).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(tabs[6], { key: " " });
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "pf-tab-preview",
    );
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
          combinationKey: "k1",
          optionValueRefs: [{ id: "value-1" }],
          sku: {
            id: "sku-1",
            skuCode: "RED-1",
            status: "ACTIVE",
            supplierSku: null,
            supplierCost: null,
            costCurrency: null,
            landedCost: null,
            price: 1299,
            compareAtPrice: null,
            productWeight: null,
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
          price: "1299",
          compareAtPrice: "",
          supplierSku: "",
          supplierCost: "",
          costCurrency: "",
          landedCost: "",
          productWeight: "",
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

  it("replaces the long workflow guide with concise contextual help", () => {
    renderForm(baseValue());

    expect(screen.queryByText(/上架流程（新商品按此顺序操作）/)).not.toBeInTheDocument();
    expect(screen.getByText(/先以「保存草稿」/)).toBeInTheDocument();
  });

  it("keeps a wrapping sticky header with a horizontally scrollable tab row", () => {
    renderForm(baseValue());

    expect(screen.getByRole("tablist").className).toContain("overflow-x-auto");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeInTheDocument();
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
    expect(screen.getByText("宽度 必须是数字。")).toBeInTheDocument();
  });

  it("renders one stock input and one primary submit per form (no duplicate ids)", async () => {
    renderForm(legacyWithSku);
    await openVariantsTab();

    expect(document.querySelectorAll('[id="pf-variants-0-stock"]')).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "保存草稿" })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "在售" })).toHaveAttribute("value", "ACTIVE");
    expect(screen.getByRole("option", { name: "停售" })).toHaveAttribute("value", "DISABLED");
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
    expect(moveLeft.closest("div.flex-wrap")?.className).toContain("flex-wrap");
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
});
