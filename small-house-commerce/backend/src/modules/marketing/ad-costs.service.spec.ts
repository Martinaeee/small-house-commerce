import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { AdCostsService } from './ad-costs.service.js';
import { CampaignLinksService } from './campaign-links.service.js';
import { OptimizersService } from './optimizers.service.js';

const OWNER = '11111111-1111-4111-a111-111111111111';
const ADMIN = '22222222-2222-4222-a222-222222222222';
const LINK = '33333333-3333-4333-a333-333333333333';
const PRODUCT = '44444444-4444-4444-a444-444444444444';
const own = { id: OWNER, permissions: ['MARKETING_VIEW_OWN', 'MARKETING_MANAGE_OWN'] };
const admin = { id: ADMIN, permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_ALL'] };
const base = { linkId: LINK, costDate: '2026-10-09', amountUsd: '50.00', phpPerUsd: '57.3', note: 'Creative A' };

type Row = { id: string; linkId: string; ownerUserId: string; costDate: Date; amountUsd: Prisma.Decimal; phpPerUsd: Prisma.Decimal | null; amountPhp: Prisma.Decimal; note: string | null; voidedAt: Date | null; version: number; createdById: string; updatedById: string; createdAt: Date; updatedAt: Date; link?: unknown };

function setup() {
  const rows = new Map<string, Row>();
  const audits: Record<string, unknown>[] = [];
  const link = { id: LINK, code: 'abcdefghijklmnop', ownerUserId: OWNER, aidSnapshot: 'OP-1', name: 'Ad A', createdAt: new Date('2026-10-08T17:00:00Z'), productId: PRODUCT, landingPageId: null, variantId: null, status: 'ACTIVE', sourceType: 'META_AD', product: { name: 'Chair', productCode: 'LUW-001', slug: 'chair', status: 'ACTIVE' }, owner: { name: 'Owner', status: 'ACTIVE', optimizerProfile: { displayName: 'Owner', status: 'ACTIVE' } }, landingPage: null };
  const prisma = {
    campaignLink: { findUnique: vi.fn(async () => link) },
    adCostEntry: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; linkId_costDate?: { linkId: string; costDate: Date } } }) => { const key = where.linkId_costDate; return where.id ? rows.get(where.id) ?? null : [...rows.values()].find(row => row.linkId === key?.linkId && row.costDate.toISOString() === key.costDate.toISOString()) ?? null; }),
      create: vi.fn(async ({ data }: { data: Row }) => { const row = { ...data, id: 'cost-1', version: 0, voidedAt: null, createdAt: new Date(), updatedAt: new Date(), link }; rows.set(row.id, row); return row; }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; ownerUserId: string; version: number }; data: Partial<Row> }) => { const row = rows.get(where.id); if (!row || row.version !== where.version || row.ownerUserId !== where.ownerUserId) return { count: 0 }; rows.set(row.id, { ...row, ...data, version: row.version + 1, updatedAt: new Date() }); return { count: 1 }; }),
      findMany: vi.fn(async ({ where }: { where: { voidedAt?: null; ownerUserId?: string } }) => [...rows.values()].filter(row => (where.voidedAt !== null || row.voidedAt === null) && (!where.ownerUserId || row.ownerUserId === where.ownerUserId))),
      count: vi.fn(async ({ where }: { where: { voidedAt?: null; ownerUserId?: string } }) => [...rows.values()].filter(row => (where.voidedAt !== null || row.voidedAt === null) && (!where.ownerUserId || row.ownerUserId === where.ownerUserId)).length),
    },
    adCostAudit: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; }), findMany: vi.fn(async () => audits) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (work: (tx: typeof prisma) => unknown) => work(prisma));
  const links = new CampaignLinksService(prisma as never, new OptimizersService(prisma as never));
  return { service: new AdCostsService(prisma as never, links), prisma, link, rows, audits };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T16:30:00Z')); });
afterEach(() => vi.useRealTimers());

