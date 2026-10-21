import type { AdminBundleComponentInput, AdminBundleComponentView } from './admin-api';

export interface AdminBundleDraft extends Omit<AdminBundleComponentView, 'id' | 'quantity' | 'position'> {
  id?: string;
  quantity: string;
}

export interface AdminBundleEditorDraft {
  version: number;
  components: AdminBundleDraft[];
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
    if (draft.some((row) => row.status !== 'ACTIVE' || row.productStatus !== 'ACTIVE' || row.isBundle)) return 0;
    return Math.max(0, Math.min(...draft.map((row, i) => Math.floor(row.availableInventory / inputs[i].quantity))));
  } catch {
    return 0;
  }
}
