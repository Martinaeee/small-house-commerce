import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReportAttributionTable } from './ReportAttributionTable';
import { AdminI18nProvider } from '@/lib/admin-i18n';
import type { MarketingReportRow } from '@/lib/marketing-api';

const base: MarketingReportRow = {
  postDate: null, postUrl: null, archivedAt: null, createdAt: null, kind: 'REGISTERED',
  id: 'link-1:120200000000001', label: '120200000000001', ownerUserId: 'u1', ownerName: 'Optimizer',
  aid: 'OP-1', productId: 'p1', productName: 'Chair', productCode: 'CHAIR-1', landingPageId: null,
  sourceType: 'META_AD', visits: null, pageTotalVisits: null, addToCarts: 1, checkouts: 1,
  submittedOrders: 1, validOrders: 1, confirmedOrders: 1, signedOrders: 0,
  duplicateOrders: 0, riskOrders: 0, afterSalesOrders: 0, refundStatusOrders: 0,
  validOrderValuePhp: '1000.00', signedGrossPhp: '0.00', spendUsd: '0.00', spendPhp: '0.00',
  orderCpaUsd: null, signedCpaUsd: null, orderRoas: null, signedRoas: null, conversionRate: null,
  expectedCostDays: 0, recordedCostDays: 0, costCoverageComplete: false, periodBasis: 'TOUCH',
  productThumbnailUrl: null, adId: '120200000000001', adIdSource: 'META_DYNAMIC',
  adIdMissingReason: null, adVisits: 1, productViews: 2, linkCount: null, adCount: null, linkName: 'Ad A',
};

const wrap = (rows: MarketingReportRow[], dimension: 'ADID' | 'AID') =>
  render(<AdminI18nProvider><ReportAttributionTable rows={rows} dimension={dimension} /></AdminI18nProvider>);

describe('verified attribution report table', () => {
  it('renders one row per AdID and never shows a splittable CL visit count', () => {
    wrap([base, { ...base, id: 'link-1:120200000000002', adId: '120200000000002', adVisits: 1 }], 'ADID');
    expect(screen.getByText('120200000000001')).toBeInTheDocument();
    expect(screen.getByText('120200000000002')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('广告访问（AdID 归因）')).toBeInTheDocument();
    expect(screen.getAllByText('Ad A')).toHaveLength(2);
  });

  it('renders the AID view with its distinct link and ad counts', () => {
    wrap([{ ...base, adId: null, aid: 'OP-1', linkCount: 2, adCount: 3 }], 'AID');
    expect(screen.getByText('OP-1')).toBeInTheDocument();
    expect(screen.getByText('链接 2 · 广告 3')).toBeInTheDocument();
    expect(screen.queryByText('120200000000001')).not.toBeInTheDocument();
  });

  it('shows the missing AdID reason on an unidentified row', () => {
    wrap([{ ...base, adId: null, adIdMissingReason: 'MISSING_META_AD_ID' }], 'ADID');
    expect(screen.getByText('未识别 AdID')).toBeInTheDocument();
    expect(screen.getByText('缺少 Meta 广告 ID')).toBeInTheDocument();
  });
});
