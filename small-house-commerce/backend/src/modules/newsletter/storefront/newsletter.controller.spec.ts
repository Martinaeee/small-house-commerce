import { describe, expect, it, vi } from 'vitest';
import { StorefrontNewsletterController } from './newsletter.controller.js';

function service(overrides: Record<string, unknown> = {}) {
  return {
    subscribe: vi.fn().mockResolvedValue({ ok: true, promoCode: null }),
    unsubscribeByToken: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('StorefrontNewsletterController', () => {
  it('delegates a validated subscription input', async () => {
    const newsletter = service();
    const controller = new StorefrontNewsletterController(newsletter as never);

    await expect(
      controller.subscribe({ email: 'a@b.com', source: 'FOOTER' }),
    ).resolves.toMatchObject({ ok: true });
    expect(newsletter.subscribe).toHaveBeenCalledWith({
      email: 'a@b.com',
      source: 'FOOTER',
    });
  });

  it('shows a confirmation form on GET without changing the subscription', () => {
    const newsletter = service();
    const controller = new StorefrontNewsletterController(newsletter as never);

    const page = controller.unsubscribeConfirmation({ token: 'valid.token' });

    expect(page).toContain('Confirm unsubscribe');
    expect(page).toContain('method="post"');
    expect(page).toContain('token=valid.token');
    expect(newsletter.unsubscribeByToken).not.toHaveBeenCalled();
  });

  it('returns a success page after a valid POST confirmation', async () => {
    const controller = new StorefrontNewsletterController(service() as never);

    await expect(
      controller.confirmUnsubscribe({ token: 'valid.token' }),
    ).resolves.toContain('unsubscribed');
  });

  it('returns an invalid-link page when POST verification fails', async () => {
    const controller = new StorefrontNewsletterController(
      service({ unsubscribeByToken: vi.fn().mockResolvedValue(false) }) as never,
    );

    await expect(
      controller.confirmUnsubscribe({ token: 'bad.token' }),
    ).resolves.toContain('invalid');
  });
});
