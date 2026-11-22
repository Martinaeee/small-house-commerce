import { readFileSync } from 'node:fs';

const DEFAULT_ACCESS_FILE = '/app/status/access.json';
const WINDOW_MS = 5 * 60_000;
const STALE_MS = 10 * 60_000;
const PDP_SLOW_MS = 3000;

export interface PdpWindowSignal {
  available: boolean;
  generatedAt: Date | null;
  stale: boolean;
  pdp5xx: number;
  pdpSlow: number;
}

interface AccessErrorRow {
  code?: unknown;
  path?: unknown;
  lastAt?: unknown;
}

interface AccessSlowRow {
  ms?: unknown;
  uri?: unknown;
}

/**
 * Reads the host-collected access report (the same contract as System Status →
 * Access Diagnostics). This is deliberately read-only and only extracts PDP
 * evidence; the report is a 20k-line tail, not a true time window, so the
 * result is a coarse per-report signal, not a p95.
 */
export function readPdpWindowSignal(
  options: { filePath?: string; now?: Date; windowMs?: number } = {},
): PdpWindowSignal {
  const path = options.filePath ?? process.env.SYSTEM_ACCESS_FILE ?? DEFAULT_ACCESS_FILE;
  const now = options.now ?? new Date();
  const windowMs = options.windowMs ?? WINDOW_MS;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { available: false, generatedAt: null, stale: true, pdp5xx: 0, pdpSlow: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { available: false, generatedAt: null, stale: true, pdp5xx: 0, pdpSlow: 0 };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { available: false, generatedAt: null, stale: true, pdp5xx: 0, pdpSlow: 0 };
  }
  const report = parsed as Record<string, unknown>;
  const generatedAt =
    typeof report.generatedAt === 'string' ? new Date(report.generatedAt) : null;
  const fresh =
    generatedAt !== null && !Number.isNaN(generatedAt.getTime())
      ? now.getTime() - generatedAt.getTime() <= STALE_MS
      : false;

  const errors = Array.isArray(report.errors) ? (report.errors as AccessErrorRow[]) : [];
  const pdp5xx = errors.filter((row) => {
    if (typeof row.code !== 'number' || row.code < 500) return false;
    if (typeof row.path !== 'string' || !row.path.startsWith('/products/')) return false;
    if (typeof row.lastAt !== 'string') return false;
    const lastAt = new Date(row.lastAt);
    if (Number.isNaN(lastAt.getTime())) return false;
    return now.getTime() - lastAt.getTime() <= windowMs;
  }).length;

  const slow = Array.isArray(report.slowest) ? (report.slowest as AccessSlowRow[]) : [];
  const pdpSlow = slow.filter((row) => {
    if (typeof row.ms !== 'number' || row.ms <= PDP_SLOW_MS) return false;
    if (typeof row.uri !== 'string') return false;
    const pathname = row.uri.split('?')[0];
    return pathname.startsWith('/products/');
  }).length;

  return {
    available: true,
    generatedAt: generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : null,
    stale: !fresh,
    pdp5xx,
    pdpSlow,
  };
}
