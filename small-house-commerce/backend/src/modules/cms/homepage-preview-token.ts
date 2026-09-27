import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const SCOPE = 'homepage-draft-preview';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

export function signPreviewToken(
  draftRev: number,
  secret: string,
  now: Date,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      scope: SCOPE,
      draftRev,
      exp: now.getTime() + PREVIEW_TOKEN_TTL_MS,
      jti: randomUUID(),
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyPreviewToken(
  token: string,
  secret: string,
  now: Date,
): { draftRev: number } | null {
  if (
    typeof token !== 'string' ||
    typeof secret !== 'string' ||
    secret.length === 0 ||
    token.length === 0 ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (
    !payload ||
    !signature ||
    !BASE64URL.test(payload) ||
    !BASE64URL.test(signature)
  ) {
    return null;
  }

  try {
    const expected = createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');
    const actualBytes = Buffer.from(signature, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    if (
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      return null;
    }

    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as unknown;
    if (!isPreviewPayload(parsed)) return null;
    if (parsed.exp <= now.getTime()) return null;

    return { draftRev: parsed.draftRev };
  } catch {
    return null;
  }
}

function isPreviewPayload(value: unknown): value is {
  scope: string;
  draftRev: number;
  exp: number;
  jti: string;
} {
  if (typeof value !== 'object' || value === null) return false;

  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  return (
    keys.length === 4 &&
    keys.join(',') === 'draftRev,exp,jti,scope' &&
    payload.scope === SCOPE &&
    typeof payload.draftRev === 'number' &&
    Number.isFinite(payload.draftRev) &&
    typeof payload.exp === 'number' &&
    Number.isFinite(payload.exp) &&
    typeof payload.jti === 'string' &&
    payload.jti.length > 0
  );
}
