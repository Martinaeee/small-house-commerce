import { z } from 'zod';

/**
 * Every environment variable the application reads.
 *
 * Validated once at boot so a missing or malformed value stops the process
 * immediately, instead of surfacing later as an `undefined` during a request.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  // Bind address. Containers must stay on 0.0.0.0 (default); local dev
  // sets 127.0.0.1 so the API is not reachable from the LAN.
  HOST: z.string().min(1).default('0.0.0.0'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must be a postgresql:// connection string',
    ),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters'),

  // Durations in the vercel/ms format used by @nestjs/jwt, e.g. "1h", "7d".
  JWT_ACCESS_TTL: z.string().min(1).default('1h'),
  JWT_REFRESH_TTL: z.string().min(1).default('7d'),

  // Cloudflare R2 direct image uploads. All optional: the app boots and the
  // URL-paste flow works without them; only presigning returns 503.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates the environment.
 *
 * Reports every problem at once rather than only the first, so a fresh clone
 * with several unset variables is fixed in one pass.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
