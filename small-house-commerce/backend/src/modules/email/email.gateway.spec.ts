import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { createEmailGateway } from './email.module.js';
import { isEmailDeliveryEnabled } from './email-delivery-readiness.js';
import { LogEmailGateway } from './log-email.gateway.js';
import { ResendEmailGateway } from './resend-email.gateway.js';

describe('email delivery readiness', () => {
  it.each([
    { email: { apiKey: null, from: null, storefrontBaseUrl: null } },
    {
      email: {
        apiKey: 're_test',
        from: null,
        storefrontBaseUrl: 'https://luwag.ph',
      },
    },
    {
      email: {
        apiKey: 're_test',
        from: 'support@luwag.ph',
        storefrontBaseUrl: null,
      },
    },
  ])('disables production delivery unless every provider value is configured', ({
    email,
  }) => {
    expect(
      isEmailDeliveryEnabled(
        new ConfigService({ app: { isProduction: true }, email }),
      ),
    ).toBe(false);
  });

  it('enables production delivery when key, sender and public base URL are configured', () => {
    expect(
      isEmailDeliveryEnabled(
        new ConfigService({
          app: { isProduction: true },
          email: {
            apiKey: 're_test',
            from: 'support@luwag.ph',
            storefrontBaseUrl: 'https://luwag.ph',
          },
        }),
      ),
    ).toBe(true);
  });

  it.each(['test', 'development'])(
    'keeps the log gateway usable in %s',
    (nodeEnv) => {
      expect(
        isEmailDeliveryEnabled(
          new ConfigService({
            app: { nodeEnv, isProduction: false },
            email: { apiKey: null, from: null, storefrontBaseUrl: null },
          }),
        ),
      ).toBe(true);
    },
  );
});

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

  it('logs a structured back-in-stock message', async () => {
    const log = vi.fn();
    const gateway = new LogEmailGateway({ log });

    await gateway.sendBackInStock('a@b.com', {
      productName: 'Oak Chair',
      productUrl: 'https://example.test/products/oak-chair',
      unsubscribeUrl: 'https://example.test/unsubscribe',
    });

    expect(JSON.stringify(log.mock.calls[0])).toContain('back-in-stock');
    expect(JSON.stringify(log.mock.calls[0])).toContain('Oak Chair');
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

  it('posts a back-in-stock message with its product link', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const gateway = new ResendEmailGateway(
      're_test_key',
      'support@luwag.ph',
      request,
    );

    await gateway.sendBackInStock('shopper@example.com', {
      productName: 'Oak & Cane Chair',
      productUrl: 'https://luwag.ph/products/oak-chair',
      unsubscribeUrl: 'https://luwag.ph/unsubscribe?token=safe',
    });

    const body = JSON.parse(String(request.mock.calls[0][1]?.body)) as Record<
      string,
      unknown
    >;
    expect(String(body.subject)).toContain('Oak & Cane Chair');
    expect(String(body.html)).toContain('https://luwag.ph/products/oak-chair');
    expect(String(body.html)).toContain('Oak &amp; Cane Chair');
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
