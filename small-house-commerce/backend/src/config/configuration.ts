import { parseEnv, type Env } from './env.validation.js';

export function hasCompleteR2(env: Env): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET &&
      env.R2_PUBLIC_BASE_URL,
  );
}

export function uploadStorageIsDurable(env: Env): boolean {
  return (
    hasCompleteR2(env) ||
    env.UPLOAD_STORAGE_DURABLE === 'true' ||
    env.NODE_ENV !== 'production'
  );
}

/**
 * Namespaced configuration tree exposed through ConfigService.
 *
 *   config.get('database.url')
 *   config.get('app.port')
 *
 * Passing this to ConfigModule.forRoot({ load: [...] }) is what triggers
 * validation: parseEnv throws during bootstrap if the environment is invalid.
 */
export function configuration() {
  const env = parseEnv();

  return {
    app: {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      host: env.HOST,
      isProduction: env.NODE_ENV === 'production',
    },
    database: {
      url: env.DATABASE_URL,
    },
    jwt: {
      secret: env.JWT_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
    },
    homepagePreviewSecret: env.HOMEPAGE_PREVIEW_SECRET ?? '',
    r2: {
      accountId: env.R2_ACCOUNT_ID ?? null,
      accessKeyId: env.R2_ACCESS_KEY_ID ?? null,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? null,
      bucket: env.R2_BUCKET ?? null,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL ?? null,
    },
    // Local-disk image upload target (order workbench: default when R2 is unset).
    upload: {
      dir: env.UPLOAD_DIR ?? null,
      durable: uploadStorageIsDurable(env),
    },
    email: {
      apiKey: env.EMAIL_API_KEY ?? null,
      from: env.EMAIL_FROM ?? null,
      replyTo: env.EMAIL_REPLY_TO ?? null,
      storefrontBaseUrl: env.STOREFRONT_BASE_URL ?? null,
    },
    // Server-side Meta Conversions API. Null values keep it disabled.
    meta: {
      pixelId: env.META_PIXEL_ID ?? null,
      accessToken: env.META_CAPI_ACCESS_TOKEN ?? null,
      testEventCode: env.META_CAPI_TEST_EVENT_CODE ?? null,
      apiVersion: env.META_CAPI_API_VERSION ?? 'v23.0',
    },
  };
}

export type AppConfiguration = ReturnType<typeof configuration>;
