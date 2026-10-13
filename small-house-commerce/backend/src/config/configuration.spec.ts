import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuration } from './configuration.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('email application configuration', () => {
  it('projects validated provider and storefront values into ConfigService keys', () => {
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/shop_test',
    );
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
    vi.stubEnv('EMAIL_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'support@luwag.ph');
    vi.stubEnv('STOREFRONT_BASE_URL', 'https://luwag.ph');

    expect(configuration().email).toEqual({
      apiKey: 're_test',
      from: 'support@luwag.ph',
      storefrontBaseUrl: 'https://luwag.ph',
    });
  });
});
