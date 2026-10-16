import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductForm, emptyProductFormValue, emptySkuFormValue, serializeFormValue, type ProductFormValue } from './ProductForm';
import { AdminI18nProvider, setAdminLang } from '@/lib/admin-i18n';
import { cardGraphFromLegacyForm } from '@/lib/admin-product-graph';

const api = vi.hoisted(() => ({ getBundleComponents: vi.fn(), searchBundleSkus: vi.fn(), setBundleComponents: vi.fn() }));
vi.mock('@/lib/admin-api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/admin-api')>(), adminApi: api }));
const component = { id: 'binding', componentSkuId: 'chair', quantity: 2, position: 0, componentSkuCode: 'CHAIR', componentProductName: 'Chair', componentVariantName: 'Black', availableInventory: 9, status: 'ACTIVE' as const, productStatus: 'ACTIVE' as const, isBundle: false };

beforeEach(() => {
  vi.resetAllMocks();
  setAdminLang('en');
  api.getBundleComponents.mockResolvedValue({ version: 4, components: [component], availableInventory: 4 });
  api.searchBundleSkus.mockResolvedValue([{ id: 'chair', skuCode: 'CHAIR', productId: 'chair-product', productName: 'Chair', variantName: 'Black', availableInventory: 9 }]);
});

function formValue(): ProductFormValue {
  const value = emptyProductFormValue();
  Object.assign(value, { name: 'Furniture set', slug: 'furniture-set', categoryId: '00000000-0000-4000-8000-000000000001' });
  value.variants = [{ clientKey: 'legacy-row', name: 'Default', position: '0', sku: { ...emptySkuFormValue(), skuCode: 'SET', price: '2499' } }];
  value.graphTyped = false;
  return value;
}

function renderForm(initial: ProductFormValue, onSubmit = vi.fn(), productId: string | null = null) {
  return render(<AdminI18nProvider><ProductForm initial={initial} categories={[]} onSubmit={onSubmit} productId={productId} pending={false} error={null} savedPreview={null} requestedSection="variants" /></AdminI18nProvider>);
}


describe('ProductForm Bundle payload boundaries', () => {
  it('materializes the typed draft when a new simple SKU chooses virtual mode', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const view = renderForm(formValue(), onSubmit);
    await user.click(screen.getByRole('checkbox', { name: 'Virtual Bundle for Default' }));
    await user.click(screen.getByRole('button', { name: 'Search SKUs' }));
    await user.click(await screen.findByRole('button', { name: 'Add CHAIR' }));
    fireEvent.submit(view.container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0] as ProductFormValue;
    expect(submitted.graphTyped).toBe(true);
    expect(submitted.graph!.variants[0].sku).toMatchObject({ isBundle: true, bundleVersion: 0, onHand: 0, bundleDraft: { version: 0, components: [{ componentSkuId: 'chair', quantity: '1' }] } });
    expect(api.setBundleComponents).not.toHaveBeenCalled();
  });

  it('prevents a parent product save while a component definition save is pending', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initial = formValue();
    initial.variants[0].id = 'variant';
    Object.assign(initial.variants[0].sku!, { id: 'bundle', isBundle: true, bundleVersion: 4 });
    initial.graph = cardGraphFromLegacyForm(initial);
    initial.graphTyped = true;
    let finish!: (definition: { version: number; components: typeof component[]; availableInventory: number }) => void;
    api.setBundleComponents.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = renderForm(initial, onSubmit, 'product');
    await screen.findByText('Chair / Black');
    expect(api.getBundleComponents).toHaveBeenCalledWith('product', 'bundle');
    const productSave = screen.getByRole('button', { name: 'Save draft' });
    await user.click(screen.getByRole('button', { name: 'Save Bundle components' }));
    expect(productSave).toBeDisabled();
    fireEvent.submit(view.container.querySelector('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
    finish({ version: 5, components: [component], availableInventory: 4 });
    await waitFor(() => expect(productSave).toBeEnabled());
  });

  it('starts a new SKU in ordinary mode with initial definition version zero', () => {
    expect(emptySkuFormValue()).toMatchObject({ isBundle: false, bundleVersion: 0 });
  });

  it.each([true, false])('serializes inventory mode %s without a definition version or physical stock', isBundle => {
    const value = emptyProductFormValue();
    Object.assign(value, { name: 'Furniture set', slug: 'furniture-set', categoryId: '00000000-0000-4000-8000-000000000001' });
    value.variants = [{ name: 'Set', position: '0', sku: { ...emptySkuFormValue(), skuCode: 'FURNITURE-SET', price: '2499', isBundle, bundleVersion: 7 } }];
    const result = serializeFormValue(value);
    expect(result).toMatchObject({ ok: true, value: { variants: [{ sku: { isBundle, price: 2499 } }] } });
    if (result.ok) {
      for (const field of ['bundleVersion', 'bundleDraft', 'bundleDefinition', 'onHand', 'stock', 'reserved']) expect(result.value).not.toHaveProperty(`variants.0.sku.${field}`);
    }
  });
});
