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
  };
}

export type AppConfiguration = ReturnType<typeof configuration>;
