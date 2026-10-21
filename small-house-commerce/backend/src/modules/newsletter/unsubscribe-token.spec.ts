import { describe, expect, it } from 'vitest';
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribe-token.js';

const SECRET = 'x'.repeat(32);

describe('newsletter unsubscribe token', () => {
  it('round-trips a normalized email', () => {
    const token = signUnsubscribeToken('a@b.com', SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe('a@b.com');
  });

  it('rejects a tampered token', () => {
    const token = signUnsubscribeToken('a@b.com', SECRET);
    expect(verifyUnsubscribeToken(`${token}x`, SECRET)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const token = signUnsubscribeToken('a@b.com', 'y'.repeat(32));
    expect(verifyUnsubscribeToken(token, SECRET)).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyUnsubscribeToken('not-a-token', SECRET)).toBeNull();
  });
});
