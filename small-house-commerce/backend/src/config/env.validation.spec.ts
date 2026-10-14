import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.validation.js';

const required = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/shop_test',
  JWT_SECRET: 'x'.repeat(32),
};

describe('homepage preview environment validation', () => {
  it('treats an absent or blank preview secret as disabled', () => {
    expect(parseEnv(required).HOMEPAGE_PREVIEW_SECRET).toBeUndefined();
    expect(
      parseEnv({ ...required, HOMEPAGE_PREVIEW_SECRET: '   ' })
        .HOMEPAGE_PREVIEW_SECRET,
    ).toBeUndefined();
  });

  it('rejects an enabled preview secret shorter than 32 characters', () => {
    expect(() =>
      parseEnv({ ...required, HOMEPAGE_PREVIEW_SECRET: 'too-short' }),
    ).toThrow(/HOMEPAGE_PREVIEW_SECRET must be at least 32 characters/);
  });

  it('accepts a 32-character preview secret', () => {
    const secret = 'p'.repeat(32);
    expect(
      parseEnv({ ...required, HOMEPAGE_PREVIEW_SECRET: secret })
        .HOMEPAGE_PREVIEW_SECRET,
    ).toBe(secret);
  });
});

describe('email environment validation', () => {
  it('allows the log gateway without provider configuration', () => {
    const parsed = parseEnv(required);

    expect(parsed.EMAIL_API_KEY).toBeUndefined();
    expect(parsed.EMAIL_FROM).toBeUndefined();
    expect(parsed.STOREFRONT_BASE_URL).toBeUndefined();
  });

  it('allows Compose to pass blank optional email variables to the log gateway', () => {
    const parsed = parseEnv({
      ...required,
      EMAIL_API_KEY: '',
      EMAIL_FROM: '',
      STOREFRONT_BASE_URL: '',
    });

    expect(parsed.EMAIL_API_KEY).toBeUndefined();
    expect(parsed.EMAIL_FROM).toBeUndefined();
    expect(parsed.STOREFRONT_BASE_URL).toBeUndefined();
  });

  it('requires a public storefront URL when real email delivery is enabled', () => {
    expect(() =>
      parseEnv({
        ...required,
        EMAIL_API_KEY: 're_test',
        EMAIL_FROM: 'support@luwag.ph',
      }),
    ).toThrow(/STOREFRONT_BASE_URL is required when EMAIL_API_KEY is set/);
  });

  it('accepts a complete real-email configuration', () => {
    expect(
      parseEnv({
        ...required,
        EMAIL_API_KEY: 're_test',
        EMAIL_FROM: 'support@luwag.ph',
        STOREFRONT_BASE_URL: 'https://luwag.ph',
      }),
    ).toMatchObject({
      EMAIL_API_KEY: 're_test',
      EMAIL_FROM: 'support@luwag.ph',
      STOREFRONT_BASE_URL: 'https://luwag.ph',
    });
  });
});
