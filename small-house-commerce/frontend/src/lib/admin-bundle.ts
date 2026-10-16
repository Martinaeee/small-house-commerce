import { adminApi, type AdminBundleComponentInput, type AdminBundleComponentView, type AdminSku } from './admin-api';
import type { AdminCatalogGraphDraft } from './admin-product-graph';

export interface AdminBundleDraft extends Omit<AdminBundleComponentView, 'id' | 'quantity' | 'position'> {
  id?: string;
  quantity: string;
}

export interface AdminBundleEditorDraft {
  version: number;
  components: AdminBundleDraft[];
}

export interface BundleComponentWrite {
  skuId?: string;
  skuCode: string;
  label: string;
  draft: AdminBundleEditorDraft;
  components: AdminBundleComponentInput[];
}

export interface BundleSaveFailure {
  write: BundleComponentWrite;
  error: string;
}

export function bundleComponentWrites(graph: Pick<AdminCatalogGraphDraft, 'variants'>): BundleComponentWrite[] {
  return graph.variants.flatMap(variant => {
    const sku = variant.sku;
    if (!sku?.isBundle || !sku.bundleDraft) return [];
    return [{ skuId: sku.id, skuCode: sku.skuCode.trim(), label: variant.name, draft: structuredClone(sku.bundleDraft), components: bundleDraftToInput(sku.bundleDraft.components) }];
  });
}

export async function saveBundleComponentWrites(product: {
  id: string;
  variants: readonly { sku: Pick<AdminSku, 'id' | 'skuCode' | 'isBundle'> | null }[];
}, writes: readonly BundleComponentWrite[]): Promise<BundleSaveFailure[]> {
  const failures: BundleSaveFailure[] = [];
  for (const write of writes) {
    const matches = product.variants.flatMap(variant => {
      const sku = variant.sku;
      return sku?.isBundle && (write.skuId ? sku.id === write.skuId : sku.skuCode === write.skuCode) ? [sku] : [];
    });
    if (matches.length !== 1) {
      failures.push({ write, error: 'Bundle SKU identity could not be resolved after product save.' });
      continue;
    }
    try {
      await adminApi.setBundleComponents(product.id, matches[0].id, { expectedVersion: write.draft.version, components: write.components });
    } catch (error) {
      failures.push({ write: { ...write, skuId: matches[0].id }, error: error instanceof Error ? error.message : 'Bundle components could not be saved.' });
    }
  }
  return failures;
}

export function bundleDraftToInput(draft: readonly AdminBundleDraft[]): AdminBundleComponentInput[] {
  if (draft.length === 0 || draft.length > 20) throw new Error('Add between 1 and 20 component SKUs.');
  const seen = new Set<string>();
  return draft.map((component, position) => {
    const quantity = Number(component.quantity);
    if (seen.has(component.componentSkuId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      throw new Error('Use unique SKUs with whole quantities from 1 to 1000.');
    }
    seen.add(component.componentSkuId);
    return { componentSkuId: component.componentSkuId, quantity, position };
  });
}

export function bundleDraftAvailability(draft: readonly AdminBundleDraft[]): number {
  try {
    const inputs = bundleDraftToInput(draft);
    if (draft.some((row) => row.status !== 'ACTIVE' || row.productStatus !== 'ACTIVE' || row.isBundle || !Number.isSafeInteger(row.availableInventory) || row.availableInventory < 0)) return 0;
    return Math.max(0, Math.min(...draft.map((row, i) => Math.floor(row.availableInventory / inputs[i].quantity))));
  } catch {
    return 0;
  }
}
