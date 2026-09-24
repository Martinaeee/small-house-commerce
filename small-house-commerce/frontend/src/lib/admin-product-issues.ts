import type { ProductFormTabKey } from "@/components/admin/product-form/ProductFormHeader";
import {
  buildVariantCandidates,
  entityRowKey,
  validateAdminCatalogGraph,
  type AdminCatalogGraphDraft,
  type AdminCatalogGraphIssueCode,
  type AdminCatalogGraphValidation,
  type AdminOptionDraft,
} from "@/lib/admin-product-graph";

const SWATCH_HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Mirrors the backend siteMediaUrl() rule and ProductForm's own check: an
 * absolute http(s) URL or a site-relative path starting with a single "/"
 * (the shape the local upload endpoint returns).
 */
function isValidMediaUrl(url: string): boolean {
  return (
    /^https?:\/\/.+/i.test(url) ||
    (url.startsWith("/") && !url.startsWith("//") && url.length > 1)
  );
}

/**
 * The editor's single error vocabulary.
 *
 * Two sources feed it: the client-side graph validation (which already knows
 * the offending rows) and the backend rejection message. The backend validates
 * the PATCH as a self-contained graph, so its messages name rows by label
 * rather than by key — every rule below resolves that label back to a draft
 * row so the rail can point at it and offer the fix.
 */

export type AdminProductIssueActionKind =
  | "enable-values"
  | "disable-option"
  | "copy";

export interface AdminProductIssueAction {
  kind: AdminProductIssueActionKind;
  label: string;
  optionKey?: string;
}

export interface AdminProductIssue {
  /** Stable identity for React keys and de-duplication. */
  id: string;
  /** What is wrong, in the operator's language. */
  message: string;
  /** One line on why it blocks the save. */
  detail?: string;
  tab: ProductFormTabKey;
  /** Row to highlight after jumping (option or option-value key). */
  highlightKey?: string;
  /** One-click repairs; the rail always adds a jump link when highlightKey is set. */
  actions: AdminProductIssueAction[];
}

export type AdminProductIssueMessageKey =
  | "product_graph_active_option_limit"
  | "product_graph_active_value_required"
  | "product_graph_duplicate_value_label"
  | "product_graph_duplicate_value_position"
  | "product_graph_value_label_required"
  | "product_graph_media_driver_limit"
  | "product_graph_candidate_limit"
  | "product_issue_detail_active_value_required"
  | "product_issue_detail_duplicate_value_label"
  | "product_issue_detail_duplicate_value_position"
  | "product_issue_detail_value_label_required"
  | "product_issue_detail_active_option_limit"
  | "product_issue_detail_media_driver_limit"
  | "product_issue_detail_candidate_limit"
  | "product_issue_detail_unknown"
  | "product_issue_action_enable_values"
  | "product_issue_action_disable_option"
  | "product_issue_action_copy"
  | "product_graph_structure_invalid"
  | "product_graph_sku_code_required"
  | "product_graph_sku_code_duplicate"
  | "product_graph_swatch_invalid"
  | "product_graph_thumbnail_invalid"
  | "product_graph_media_url_invalid";

export type AdminProductIssueTranslate = (
  key: AdminProductIssueMessageKey,
  vars?: Record<string, string | number>,
) => string;

function optionByKey(
  draft: AdminCatalogGraphDraft,
  key: string | undefined,
): AdminOptionDraft | undefined {
  if (!key) return undefined;
  return draft.options.find((option) => entityRowKey(option) === key);
}

function optionByName(
  draft: AdminCatalogGraphDraft,
  name: string,
): AdminOptionDraft | undefined {
  const normalized = name.trim().toLowerCase();
  return draft.options.find(
    (option) => option.name.trim().toLowerCase() === normalized,
  );
}

/** How many values an "enable every value" repair would switch on. */
function inactiveValueCount(option: AdminOptionDraft | undefined): number {
  return option ? option.values.filter((value) => !value.isActive).length : 0;
}

function repairActions(
  code: AdminCatalogGraphIssueCode,
  option: AdminOptionDraft | undefined,
  t: AdminProductIssueTranslate,
): AdminProductIssueAction[] {
  if (code !== "active_value_required" || !option) return [];
  const optionKey = entityRowKey(option);
  const actions: AdminProductIssueAction[] = [];
  const enableCount = inactiveValueCount(option);
  if (enableCount > 0) {
    actions.push({
      kind: "enable-values",
      label: t("product_issue_action_enable_values", { count: enableCount }),
      optionKey,
    });
  }
  actions.push({
    kind: "disable-option",
    label: t("product_issue_action_disable_option"),
    optionKey,
  });
  return actions;
}

