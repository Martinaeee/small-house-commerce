import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdCostsList } from '@/components/admin/marketing/AdCostsList';
import MarketingWorkbench from '@/components/admin/marketing/MarketingWorkbench';
import { AdminI18nProvider } from '@/lib/admin-i18n';
import { marketingApi, type AdCostRow, type CampaignLinkRow } from '@/lib/marketing-api';
const auth = vi.hoisted(() => ({ admin: { id: 'u1', permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] } }));
vi.mock('@/components/admin/AdminAuthProvider', () => ({ useAdminAuth: () => auth }));
vi.mock('@/lib/marketing-api', async load => ({ ...await load(), marketingApi: { listCosts: vi.fn(), voidCost: vi.fn(), costAudit: vi.fn(), listLinks: vi.fn(), getLink: vi.fn(), ownerOptions: vi.fn() } }));
const row: AdCostRow = { id: 'cost-1', linkId: 'link-1', linkCode: 'link-code', linkName: 'Chair ad', ownerUserId: 'u1', ownerName: 'Optimizer', aid: 'OP-1', productId: 'p1', productName: 'Chair', productCode: 'CHAIR-1', landingPageId: 'page-1', costDate: '2026-10-10', amountUsd: '0.00', phpPerUsd: null, amountPhp: '0.00', note: null, voidedAt: null, version: 2, createdAt: '2026-10-10T12:00:00Z', updatedAt: '2026-10-10T12:00:00Z' };
const link: CampaignLinkRow = { productId: 'p1', landingPageId: 'page-1', code: 'link-code', variantId: null, variantNameSnapshot: null, pageName: 'Chair page', path: '/lp/chair?cl=link-code', status: 'ACTIVE', sourceType: 'META_AD', version: 0, updatedAt: '2026-10-09T16:30:00Z', id: 'link-1', name: 'Chair ad', ownerUserId: 'u1', ownerName: 'Optimizer', aid: 'OP-1', productName: 'Chair', productCode: 'CHAIR-1', createdAt: '2026-10-09T16:30:00Z' };
const mount = (props: Parameters<typeof AdCostsList>[0] = {}) => render(<AdminI18nProvider><AdCostsList {...props} /></AdminI18nProvider>);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); auth.admin.permissions = ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'];
  vi.mocked(marketingApi.listCosts).mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 20 });
  vi.mocked(marketingApi.listLinks).mockResolvedValue({ items: [link], total: 1, page: 1, pageSize: 20 });
  vi.mocked(marketingApi.getLink).mockResolvedValue(link);
  vi.mocked(marketingApi.ownerOptions).mockResolvedValue([]);
  vi.mocked(marketingApi.costAudit).mockResolvedValue([{ id: 'audit-1', actorUserId: 'u1', actor: { name: 'Optimizer' }, action: 'CREATE', before: null, after: row, createdAt: '2026-10-10T12:00:00Z' }]);
});

describe('advertising expense workbench', () => {
  it('shows server-saved zero/FX values and authentic audit snapshots rather than invented cost totals', async () => {
    mount({ productId: 'p1', landingPageId: 'page-1', linkId: 'link-1' });
    await screen.findByText('Chair ad');
    expect(screen.getByText('USD 0.00')).toBeInTheDocument();
    expect(screen.getByText('PHP 0.00')).toBeInTheDocument();
    expect(screen.getByText('当天未投放（零费用）')).toBeInTheDocument();
    expect(marketingApi.listCosts).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', landingPageId: 'page-1', linkId: 'link-1', includeVoided: false }));
    fireEvent.click(screen.getByRole('button', { name: '审计记录' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('创建');
    expect(marketingApi.costAudit).toHaveBeenCalledWith('cost-1');
    expect(within(dialog).getByText('PHP 0.00')).toBeInTheDocument();
  });

  it('keeps finance and broad readers read-only for another owner', async () => {
    auth.admin.permissions = ['MARKETING_VIEW_ALL'];
    const view = mount(); await screen.findByText('Chair ad');
    for (const name of ['录入费用', '编辑', '作废']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '审计记录' })).toBeInTheDocument();
    view.unmount(); auth.admin.permissions = ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_OWN'];
    vi.mocked(marketingApi.listCosts).mockResolvedValue({ items: [{ ...row, ownerUserId: 'u2' }], total: 1, page: 1, pageSize: 20 });
    mount(); await screen.findByText('Chair ad');
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '作废' })).not.toBeInTheDocument();
  });

  it('voids against the saved version and filters historical rows without offering deletion', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(marketingApi.voidCost).mockResolvedValue({ ...row, voidedAt: '2026-10-11T00:00:00Z', version: 3 });
    mount(); await screen.findByText('Chair ad');
    fireEvent.click(screen.getByRole('button', { name: '作废' }));
    await waitFor(() => expect(marketingApi.voidCost).toHaveBeenCalledWith('cost-1', 2));
    fireEvent.click(screen.getByLabelText('包含已作废记录'));
    await waitFor(() => expect(marketingApi.listCosts).toHaveBeenLastCalledWith(expect.objectContaining({ includeVoided: true })));
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });

  it('loads the saved link context before opening its expense form', async () => {
    mount({ productId: 'p1', landingPageId: 'page-1', linkId: 'link-1' }); await screen.findByText('Chair ad');
    fireEvent.click(screen.getByRole('button', { name: '录入费用' }));
    const picker = await screen.findByRole('dialog');
    fireEvent.click(await within(picker).findByRole('button', { name: /Chair ad/ }));
    expect(await screen.findByLabelText('费用日期（马尼拉）')).toBeInTheDocument();
    expect(marketingApi.getLink).toHaveBeenCalledWith('link-1');
    expect(screen.queryByRole('textbox', { name: /AID/ })).not.toBeInTheDocument();
  });

  it('adds expenses as an associated view and retains product/page/link context', async () => {
    render(<AdminI18nProvider><MarketingWorkbench view='costs' productId='p1' landingPageId='page-1' linkId='link-1' /></AdminI18nProvider>);
    expect(screen.getByRole('link', { name: '广告费用' })).toHaveAttribute('href', '/admin/marketing/costs?productId=p1&landingPageId=page-1&linkId=link-1');
    expect(screen.getByRole('link', { name: '广告费用' })).toHaveAttribute('aria-current', 'page');
    await screen.findByText('Chair ad');
  });
});
