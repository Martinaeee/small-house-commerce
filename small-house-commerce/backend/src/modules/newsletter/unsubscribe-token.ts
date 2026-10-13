import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'newsletter-unsubscribe:';

export function signUnsubscribeToken(
  normalizedEmail: string,
  secret: string,
): string {
  const mac = createHmac('sha256', secret)
    .update(PREFIX + normalizedEmail)
    .digest('base64url');
  return `${Buffer.from(normalizedEmail).toString('base64url')}.${mac}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): string | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    const email = Buffer.from(parts[0], 'base64url').toString('utf8');
    if (!email) return null;
    const expected = createHmac('sha256', secret)
      .update(PREFIX + email)
      .digest('base64url');
    const actualBuffer = Buffer.from(parts[1]);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return null;
    }
    return email;
  } catch {
    return null;
  }
}