function detailForCode(
  code: AdminCatalogGraphIssueCode,
  t: AdminProductIssueTranslate,
): string {
  switch (code) {
    case "active_value_required":
      return t("product_issue_detail_active_value_required");
    case "duplicate_value_label":
      return t("product_issue_detail_duplicate_value_label");
    case "duplicate_value_position":
      return t("product_issue_detail_duplicate_value_position");
    case "value_label_required":
      return t("product_issue_detail_value_label_required");
    case "active_option_limit":
      return t("product_issue_detail_active_option_limit");
    case "media_driver_limit":
      return t("product_issue_detail_media_driver_limit");
    case "candidate_limit":
      return t("product_issue_detail_candidate_limit");
  }
}

/**
 * Turns the client validation result into rail entries. Messages come from the
 * validation itself (already localized); the issue codes carry the row keys.
 */
export function graphIssuesFromValidation(
  draft: AdminCatalogGraphDraft,
  validation: AdminCatalogGraphValidation,
  t: AdminProductIssueTranslate,
): AdminProductIssue[] {
  return validation.issues.map((issue, index) => {
    const option = optionByKey(draft, issue.optionKey);
    return {
      id: `graph:${issue.code}:${issue.optionKey ?? ""}:${issue.valueKey ?? ""}:${index}`,
      message: validation.errors[index] ?? "",
      detail: detailForCode(issue.code, t),
      tab: "variants" as const,
      highlightKey: issue.valueKey ?? issue.optionKey,
      actions: repairActions(issue.code, option, t),
    };
  });
}

/**
 * Every problem that blocks a save, in rail form: the shared graph validation
 * plus the row-level checks the serializer would otherwise reject (SKU codes,
 * swatch format, thumbnail and scoped-media URLs).
 */
export function collectGraphIssues(
  draft: AdminCatalogGraphDraft,
  t: AdminProductIssueTranslate,
): AdminProductIssue[] {
  const validation = validateAdminCatalogGraph(draft, t);
  const issues = graphIssuesFromValidation(draft, validation, t);
  const push = (
    id: string,
    message: string,
    tab: ProductFormTabKey,
    highlightKey?: string,
  ): void => {
    issues.push({ id, message, tab, highlightKey, actions: [] });
  };

  try {
    buildVariantCandidates(draft);
  } catch {
    if (issues.length === 0) {
      push("structure", t("product_graph_structure_invalid"), "variants");
    }
  }

  const seenCodes = new Map<string, string>();
  for (const variant of draft.variants) {
    if (!variant.sku) continue;
    const code = variant.sku.skuCode.trim();
    const variantKey = entityRowKey(variant);
    if (!code) {
      push(
        `sku-required:${variantKey}`,
        t("product_graph_sku_code_required", { name: variant.name }),
        "variants",
        variantKey,
      );
      continue;
    }
    const normalized = code.toLowerCase();
    if (seenCodes.has(normalized)) {
      push(
        `sku-duplicate:${normalized}`,
        t("product_graph_sku_code_duplicate", { code }),
        "variants",
        variantKey,
      );
    }
    seenCodes.set(normalized, variantKey);
  }

  for (const option of draft.options) {
    for (const value of option.values) {
      const valueKey = entityRowKey(value);
      if (
        value.swatchHex !== null &&
        value.swatchHex.trim() !== "" &&
        !SWATCH_HEX.test(value.swatchHex.trim())
      ) {
        push(
          `swatch:${valueKey}`,
          t("product_graph_swatch_invalid"),
          "variants",
          valueKey,
        );
      }
      if (
        value.thumbnailUrl !== null &&
        value.thumbnailUrl.trim() !== "" &&
        !isValidMediaUrl(value.thumbnailUrl.trim())
      ) {
        push(
          `thumbnail:${valueKey}`,
          t("product_graph_thumbnail_invalid"),
          "variants",
          valueKey,
        );
      }
    }
  }

  for (const media of draft.media) {
    if (media.url.trim() !== "" && !isValidMediaUrl(media.url.trim())) {
      push(
        `media-url:${entityRowKey(media)}`,
        t("product_graph_media_url_invalid"),
        "media",
        entityRowKey(media),
      );
    }
  }

  return issues;
}

