import { describe, expect, it, vi } from 'vitest';
import { persistConvertedDraft } from './converted-draft.js';

const NOW = new Date('2026-11-03T00:00:00.000Z');
const ARGS = {
  rawToken: `${NOW.getTime().toString(36)}.${'C'.repeat(43)}`,
  orderId: '11111111-1111-4111-8111-111111111111',
  customerName: 'Ana',
  customerPhone: '09171234567',
  now: NOW,
};

describe('persistConvertedDraft', () => {
  it('converts an existing open draft in the order transaction', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const createMany = vi.fn(async () => ({ count: 0 }));
    await persistConvertedDraft({ checkoutDraft: { updateMany, createMany } } as never, ARGS);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), status: 'OPEN' },
        data: expect.objectContaining({ status: 'CONVERTED', orderId: ARGS.orderId }),
      }),
    );
    expect(createMany).not.toHaveBeenCalled();
  });

  it('creates a converted tombstone when the first autosave never arrived', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const createMany = vi.fn(async () => ({ count: 1 }));
    await persistConvertedDraft({ checkoutDraft: { updateMany, createMany } } as never, ARGS);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          status: 'CONVERTED',
          orderId: ARGS.orderId,
          hasUserInput: true,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('stamps the tombstone timestamps the table requires', async () => {
    // `updated_at` is NOT NULL with no database default: a createMany that
    // leaves it out fails the insert and rolls the whole order back.
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const createMany = vi.fn(
      async (_args: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) => ({
        count: 1,
      }),
    );
    await persistConvertedDraft({ checkoutDraft: { updateMany, createMany } } as never, ARGS);
    const data = createMany.mock.calls[0]?.[0]?.data?.[0];
    expect(data?.createdAt).toEqual(NOW);
    expect(data?.updatedAt).toEqual(NOW);
  });

  it('never touches the draft for a malformed token', async () => {
    const updateMany = vi.fn();
    const createMany = vi.fn();
    await persistConvertedDraft({ checkoutDraft: { updateMany, createMany } } as never, {
      ...ARGS,
      rawToken: 'not-a-token',
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});
