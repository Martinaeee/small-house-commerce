import {
  entityRowKey,
  type AdminCatalogGraphDraft,
  type AdminMediaDraft,
  type AdminOptionDraft,
  type AdminVariantDraft,
  type EntityRef,
} from "./admin-product-graph";

export interface AdminMediaSummary {
  rowCount: number;
  usableCount: number;
  imageCount: number;
  videoCount: number;
  altCompleteCount: number;
}

type SummaryMediaRow = Pick<
  AdminMediaDraft,
  "url" | "type" | "altText" | "sortOrder"
>;

function isUsable(row: Pick<AdminMediaDraft, "url">): boolean {
  return row.url.trim() !== "";
}

export function summarizeAdminMedia(
  rows: readonly SummaryMediaRow[],
): AdminMediaSummary {
  return rows.reduce<AdminMediaSummary>(
    (summary, row) => ({
      rowCount: summary.rowCount + 1,
      usableCount: summary.usableCount + (isUsable(row) ? 1 : 0),
      imageCount: summary.imageCount + (row.type === "IMAGE" ? 1 : 0),
      videoCount: summary.videoCount + (row.type === "VIDEO" ? 1 : 0),
      altCompleteCount:
        summary.altCompleteCount + (row.altText?.trim() ? 1 : 0),
    }),
    {
      rowCount: 0,
      usableCount: 0,
      imageCount: 0,
      videoCount: 0,
      altCompleteCount: 0,
    },
  );
}

export function impactedSkuCount(
  draft: AdminCatalogGraphDraft,
  option: AdminOptionDraft | null,
): number {
  if (option === null) {
    return draft.variants.filter((variant) => variant.sku !== null).length;
  }
  if (!option.isActive) return 0;

  const activeValueKeys = new Set(
    option.values
      .filter((value) => value.isActive)
      .map(entityRowKey)
      .filter(Boolean),
  );
  return draft.variants.filter(
    (variant) =>
      variant.sku !== null &&
      variant.optionValueRefs.some((ref) =>
        activeValueKeys.has(entityRowKey(ref)),
      ),
  ).length;
}

export interface VariantMediaResolutionSummary {
  source: "EXACT" | "OPTION_VALUE" | "SHARED";
  count: number;
  optionValueRef: EntityRef | null;
}

function usableRows<T extends Pick<AdminMediaDraft, "url">>(
  rows: readonly T[],
): T[] {
  return rows.filter(isUsable);
}

export function summarizeVariantMediaResolution(
  draft: AdminCatalogGraphDraft,
  variant: AdminVariantDraft,
  sharedRowsOverride: readonly Pick<AdminMediaDraft, "url">[] | null = null,
): VariantMediaResolutionSummary {
  const variantKey = entityRowKey(variant);
  const exactRows = usableRows(
    draft.media.filter(
      (row) =>
        row.variantRef !== null &&
        entityRowKey(row.variantRef) === variantKey,
    ),
  );
  if (exactRows.length > 0) {
    return { source: "EXACT", count: exactRows.length, optionValueRef: null };
  }

  const driver = draft.options.find(
    (option) => option.isActive && option.isMediaDriver,
  );
  if (driver) {
    const activeDriverValueKeys = new Set(
      driver.values
        .filter((value) => value.isActive)
        .map(entityRowKey)
        .filter(Boolean),
    );
    const optionValueRef = variant.optionValueRefs.find((ref) =>
      activeDriverValueKeys.has(entityRowKey(ref)),
    );
    if (optionValueRef) {
      const optionRows = usableRows(
        draft.media.filter(
          (row) =>
            row.optionValueRef !== null &&
            entityRowKey(row.optionValueRef) === entityRowKey(optionValueRef),
        ),
      );
      if (optionRows.length > 0) {
        return {
          source: "OPTION_VALUE",
          count: optionRows.length,
          optionValueRef,
        };
      }
    }
  }

  const sharedRows = usableRows(
    sharedRowsOverride ??
      draft.media.filter(
        (row) => row.optionValueRef === null && row.variantRef === null,
      ),
  );
  return {
    source: "SHARED",
    count: sharedRows.length,
    optionValueRef: null,
  };
}
