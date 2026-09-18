import { parseEnv } from './env.validation.js';

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
    },
  };
}

export type AppConfiguration = ReturnType<typeof configuration>;
