import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CostForm } from '@/components/admin/marketing/CostForm';
import { AdminI18nProvider } from '@/lib/admin-i18n';
import { AdminApiError } from '@/lib/admin-auth';
import { marketingApi, type AdCostRow } from '@/lib/marketing-api';
vi.mock('@/lib/marketing-api', async load => ({ ...await load(), marketingApi: { saveCost: vi.fn(), listCosts: vi.fn() } }));
const link = { id: 'link-1', name: 'Chair ad', ownerName: 'Optimizer', aid: 'OP-1', productName: 'Chair', productCode: 'CHAIR-1', createdAt: '2026-10-09T16:30:00Z' };
const entry: AdCostRow = { linkCode: 'link-code', linkName: link.name, ownerName: link.ownerName, aid: link.aid, productId: 'p1', productName: link.productName, productCode: link.productCode, landingPageId: null, createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', id: 'cost-1', linkId: link.id, ownerUserId: 'u1', costDate: '2026-10-10', amountUsd: '50.00', phpPerUsd: '57.300000', amountPhp: '2865.00', note: 'Old', voidedAt: null, version: 2 };
const mount = (props: Partial<Parameters<typeof CostForm>[0]> = {}) => render(<AdminI18nProvider><CostForm link={link} onClose={() => {}} onSaved={() => {}} {...props} /></AdminI18nProvider>);
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.mocked(marketingApi.saveCost).mockResolvedValue(entry); });

describe('USD expense form', () => {
  it('defaults to Manila today, fixes link ownership, and sends no computed PHP total', async () => {
    mount();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(screen.getByLabelText('费用日期（马尼拉）')).toHaveValue(today);
    expect(screen.getByText(/OP-1/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('USD 金额'), { target: { value: '50.00' } });
    fireEvent.change(screen.getByLabelText('汇率（1 USD = X PHP）'), { target: { value: '57.3' } });
    fireEvent.click(screen.getByRole('button', { name: '保存费用' }));
    await waitFor(() => expect(marketingApi.saveCost).toHaveBeenCalledOnce());
    expect(vi.mocked(marketingApi.saveCost).mock.calls[0][0]).toEqual({ linkId: 'link-1', costDate: today, amountUsd: '50.00', phpPerUsd: '57.3', note: null });
  });

  it('records an explicit zero day with no FX and preserves server-controlled amount fields', async () => {
    mount();
    fireEvent.click(screen.getByLabelText('当天未投放（零费用）'));
    expect(screen.getByLabelText('汇率（1 USD = X PHP）')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存费用' }));
    await waitFor(() => expect(marketingApi.saveCost).toHaveBeenCalledWith(expect.objectContaining({ amountUsd: '0.00', phpPerUsd: null })));
  });

  it('preserves a correction draft on409 and only loads the saved version after an explicit click', async () => {
    vi.mocked(marketingApi.saveCost).mockRejectedValue(new AdminApiError('Conflict', 409));
    vi.mocked(marketingApi.listCosts).mockResolvedValue({ items: [{ ...entry, amountUsd: '70.00', version: 4 }], total: 1, page: 1, pageSize: 1 });
    mount({ entry });
    expect(screen.getByLabelText('费用日期（马尼拉）')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('USD 金额'), { target: { value: '66.00' } });
    fireEvent.click(screen.getByRole('button', { name: '保存费用' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('版本冲突');
    expect(screen.getByLabelText('USD 金额')).toHaveValue('66.00');
    expect(marketingApi.saveCost).toHaveBeenCalledWith(expect.objectContaining({ amountUsd: '66.00', expectedVersion: 2 }));
    expect(marketingApi.listCosts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新载入已保存版本' }));
    await waitFor(() => expect(screen.getByLabelText('USD 金额')).toHaveValue('70.00'));
    expect(marketingApi.listCosts).toHaveBeenCalledWith(expect.objectContaining({ linkId: 'link-1', dateFrom: '2026-10-10', dateTo: '2026-10-10', includeVoided: true }));
  });

  it('explains reactivation when editing a voided record and submits its real version', async () => {
    mount({ entry: { ...entry, voidedAt: '2026-10-11T00:00:00Z' } });
    expect(screen.getByText(/保存将重新生效/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存费用' }));
    await waitFor(() => expect(marketingApi.saveCost).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2 })));
  });

  it('blocks same-tick duplicate submissions without discarding the form', async () => {
    vi.mocked(marketingApi.saveCost).mockImplementation(() => new Promise(() => {}));
    mount({ entry });
    const button = screen.getByRole('button', { name: '保存费用' });
    const form = button.closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(marketingApi.saveCost).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('USD 金额')).toHaveValue('50.00');
  });
});