interface ServerRule {
  pattern: RegExp;
  /** Builds the rail entry from the captured row label. */
  build: (
    match: RegExpMatchArray,
    draft: AdminCatalogGraphDraft,
    t: AdminProductIssueTranslate,
  ) => Omit<AdminProductIssue, "id">;
}

/**
 * Mirrors the backend's catalog-graph messages verbatim. `validateOptionGraph`
 * (catalog-graph.dto.ts) rejects the patch alone, so these arrive as
 * `Validation failed: catalogGraph.options: <message>`.
 */
const SERVER_RULES: ServerRule[] = [
  {
    pattern: /Active option (.+?) must have at least one active value\./,
    build: (match, draft, t) => {
      const option = optionByName(draft, match[1] ?? "");
      return {
        message: t("product_graph_active_value_required", {
          option: match[1] ?? "",
        }),
        detail: t("product_issue_detail_active_value_required"),
        tab: "variants",
        highlightKey: option ? entityRowKey(option) : undefined,
        actions: repairActions("active_value_required", option, t),
      };
    },
  },
  {
    pattern: /Option (.+?) must have at least one active value\./,
    build: (match, draft, t) => {
      const option = optionByName(draft, match[1] ?? "");
      return {
        message: t("product_graph_active_value_required", {
          option: match[1] ?? "",
        }),
        detail: t("product_issue_detail_active_value_required"),
        tab: "variants",
        highlightKey: option ? entityRowKey(option) : undefined,
        actions: repairActions("active_value_required", option, t),
      };
    },
  },
  {
    pattern: /Duplicate active value label (.+?) in option (.+?)\./,
    build: (match, draft, t) => {
      const option = optionByName(draft, match[2] ?? "");
      return {
        message: t("product_graph_duplicate_value_label", {
          label: match[1] ?? "",
          option: match[2] ?? "",
        }),
        detail: t("product_issue_detail_duplicate_value_label"),
        tab: "variants",
        highlightKey: option ? entityRowKey(option) : undefined,
        actions: [],
      };
    },
  },
  {
    pattern: /Duplicate active value position (\d+) in option (.+?)\./,
    build: (match, draft, t) => {
      const option = optionByName(draft, match[2] ?? "");
      return {
        message: t("product_graph_duplicate_value_position", {
          position: match[1] ?? "",
          option: match[2] ?? "",
        }),
        detail: t("product_issue_detail_duplicate_value_position"),
        tab: "variants",
        highlightKey: option ? entityRowKey(option) : undefined,
        actions: [],
      };
    },
  },
  {
    pattern: /A catalog graph may have at most two active option groups; received (\d+)\./,
    build: (match, _draft, t) => ({
      message: t("product_graph_active_option_limit", {
        count: match[1] ?? "",
      }),
      detail: t("product_issue_detail_active_option_limit"),
      tab: "variants",
      actions: [],
    }),
  },
  {
    pattern: /may have at most one active media-driver option group/,
    build: (_match, _draft, t) => ({
      message: t("product_graph_media_driver_limit"),
      detail: t("product_issue_detail_media_driver_limit"),
      tab: "media",
      actions: [],
    }),
  },
  {
    pattern: /produce (\d+) candidates; the limit is 100\./,
    build: (match, _draft, t) => ({
      message: t("product_graph_candidate_limit", {
        count: match[1] ?? "",
        limit: 100,
      }),
      detail: t("product_issue_detail_candidate_limit"),
      tab: "variants",
      actions: [],
    }),
  },
];

/**
 * Parses a backend rejection into rail entries. Unmatched messages stay
 * readable as raw text with a copy action so nothing is silently swallowed.
 */
export function serverIssuesFromError(
  rawMessage: string,
  draft: AdminCatalogGraphDraft,
  t: AdminProductIssueTranslate,
): AdminProductIssue[] {
  const text = rawMessage.replace(/^Validation failed:\s*/, "").trim();
  for (const rule of SERVER_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    return [{ id: `server:${rule.pattern.source}`, ...rule.build(match, draft, t) }];
  }
  return [
    {
      id: "server:unknown",
      message: text,
      detail: t("product_issue_detail_unknown"),
      tab: "variants",
      actions: [{ kind: "copy", label: t("product_issue_action_copy") }],
    },
  ];
}
