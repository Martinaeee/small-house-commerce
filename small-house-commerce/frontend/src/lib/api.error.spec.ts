import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

describe('ApiError', () => {
  it('carries the status and the backend code', async () => {
    stubFetch(400, { statusCode: 400, code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock for TB001' });
    const error = await api.createOrder({ customer: {} as never, items: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock for TB001' });
  });

  it('has a null code when the backend sends none', async () => {
    stubFetch(400, { statusCode: 400, message: 'Validation failed: phone: Invalid' });
    const error = await api.createOrder({ customer: {} as never, items: [] }).catch((e) => e);
    expect(error).toMatchObject({ status: 400, code: null });
  });
});
