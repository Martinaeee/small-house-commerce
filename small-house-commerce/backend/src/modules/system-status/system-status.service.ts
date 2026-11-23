import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { PrismaService } from '../../prisma/prisma.service.js';

const DEFAULT_STATUS_FILE = '/app/status/status.json';
const DEFAULT_ACCESS_FILE = '/app/status/access.json';
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

export interface SystemStatusOptions {
  filePath?: string;
  accessFilePath?: string;
  now?: () => number;
  maxAgeMs?: number;
}

export interface SystemStatusSnapshot {
  generatedAt: string;
  stale: boolean;
  [key: string]: unknown;
}

export interface AccessImageStats {
  requests: number;
  hit: number;
  miss: number;
  hitRate: number | null;
  /** Same ratio with the warm-up script's own requests removed. */
  realHitRate: number | null;
  /** Requests sent by our own cache warm-up (Python-urllib). */
  warmupRequests: number;
}

export interface AccessSlowRequest {
  ms: number;
  uri: string;
  status: number;
  cache: string;
  referer: string;
  traffic: "human" | "bot" | "warmup" | "probe";
}

export interface AccessErrorRow {
  code: number;
  path: string;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
  bot: boolean;
  sampleUa: string;
  sampleReferer: string;
}

export interface AccessImageInfo {
  file: string;
  width: number | null;
  productName: string | null;
  productSlug: string | null;
  /** main | option | variant | scene | detail */
  kind: string | null;
}

export interface AccessReport {
  generatedAt: string;
  stale: boolean;
  windowLines: number;
  windowFirstAt: string | null;
  windowLastAt: string | null;
  requests: number;
  traffic: { human: number; bot: number; warmup: number; probe?: number };
  status5xx: number;
  status4xx: number;
  errorRate5xx: number | null;
  images: AccessImageStats;
  top5xxPaths: [string, number][];
  errors: AccessErrorRow[];
  slowest: (AccessSlowRequest & { image: AccessImageInfo | null })[];
  statusCounts: Record<string, number>;
}

/**
 * Reads the host-collected status snapshot.
 *
 * The host writes it atomically (see luwag-status.sh); the backend only reads
 * it. A missing or malformed snapshot fails closed with 503 so the admin page
 * can say "status unavailable" instead of showing fabricated values.
 */
@Injectable()
export class SystemStatusService {
  private imageIndex: Map<string, ImageInfo> | null = null;
  private imageIndexAt = 0;

