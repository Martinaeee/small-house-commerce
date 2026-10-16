import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminBundleComponentView } from '@/lib/admin-api';
import type { AdminBundleEditorDraft } from '@/lib/admin-bundle';
import { AdminI18nProvider, setAdminLang } from '@/lib/admin-i18n';
import { BundleComponentsEditor } from './BundleComponentsEditor';

const { getComponents, search, save } = vi.hoisted(() => ({ getComponents: vi.fn(), search: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/admin-api', () => ({ adminApi: { getBundleComponents: getComponents, searchBundleSkus: search, setBundleComponents: save } }));
const component: AdminBundleComponentView = { id: 'binding-1', componentSkuId: 'chair', quantity: 2, position: 0, componentSkuCode: 'CHAIR', componentProductName: 'Chair', componentVariantName: 'Black', availableInventory: 9, status: 'ACTIVE', productStatus: 'ACTIVE', isBundle: false };

beforeEach(() => {
  vi.resetAllMocks();
  setAdminLang('en');
  getComponents.mockResolvedValue({ version: 4, components: [component], availableInventory: 4 });
  search.mockResolvedValue([{ id: 'table', skuCode: 'TABLE', productId: 'other', productName: 'Table', variantName: 'Small', availableInventory: 3 }]);
  save.mockResolvedValue({ version: 5, components: [component], availableInventory: 4 });
});

function renderEditor({ persisted = true, disabled = false, onSavingChange }: { persisted?: boolean; disabled?: boolean; onSavingChange?: (saving: boolean) => void } = {}) {
  function Harness() {
    const [draft, setDraft] = useState<AdminBundleEditorDraft>();
    return <BundleComponentsEditor productId={persisted ? "product" : null} skuId={persisted ? "bundle" : null} draft={draft} onChange={setDraft} disabled={disabled} onSavingChange={onSavingChange} />;
  }
  return render(<AdminI18nProvider><Harness /></AdminI18nProvider>);
}

describe('BundleComponentsEditor', () => {
  it('edits a new virtual SKU without loading or saving a nonexistent identity', async () => {
    const user = userEvent.setup();
    renderEditor({ persisted: false });
    expect(screen.getByText('Save the product to save these components with its new SKU.')).toBeVisible();
    await user.type(screen.getByLabelText('Search component SKUs'), 'Table');
    await user.click(screen.getByRole('button', { name: 'Search SKUs' }));
    await user.click(await screen.findByRole('button', { name: 'Add TABLE' }));
    expect(screen.getByLabelText('Quantity for TABLE')).toHaveValue('1');
    expect(screen.getByText('Bundle availability: 3')).toBeVisible();
    expect(getComponents).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save Bundle components' })).not.toBeInTheDocument();
  });

  it('reorders exact component identities and assigns contiguous positions', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText('Chair / Black');
    await user.click(screen.getByRole('button', { name: 'Search SKUs' }));
    await user.click(await screen.findByRole('button', { name: 'Add TABLE' }));
    await user.click(screen.getByRole('button', { name: 'Move TABLE up' }));
    await user.click(screen.getByRole('button', { name: 'Save Bundle components' }));
    expect(save).toHaveBeenCalledWith('product', 'bundle', { expectedVersion: 4, components: [
      { componentSkuId: 'table', quantity: 1, position: 0 },
      { componentSkuId: 'chair', quantity: 2, position: 1 },
    ] });
  });

  it('reloads a conflicting draft before saving against the new definition version', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText('Chair / Black');
    await user.clear(screen.getByLabelText('Quantity for CHAIR'));
    await user.type(screen.getByLabelText('Quantity for CHAIR'), '3');
    getComponents.mockResolvedValue({ version: 6, components: [{ ...component, quantity: 1 }], availableInventory: 9 });
    await user.click(screen.getByRole('button', { name: 'Reload components' }));
    expect(screen.getByLabelText('Quantity for CHAIR')).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Save Bundle components' }));
    expect(save).toHaveBeenCalledWith('product', 'bundle', { expectedVersion: 6, components: [{ componentSkuId: 'chair', quantity: 1, position: 0 }] });
  });

  it('locks edits and parent saves until a delayed reload has adopted its new version', async () => {
    const user = userEvent.setup();
    const onSavingChange = vi.fn();
    renderEditor({ onSavingChange });
    await screen.findByText('Chair / Black');
    let finish!: (value: { version: number; components: typeof component[]; availableInventory: number }) => void;
    getComponents.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Reload components' }));
    expect(screen.getByLabelText('Quantity for CHAIR')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload components' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Bundle components' })).toBeDisabled();
    expect(onSavingChange).toHaveBeenLastCalledWith(true);
    finish({ version: 6, components: [{ ...component, quantity: 4 }], availableInventory: 2 });
    await waitFor(() => expect(screen.getByLabelText('Quantity for CHAIR')).toBeEnabled());
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
    await user.clear(screen.getByLabelText('Quantity for CHAIR'));
    await user.type(screen.getByLabelText('Quantity for CHAIR'), '3');
    await user.click(screen.getByRole('button', { name: 'Save Bundle components' }));
    expect(save).toHaveBeenCalledWith('product', 'bundle', { expectedVersion: 6, components: [{ componentSkuId: 'chair', quantity: 3, position: 0 }] });
  });

  it('unlocks a failed reload without discarding the existing draft', async () => {
    const user = userEvent.setup();
    const onSavingChange = vi.fn();
    renderEditor({ onSavingChange });
    await screen.findByText('Chair / Black');
    await user.clear(screen.getByLabelText('Quantity for CHAIR'));
    await user.type(screen.getByLabelText('Quantity for CHAIR'), '3');
    getComponents.mockRejectedValueOnce(new Error('Reload failed'));
    await user.click(screen.getByRole('button', { name: 'Reload components' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload failed');
    expect(screen.getByLabelText('Quantity for CHAIR')).toHaveValue('3');
    expect(screen.getByLabelText('Quantity for CHAIR')).toBeEnabled();
    expect(onSavingChange.mock.calls).toEqual([[true], [false]]);
  });

  it('blocks component controls and writes while its parent is saving', async () => {
    const user = userEvent.setup();
    renderEditor({ disabled: true });
    await screen.findByText('Chair / Black');
    expect(screen.getByLabelText('Quantity for CHAIR')).toBeDisabled();
    expect(screen.getByLabelText('Search component SKUs')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save Bundle components' }));
    expect(save).not.toHaveBeenCalled();
  });

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
      { componentSkuId: 'chair', quantity: 3, position: 0 },
      { componentSkuId: 'table', quantity: 1, position: 1 },
    ] });
    expect(await screen.findByRole('status')).toHaveTextContent('Bundle components saved.');
  });

  it('blocks invalid quantities and preserves the visible draft on a version conflict', async () => {
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

  it.each([1, 4])('loads a different owner with version %i instead of the previous definition', async (nextVersion) => {
    const onChange = vi.fn();
    const view = render(<AdminI18nProvider><BundleComponentsEditor productId="product" skuId="bundle" expectedVersion={4} onChange={onChange} /></AdminI18nProvider>);
    await screen.findByText('Chair / Black');
    getComponents.mockResolvedValue({ version: nextVersion, components: [{ ...component, componentSkuId: 'table', componentSkuCode: 'TABLE', componentProductName: 'Table', componentVariantName: 'Small', quantity: 1 }], availableInventory: 3 });

    view.rerender(<AdminI18nProvider><BundleComponentsEditor productId="product-b" skuId="bundle-b" expectedVersion={nextVersion} onChange={onChange} /></AdminI18nProvider>);

    expect(screen.queryByText('Chair / Black')).not.toBeInTheDocument();
    expect(await screen.findByText('Table / Small')).toBeVisible();
    expect(screen.queryByText('Chair / Black')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Quantity for TABLE')).toHaveValue('1');
  });

  it.each(['save', 'reload'])('ignores a completed %s from the previous owner after navigation', async (action) => {
    const user = userEvent.setup();
    let finish!: (value: { version: number; components: typeof component[]; availableInventory: number }) => void;
    getComponents.mockResolvedValueOnce({ version: 0, components: [component], availableInventory: 4 });
    function Harness() {
      const [owner, setOwner] = useState('bundle');
      const [definition, setDefinition] = useState<import('@/lib/admin-api').AdminBundleDefinition>();
      return <>
        <button onClick={() => { setOwner('bundle-b'); setDefinition(undefined); }}>Switch owner</button>
        <BundleComponentsEditor productId="product" skuId={owner} definition={definition} onDefinitionChange={setDefinition} onChange={() => undefined} />
      </>;
    }
    render(<AdminI18nProvider><Harness /></AdminI18nProvider>);
    await screen.findByText('Chair / Black');
    (action === 'save' ? save : getComponents).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: action === 'save' ? 'Save Bundle components' : 'Reload components' }));
    getComponents.mockResolvedValue({ version: 1, components: [{ ...component, componentSkuId: 'table', componentSkuCode: 'TABLE', componentProductName: 'Table', componentVariantName: 'Small' }], availableInventory: 3 });
    await user.click(screen.getByRole('button', { name: 'Switch owner' }));
    await screen.findByText('Table / Small');
    await act(async () => { finish({ version: 5, components: [component], availableInventory: 4 }); });

    expect(screen.getByText('Table / Small')).toBeVisible();
    expect(screen.queryByText('Chair / Black')).not.toBeInTheDocument();
  });

  it('removes a binding without writing until Save and blocks an empty definition', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText('Chair / Black');
    await user.click(screen.getByRole('button', { name: 'Remove CHAIR' }));
    expect(screen.queryByText('Chair / Black')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Bundle components' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
});
