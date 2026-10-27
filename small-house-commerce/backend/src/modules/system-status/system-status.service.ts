import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';

const DEFAULT_STATUS_FILE = '/app/status/status.json';
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

export interface SystemStatusOptions {
  filePath?: string;
  now?: () => number;
  maxAgeMs?: number;
}

export interface SystemStatusSnapshot {
  generatedAt: string;
  stale: boolean;
  [key: string]: unknown;
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
}
