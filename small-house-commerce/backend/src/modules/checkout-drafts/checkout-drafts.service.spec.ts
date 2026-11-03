import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CheckoutDraftConflictError,
  CheckoutDraftGoneError,
  CheckoutDraftsService,
} from './checkout-drafts.service.js';
import type { CheckoutDraftSaveInput } from './dto/checkout-draft.dto.js';

const NOW = new Date('2026-11-03T00:00:00.000Z');
const TOKEN = `${NOW.getTime().toString(36)}.${'B'.repeat(43)}`;
const EMPTY_INPUT: CheckoutDraftSaveInput = {
  revision: 1,
  hasUserInput: false,
  customer: {
    name: '', phone: '', province: '', city: '', barangay: '',
    postalCode: '', streetAddress: '', landmark: '',
  },
  items: [],
  preferredDeliveryDate: null,
  promoCodeInput: '',
  promoCodeApplied: null,
  customerNote: '',
};

function harness(row: Record<string, unknown> | null = null) {
  const state = { row };
  const prisma = {
    checkoutDraft: {
      findUnique: vi.fn(async () => state.row),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.row = { id: 'draft-1', createdAt: NOW, updatedAt: NOW, ...data };
        return state.row;
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!state.row) return { count: 0 };
        state.row = { ...state.row, ...data };
        return { count: 1 };
      }),
    },
    sku: { findMany: vi.fn(async () => []) },
  };
  const service = new CheckoutDraftsService(prisma as never);
  return { service, prisma, state };
}

describe('CheckoutDraftsService.save', () => {
  it('creates an empty draft on first visit', async () => {
    const { service, prisma } = harness();
    const result = await service.save(TOKEN, EMPTY_INPUT, NOW);
    expect(result).toEqual({ status: 'OPEN', revision: 1, converted: false });
    expect(prisma.checkoutDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'OPEN', hasUserInput: false, clientRevision: 1 }),
      }),
    );
  });

  it('accepts an incomplete phone and name without validating them', async () => {
    const { service, state } = harness();
    await service.save(
      TOKEN,
      {
        ...EMPTY_INPUT,
        hasUserInput: true,
        customer: { ...EMPTY_INPUT.customer, name: 'Ma', phone: '0917' },
      },
      NOW,
    );
    expect(state.row?.contactPhone).toBe('0917');
    expect(state.row?.contactName).toBe('Ma');
  });

  it('treats an equal revision as an idempotent retry', async () => {
    const { service, prisma } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 3, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot: {}, productSnapshot: [],
    });
    const result = await service.save(TOKEN, { ...EMPTY_INPUT, revision: 3 }, NOW);
    expect(result).toEqual({ status: 'OPEN', revision: 3, converted: false });
    expect(prisma.checkoutDraft.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an older revision instead of overwriting newer input', async () => {
    const { service } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 5, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot: {}, productSnapshot: [],
    });
    await expect(service.save(TOKEN, { ...EMPTY_INPUT, revision: 4 }, NOW)).rejects.toBeInstanceOf(
      CheckoutDraftConflictError,
    );
  });

  it('stops writing once the draft has converted', async () => {
    const { service, prisma } = harness({
      id: 'draft-1', status: 'CONVERTED', clientRevision: 9, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot: {}, productSnapshot: [],
    });
    const result = await service.save(TOKEN, { ...EMPTY_INPUT, revision: 10 }, NOW);
    expect(result).toEqual({ status: 'CONVERTED', revision: 9, converted: true });
    expect(prisma.checkoutDraft.updateMany).not.toHaveBeenCalled();
  });

  it('keeps hasUserInput true once the shopper typed', async () => {
    const { service, state } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 1, hasUserInput: true, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot: {}, productSnapshot: [],
    });
    await service.save(TOKEN, { ...EMPTY_INPUT, revision: 2, hasUserInput: false }, NOW);
    expect(state.row?.hasUserInput).toBe(true);
  });
});

describe('CheckoutDraftsService.read', () => {
  it('returns null for an unknown token', async () => {
    const { service } = harness();
    await expect(service.read(TOKEN, NOW)).resolves.toBeNull();
  });

  it('refuses an expired draft even before cleanup runs', async () => {
    const { service } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 1, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() - 1), snapshot: {}, productSnapshot: [],
    });
    await expect(service.read(TOKEN, NOW)).rejects.toBeInstanceOf(CheckoutDraftGoneError);
  });

  it('returns the snapshot to the token holder', async () => {
    const snapshot = { ...EMPTY_INPUT, customer: { ...EMPTY_INPUT.customer, name: 'Ana' } };
    const { service } = harness({
      id: 'draft-1', status: 'OPEN', clientRevision: 2, createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000), snapshot, productSnapshot: [],
    });
    await expect(service.read(TOKEN, NOW)).resolves.toEqual({
      status: 'OPEN', revision: 2, snapshot,
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});
