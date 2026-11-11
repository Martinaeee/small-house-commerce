import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';

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
}

export interface AccessSlowRequest {
  ms: number;
  uri: string;
  status: number;
}

export interface AccessReport {
  generatedAt: string;
  stale: boolean;
  windowLines: number;
  requests: number;
  status5xx: number;
  status4xx: number;
  errorRate5xx: number | null;
  images: AccessImageStats;
  top5xxPaths: [string, number][];
  slowest: AccessSlowRequest[];
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
  constructor(@Optional() private readonly options: SystemStatusOptions = {}) {}

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
  getAccessReport(): AccessReport {
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

    return {
      generatedAt: generatedAt as string,
      stale: now() - generatedMs > maxAgeMs,
      windowLines: asNumber(report.windowLines),
      requests: asNumber(report.requests),
      status5xx: asNumber(report.status5xx),
      status4xx: asNumber(report.status4xx),
      errorRate5xx: asNumberOrNull(report.errorRate5xx),
      images: {
        requests: asNumber(images.requests),
        hit: asNumber(images.hit),
        miss: asNumber(images.miss),
        hitRate: asNumberOrNull(images.hitRate),
      },
      top5xxPaths: asPairs(report.top5xxPaths),
      slowest: asSlowRequests(report.slowest),
      statusCounts: asStringNumberMap(report.statusCounts),
    };
  }
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
      (entry): entry is AccessSlowRequest =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).ms === 'number' &&
        typeof (entry as Record<string, unknown>).uri === 'string' &&
        typeof (entry as Record<string, unknown>).status === 'number',
    )
    .map((entry) => ({ ms: entry.ms, uri: entry.uri, status: entry.status }));
}

function asStringNumberMap(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}
