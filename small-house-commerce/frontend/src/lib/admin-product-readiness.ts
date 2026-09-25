import {
  entityRowKey,
  type AdminCatalogGraphDraft,
} from "@/lib/admin-product-graph";

/**
 * Publish readiness for the editor's side rail.
 *
 * These are the field-level checks an operator can act on; anything that would
 * BLOCK a save comes from the graph validation instead (collectGraphIssues),
 * so this module never invents a rule the save path does not enforce. Every
 * input here is real form state — nothing is estimated or hard-coded.
 */

export type ReadinessCheckKey =
  | "basic"
  | "priced_sku"
  | "shared_media"
  | "shipping"
  | "default_variant";

export interface ReadinessCheck {
  key: ReadinessCheckKey;
  ok: boolean;
}

export type ReadinessWarningKey = "seo" | "option_media";

export interface ReadinessWarning {
  key: ReadinessWarningKey;
  /** Option-value label, present on option_media warnings. */
  name?: string;
}

/** The shipping fields a sellable SKU needs before a courier can quote it. */
const SHIPPING_FIELDS = [
  "productWeight",
  "packageWidth",
  "packageHeight",
  "packageDepth",
  "packageWeight",
] as const;

interface SkuLike {
  status?: string;
  price?: unknown;
  productWeight?: unknown;
  packageWidth?: unknown;
  packageHeight?: unknown;
  packageDepth?: unknown;
  packageWeight?: unknown;
}

interface SkuFacts {
  active: boolean;
  priced: boolean;
  shippingComplete: boolean;
}

/** The form keeps legacy SKUs as strings and graph SKUs as numbers. */
function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function skuFacts(sku: SkuLike): SkuFacts {
  const price =
    sku.price === null || sku.price === undefined || sku.price === ""
      ? null
      : Number(sku.price);
  return {
    active: sku.status === "ACTIVE",
    priced: price !== null && Number.isFinite(price),
    shippingComplete: SHIPPING_FIELDS.every((field) => isFilled(sku[field])),
  };
}

export interface ProductReadinessInput {
  name: string;
  slug: string;
  categoryId: string;
  tagline: string;
  description: string;
  images: readonly { url: string }[];
  /** Typed catalog graph; null for legacy graph-v0 products. */
  graph: AdminCatalogGraphDraft | null;
  /** Legacy variants, used when there is no typed graph. */
  legacyVariants: readonly { sku: SkuLike | null }[];
}

export interface ProductReadiness {
  checks: ReadinessCheck[];
  warnings: ReadinessWarning[];
  /** How many checks pass, for the "n/m ready" line. */
  complete: number;
  total: number;
}

export function productReadiness(
  input: ProductReadinessInput,
): ProductReadiness {
  const skus: SkuFacts[] = input.graph
    ? input.graph.variants
        .map((variant) => variant.sku)
        .filter((sku): sku is NonNullable<typeof sku> => sku !== null)
        .map((sku) => skuFacts(sku))
    : input.legacyVariants
        .map((variant) => variant.sku)
        .filter((sku): sku is NonNullable<typeof sku> => sku !== null)
        .map((sku) => skuFacts(sku));

  const checks: ReadinessCheck[] = [
    {
      key: "basic",
      ok: Boolean(
        input.name.trim() && input.slug.trim() && input.categoryId.trim(),
      ),
    },
    {
      key: "priced_sku",
      ok: skus.some((sku) => sku.active && sku.priced),
    },
    {
      key: "shared_media",
      ok: input.images.some((image) => image.url.trim() !== ""),
    },
    {
      key: "shipping",
      ok: skus.length > 0 && skus.every((sku) => sku.shippingComplete),
    },
    {
      key: "default_variant",
      ok: input.graph
        ? input.graph.defaultDisplayVariantRef !== null
        : input.legacyVariants.length > 0,
    },
  ];

  const warnings: ReadinessWarning[] = [];
  if (!input.tagline.trim() || !input.description.trim()) {
    warnings.push({ key: "seo" });
  }

  // The gallery-switching option drives which images a shopper sees; a value
  // with no media of its own silently falls back to the shared gallery.
  const driver = input.graph?.options.find(
    (option) => option.isActive && option.isMediaDriver,
  );
  if (driver && input.graph) {
    const coveredValueKeys = new Set(
      input.graph.media
        .filter((row) => row.optionValueRef !== null)
        .map((row) => entityRowKey(row.optionValueRef!)),
    );
    for (const value of driver.values) {
      if (!value.isActive) continue;
      if (!coveredValueKeys.has(entityRowKey(value))) {
        warnings.push({ key: "option_media", name: value.label });
      }
    }
  }

  return {
    checks,
    warnings,
    complete: checks.filter((check) => check.ok).length,
    total: checks.length,
  };
}
