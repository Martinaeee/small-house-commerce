import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { manilaVisitDay } from '../marketing/marketing-attribution.js';
import type { AnalyticsEventInput } from './dto/analytics-event.dto.js';

/**
 * First-party event ingest.
 *
 * Security posture (the route is public):
 *   - the DTO bounds every string and caps the batch at 20 events;
 *   - admin paths are dropped, so back-office navigation never lands in
 *     storefront metrics;
 *   - a small in-process token bucket per client address keeps a single
 *     caller from flooding the table. It is deliberately per-process: the
 *     goal is to stop runaway client loops, not to be a global quota.
 *
 * Impressions dedupe in the database (partial unique index on
 * session + section + Manila day), not in application memory, so two app
 * instances can never double-count the same scroll.
 */

/** Requests per client address per window. */
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Hard cap on a single metadata blob so one event cannot bloat a row. */
const METADATA_MAX_BYTES = 4096;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly productIdCache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /** Returns how many events were stored; over-limit callers get 429 upstream. */
  async ingest(events: AnalyticsEventInput[], clientKey: string): Promise<{ accepted: number }> {
    const now = Date.now();
    this.pruneRateLimiter(now);
    const bucket = this.hits.get(clientKey) ?? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
    }
    if (bucket.count + events.length > RATE_LIMIT_MAX) {
      this.hits.set(clientKey, bucket);
      return { accepted: 0 };
    }
    bucket.count += events.length;
    this.hits.set(clientKey, bucket);

    const rows = events
      .filter((event) => this.isStorefrontEvent(event))
      .map((event) => this.toRow(event));
    if (rows.length === 0) return { accepted: 0 };

    await this.resolveProductIds(rows);

    try {
      // `skipDuplicates` becomes ON CONFLICT DO NOTHING, which is what makes
      // repeated impressions inside one batch harmless.
      const result = await this.prisma.analyticsEvent.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return { accepted: result.count };
    } catch (error) {
      // Analytics must never break the storefront. A rejected batch is logged
      // and reported as zero rather than surfacing as a 500.
      this.logger.warn(`analytics ingest failed: ${(error as Error).message}`);
      return { accepted: 0 };
    }
  }

  /** True when the bucket is exhausted; the controller turns this into 429. */
  isRateLimited(clientKey: string): boolean {
    const bucket = this.hits.get(clientKey);
    return Boolean(bucket && Date.now() < bucket.resetAt && bucket.count >= RATE_LIMIT_MAX);
  }

  /**
   * A homepage click carries the product slug (the only id the DOM has), so
   * the product id is resolved here. The lookup is cached per slug: a busy
   * homepage would otherwise turn every click into a query.
   */
  private async resolveProductIds(rows: Prisma.AnalyticsEventCreateManyInput[]): Promise<void> {
    for (const row of rows) {
      if (row.eventName !== 'HOMEPAGE_SECTION_CLICK') continue;
      if (row.productId) continue;
      const slug = productSlugFrom(row.destination ?? null);
      if (!slug) continue;
      const cached = this.productIdCache.get(slug);
      if (cached) {
        row.productId = cached;
        continue;
      }
      const product = await this.prisma.product.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!product) continue;
      if (this.productIdCache.size >= 500) this.productIdCache.clear();
      this.productIdCache.set(slug, product.id);
      row.productId = product.id;
    }
  }

  private isStorefrontEvent(event: AnalyticsEventInput): boolean {
    const path = event.pagePath || '/';
    return !path.startsWith('/admin') && !path.startsWith('/preview');
  }

  private toRow(event: AnalyticsEventInput): Prisma.AnalyticsEventCreateManyInput {
    return {
      eventName: event.eventName,
      sessionId: event.sessionId,
      pageUrl: event.pageUrl || event.pagePath || '/',
      pagePath: event.pagePath || '/',
      deviceType: event.deviceType,
      referrer: event.referrer ?? null,
      utmSource: event.utmSource ?? null,
      utmMedium: event.utmMedium ?? null,
      utmCampaign: event.utmCampaign ?? null,
      entityId: event.entityId ?? null,
      sectionId: event.sectionId ?? null,
      sectionType: event.sectionType ?? null,
      destination: event.destination ?? null,
      productId: event.productId ?? null,
      campaignId: event.campaignId ?? null,
      metadata: this.boundedMetadata(event.metadata),
      eventDay: manilaVisitDay(new Date()),
    };
  }

  private boundedMetadata(
    metadata: Record<string, unknown> | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.DbNull {
    if (!metadata) return Prisma.DbNull;
    try {
      const serialized = JSON.stringify(metadata);
      if (serialized.length > METADATA_MAX_BYTES) return Prisma.DbNull;
      return JSON.parse(serialized) as Prisma.InputJsonValue;
    } catch {
      return Prisma.DbNull;
    }
  }

  /** Drops expired buckets so the map cannot grow without bound. */
  private pruneRateLimiter(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, bucket] of this.hits) {
      if (now >= bucket.resetAt) this.hits.delete(key);
    }
  }
}

/** `/products/some-slug` → `some-slug`; null for any other destination. */
function productSlugFrom(destination: string | null): string | null {
  if (!destination) return null;
  const match = destination.match(/\/products\/([^/?#]+)/);
  return match ? match[1] : null;
}
