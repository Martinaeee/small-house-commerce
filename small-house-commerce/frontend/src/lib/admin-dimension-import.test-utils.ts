import { emptyProductFormValue } from "@/components/admin/ProductForm";
import { canonicalCombinationKey, type AdminSkuDraft } from "./admin-product-graph";

export function dimensionFixture() {
  const form = emptyProductFormValue();
  Object.assign(form, { width: "120", depth: "60", height: "75", foldedWidth: "30", foldedDepth: "15", foldedHeight: "10", graphTyped: true });
  const sku = (index: number): AdminSkuDraft => ({
    id: `sku-${index}`, skuCode: `S-${index}`, status: "ACTIVE", isBundle: false, bundleVersion: 0,
    price: 100 + index, compareAtPrice: 150, supplierSku: null, supplierCost: null, costCurrency: null, landedCost: null,
    productWidth: null, productDepth: null, productHeight: null, productWeight: 4,
    packageWidth: 130, packageDepth: 70, packageHeight: 85, packageWeight: 5, volumetricWeight: 9, onHand: 5 + index,
  });
  const option = (id: string, kind: "COLOR" | "STYLE", labels: string[]) => ({
    id, kind, name: id, position: id === "color" ? 0 : 1, presentation: "TEXT" as const, isMediaDriver: false, isActive: true,
    values: labels.map((label, index) => ({ id: `${id}-${index}`, label, position: index, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null, isActive: true })),
  });
  form.graph = {
    catalogGraphVersion: 1, defaultDisplayVariantRef: null, media: [],
    options: [option("color", "COLOR", ["Black", "White"]), option("style", "STYLE", ["3-Tier", "4-Tier"])],
    variants: Array.from({ length: 4 }, (_, index) => {
      const color = index % 2, style = Math.floor(index / 2);
      const pairs = [{ optionId: "color", valueId: `color-${color}` }, { optionId: "style", valueId: `style-${style}` }];
      return { id: `variant-${index}`, name: `${["Black", "White"][color]} / ${["3-Tier", "4-Tier"][style]}`, position: index,
        combinationKey: canonicalCombinationKey(pairs), optionValueRefs: pairs.map(pair => ({ id: pair.valueId })), sku: sku(index) };
    }),
  };
  return form;
}
