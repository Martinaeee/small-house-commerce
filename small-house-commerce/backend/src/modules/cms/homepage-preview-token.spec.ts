import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_TOKEN_TTL_MS,
  signPreviewToken,
  verifyPreviewToken,
} from './homepage-preview-token.js';

const NOW = new Date('2026-09-27T00:00:00.000Z');
const SECRET = 'homepage-preview-secret';

function encodePayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function signRawPayload(payload: string, secret = SECRET): string {
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function payloadOf(token: string): Record<string, unknown> {
  const [payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

describe('homepage preview token', () => {
  it('round-trips a signed token within the TTL', () => {
    const token = signPreviewToken(42, SECRET, NOW);

    expect(token.split('.')).toHaveLength(2);
    expect(Object.keys(payloadOf(token)).sort()).toEqual([
      'draftRev',
      'exp',
      'jti',
      'scope',
    ]);
    expect(payloadOf(token)).toMatchObject({
      scope: 'homepage-draft-preview',
      draftRev: 42,
      exp: NOW.getTime() + PREVIEW_TOKEN_TTL_MS,
    });
    expect(verifyPreviewToken(token, SECRET, NOW)).toEqual({ draftRev: 42 });
    expect(
      verifyPreviewToken(
        token,
        SECRET,
        new Date(NOW.getTime() + PREVIEW_TOKEN_TTL_MS - 1),
      ),
    ).toEqual({ draftRev: 42 });
  });

  it('rejects a tampered payload and a tampered signature', () => {
    const token = signPreviewToken(42, SECRET, NOW);
    const [payload, signature] = token.split('.');
    const tamperedPayload = encodePayload({
      ...payloadOf(token),
      draftRev: 43,
    });
    const tamperedSignature = `${payload}.${
      signature[0] === 'A' ? 'B' : 'A'
    }${signature.slice(1)}`;

    expect(
      verifyPreviewToken(`${tamperedPayload}.${signature}`, SECRET, NOW),
    ).toBeNull();
    expect(verifyPreviewToken(tamperedSignature, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token, including one expiring exactly at now', () => {
    const token = signPreviewToken(42, SECRET, NOW);

    expect(
      verifyPreviewToken(
        token,
        SECRET,
        new Date(NOW.getTime() + PREVIEW_TOKEN_TTL_MS),
      ),
    ).toBeNull();
    expect(
      verifyPreviewToken(
        token,
        SECRET,
        new Date(NOW.getTime() + PREVIEW_TOKEN_TTL_MS + 1),
      ),
    ).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const token = signPreviewToken(42, SECRET, NOW);

    expect(verifyPreviewToken(token, 'another-secret', NOW)).toBeNull();
  });

  it('rejects a token whose scope is not homepage-draft-preview', () => {
    const token = signRawPayload(
      encodePayload({
        scope: 'not-homepage-preview',
        draftRev: 42,
        exp: NOW.getTime() + PREVIEW_TOKEN_TTL_MS,
        jti: 'test-jti',
      }),
    );

    expect(verifyPreviewToken(token, SECRET, NOW)).toBeNull();
  });

  it('returns null for an empty secret (feature disabled)', () => {
    const token = signPreviewToken(42, SECRET, NOW);

    expect(verifyPreviewToken(token, '', NOW)).toBeNull();
  });

  it('returns null for malformed tokens without throwing', () => {
    const malformedTokens = [
      '',
      'not-a-token',
      'one.two.three',
      signRawPayload('not-json'),
      signRawPayload(encodePayload({ scope: 'homepage-draft-preview' })),
      signRawPayload(
        encodePayload({
          scope: 'homepage-draft-preview',
          draftRev: 42,
          exp: NOW.getTime() + PREVIEW_TOKEN_TTL_MS,
          jti: 'test-jti',
          extra: true,
        }),
      ),
      signRawPayload(
        encodePayload({
          scope: 'homepage-draft-preview',
          draftRev: '42',
          exp: NOW.getTime() + PREVIEW_TOKEN_TTL_MS,
          jti: 'test-jti',
        }),
      ),
    ];

    for (const token of malformedTokens) {
      expect(() => verifyPreviewToken(token, SECRET, NOW)).not.toThrow();
      expect(verifyPreviewToken(token, SECRET, NOW)).toBeNull();
    }
  });
});
