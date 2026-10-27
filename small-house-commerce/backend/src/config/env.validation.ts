import { z } from 'zod';

const blankAsUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const EMAIL_ADDRESS = z.string().email();

/**
 * The sender `From` value, which is forwarded to Resend verbatim.
 *
 * Resend takes either a bare address or the RFC 5322 display form
 * ("LUWAG <no-reply@luwag.shop>"). Validating as a bare email rejects the
 * display form and stops the process at boot, so both shapes are accepted
 * while the address itself is still checked.
 */
const emailFrom = z.string().superRefine((value, ctx) => {
  if (/[\r\n]/.test(value)) {
    ctx.addIssue({
      code: 'custom',
      message: 'EMAIL_FROM must not contain line breaks',
    });
    return;
  }

  const display = /^([^<>]+?)\s*<([^<>]+)>$/.exec(value.trim());
  if (display && display[1].trim() === '') {
    ctx.addIssue({
      code: 'custom',
      message: 'EMAIL_FROM display name is empty',
    });
    return;
  }

  const address = display ? display[2].trim() : value.trim();
  if (!EMAIL_ADDRESS.safeParse(address).success) {
    ctx.addIssue({
      code: 'custom',
      message:
        'EMAIL_FROM must be an email address or "Display Name <address>"',
    });
  }
});

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

  // Optional signed homepage draft-preview tokens. Empty/unset disables preview;
  // an enabled HMAC secret must resist offline guessing if a token is observed.
  HOMEPAGE_PREVIEW_SECRET: z.preprocess(
    blankAsUndefined,
    z
      .string()
      .min(32, 'HOMEPAGE_PREVIEW_SECRET must be at least 32 characters')
      .optional(),
  ),

  // Cloudflare R2 direct image uploads. All optional: the app boots and the
  // URL-paste flow works without them; only presigning returns 503.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  // Local-disk image upload (default when R2 is not configured). Files land
  // here and are served by the backend itself at /uploads/*.
  UPLOAD_DIR: z.string().optional(),
  // Production-local brand assets are publishable only when this path is a
  // persistent mounted volume. R2 is considered durable automatically.
  UPLOAD_STORAGE_DURABLE: z.enum(['true', 'false']).optional(),

  // On-demand storefront revalidation. Both must be set for the best-effort
  // bridge to run; unset either and admin writes simply fall back to ISR.
  REVALIDATE_URL: z.string().url().optional(),
  REVALIDATE_SECRET: z.string().optional(),

  // Optional email delivery. Unset uses the log gateway; when a provider key
  // is supplied, both a validated sender and the public unsubscribe-link base
  // URL are required for Resend.
  EMAIL_API_KEY: z.preprocess(
    blankAsUndefined,
    z.string().min(1).optional(),
  ),
  EMAIL_FROM: z.preprocess(
    blankAsUndefined,
    emailFrom.optional(),
  ),
  // Replies to an automated email go here instead of to the no-reply sender.
  EMAIL_REPLY_TO: z.preprocess(
    blankAsUndefined,
    EMAIL_ADDRESS.optional(),
  ),
  STOREFRONT_BASE_URL: z.preprocess(
    blankAsUndefined,
    z.string().url().optional(),
  ),
}).superRefine((env, ctx) => {
  if (env.EMAIL_API_KEY && !env.EMAIL_FROM) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_FROM'],
      message: 'EMAIL_FROM is required when EMAIL_API_KEY is set',
    });
  }
  if (env.EMAIL_API_KEY && !env.STOREFRONT_BASE_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['STOREFRONT_BASE_URL'],
      message: 'STOREFRONT_BASE_URL is required when EMAIL_API_KEY is set',
    });
  }
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
