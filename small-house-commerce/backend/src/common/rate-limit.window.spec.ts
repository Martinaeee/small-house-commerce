import {
  SlidingWindowRateLimiter,
  normalizeClientIp,
} from './rate-limit.window.js';

describe('SlidingWindowRateLimiter', () => {
  it('admits exactly `limit` hits, then blocks until the window slides', () => {
    const limiter = new SlidingWindowRateLimiter();
    for (let i = 0; i < 3; i++) {
      expect(limiter.hit('k', 3, 1_000, 100).allowed).toBe(true);
    }
    const blocked = limiter.hit('k', 3, 1_000, 100);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1_000);

    // The first hit is 1,000 ms old at t=1,100: it has slid out, so one slot
    // opens (boundary is strict: now - t < windowMs).
    expect(limiter.hit('k', 3, 1_000, 1_100).allowed).toBe(true);
  });

  it('treats a timestamp exactly at the window edge as expired', () => {
    const limiter = new SlidingWindowRateLimiter();
    expect(limiter.hit('k', 1, 1_000, 0).allowed).toBe(true);
    expect(limiter.hit('k', 1, 1_000, 1_000).allowed).toBe(true);
  });

  it('isolates keys and reports a positive Retry-After on the blocked one', () => {
    const limiter = new SlidingWindowRateLimiter();
    expect(limiter.hit('a', 1, 1_000, 0).allowed).toBe(true);
    expect(limiter.hit('b', 1, 1_000, 0).allowed).toBe(true);
    const blocked = limiter.hit('a', 1, 1_000, 500);
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 500 });
  });

  it('sweeps stale empty buckets on write (no timer)', () => {
    const limiter = new SlidingWindowRateLimiter(1);
    limiter.hit('short', 1, 100, 0);
    expect(limiter.size).toBe(1);
    // Past the sweep interval AND the bucket window, any write triggers cleanup.
    limiter.hit('other', 1, 100, 200);
    expect(limiter.size).toBe(1);
  });
});

describe('normalizeClientIp', () => {
  it('passes IPv4 through unchanged', () => {
    expect(normalizeClientIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(normalizeClientIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('groups IPv6 clients into their /64 network prefix', () => {
    expect(normalizeClientIp('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    // Two hosts on the same /64 share a bucket; the compressed form expands.
    expect(normalizeClientIp('2001:db8:1:2::abcd')).toBe('2001:db8:1:2::/64');
    expect(normalizeClientIp('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
  });

  it('keeps distinct /64 networks apart and maps missing IPs to "unknown"', () => {
    expect(normalizeClientIp('2001:db8:9:9::1')).not.toBe(
      normalizeClientIp('2001:db8:1:2::1'),
    );
    expect(normalizeClientIp(undefined)).toBe('unknown');
  });

  it('buckets non-IP garbage as unknown', () => {
    expect(normalizeClientIp('abc')).toBe('unknown');
    expect(normalizeClientIp('999.1.1.1')).toBe('unknown');
    expect(normalizeClientIp('::ffff:999.1.1.1')).toBe('unknown');
  });

  it('lowercases IPv6 hex so one /64 is one bucket', () => {
    expect(normalizeClientIp('2001:DB8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(normalizeClientIp('2001:DB8:1:2::1')).toBe(
      normalizeClientIp('2001:db8:1:2::abcd'),
    );
  });
});
