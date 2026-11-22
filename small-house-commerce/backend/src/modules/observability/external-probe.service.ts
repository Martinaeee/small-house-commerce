import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service.js';

const MAX_SKEW_MS = 120_000;
const MAX_ROUTES = 10;
const CHECKS = new Set(['PASS', 'FAIL', 'UNKNOWN']);
const STATUSES = new Set(['OPERATIONAL', 'DEGRADED', 'DOWN', 'UNKNOWN']);

export interface ExternalProbeRoute {
  key: string;
  path: string;
  status: string;
  dns: string;
  tls: string;
  http: string;
  httpStatus?: number | null;
  latencyMs?: number | null;
  dom: string;
  errorCode?: string | null;
}

export interface ExternalProbePayload {
  nodeKey: string;
  runId: string;
  checkedAt: string;
  routes: ExternalProbeRoute[];
}

export interface ExternalHeartbeatPayload {
  nodeKey: string;
  reportedAt: string;
}

/** Deterministic JSON so the node and backend sign identical bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function probeSignature(
  secret: string,
  timestamp: string,
  body: unknown,
): string {
  return `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${canonicalJson(body)}`)
    .digest('hex')}`;
}

/**
 * External node ingestion (P1.5).
 *
 * The node authenticates with HMAC-SHA256 over `${timestamp}.${canonicalJson}`;
 * timestamps outside ±120s are rejected. Database uniqueness on
 * (environment, routeKey, runId) makes a replayed request a no-op rather than a
 * duplicate row, so a retry is safe.
 */
@Injectable()
export class ExternalProbeService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    body: unknown,
    timestamp: string | undefined,
    signature: string | undefined,
    now: Date = new Date(),
  ): Promise<{ accepted: number; duplicates: number }> {
    this.verify(body, timestamp, signature, now);
    const payload = body as ExternalProbePayload;
    this.validatePayload(payload, now);

    const rows = payload.routes.map((route) => ({
      runId: payload.runId,
      environment: 'EXTERNAL' as const,
      routeKey: route.key,
      routePath: route.path,
      status: route.status as 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'UNKNOWN',
      dns: route.dns as 'PASS' | 'FAIL' | 'UNKNOWN',
      tls: route.tls as 'PASS' | 'FAIL' | 'UNKNOWN',
      http: route.http as 'PASS' | 'FAIL' | 'UNKNOWN',
      httpStatus: route.httpStatus ?? null,
      latencyMs: route.latencyMs ?? null,
      dom: route.dom as 'PASS' | 'FAIL' | 'UNKNOWN',
      errorCode: route.errorCode ?? null,
      checkedAt: new Date(payload.checkedAt),
    }));
    const result = await this.prisma.syntheticProbeRun.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return { accepted: result.count, duplicates: rows.length - result.count };
  }

  async heartbeat(
    body: unknown,
    timestamp: string | undefined,
    signature: string | undefined,
    now: Date = new Date(),
  ): Promise<{ accepted: boolean }> {
    this.verify(body, timestamp, signature, now);
    const payload = body as ExternalHeartbeatPayload;
    if (!isShortString(payload?.nodeKey, 40)) {
      throw new BadRequestException('nodeKey is required');
    }
    const reportedAt = parseTimestamp(payload?.reportedAt);
    if (!reportedAt) throw new BadRequestException('reportedAt must be an ISO timestamp');
    if (Math.abs(now.getTime() - reportedAt.getTime()) > MAX_SKEW_MS) {
      throw new BadRequestException('reportedAt is outside the accepted window');
    }
    try {
      await this.prisma.probeNodeHeartbeat.create({
        data: {
          nodeKey: payload.nodeKey,
          environment: 'EXTERNAL',
          reportedAt,
        },
      });
      return { accepted: true };
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
        return { accepted: false };
      }
      throw error;
    }
  }

  private verify(
    body: unknown,
    timestamp: string | undefined,
    signature: string | undefined,
    now: Date,
  ): void {
    const secret = process.env.EXTERNAL_PROBE_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('External probe ingestion is not configured');
    }
    if (!timestamp || !signature) {
      throw new UnauthorizedException('Missing probe timestamp or signature');
    }
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || Math.abs(now.getTime() - seconds * 1000) > MAX_SKEW_MS) {
      throw new UnauthorizedException('Probe timestamp is outside the accepted window');
    }
    const expected = probeSignature(secret, timestamp, body);
    const got = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      throw new UnauthorizedException('Invalid probe signature');
    }
  }

  private validatePayload(payload: ExternalProbePayload, now: Date): void {
    if (!isShortString(payload?.nodeKey, 40)) {
      throw new BadRequestException('nodeKey is required');
    }
    if (!isShortString(payload?.runId, 64)) {
      throw new BadRequestException('runId is required');
    }
    const checkedAt = parseTimestamp(payload?.checkedAt);
    if (!checkedAt) throw new BadRequestException('checkedAt must be an ISO timestamp');
    if (Math.abs(now.getTime() - checkedAt.getTime()) > MAX_SKEW_MS) {
      throw new BadRequestException('checkedAt is outside the accepted window');
    }
    if (!Array.isArray(payload?.routes) || payload.routes.length === 0) {
      throw new BadRequestException('routes must not be empty');
    }
    if (payload.routes.length > MAX_ROUTES) {
      throw new BadRequestException(`routes must contain at most ${MAX_ROUTES} entries`);
    }
    const keys = new Set<string>();
    for (const route of payload.routes) {
      if (!isShortString(route?.key, 40) || keys.has(route.key)) {
        throw new BadRequestException('route.key must be unique and non-empty');
      }
      keys.add(route.key);
      if (!isShortString(route?.path, 512)) {
        throw new BadRequestException('route.path is required');
      }
      if (!STATUSES.has(route.status)) {
        throw new BadRequestException(`invalid route status: ${route.status}`);
      }
      for (const check of [route.dns, route.tls, route.http, route.dom]) {
        if (!CHECKS.has(check)) throw new BadRequestException('invalid probe check');
      }
      if (route.httpStatus !== undefined && route.httpStatus !== null) {
        if (!Number.isInteger(route.httpStatus) || route.httpStatus < 100 || route.httpStatus > 599) {
          throw new BadRequestException('httpStatus must be 100-599');
        }
      }
      if (route.latencyMs !== undefined && route.latencyMs !== null) {
        if (!Number.isInteger(route.latencyMs) || route.latencyMs < 0 || route.latencyMs > 120_000) {
          throw new BadRequestException('latencyMs must be 0-120000');
        }
      }
      if (route.errorCode !== undefined && route.errorCode !== null && typeof route.errorCode !== 'string') {
        throw new BadRequestException('errorCode must be a string');
      }
    }
  }
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