  constructor(
    @Optional() private readonly options: SystemStatusOptions = {},
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getStatus(): SystemStatusSnapshot {
    const filePath =
      this.options.filePath ??
      process.env.SYSTEM_STATUS_FILE ??
      DEFAULT_STATUS_FILE;

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      throw new ServiceUnavailableException({
        code: 'SYSTEM_STATUS_UNAVAILABLE',
        message: 'System status snapshot is not available',
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException({
        code: 'SYSTEM_STATUS_INVALID',
        message: 'System status snapshot is not valid JSON',
      });
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ServiceUnavailableException({
        code: 'SYSTEM_STATUS_INVALID',
        message: 'System status snapshot has an invalid shape',
      });
    }

    const snapshot = parsed as Record<string, unknown>;
    const generatedAt = snapshot.generatedAt;
    const generatedMs =
      typeof generatedAt === 'string' ? Date.parse(generatedAt) : Number.NaN;
    if (!Number.isFinite(generatedMs)) {
      throw new ServiceUnavailableException({
        code: 'SYSTEM_STATUS_INVALID',
        message: 'System status snapshot is missing generatedAt',
      });
    }

    const now = this.options.now ?? Date.now;
    const maxAgeMs = this.options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

    return {
      ...snapshot,
      generatedAt: generatedAt as string,
      stale: now() - generatedMs > maxAgeMs,
    };
  }

  /**
   * Reads the host-collected access report (5xx rate, image-cache hit ratio,
   * slowest paths). Same contract as the status snapshot: the host writes it,
   * the backend only reads, and a missing file fails closed.
   */
  async getAccessReport(): Promise<AccessReport> {
    const filePath =
      this.options.accessFilePath ??
      process.env.SYSTEM_ACCESS_FILE ??
      DEFAULT_ACCESS_FILE;

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      throw new ServiceUnavailableException({
        code: 'SYSTEM_ACCESS_UNAVAILABLE',
        message: 'Access report is not available',
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException({
        code: 'SYSTEM_ACCESS_INVALID',
        message: 'Access report is not valid JSON',
      });
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ServiceUnavailableException({
        code: 'SYSTEM_ACCESS_INVALID',
        message: 'Access report has an invalid shape',
      });
    }

    const report = parsed as Record<string, unknown>;
    const generatedAt = report.generatedAt;
    const generatedMs =
      typeof generatedAt === 'string' ? Date.parse(generatedAt) : Number.NaN;
    if (!Number.isFinite(generatedMs)) {
      throw new ServiceUnavailableException({
        code: 'SYSTEM_ACCESS_INVALID',
        message: 'Access report is missing generatedAt',
      });
    }

    const now = this.options.now ?? Date.now;
    const maxAgeMs = this.options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const images = asRecord(report.images);
    const window = asRecord(report.window);
    const traffic = asRecord(report.traffic);
    const slowest = asSlowRequests(report.slowest);
    const index = await this.getImageIndex();

    return {
      generatedAt: generatedAt as string,
      stale: now() - generatedMs > maxAgeMs,
      // The collector writes `linesRead`; the admin UI calls it the window.
      windowLines: asNumber(report.linesRead),
      windowFirstAt: asStringOrNull(window.firstAt),
      windowLastAt: asStringOrNull(window.lastAt),
      requests: asNumber(report.requests),
      traffic: {
        human: asNumber(traffic.human),
        bot: asNumber(traffic.bot),
        warmup: asNumber(traffic.warmup),
        // The collector only started separating the probes recently, so the
        // field may be absent from an older report.
        probe: asNumber(traffic.probe),
      },
      status5xx: asNumber(report.status5xx),
      status4xx: asNumber(report.status4xx),
      errorRate5xx: asNumberOrNull(report.errorRate5xx),
      images: {
        requests: asNumber(images.requests),
        hit: asNumber(images.hit),
        miss: asNumber(images.miss),
        hitRate: asNumberOrNull(images.hitRate),
        realHitRate: asNumberOrNull(images.realHitRate),
        warmupRequests: asNumber(images.warmupRequests),
      },
      top5xxPaths: asPairs(report.top5xxPaths),
      errors: asErrors(report.errors),
      slowest: slowest.map((entry) => ({
        ...entry,
        image: this.describeImage(entry.uri, index),
      })),
      statusCounts: asStringNumberMap(report.statusCounts),
    };
  }

  /** Pulls the optimizer URL apart and joins it against the catalog. */
  private describeImage(uri: string, index: Map<string, ImageInfo>): AccessImageInfo | null {
    const queryStart = uri.indexOf('?');
    if (queryStart < 0) return null;
    const params = new URLSearchParams(uri.slice(queryStart + 1));
    const source = params.get('url');
    if (!source) return null;
    const file = source.split('/').pop() || '';
    if (!file) return null;
    const width = Number(params.get('w'));
    const hit = index.get(file);
    return {
      file,
      width: Number.isFinite(width) ? width : null,
      productName: hit?.productName ?? null,
      productSlug: hit?.productSlug ?? null,
      kind: hit?.kind ?? null,
    };
  }

  /**
   * Filename -> catalog entry for every uploaded product image. Cached for
   * five minutes: the catalog changes far slower than the access log does,
   * and the admin page polls once a minute.
   */
  private async getImageIndex(): Promise<Map<string, ImageInfo>> {
    const now = Date.now();
    if (this.imageIndex && now - this.imageIndexAt < 5 * 60_000) {
      return this.imageIndex;
    }
    if (!this.prisma) return new Map();

    const [images, blocks] = await Promise.all([
      this.prisma.productImage.findMany({
        select: {
          url: true,
          isScene: true,
          optionValueId: true,
          variantId: true,
          product: { select: { name: true, slug: true } },
        },
      }),
      this.prisma.productDetailBlock.findMany({
        select: {
          url: true,
          product: { select: { name: true, slug: true } },
        },
      }),
    ]);

    const index = new Map<string, ImageInfo>();
    for (const image of images) {
      const file = image.url.split('/').pop();
      if (!file) continue;
      index.set(file, {
        productName: image.product.name,
        productSlug: image.product.slug,
        kind: image.isScene
          ? 'scene'
          : image.optionValueId
            ? 'option'
            : image.variantId
              ? 'variant'
              : 'main',
      });
    }
    for (const block of blocks) {
      const file = block.url.split('/').pop();
      if (!file || index.has(file)) continue;
      index.set(file, {
        productName: block.product.name,
        productSlug: block.product.slug,
        kind: 'detail',
      });
    }

    this.imageIndex = index;
    this.imageIndexAt = now;
    return index;
  }
}

interface ImageInfo {
  productName: string;
  productSlug: string;
  kind: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asErrors(value: unknown): AccessErrorRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === 'object',
    )
    .map((entry) => ({
      code: asNumber(entry.code),
      path: typeof entry.path === 'string' ? entry.path : '',
      count: asNumber(entry.count),
      firstAt: asStringOrNull(entry.firstAt),
      lastAt: asStringOrNull(entry.lastAt),
      bot: entry.bot === true,
      sampleUa: typeof entry.sampleUa === 'string' ? entry.sampleUa : '',
      sampleReferer:
        typeof entry.sampleReferer === 'string' ? entry.sampleReferer : '',
    }))
    .filter((entry) => entry.code >= 400 && entry.path.length > 0);
}

function asPairs(value: unknown): [string, number][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'number',
    )
    .map((entry) => [entry[0], entry[1]]);
}

function asSlowRequests(value: unknown): AccessSlowRequest[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).ms === 'number' &&
        typeof (entry as Record<string, unknown>).uri === 'string' &&
        typeof (entry as Record<string, unknown>).status === 'number',
    )
    .map((entry) => ({
      ms: entry.ms as number,
      uri: entry.uri as string,
      status: entry.status as number,
      cache: typeof entry.cache === 'string' ? entry.cache : 'UNKNOWN',
      referer: typeof entry.referer === 'string' ? entry.referer : '',
      traffic:
        entry.traffic === 'bot' || entry.traffic === 'warmup' || entry.traffic === 'probe'
          ? entry.traffic
          : 'human',
    }));
}

function asStringNumberMap(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}
