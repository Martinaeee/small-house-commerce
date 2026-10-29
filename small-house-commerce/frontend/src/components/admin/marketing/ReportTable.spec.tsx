import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportTable } from '@/components/admin/marketing/ReportTable';
import MarketingWorkbench from '@/components/admin/marketing/MarketingWorkbench';
import { AdminI18nProvider } from '@/lib/admin-i18n';
import { marketingApi, type MarketingReport, type MarketingReportRow } from '@/lib/marketing-api';
const auth = vi.hoisted(() => ({ admin: { id: 'u1', permissions: ['MARKETING_VIEW_OWN'] } }));
vi.mock('@/components/admin/AdminAuthProvider', () => ({ useAdminAuth: () => auth }));
vi.mock('@/lib/marketing-api', async load => ({ ...await load(), marketingApi: { report: vi.fn(), ownerOptions: vi.fn(), linkContext: vi.fn(async () => ({ products: [] })), listCosts: vi.fn(async () => ({ items: [], total: 0 })) } }));
const row: MarketingReportRow = { kind: 'REGISTERED', id: 'link-1', label: 'Ad A', ownerUserId: 'u1', ownerName: 'Optimizer', aid: 'OP-1', productId: 'p1', productName: 'Chair', productCode: 'CHAIR-1', landingPageId: 'page-1', sourceType: 'META_AD' as const, addToCarts: 0, checkouts: 0, visits: 2, pageTotalVisits: null, submittedOrders: 3, validOrders: 2, confirmedOrders: 1, signedOrders: 1, validOrderValuePhp: '12000.00', signedGrossPhp: '10000.00', spendUsd: '50.00', spendPhp: '2865.00', orderCpaUsd: '25.00', signedCpaUsd: '50.00', orderRoas: '4.19', signedRoas: '3.49', conversionRate: '1.0000', costCoverageComplete: true, recordedCostDays: 3, expectedCostDays: 3, duplicateOrders: 1, riskOrders: 1, afterSalesOrders: 0, refundStatusOrders: 0, periodBasis: 'TOUCH' , productThumbnailUrl: null };
const result: MarketingReport = { from: '2026-10-05', to: '2026-10-07', groupBy: 'LINK', mode: 'FLAT', sortBy: 'NAME', sortDirection: 'ASC', asOf: '2026-10-11T04:00:00Z', page: 1, pageSize: 20, total: 1, rows: [row], otherSources: [] };
const mount = (props: Parameters<typeof ReportTable>[0] = {}) => render(<AdminI18nProvider><ReportTable {...props} /></AdminI18nProvider>);
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); auth.admin.permissions = ['MARKETING_VIEW_OWN']; vi.mocked(marketingApi.report).mockResolvedValue(result); vi.mocked(marketingApi.ownerOptions).mockResolvedValue([]); });

describe('touch-date marketing reports', () => {
  it('shows saved PHP/CPA/ROAS and immutable whole-order gross with a non-settlement warning', async () => {
    mount(); await screen.findByText('Ad A');
    expect(screen.getByRole('cell', { name: 'PHP 10000.00' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'PHP 2865.00' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '3.49' })).toBeInTheDocument();
    expect(screen.getByText(/签收毛额未扣退款、不等于 COD 回款/)).toBeInTheDocument();
    expect(screen.getByText(/转化仍可能继续发生/)).toBeInTheDocument();
    expect(screen.queryByText(/净利润|Profit ROAS/)).not.toBeInTheDocument();
    expect(screen.getByText(/重复标记 1/)).toBeInTheDocument();
  });

  it('marks cost coverage gaps and renders missing ratios as dashes rather than zero', async () => {
    vi.mocked(marketingApi.report).mockResolvedValue({ ...result, rows: [{ ...row, costCoverageComplete: false, recordedCostDays: 2, orderCpaUsd: null, signedCpaUsd: null, orderRoas: null, signedRoas: null }] });
    mount(); await screen.findByText('Ad A');
    expect(screen.getByText('费用未完整录入（2 / 3 日）')).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: '3.49' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: '—' }).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole('cell', { name: 'USD 50.00' })).toBeInTheDocument();
  });

  it('separates direct, legacy and historical/unverified sources without calling them paid return', async () => {
    const free: MarketingReportRow = { ...row, kind: 'UNVERIFIED', id: 'UNVERIFIED', label: 'UNVERIFIED', visits: null, orderRoas: null, signedRoas: null, orderCpaUsd: null, signedCpaUsd: null, periodBasis: 'ORDER_CREATED' };
    vi.mocked(marketingApi.report).mockResolvedValue({ ...result, otherSources: [free] });
    mount(); await screen.findByText('Ad A');
    expect(screen.getByText('历史 / 未验证触达（按订单创建日期）')).toBeInTheDocument();
    expect(screen.getByText(/不参与已登记链接的 CPA\/ROAS/)).toBeInTheDocument();
  });

  it('filters the cohort by Manila dates and level while retaining product/page/link context', async () => {
    mount({ productId: 'p1', landingPageId: 'page-1', linkId: 'link-1' }); await screen.findByText('Ad A');
    fireEvent.change(screen.getByLabelText('触达日期从（马尼拉）'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('触达日期到（马尼拉）'), { target: { value: '2026-10-07' } });
    fireEvent.change(screen.getByLabelText('统计层级'), { target: { value: 'PAGE' } });
    fireEvent.click(screen.getByRole('button', { name: '查询核算' }));
    await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-05', to: '2026-10-07', groupBy: 'PAGE', productId: 'p1', landingPageId: 'page-1', linkIds: ['link-1'] })));
  });

  it('links the fourth view to the same context rather than another disconnected page', async () => {
    render(<AdminI18nProvider><MarketingWorkbench view='reports' productId='p1' landingPageId='page-1' linkId='link-1' /></AdminI18nProvider>);
    expect(screen.getByRole('link', { name: '核算' })).toHaveAttribute('href', '/admin/marketing/reports?productId=p1&landingPageId=page-1&linkId=link-1');
    expect(screen.getByRole('link', { name: '核算' })).toHaveAttribute('aria-current', 'page');
    await screen.findByText('Ad A');
  });
});

