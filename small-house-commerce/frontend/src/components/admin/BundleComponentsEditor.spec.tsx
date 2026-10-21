import { useState } from 'react';
import type { AdminBundleEditorDraft } from '@/lib/admin-bundle';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminI18nProvider, setAdminLang } from '@/lib/admin-i18n';
import { BundleComponentsEditor } from './BundleComponentsEditor';

const { getComponents, search, save } = vi.hoisted(() => ({ getComponents: vi.fn(), search: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/admin-api', () => ({ adminApi: { getBundleComponents: getComponents, searchBundleSkus: search, setBundleComponents: save } }));
const component = { id: 'binding-1', componentSkuId: 'chair', quantity: 2, position: 0, componentSkuCode: 'CHAIR', componentProductName: 'Chair', componentVariantName: 'Black', availableInventory: 9, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false };

beforeEach(() => {
  vi.resetAllMocks();
  setAdminLang('en');
  getComponents.mockResolvedValue({ version: 4, components: [component], availableInventory: 4 });
  search.mockResolvedValue([{ id: 'table', skuCode: 'TABLE', productId: 'other', productName: 'Table', variantName: 'Small', availableInventory: 3 }]);
  save.mockResolvedValue({ version: 5, components: [component], availableInventory: 4 });
});
function renderEditor() {
  function Harness() {
    const [draft, setDraft] = useState<AdminBundleEditorDraft>();
    return <BundleComponentsEditor productId="product" skuId="bundle" draft={draft} onChange={setDraft} />;
  }
  return render(<AdminI18nProvider><Harness /></AdminI18nProvider>);
}

describe('BundleComponentsEditor', () => {
  it('loads concrete SKU labels and previews limiting availability', async () => {
    renderEditor();
    expect(await screen.findByText('Chair / Black')).toBeVisible();
    expect(screen.getByText('Bundle availability: 4')).toBeVisible();
  });
  it('adds an exact SKU and saves quantities with the loaded version', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText('Chair / Black');
    await user.type(screen.getByLabelText('Search component SKUs'), 'Table');
    await user.click(screen.getByRole('button', { name: 'Search SKUs' }));
    await user.click(await screen.findByRole('button', { name: 'Add TABLE' }));
    await user.clear(screen.getByLabelText('Quantity for CHAIR'));
    await user.type(screen.getByLabelText('Quantity for CHAIR'), '3');
    await user.click(screen.getByRole('button', { name: 'Save Bundle components' }));
    expect(save).toHaveBeenCalledWith('product', 'bundle', { expectedVersion: 4, components: [
      { componentSkuId: 'chair', quantity: 3, position: 0 }, { componentSkuId: 'table', quantity: 1, position: 1 },
    ] });
  });
  it('blocks invalid quantities and preserves the draft on a version conflict', async () => {
    const user = userEvent.setup();
    save.mockRejectedValue(new Error('Bundle changed. Reload its components before saving.'));
    renderEditor();
    await screen.findByText('Chair / Black');
    const quantity = screen.getByLabelText('Quantity for CHAIR');
    await user.clear(quantity);
    await user.type(quantity, '1.5');
    expect(screen.getByRole('button', { name: 'Save Bundle components' })).toBeDisabled();
    await user.clear(quantity);
    await user.type(quantity, '3');
    await user.click(screen.getByRole('button', { name: 'Save Bundle components' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bundle changed');
    expect(quantity).toHaveValue('3');
  });
  it('removes a binding without writing until Save', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText('Chair / Black');
    await user.click(screen.getByRole('button', { name: 'Remove CHAIR' }));
    expect(screen.queryByText('Chair / Black')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Bundle components' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
});
