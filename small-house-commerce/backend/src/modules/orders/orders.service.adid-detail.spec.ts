import { describe, expect, it } from 'vitest';
import { OrdersService } from './orders.service.js';

describe('order detail advertising number', () => {
  it.each(['FB-OP-1-261105-01', null])('returns the same number in the detail and attribution: %s', async (adid) => {
    const order = {
      id: 'order-1', assignedToId: null, assignedBy: null,
      attribution: { adid }, statusHistory: [], notes: [],
      verificationAssignments: [], customer: { notes: [], riskLogs: [] },
    };
    const service = new OrdersService(
      { order: { findUnique: async () => order } } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );

    const detail = await service.get('order-1');

    expect(detail).toMatchObject({ adid, attribution: { adid } });
  });
});