describe('USD advertising costs with audited corrections', () => {
  it('computes PHP from Decimal inputs and never accepts a client total or owner override', async () => {
    const { service } = setup();
    const result = await service.upsertCost({ ...base, amountPhp: '1.00', ownerUserId: ADMIN } as never, own);
    expect(result).toMatchObject({ ownerUserId: OWNER, amountUsd: '50.00', phpPerUsd: '57.300000', amountPhp: '2865.00', version: 0 });
  });

  it('rounds each individual conversion half up to PHP cents', async () => {
    const { service } = setup();
    expect(await service.upsertCost({ ...base, amountUsd: '0.01', phpPerUsd: '56.5' }, own)).toMatchObject({ amountPhp: '0.57' });
  });

  it('requires a saved version to correct the same link/day and keeps one row with before/after audit', async () => {
    const { service, rows, audits } = setup();
    const original = await service.upsertCost(base, own);
    expect(original).toMatchObject({ version: 0 });
    const corrected = await service.upsertCost({ ...base, amountUsd: '60.00', expectedVersion: 0 }, own);
    expect(corrected).toMatchObject({ id: original!.id, amountPhp: '3438.00', version: 1 });
    expect(rows.size).toBe(1);
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({ actorUserId: OWNER, action: 'UPDATE', before: { amountUsd: '50.00', phpPerUsd: '57.300000', amountPhp: '2865.00', version: 0 }, after: { amountUsd: '60.00', amountPhp: '3438.00', version: 1 } });
    await expect(service.upsertCost({ ...base, amountUsd: '99.00' }, own)).rejects.toMatchObject({ status: 409 });
    await expect(service.upsertCost({ ...base, amountUsd: '99.00', expectedVersion: 0 }, own)).rejects.toMatchObject({ status: 409 });
    expect(audits).toHaveLength(2);
  });

  it('allows explicit zero spend without a rate and distinguishes it from an absent row', async () => {
    const { service, rows } = setup();
    expect(rows.size).toBe(0);
    expect(await service.upsertCost({ ...base, amountUsd: '0.00', phpPerUsd: null }, own)).toMatchObject({ amountUsd: '0.00', phpPerUsd: null, amountPhp: '0.00', voidedAt: null });
    expect(rows.size).toBe(1);
  });

  it('rejects dates before link creation or after Manila today and non-positive FX on spend', async () => {
    for (const extra of [{ costDate: '2026-10-08' }, { costDate: '2026-10-12' }, { phpPerUsd: '0' }, { phpPerUsd: null }]) {
      const { service, rows, audits } = setup();
      await expect(service.upsertCost({ ...base, ...extra }, own)).rejects.toMatchObject({ status: 400 });
      expect(rows.size).toBe(0); expect(audits).toHaveLength(0);
    }
    const { service } = setup();
    expect(await service.upsertCost({ ...base, costDate: '2026-10-11' }, own)).toMatchObject({ costDate: '2026-10-11' });
  });

  it('rejects an individually valid USD/rate product that overflows PHP storage', async () => {
    const { service, rows } = setup();
    await expect(service.upsertCost({ ...base, amountUsd: '9999999999.99', phpPerUsd: '999999.999999' }, own)).rejects.toMatchObject({ status: 400 });
    expect(rows.size).toBe(0);
  });

  it('preserves a voided row and its audited values while removing it from active totals', async () => {
    const { service, rows, audits } = setup();
    const row = await service.upsertCost(base, own);
    expect(row).not.toBeNull();
    const voided = await service.voidCost(row!.id, 0, own);
    expect(voided).toMatchObject({ voidedAt: expect.any(String), amountUsd: '50.00', version: 1 });
    expect(rows.size).toBe(1);
    expect(audits[1]).toMatchObject({ action: 'VOID', actorUserId: OWNER, before: { voidedAt: null }, after: { voidedAt: expect.any(String) } });
    const active = await service.listCosts({ includeVoided: false, page: 1, pageSize: 20 }, own);
    expect(active.items).toHaveLength(0);
    expect(active.total).toBe(0);
    await expect(service.voidCost(row!.id, 0, own)).rejects.toMatchObject({ status: 409 });
  });

  it('reactivates a same-day voided row only through a new versioned, audited correction', async () => {
    const { service, rows, audits } = setup();
    const row = await service.upsertCost(base, own);
    expect(row).not.toBeNull();
    await service.voidCost(row!.id, 0, own);
    expect(await service.upsertCost({ ...base, amountUsd: '55.00', expectedVersion: 1 }, own)).toMatchObject({ id: row!.id, voidedAt: null, version: 2 });
    expect(rows.size).toBe(1);
    expect(audits[2]).toMatchObject({ action: 'UPDATE', before: { voidedAt: expect.any(String) }, after: { voidedAt: null } });
  });

  it('preserves server link ownership when an administrator records the expense', async () => {
    const { service, audits } = setup();
    expect(await service.upsertCost(base, admin)).toMatchObject({ ownerUserId: OWNER, createdById: ADMIN });
    expect(audits[0]).toMatchObject({ actorUserId: ADMIN });
  });

  it('lets finance read the preserved correction and void history without changing saved FX', async () => {
    const { service } = setup();
    const row = await service.upsertCost(base, own);
    await service.upsertCost({ ...base, phpPerUsd: '58', expectedVersion: 0 }, own);
    await service.voidCost(row.id, 1, admin);
    const history = await service.auditHistory(row.id, { id: ADMIN, permissions: ['MARKETING_VIEW_ALL'] });
    expect(history).toHaveLength(3);
    expect(history[1]).toMatchObject({ action: 'UPDATE', before: { phpPerUsd: '57.300000', amountPhp: '2865.00' }, after: { phpPerUsd: '58.000000', amountPhp: '2900.00' } });
    expect(history[2]).toMatchObject({ action: 'VOID', actorUserId: ADMIN });
  });

  it('hides an audit record from another owner and rejects nonexistent records', async () => {
    const { service } = setup();
    const row = await service.upsertCost(base, own);
    await expect(service.auditHistory(row.id, { ...own, id: ADMIN })).rejects.toMatchObject({ status: 404 });
    await expect(service.auditHistory('missing', admin)).rejects.toMatchObject({ status: 404 });
  });

  it('hides foreign owners and prohibits finance and broad-read-only writers', async () => {
    const { service } = setup();
    await expect(service.upsertCost(base, { ...own, id: ADMIN })).rejects.toMatchObject({ status: 404 });
    await expect(service.upsertCost(base, { id: ADMIN, permissions: ['MARKETING_VIEW_ALL'] })).rejects.toMatchObject({ status: 403 });
    await expect(service.upsertCost(base, { id: ADMIN, permissions: ['MARKETING_VIEW_ALL', 'MARKETING_MANAGE_OWN'] })).rejects.toMatchObject({ status: 404 });
  });
});
