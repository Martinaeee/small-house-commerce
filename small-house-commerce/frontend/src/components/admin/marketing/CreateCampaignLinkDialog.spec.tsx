import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AdminI18nProvider } from '@/lib/admin-i18n';
import { marketingApi, type CampaignLinkRow } from '@/lib/marketing-api';
import { CreateCampaignLinkDialog } from './CreateCampaignLinkDialog';
import { PostLinkResultDialog } from './PostLinkResultDialog';
import { copyText } from '@/lib/clipboard';
vi.mock('@/components/admin/AdminAuthProvider', () => ({ useAdminAuth: () => ({ admin: { id: 'u1', name: 'Operator', permissions: ['MARKETING_VIEW_OWN','MARKETING_MANAGE_OWN'] } }) }));
vi.mock('@/lib/marketing-api', async load => ({ ...await load(), marketingApi: { linkContext: vi.fn(), createLink: vi.fn(), cloneLink: vi.fn(), createShortLink: vi.fn() } }));
vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn(async () => false) }));
const row: CampaignLinkRow = { id:'l1', code:'code1', adid:'FB-OP-1-261103-01', name:'Post', sourceType:'FB_POST', productId:'p1', productName:'Chair', productCode:null, productThumbnailUrl:null, variantId:null, variantNameSnapshot:null, landingPageId:null, pageName:null, ownerUserId:'u1', ownerName:'Operator', aid:'OP-1', path:'/products/chair?cl=code1', status:'ACTIVE', version:0, createdAt:'2026-11-03T01:00:00Z', updatedAt:'2026-11-03T01:00:00Z', postDate:'2026-11-03',postUrl:null,archivedAt:null };
beforeEach(() => {
 vi.clearAllMocks(); localStorage.clear(); vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-11-03T02:00:00Z'));
 vi.mocked(marketingApi.linkContext).mockResolvedValue({products:[{id:'p1',name:'Chair',productCode:null,slug:'chair',thumbnailUrl:null,variants:[],landingPages:[]}]});
 vi.mocked(marketingApi.createLink).mockResolvedValue(row);
});
afterEach(()=>vi.useRealTimers());
const wrap=(child: React.ReactNode)=>render(<AdminI18nProvider>{child}</AdminI18nProvider>);
describe('post creation and dedicated links',()=>{
 it('defaults to Manila today and omits an empty name for server naming',async()=>{
  wrap(<CreateCampaignLinkDialog productId="p1" defaultSourceType="FB_POST" onClose={vi.fn()} onSaved={vi.fn()}/>);
  await screen.findByTestId('link-builder-product-current');
  expect(screen.getByLabelText('发帖日期')).toHaveValue('2026-11-03');
  fireEvent.click(screen.getByRole('button',{name:'保存并生成链接'}));
  await waitFor(()=>expect(marketingApi.createLink).toHaveBeenCalledWith(expect.objectContaining({postDate:'2026-11-03',sourceType:'FB_POST'})));
  expect(vi.mocked(marketingApi.createLink).mock.calls[0][0]).not.toHaveProperty('name');
 });
 it('does not inherit a copied post date, URL or name',async()=>{
  wrap(<CreateCampaignLinkDialog copyFrom={{...row,postDate:'2026-10-01',postUrl:'https://facebook.com/old'}} onClose={vi.fn()} onSaved={vi.fn()}/>);
  await screen.findByTestId('link-builder-product-current');
  expect(screen.getByLabelText('发帖日期')).toHaveValue('2026-11-03');
  expect(screen.getByLabelText(/Facebook 原帖地址/)).toHaveValue('');
  expect(screen.getByLabelText('内部名称')).toHaveValue('');
 });
 it('lets a page-scoped create change or clear the prefilled product', async()=>{
  wrap(<CreateCampaignLinkDialog productId="p1" lockProduct={false} defaultSourceType="FB_POST" onClose={vi.fn()} onSaved={vi.fn()}/>);
  await screen.findByTestId('link-builder-product-current');
  expect(screen.getByRole('button',{name:'清除选择'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'清除选择'}));
  expect(screen.queryByTestId('link-builder-product-current')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'保存并生成链接'})).toBeDisabled();
 });
 it('keeps the product locked when a landing page or product page owns it', async()=>{
  wrap(<CreateCampaignLinkDialog productId="p1" onClose={vi.fn()} onSaved={vi.fn()}/>);
  await screen.findByTestId('link-builder-product-current');
  expect(screen.getByRole('button',{name:'更换'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'清除选择'})).toBeDisabled();
 });
 it('warns on an unconfirmed create response without retrying automatically', async()=>{
  vi.mocked(marketingApi.createLink).mockRejectedValue(new TypeError('Failed to fetch'));
  wrap(<CreateCampaignLinkDialog productId="p1" defaultSourceType="FB_POST" onClose={vi.fn()} onSaved={vi.fn()}/>);
  await screen.findByTestId('link-builder-product-current');fireEvent.click(screen.getByRole('button',{name:'保存并生成链接'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('不要立即重复创建');
  expect(marketingApi.createLink).toHaveBeenCalledTimes(1);
 });
 it('keeps the saved long link when shortening fails and retries only shortening',async()=>{
  vi.mocked(marketingApi.createShortLink).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({path:'/s/abc123',code:'abc123',target:row.path});
  wrap(<PostLinkResultDialog link={row} onClose={vi.fn()} onContinue={vi.fn()}/>);
  await screen.findByRole('alert');
  expect(screen.getByLabelText('完整投放链接')).toHaveValue(new URL(row.path,window.location.origin).href);
  fireEvent.click(screen.getByRole('button',{name:'重试短链'}));
  await waitFor(()=>expect(screen.getByLabelText('该帖专属短链')).toHaveValue(new URL('/s/abc123',window.location.origin).href));
  expect(marketingApi.createLink).not.toHaveBeenCalled();
 });
 it('never lets the short-link button copy the long link', async()=>{
  vi.mocked(marketingApi.createShortLink).mockRejectedValue(new Error('offline'));
  wrap(<PostLinkResultDialog link={row} onClose={vi.fn()} onContinue={vi.fn()}/>);
  await screen.findByRole('alert');
  expect(screen.getByRole('button',{name:'复制短链'})).toBeDisabled();
  vi.mocked(copyText).mockResolvedValue(true);
  fireEvent.click(screen.getByRole('button',{name:'复制完整链接'}));
  await waitFor(()=>expect(copyText).toHaveBeenCalledWith(new URL(row.path,window.location.origin).href));
 });
 it('copies the URL each button names once the short link exists', async()=>{
  vi.mocked(marketingApi.createShortLink).mockResolvedValue({path:'/s/abc123',code:'abc123',target:row.path});
  vi.mocked(copyText).mockResolvedValue(true);
  wrap(<PostLinkResultDialog link={row} onClose={vi.fn()} onContinue={vi.fn()}/>);
  await waitFor(()=>expect(screen.getByLabelText('该帖专属短链')).toHaveValue(new URL('/s/abc123',window.location.origin).href));
  fireEvent.click(screen.getByRole('button',{name:'复制短链'}));
  await waitFor(()=>expect(copyText).toHaveBeenLastCalledWith(new URL('/s/abc123',window.location.origin).href));
 });
});
