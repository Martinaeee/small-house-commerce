/**
 * Dependency-free sliding-window-log rate limiter.
 *
 * Every accepted hit records a timestamp; a request is blocked when the
 * number of timestamps inside the trailing window already equals the limit.
 * The clock is injected for deterministic tests. State is per-process memory,
 * which matches the single-instance deployment behind one reverse proxy.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** When blocked: ms until the oldest in-window hit expires; 0 when allowed. */
  retryAfterMs: number;
}

interface RateBucket {
  windowMs: number;
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private lastSweep = 0;

  constructor(private readonly sweepIntervalMs = 10 * 60_000) {}

  hit(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): RateLimitDecision {
    this.sweepIfDue(now);

    const bucket = this.buckets.get(key) ?? { windowMs, timestamps: [] };
    bucket.windowMs = windowMs;
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);

    if (bucket.timestamps.length >= limit) {
      const retryAfterMs = Math.max(
        0,
        (bucket.timestamps[0] ?? now) + windowMs - now,
      );
      this.buckets.set(key, bucket);
      return { allowed: false, retryAfterMs };
    }

    bucket.timestamps.push(now);
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Number of live buckets (test/observability). */
  get size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
    this.lastSweep = 0;
  }

  /**
   * Periodic cleanup without a timer: at most once per sweepIntervalMs, prune
   * expired timestamps from every bucket and drop buckets that are empty.
   */
  private sweepIfDue(now: number): void {
    if (now - this.lastSweep < this.sweepIntervalMs) {
      return;
    }
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      bucket.timestamps = bucket.timestamps.filter(
        (timestamp) => now - timestamp < bucket.windowMs,
      );
      if (bucket.timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Rate-limit identity for a peer address. Residential IPv6 clients get a
 * fresh /64 per household but rotate host addresses inside it, so IPv6 peers
 * are bucketed by their first four hextets. IPv4 (including ::ffff:-mapped)
 * keeps the literal address.
 */
export function normalizeClientIp(ip: string | null | undefined): string {
  if (!ip) {
    return 'unknown';
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) {
    return mapped[1]!;
  }
  if (!ip.includes(':')) {
    return ip;
  }

  // Expand '::' into zero groups, then keep the network side (first 4).
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [
    ...headGroups,
    ...Array.from({ length: Math.max(0, missing) }, () => '0'),
    ...tailGroups,
  ].map((group) => (group === '' ? '0' : group));

  return `${groups.slice(0, 4).join(':')}::/64`;
}
