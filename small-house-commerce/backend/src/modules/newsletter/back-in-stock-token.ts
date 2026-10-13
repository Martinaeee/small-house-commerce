import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'back-in-stock-unsubscribe:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function signBackInStockUnsubscribeToken(
  subscriptionId: string,
  secret: string,
): string {
  const mac = createHmac('sha256', secret)
    .update(PREFIX + subscriptionId)
    .digest('base64url');
  return `${Buffer.from(subscriptionId).toString('base64url')}.${mac}`;
}

export function verifyBackInStockUnsubscribeToken(
  token: string,
  secret: string,
): string | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    const subscriptionId = Buffer.from(parts[0], 'base64url').toString('utf8');
    if (!UUID_PATTERN.test(subscriptionId)) return null;
    const expected = createHmac('sha256', secret)
      .update(PREFIX + subscriptionId)
      .digest('base64url');
    const actualBuffer = Buffer.from(parts[1]);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return null;
    }
    return subscriptionId;
  } catch {
    return null;
  }
}
