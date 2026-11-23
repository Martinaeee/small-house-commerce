import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { connect as tlsConnect } from 'node:tls';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  classifyProbe,
  probeRoutes,
  type ProbeCheckValue,
} from './observability-availability.js';

const DEFAULT_BASE_URL = 'https://luwag.shop';
// Two minutes, not one: every route costs a DNS lookup, a TLS handshake and a
// full page render, and the alert engine only evaluates completed five-minute
// windows anyway. A minute apart would double the cost for no earlier signal.
const DEFAULT_INTERVAL_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const RETENTION_DAYS = 30;
const PROBE_UA = 'LUWAG-Probe/1.0 (+https://luwag.shop)';

/**
 * Production-side synthetic probes (P1.5).
 *
 * GET-only: the worker never writes a cart, order or payment. Every round
 * stores one row per key route; missing configuration or a failed check is
 * recorded as UNKNOWN/DOWN rather than a fabricated pass. Disabled unless
 * PROBE_ENABLED=true, and never runs in tests.
 */
@Injectable()
export class SyntheticProbeService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SyntheticProbeService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastPruneDay: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.PROBE_ENABLED !== 'true') return;
    const intervalMs = positiveInt(process.env.PROBE_INTERVAL_MS, DEFAULT_INTERVAL_MS);
    this.timer = setInterval(() => {
      void this.runRound().catch(() => undefined);
    }, intervalMs);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runRound(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const runId = randomUUID();
      for (const route of probeRoutes()) {
        await this.probeOne(runId, route, now).catch((error) => {
          this.logger.warn(`Probe ${route.key} failed to record: ${String(error)}`);
        });
      }
      await this.prune(now).catch(() => undefined);
    } finally {
      this.running = false;
    }
  }

  private async probeOne(
    runId: string,
    route: { key: string; path: string; domMarker: string },
    now: Date,
  ): Promise<void> {
    const base = (process.env.PROBE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const timeoutMs = positiveInt(process.env.PROBE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

    let dns: ProbeCheckValue = 'UNKNOWN';
    let tls: ProbeCheckValue = 'UNKNOWN';
    let http: ProbeCheckValue = 'UNKNOWN';
    let httpStatus: number | null = null;
    let latencyMs: number | null = null;
    let dom: ProbeCheckValue = 'UNKNOWN';
    let errorCode: string | null = null;

    if (route.path.length === 0) {
      errorCode = 'PROBE_PATH_NOT_CONFIGURED';
    } else {
      const url = new URL(route.path, `${base}/`);
      dns = await checkDns(url.hostname, timeoutMs);
      tls = url.protocol === 'https:' ? await checkTls(url.hostname, Number(url.port || 443), timeoutMs) : 'UNKNOWN';

      const started = performance.now();
      try {
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'user-agent': PROBE_UA },
          signal: AbortSignal.timeout(timeoutMs),
        });
        latencyMs = Math.round(performance.now() - started);
        httpStatus = response.status;
        http = response.status >= 200 && response.status < 400 ? 'PASS' : 'FAIL';
        if (http === 'FAIL') errorCode = `HTTP_${response.status}`;
        if (route.domMarker) {
          const body = await response.text();
          dom = body.includes(route.domMarker) ? 'PASS' : 'FAIL';
          if (dom === 'FAIL' && errorCode === null) errorCode = 'DOM_MARKER_MISSING';
        }
      } catch (error) {
        latencyMs = Math.round(performance.now() - started);
        http = 'FAIL';
        errorCode = error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      }
    }

    const status = classifyProbe({ dns, tls, http, dom, latencyMs });
    try {
      await this.prisma.syntheticProbeRun.create({
        data: {
          runId,
          environment: 'PROD',
          routeKey: route.key,
          routePath: route.path || '(not-configured)',
          status,
          dns,
          tls,
          http,
          httpStatus,
          latencyMs,
          dom,
          errorCode,
          checkedAt: now,
        },
      });
    } catch (error) {
      // Retried round at the same timestamp must not fail the worker.
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
        return;
      }
      throw error;
    }
  }

  private async prune(now: Date): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    if (this.lastPruneDay === day) return;
    await this.prisma.syntheticProbeRun.deleteMany({
      where: { checkedAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 86_400_000) } },
    });
    this.lastPruneDay = day;
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

async function checkDns(hostname: string, timeoutMs: number): Promise<ProbeCheckValue> {
  try {
    return await withTimeout(
      lookup(hostname).then(() => 'PASS' as ProbeCheckValue),
      timeoutMs,
      'FAIL',
    );
  } catch {
    return 'FAIL';
  }
}

async function checkTls(
  hostname: string,
  port: number,
  timeoutMs: number,
): Promise<ProbeCheckValue> {
  return new Promise<ProbeCheckValue>((resolve) => {
    let settled = false;
    const finish = (value: ProbeCheckValue) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const socket = tlsConnect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: true,
        timeout: timeoutMs,
      },
      () => {
        finish('PASS');
        socket.destroy();
      },
    );
    socket.once('error', () => finish('FAIL'));
    socket.once('timeout', () => {
      finish('FAIL');
      socket.destroy();
    });
  });
}

async function withTimeout(
  promise: Promise<ProbeCheckValue>,
  timeoutMs: number,
  fallback: ProbeCheckValue,
): Promise<ProbeCheckValue> {
  return Promise.race([
    promise,
    new Promise<ProbeCheckValue>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), timeoutMs);
      timer.unref?.();
    }),
  ]);
}
