import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { createEmailGateway } from './email.module.js';
import { LogEmailGateway } from './log-email.gateway.js';
import { ResendEmailGateway } from './resend-email.gateway.js';

describe('email gateway selection', () => {
  it('uses the log gateway without provider credentials', () => {
    expect(
      createEmailGateway(
        new ConfigService({ email: { apiKey: null, from: null } }),
      ),
    ).toBeInstanceOf(LogEmailGateway);
  });

  it('uses Resend when an API key and sender are configured', () => {
    expect(
      createEmailGateway(
        new ConfigService({
          email: { apiKey: 're_test', from: 'support@luwag.ph' },
        }),
      ),
    ).toBeInstanceOf(ResendEmailGateway);
  });
});

describe('LogEmailGateway', () => {
  it('logs a structured welcome message and never throws', async () => {
    const log = vi.fn();
    const gateway = new LogEmailGateway({ log });

    await expect(
      gateway.sendWelcome('a@b.com', {
        promoCode: 'WELCOME10',
        unsubscribeUrl: 'https://example.test/unsubscribe',
      }),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls[0])).toContain('a@b.com');
    expect(JSON.stringify(log.mock.calls[0])).toContain('WELCOME10');
  });
});

describe('ResendEmailGateway', () => {
  it('posts an escaped welcome email to Resend', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const gateway = new ResendEmailGateway(
      're_test_key',
      'support@luwag.ph',
      request,
    );

    await gateway.sendWelcome('shopper@example.com', {
      offerTitle: '<script>alert(1)</script>',
      offerBody: 'Save & enjoy',
      promoCode: 'WELCOME10',
      unsubscribeUrl: 'https://luwag.ph/unsubscribe?token=safe',
    });

    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'support@luwag.ph',
      to: ['shopper@example.com'],
    });
    expect(String(body.html)).toContain('&lt;script&gt;');
    expect(String(body.html)).not.toContain('<script>');
    expect(String(body.html)).toContain('Save &amp; enjoy');
  });

  it('bounds Resend requests with a five-second timeout signal', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const gateway = new ResendEmailGateway(
      're_test_key',
      'support@luwag.ph',
      request,
    );

    await gateway.sendWelcome('shopper@example.com', {
      unsubscribeUrl: 'https://luwag.ph/unsubscribe?token=safe',
    });

    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(request.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws when Resend rejects the request', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('provider unavailable', { status: 503 }),
    );
    const gateway = new ResendEmailGateway(
      're_test_key',
      'support@luwag.ph',
      request,
    );

    await expect(
      gateway.sendWelcome('shopper@example.com', {
        unsubscribeUrl: 'https://luwag.ph/unsubscribe?token=safe',
      }),
    ).rejects.toThrow('Resend email failed (503)');
  });
});