describe("workbench report filters, sorting and tree view", () => {
  const context = { products: [{ id: "p1", name: "Chair", productCode: "C1", slug: "chair", thumbnailUrl: "/c.jpg", variants: [], landingPages: [] }] };
  const owners = [{ userId: "u1", aid: "OP-1", displayName: "Optimizer", status: "ACTIVE" as const, userStatus: "ACTIVE" as const }];

  function mountAll() {
    auth.admin.permissions = ["MARKETING_VIEW_ALL", "MARKETING_MANAGE_OWN"];
    vi.mocked(marketingApi.linkContext).mockResolvedValue(context);
    vi.mocked(marketingApi.ownerOptions).mockResolvedValue(owners);
  }

  it("exposes product and optimizer filters and defaults to the tree view", async () => {
    mountAll();
    mount();
    expect(await screen.findByLabelText("视图")).toHaveValue("TREE");
    fireEvent.change(screen.getByLabelText("视图"), { target: { value: "FLAT" } });
    await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "FLAT", sortBy: "NAME", sortDirection: "ASC" })));
    fireEvent.change(screen.getByLabelText("商品"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "查询核算" }));
    await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ productId: "p1", page: 1 })));
    fireEvent.change(screen.getByLabelText(/负责人/), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "查询核算" }));
    await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ ownerUserId: "u1" })));
  });

  it("hides the optimizer filter for view-own accounts", async () => {
    mount();
    await screen.findByRole("combobox", { name: "商品" });
    expect(screen.queryByLabelText(/负责人/)).not.toBeInTheDocument();
  });

  it("disables the grouping-level select while the tree view owns the grouping", async () => {
    mount();
    await screen.findByText("Ad A");
    expect(screen.getByRole("combobox", { name: "统计层级" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "视图" }), { target: { value: "FLAT" } });
    await screen.findByText("Ad A");
    expect(screen.getByRole("combobox", { name: "统计层级" })).toBeEnabled();
  });

  it("sorts by a clicked column and toggles directions", async () => {
    mount();
    await screen.findByText("Ad A");
    fireEvent.click(screen.getAllByRole("button", { name: /有效订单/ })[0]!);
    await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: "VALID", sortDirection: "DESC" })));
    fireEvent.click(screen.getAllByRole("button", { name: /^有效订单/ })[0]!);
    await waitFor(() => expect(marketingApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: "VALID", sortDirection: "ASC" })));
  });

  it("renders tree data with thumbnails, group counts and the funnel hint", async () => {
    mountAll();
    vi.mocked(marketingApi.report).mockResolvedValue({
      ...result, mode: "TREE", linkCount: 1,
      tree: [{ product: { id: "p1", name: "Chair", productCode: "C1", thumbnailUrl: "/c.jpg" }, totals: row, sources: [{ sourceType: "META_AD", totals: row, links: [row] }] }],
    });
    mount();
    await screen.findByRole("img", { name: "Chair" });
    expect(screen.getByRole("img", { name: "Chair" })).toHaveAttribute("src", "/c.jpg");
    expect(screen.getByText("共 1 条链接")).toBeInTheDocument();
    expect(screen.getByText(/加购 \/ 发起购物为事件次数/)).toBeInTheDocument();
  });

  it("renders a rows-less tree payload without touching the flat table", async () => {
    vi.mocked(marketingApi.report).mockResolvedValue({ ...result, mode: "TREE", linkCount: 1, rows: undefined as unknown as MarketingReport["rows"], tree: [{ product: { id: "p1", name: "Chair", productCode: "C1", thumbnailUrl: null }, totals: row, sources: [{ sourceType: "META_AD", totals: row, links: [row] }] }] });
    mount();
    await screen.findAllByText("Chair");
    expect(screen.getByText("Ad A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下一页" })).not.toBeInTheDocument();
  });

  it("warns when the unpaginated tree exceeds 500 links", async () => {
    vi.mocked(marketingApi.report).mockResolvedValue({ ...result, mode: "TREE", linkCount: 600, tree: [] });
    mount();
    await screen.findByText(/链接超过 500 条/);
    expect(screen.getByText("共 600 条链接")).toBeInTheDocument();
  });

  it("shows flat-row thumbnails when the flat list carries them", async () => {
    mountAll();
    vi.mocked(marketingApi.report).mockResolvedValue({ ...result, rows: [{ ...row, productThumbnailUrl: "/c.jpg" }] });
    mount();
    // default view is the tree; the flat fixture only renders under FLAT
    fireEvent.change(await screen.findByRole("combobox", { name: "视图" }), { target: { value: "FLAT" } });
    await screen.findByText("Ad A");
    expect(screen.getByRole("img", { name: "Chair" })).toHaveAttribute("src", "/c.jpg");
    fireEvent.click(screen.getByRole("button", { name: "查询核算" }));
  });
});
