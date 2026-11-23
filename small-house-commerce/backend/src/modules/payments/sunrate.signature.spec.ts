import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { signFields, verifySignature } from './sunrate.signature.js';

const KEY = 'unit-test-key';

/**
 * Independent reference implementation of the documented rule (v5 README):
 * exclude `signature`, sort remaining field names by ASCII dictionary
 * order, join as `k1=v1&k2=v2...`, append the signing key DIRECTLY (no `&`),
 * SHA256 hex. Kept in the spec file so the test never imports the signer's
 * own understanding twice.
 */
const manual = (fields: Record<string, string>, key: string) => {
  const base =
    Object.keys(fields)
      .filter((name) => name !== 'signature')
      .sort()
      .map((name) => `${name}=${fields[name]}`)
      .join('&') + key;
  return createHash('sha256').update(base, 'utf8').digest('hex');
};

describe('sunrate signature', () => {
  it('signs ASCII-sorted k=v pairs and appends the key directly', () => {
    const fields = {
      merID: 'M1',
      orderNum: 'O2',
      transTime: '20261120100000',
      signType: 'SHA256',
    };
    expect(signFields(fields, KEY)).toBe(manual(fields, KEY));
  });

  it('keeps a space and special characters verbatim (no urlencoding)', () => {
    const fields = { goodsInfo: 'a b&c=d', merReserve: '', orderNum: 'O' };
    expect(signFields(fields, KEY)).toBe(manual(fields, KEY));
    expect(signFields(fields, KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sorts by field name, not insertion order', () => {
    const a = { orderNum: 'O', merID: 'M' };
    const b = { merID: 'M', orderNum: 'O' };
    expect(signFields(a, KEY)).toBe(signFields(b, KEY));
  });

  it('excludes the signature itself and verifies with timing-safe compare', () => {
    const good = signFields({ orderNum: 'O', transTime: 'T' }, KEY);
    expect(verifySignature({ orderNum: 'O', transTime: 'T', signature: good }, KEY)).toBe(true);
    expect(verifySignature({ orderNum: 'X', transTime: 'T', signature: good }, KEY)).toBe(false);
    expect(verifySignature({ orderNum: 'O', transTime: 'T' }, KEY)).toBe(false);
    expect(verifySignature({ orderNum: 'O', signature: 'nothex' }, KEY)).toBe(false);
  });

  it('throws without a key instead of signing empty', () => {
    expect(() => signFields({ orderNum: 'O' }, '')).toThrow(/key/i);
  });
});
