import { analyticsEventSchema, analyticsEventNames } from './analytics-event.dto.js';

const base = {
  sessionId: 'session-abc-123456',
  pageUrl: 'https://luwag.shop/checkout/confirm',
  pagePath: '/checkout/confirm',
  deviceType: 'mobile' as const,
};

describe('analytics event names', () => {
  it('accepts the checkout submit events', () => {
    for (const eventName of ['CHECKOUT_SUBMIT_ATTEMPT', 'CHECKOUT_SUBMIT_FAILED'] as const) {
      expect(analyticsEventNames).toContain(eventName);
      expect(analyticsEventSchema.safeParse({ ...base, eventName }).success).toBe(true);
    }
  });

  it('keeps rejecting names outside the list', () => {
    expect(analyticsEventSchema.safeParse({ ...base, eventName: 'CHECKOUT_SUBMIT' }).success).toBe(false);
  });

  it('passes a failure metadata blob through unchanged', () => {
    const parsed = analyticsEventSchema.parse({
      ...base,
      eventName: 'CHECKOUT_SUBMIT_FAILED',
      entityId: 'sku-1,sku-2',
      metadata: {
        step: 'confirm',
        reason: 'STOCK',
        httpStatus: 400,
        skuIds: ['sku-1', 'sku-2'],
        customer: { name: 'Ana', phone: '+639171234567' },
        idempotencyKey: 'key-1',
      },
    });
    expect(parsed.metadata).toMatchObject({ reason: 'STOCK', step: 'confirm' });
  });
});
