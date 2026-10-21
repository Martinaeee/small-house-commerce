import { describe, expect, it } from 'vitest';
import { uploadStorageIsDurable } from './configuration.js';
import { parseEnv } from './env.validation.js';

const base = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  JWT_SECRET: 'x'.repeat(32),
};

describe('upload durability configuration', () => {
  it('marks development/test local storage durable but production local storage ephemeral', () => {
    expect(uploadStorageIsDurable(parseEnv({ ...base, NODE_ENV: 'development' }))).toBe(true);
    expect(uploadStorageIsDurable(parseEnv({ ...base, NODE_ENV: 'test' }))).toBe(true);
    expect(uploadStorageIsDurable(parseEnv({ ...base, NODE_ENV: 'production' }))).toBe(false);
  });

  it('requires an explicit true flag for durable production local storage', () => {
    expect(
      uploadStorageIsDurable(
        parseEnv({
          ...base,
          NODE_ENV: 'production',
          UPLOAD_STORAGE_DURABLE: 'true',
        }),
      ),
    ).toBe(true);
    expect(() =>
      parseEnv({ ...base, UPLOAD_STORAGE_DURABLE: 'yes' }),
    ).toThrow('UPLOAD_STORAGE_DURABLE');
  });

  it('treats only complete R2 configuration as automatically durable', () => {
    const production = { ...base, NODE_ENV: 'production' } as const;
    expect(
      uploadStorageIsDurable(
        parseEnv({ ...production, R2_ACCOUNT_ID: 'partial' }),
      ),
    ).toBe(false);
    expect(
      uploadStorageIsDurable(
        parseEnv({
          ...production,
          R2_ACCOUNT_ID: 'acct',
          R2_ACCESS_KEY_ID: 'key',
          R2_SECRET_ACCESS_KEY: 'secret',
          R2_BUCKET: 'bucket',
          R2_PUBLIC_BASE_URL: 'https://img.example.test',
        }),
      ),
    ).toBe(true);
  });
});

describe('email environment validation', () => {
  it('keeps the log gateway available when all email variables are unset', () => {
    const parsed = parseEnv(base);
    expect(parsed.EMAIL_API_KEY).toBeUndefined();
    expect(parsed.EMAIL_FROM).toBeUndefined();
    expect(parsed.STOREFRONT_BASE_URL).toBeUndefined();
  });

  it('accepts a complete Resend configuration', () => {
    expect(
      parseEnv({
        ...base,
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

  it('rejects an API key without a sender address', () => {
    expect(() => parseEnv({ ...base, EMAIL_API_KEY: 're_test' })).toThrow(
      'EMAIL_FROM is required when EMAIL_API_KEY is set',
    );
  });
});
