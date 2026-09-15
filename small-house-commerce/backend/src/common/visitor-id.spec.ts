import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { VISITOR_COOKIE, ensureVisitorHash } from './visitor-id.js';

function makeReqRes(cookieHeader?: string) {
  const req = { headers: { cookie: cookieHeader }, secure: false } as unknown as Request;
  const cookie = vi.fn();
  const res = { cookie } as unknown as Response;
  return { req, res, cookie };
}

describe('ensureVisitorHash', () => {
  it('hashes a valid cookie deterministically without setting a new one', () => {
    const { req, res, cookie } = makeReqRes(`${VISITOR_COOKIE}=abcdef0123456789abcdef0123456789`);

    const h1 = ensureVisitorHash(req, res, 'pepper');
    const h2 = ensureVisitorHash(req, res, 'pepper');

    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(cookie).not.toHaveBeenCalled();
  });

  it('mints and sets a cookie for missing/garbage ids', () => {
    const { req, res, cookie } = makeReqRes('other=1');
    const hash = ensureVisitorHash(req, res, 'pepper');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie).toHaveBeenCalledTimes(1);
    expect(cookie.mock.calls[0][0]).toBe(VISITOR_COOKIE);
    expect(cookie.mock.calls[0][2]).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });

    const garbage = makeReqRes(`${VISITOR_COOKIE}=short`);
    ensureVisitorHash(garbage.req, garbage.res, 'pepper');
    expect(garbage.cookie).toHaveBeenCalledTimes(1);
  });

  it('different peppers yield different hashes', () => {
    const { req, res } = makeReqRes(`${VISITOR_COOKIE}=abcdef0123456789abcdef0123456789`);
    expect(ensureVisitorHash(req, res, 'one')).not.toBe(
      ensureVisitorHash(req, res, 'two'),
    );
  });
});
