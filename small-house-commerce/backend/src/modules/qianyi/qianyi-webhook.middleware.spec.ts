import { describe, expect, it, vi } from 'vitest';
import { QianyiWebhookMiddleware } from './qianyi-webhook.middleware.js';

function harness(allow: boolean) {
  const response = { status: vi.fn(() => response), json: vi.fn(() => response) };
  const next = vi.fn();
  const webhooks = { allow: vi.fn(() => allow) };
  const middleware = new QianyiWebhookMiddleware(webhooks as never);
  return { response, next, webhooks,
    run: (headers: Record<string, string>) => middleware.use({ ip: '203.0.113.9', headers } as never, response as never, next) };
}

describe('QianyiWebhookMiddleware', () => {
  it('rejects an over-budget caller before the multipart parser runs', () => {
    const { run, response, next } = harness(false);
    run({});
    expect(response.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a declared body larger than the cap', () => {
    const { run, response, next } = harness(true);
    run({ 'content-length': '999999999' });
    expect(response.status).toHaveBeenCalledWith(413);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets a normal callback through', () => {
    const { run, next, webhooks } = harness(true);
    run({ 'content-length': '800' });
    expect(webhooks.allow).toHaveBeenCalledWith('203.0.113.9');
    expect(next).toHaveBeenCalled();
  });
});
