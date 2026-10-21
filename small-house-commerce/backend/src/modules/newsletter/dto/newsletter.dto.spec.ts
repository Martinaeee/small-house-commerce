import { describe, expect, it } from 'vitest';
import {
  subscriberQuerySchema,
  subscriberStatusSchema,
  subscribeSchema,
  unsubscribeQuerySchema,
} from './newsletter.dto.js';

describe('newsletter DTOs', () => {
  it('trims a valid email and accepts known sources', () => {
    expect(
      subscribeSchema.parse({ email: ' shopper@example.com ', source: 'POPUP' }),
    ).toEqual({ email: 'shopper@example.com', source: 'POPUP' });
  });

  it('rejects invalid email and source values', () => {
    expect(() =>
      subscribeSchema.parse({ email: 'not-an-email', source: 'SIDEBAR' }),
    ).toThrow();
  });

  it('bounds unsubscribe tokens', () => {
    expect(unsubscribeQuerySchema.parse({ token: 'abc.def' })).toEqual({
      token: 'abc.def',
    });
    expect(() =>
      unsubscribeQuerySchema.parse({ token: 'x'.repeat(2_049) }),
    ).toThrow();
  });

  it('normalizes subscriber list pagination and filters', () => {
    expect(
      subscriberQuerySchema.parse({
        page: '2',
        pageSize: '25',
        status: 'UNSUBSCRIBED',
        source: 'FOOTER',
      }),
    ).toEqual({
      page: 2,
      pageSize: 25,
      status: 'UNSUBSCRIBED',
      source: 'FOOTER',
    });
    expect(subscriberQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('accepts only subscriber statuses for updates', () => {
    expect(subscriberStatusSchema.parse({ status: 'SUBSCRIBED' })).toEqual({
      status: 'SUBSCRIBED',
    });
    expect(() => subscriberStatusSchema.parse({ status: 'PENDING' })).toThrow();
  });
});
