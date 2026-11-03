import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutDraftsCleanup } from './checkout-drafts-cleanup.js';

describe('CheckoutDraftsCleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs once at start and then on the interval, unref-ing the timer', async () => {
    vi.useFakeTimers();
    const drafts = { prune: vi.fn(async () => ({ expired: 0, deleted: 0 })) };
    const unref = vi.fn();
    const realSetInterval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      const timer = realSetInterval(fn, ms);
      const original = timer.unref?.bind(timer);
      timer.unref = () => {
        unref();
        original?.();
        return timer;
      };
      return timer;
    }) as typeof setInterval);
    const cleanup = new CheckoutDraftsCleanup(drafts as never);
    cleanup.onModuleInit();
    expect(drafts.prune).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60_000);
    expect(drafts.prune).toHaveBeenCalledTimes(2);
    expect(unref).toHaveBeenCalled();
    cleanup.onModuleDestroy();
  });

  it('does not crash the app when a prune tick fails', async () => {
    vi.useFakeTimers();
    const drafts = {
      prune: vi.fn(async () => {
        throw new Error('db down');
      }),
    };
    vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref: vi.fn() } as never);
    const cleanup = new CheckoutDraftsCleanup(drafts as never);
    expect(() => cleanup.onModuleInit()).not.toThrow();
    await vi.runOnlyPendingTimersAsync();
    cleanup.onModuleDestroy();
  });
});
