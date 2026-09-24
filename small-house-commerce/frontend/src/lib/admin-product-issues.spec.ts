import { describe, expect, it } from "vitest";
import {
  collectGraphIssues,
  serverIssuesFromError,
  type AdminProductIssueMessageKey,
} from "@/lib/admin-product-issues";
import type { AdminCatalogGraphDraft } from "@/lib/admin-product-graph";

/**
 * The rail's vocabulary: every blocking problem arrives as one entry carrying
 * the message, the row it belongs to, and the repairs that clear it.
 */

const MESSAGES: Record<AdminProductIssueMessageKey, string> = {
  product_graph_active_option_limit:
    "最多只能启用 2 个选项组；当前启用了 {count} 个。",
  product_graph_active_value_required:
    "启用的选项 {option} 至少需要一个启用的选项值。",
  product_graph_duplicate_value_label:
    "选项 {option} 中存在重复的启用值标签：{label}。",
  product_graph_duplicate_value_position:
    "选项 {option} 中存在重复的位置：{position}。",
  product_graph_value_label_required: "选项 {option} 的选项值标签不能为空。",
  product_graph_media_driver_limit: "最多只能有 1 个启用的商品图切换选项。",
  product_graph_candidate_limit:
    "启用的选项会生成 {count} 个款式，最多允许 {limit} 个。",
  product_graph_structure_invalid: "选项结构无效，请检查启用的选项和值。",
  product_graph_sku_code_required: "「{name}」需要填写 SKU 编码才能保存。",
  product_graph_sku_code_duplicate: "SKU 编码 {code} 重复。",
  product_graph_swatch_invalid: "色块颜色必须是 #rrggbb 格式。",
  product_graph_thumbnail_invalid: "选项缩略图必须是有效的图片网址。",
  product_graph_media_url_invalid: "作用域媒体网址必须是有效的链接。",
  product_issue_detail_active_value_required: "前台至少需要一个可选项。",
  product_issue_detail_duplicate_value_label: "重名说明。",
  product_issue_detail_duplicate_value_position: "同位说明。",
  product_issue_detail_value_label_required: "标签说明。",
  product_issue_detail_active_option_limit: "上限说明。",
  product_issue_detail_media_driver_limit: "驱动说明。",
  product_issue_detail_candidate_limit: "组合说明。",
  product_issue_detail_unknown: "需要人工判断。",
  product_issue_action_enable_values: "启用全部 {count} 个选项值",
  product_issue_action_disable_option: "停用这个选项",
  product_issue_action_copy: "复制错误信息",
};

function t(key: AdminProductIssueMessageKey, vars?: Record<string, string | number>): string {
  let text = MESSAGES[key];
  for (const [name, value] of Object.entries(vars ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function draft(overrides: Partial<AdminCatalogGraphDraft> = {}): AdminCatalogGraphDraft {
  return {
    catalogGraphVersion: 3,
    defaultDisplayVariantRef: null,
    options: [
      {
        id: "option-color",
        kind: "COLOR",
        name: "color",
        position: 0,
        presentation: "SWATCH",
        isMediaDriver: false,
        isActive: true,
        values: [
          {
            id: "value-red",
            label: "Red",
            position: 0,
            swatchHex: "#b91c1c",
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: false,
          },
          {
            id: "value-blue",
            label: "Blue",
            position: 1,
            swatchHex: "#1d4ed8",
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: false,
          },
        ],
      },
    ],
    variants: [],
    media: [],
    ...overrides,
  };
}

describe("collectGraphIssues", () => {
  it("names the option and offers both repairs when it has no active value", () => {
    const issues = collectGraphIssues(draft(), t);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe("启用的选项 color 至少需要一个启用的选项值。");
    expect(issues[0].detail).toBe("前台至少需要一个可选项。");
    expect(issues[0].tab).toBe("variants");
    expect(issues[0].highlightKey).toBe("option-color");
    expect(issues[0].actions).toEqual([
      expect.objectContaining({
        kind: "enable-values",
        label: "启用全部 2 个选项值",
        optionKey: "option-color",
      }),
      expect.objectContaining({
        kind: "disable-option",
        label: "停用这个选项",
        optionKey: "option-color",
      }),
    ]);
  });

  it("drops the enable repair when every value is already active but none usable", () => {
    const base = draft();
    // Values exist and are active, so the only way this option blocks a save
    // is the candidate cap — which has no one-click repair.
    const issues = collectGraphIssues(
      {
        ...base,
        options: [
          {
            ...base.options[0],
            values: base.options[0].values.map((value) => ({
              ...value,
              isActive: true,
            })),
          },
        ],
      },
      t,
    );

    expect(issues).toEqual([]);
  });

  it("routes a scoped-media URL problem to the media tab with its row key", () => {
    const issues = collectGraphIssues(
      draft({
        options: [],
        media: [
          {
            id: "media-1",
            url: "not-a-url",
            type: "IMAGE",
            altText: null,
            sortOrder: 0,
            optionValueRef: null,
            variantRef: null,
          },
        ],
      }),
      t,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].tab).toBe("media");
    expect(issues[0].highlightKey).toBe("media-1");
    expect(issues[0].message).toBe("作用域媒体网址必须是有效的链接。");
  });

  it("flags a priced row without a SKU code against that variant", () => {
    const issues = collectGraphIssues(
      draft({
        options: [],
        variants: [
          {
            clientKey: "variant-k0",
            name: "Variant 1",
            position: 0,
            combinationKey: "k0",
            optionValueRefs: [],
            sku: {
              skuCode: "",
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
      }),
      t,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe("「Variant 1」需要填写 SKU 编码才能保存。");
    expect(issues[0].highlightKey).toBe("variant-k0");
  });
});

describe("serverIssuesFromError", () => {
  it("translates the backend rejection and resolves the named option", () => {
    const issues = serverIssuesFromError(
      "Validation failed: catalogGraph.options: Active option color must have at least one active value.",
      draft(),
      t,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe("启用的选项 color 至少需要一个启用的选项值。");
    expect(issues[0].detail).toBe("前台至少需要一个可选项。");
    expect(issues[0].highlightKey).toBe("option-color");
    expect(issues[0].actions.map((action) => action.kind)).toEqual([
      "enable-values",
      "disable-option",
    ]);
  });

  it("matches the option by name even when the backend message omits the prefix", () => {
    const issues = serverIssuesFromError(
      "Active option color must have at least one active value.",
      draft(),
      t,
    );

    expect(issues[0].highlightKey).toBe("option-color");
  });

  it("keeps an unmatched message readable with a copy action", () => {
    const issues = serverIssuesFromError(
      "Validation failed: slug: A product with this slug already exists.",
      draft(),
      t,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe("slug: A product with this slug already exists.");
    expect(issues[0].detail).toBe("需要人工判断。");
    expect(issues[0].actions).toEqual([
      expect.objectContaining({ kind: "copy", label: "复制错误信息" }),
    ]);
  });

  it("still resolves the option when the draft row has no id yet", () => {
    const base = draft();
    const clientDraft: AdminCatalogGraphDraft = {
      ...base,
      options: [{ ...base.options[0], id: undefined, clientKey: "option-new" }],
    };

    const issues = serverIssuesFromError(
      "Validation failed: catalogGraph.options: Active option color must have at least one active value.",
      clientDraft,
      t,
    );

    expect(issues[0].highlightKey).toBe("option-new");
    expect(issues[0].actions[1]).toEqual(
      expect.objectContaining({ kind: "disable-option", optionKey: "option-new" }),
    );
  });
});
