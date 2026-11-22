import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { readPdpWindowSignal } from './access-signal.js';
import { AlertNotifier } from './alert-notifier.js';

const RULES = {
  PROBE_DOWN: 'PROBE_DOWN',
  PROBE_STALE: 'PROBE_STALE',
  PDP_5XX_TIMEOUT: 'PDP_5XX_TIMEOUT',
  PDP_P95_SLOW: 'PDP_P95_SLOW',
} as const;

const SEVERITY: Record<string, 'P0' | 'P1' | 'P2'> = {
  PROBE_DOWN: 'P0',
  PROBE_STALE: 'P1',
  PDP_5XX_TIMEOUT: 'P1',
  PDP_P95_SLOW: 'P1',
};

const DEFAULT_INTERVAL_MS = 60_000;
const P95_WINDOW_MS = 5 * 60_000;
const P95_MIN_SAMPLES = 20;
const P95_BUDGET_MS = 2000;

/**
 * P2-lite alert engine: PROBE_DOWN / PROBE_STALE / PDP_5XX_TIMEOUT.
 *
 * Triggers require consecutive evidence (two probe rounds, or two distinct
 * access reports). A fingerprint keeps one row per issue; recovery closes it
 * and a later recurrence reopens the same row. Notifications fire only on
 * open/reopen, never on every evaluation.
 */
@Injectable()
export class AlertService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AlertService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private startedAt = Date.now();
  private pdpBadWindows = 0;
  private lastPdpGeneratedAt: number | null = null;
  private lastP95WindowEnd: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: AlertNotifier,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.ALERT_ENABLED !== 'true') return;
    const intervalMs = positiveInt(process.env.ALERT_INTERVAL_MS, DEFAULT_INTERVAL_MS);
    this.timer = setInterval(() => {
      void this.evaluateAll().catch(() => undefined);
    }, intervalMs);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async evaluateAll(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.evaluateProbeDown(now);
      await this.evaluateProbeStale(now);
      await this.evaluatePdp(now);
      await this.evaluatePdpP95(now);
    } catch (error) {
      this.logger.warn(`Alert evaluation failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async list() {
    return this.prisma.alertIssue.findMany({
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
      take: 100,
    });
  }

  async updateStatus(
    id: string,
    status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED',
    userId: string,
    now: Date = new Date(),
  ) {
    return this.prisma.alertIssue.update({
      where: { id },
      data:
        status === 'ACKNOWLEDGED'
          ? {
              status,
              acknowledgedBy: userId,
              acknowledgedAt: now,
            }
          : status === 'CLOSED'
            ? { status, closedAt: now }
            : { status, closedAt: null },
    });
  }

  private async evaluateProbeDown(now: Date): Promise<void> {
    const runs = await this.prisma.syntheticProbeRun.findMany({
      orderBy: { checkedAt: 'desc' },
      take: 300,
    });
    const byRoute = new Map<string, typeof runs>();
    for (const run of runs) {
      const list = byRoute.get(run.routeKey) ?? [];
      if (list.length < 2) list.push(run);
      byRoute.set(run.routeKey, list);
    }
    for (const [routeKey, pair] of byRoute) {
      const down = pair.length === 2 && pair.every((run) => run.status === 'DOWN');
      if (!down) {
        await this.resolve(RULES.PROBE_DOWN, `PROBE_DOWN:${routeKey}`, now);
        continue;
      }
      await this.openIssue({
        ruleCode: RULES.PROBE_DOWN,
        fingerprint: `PROBE_DOWN:${routeKey}`,
        title: `${routeKey} route is down`,
        detail: pair
          .map(
            (run) =>
              `${run.environment} ${run.checkedAt.toISOString()} HTTP ${run.httpStatus ?? '—'} ${run.errorCode ?? ''}`.trim(),
          )
          .join('\n'),
        now,
      });
    }
  }

  private async evaluateProbeStale(now: Date): Promise<void> {
    if (process.env.PROBE_ENABLED !== 'true') {
      await this.resolve(RULES.PROBE_STALE, 'PROBE_STALE:PROD', now);
      return;
    }
    const latest = await this.prisma.syntheticProbeRun.findFirst({
      where: { environment: 'PROD' },
      orderBy: { checkedAt: 'desc' },
    });
    const staleMs = positiveInt(process.env.PROBE_INTERVAL_MS, DEFAULT_INTERVAL_MS) * 2;
    const gracePassed = now.getTime() - this.startedAt > staleMs;
    const stale =
      latest === null
        ? gracePassed
        : now.getTime() - latest.checkedAt.getTime() > staleMs;
    if (!stale) {
      await this.resolve(RULES.PROBE_STALE, 'PROBE_STALE:PROD', now);
      return;
    }
    await this.openIssue({
      ruleCode: RULES.PROBE_STALE,
      fingerprint: 'PROBE_STALE:PROD',
      title: 'Synthetic probe evidence is stale',
      detail: latest
        ? `Last PROD probe: ${latest.checkedAt.toISOString()} (older than ${staleMs}ms)`
        : `No PROD probe since the worker started; stale threshold ${staleMs}ms`,
      now,
    });
  }

  private async evaluatePdp(now: Date): Promise<void> {
    const signal = readPdpWindowSignal({ now });
    // Unavailable or stale evidence must not close an existing issue.
    if (!signal.available || signal.stale || !signal.generatedAt) return;
    if (this.lastPdpGeneratedAt === signal.generatedAt.getTime()) return;
    this.lastPdpGeneratedAt = signal.generatedAt.getTime();

    const bad = signal.pdp5xx > 0 || signal.pdpSlow > 0;
    this.pdpBadWindows = bad ? this.pdpBadWindows + 1 : 0;
    if (this.pdpBadWindows < 2) {
      if (!bad) await this.resolve(RULES.PDP_5XX_TIMEOUT, 'PDP_5XX_TIMEOUT', now);
      return;
    }
    await this.openIssue({
      ruleCode: RULES.PDP_5XX_TIMEOUT,
      fingerprint: 'PDP_5XX_TIMEOUT',
      title: 'PDP server errors or slow responses',
      detail: `access report ${signal.generatedAt.toISOString()}: ${signal.pdp5xx} PDP 5xx row(s), ${signal.pdpSlow} PDP slow request(s) >3000ms`,
      now,
    });
  }

  /**
   * P3 PDP p95: the product API is the server work the PDP waits on. Two
   * completed five-minute windows must both have enough samples and p95 above
   * 2s. Low-sample windows never alarm.
   */
  private async evaluatePdpP95(now: Date): Promise<void> {
    const fingerprint = 'PDP_P95_SLOW:product';
    if (process.env.API_METRICS_ENABLED !== 'true') return;
    const currentStart = Math.floor(now.getTime() / P95_WINDOW_MS) * P95_WINDOW_MS;
    // The pair of completed windows only changes every five minutes; evaluate
    // once per window so occurrences do not inflate on each one-minute tick.
    if (this.lastP95WindowEnd === currentStart) return;
    const windows = [
      { start: currentStart - 2 * P95_WINDOW_MS, end: currentStart - P95_WINDOW_MS },
      { start: currentStart - P95_WINDOW_MS, end: currentStart },
    ];
    const rows = await Promise.all(
      windows.map((window) =>
        this.prisma.$queryRaw<Array<{ n: number; p95: number | null }>>(Prisma.sql`
          SELECT count(*)::int AS n,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p95
            FROM api_request_metrics
           WHERE route_group = 'product'
             AND sampled_at >= ${new Date(window.start)}
             AND sampled_at < ${new Date(window.end)}
        `),
      ),
    );
    const enoughEvidence = rows.every((batch) => batch[0] && batch[0].n >= P95_MIN_SAMPLES && batch[0].p95 !== null);
    if (!enoughEvidence) return;
    const bad = rows.every((batch) => (batch[0]?.p95 ?? 0) > P95_BUDGET_MS);
    const recovered = rows.every((batch) => (batch[0]?.p95 ?? Infinity) <= P95_BUDGET_MS);
    if (recovered) {
      await this.resolve(RULES.PDP_P95_SLOW, fingerprint, now);
      this.lastP95WindowEnd = currentStart;
      return;
    }
    if (!bad) return;
    await this.openIssue({
      ruleCode: RULES.PDP_P95_SLOW,
      fingerprint,
      title: 'PDP product API p95 is above budget',
      detail: windows
        .map(
          (window, index) =>
            `${new Date(window.start).toISOString()}–${new Date(window.end).toISOString()}: ` +
            `${rows[index]?.[0]?.n ?? 0} samples, p95 ${Math.round(rows[index]?.[0]?.p95 ?? 0)}ms`,
        )
        .join('\n'),
      now,
    });
    this.lastP95WindowEnd = currentStart;
  }

  private async openIssue(input: {
    ruleCode: string;
    fingerprint: string;
    title: string;
    detail: string;
    now: Date;
  }): Promise<void> {
    const existing = await this.prisma.alertIssue.findUnique({
      where: { ruleCode_fingerprint: { ruleCode: input.ruleCode, fingerprint: input.fingerprint } },
    });
    if (!existing) {
      const issue = await this.prisma.alertIssue.create({
        data: {
          ruleCode: input.ruleCode,
          fingerprint: input.fingerprint,
          severity: SEVERITY[input.ruleCode] ?? 'P2',
          status: 'OPEN',
          title: input.title,
          detail: input.detail,
          firstSeenAt: input.now,
          lastSeenAt: input.now,
        },
      });
      await this.notifier.send({
        ruleCode: issue.ruleCode,
        severity: issue.severity,
        title: issue.title,
        detail: issue.detail,
        fingerprint: issue.fingerprint,
        occurrences: issue.occurrences,
        firstSeenAt: issue.firstSeenAt,
      });
      return;
    }

    const reopened = existing.status === 'CLOSED';
    const snoozed = existing.snoozedUntil !== null && existing.snoozedUntil > input.now;
    await this.prisma.alertIssue.update({
      where: { id: existing.id },
      data: {
        status: 'OPEN',
        title: input.title,
        detail: input.detail,
        lastSeenAt: input.now,
        occurrences: { increment: 1 },
        ...(reopened ? { closedAt: null } : {}),
      },
    });
    if (reopened && !snoozed) {
      await this.notifier.send({
        ruleCode: existing.ruleCode,
        severity: existing.severity,
        title: input.title,
        detail: input.detail,
        fingerprint: input.fingerprint,
        occurrences: existing.occurrences + 1,
        firstSeenAt: existing.firstSeenAt,
      });
    }
  }

  private async resolve(ruleCode: string, fingerprint: string, now: Date): Promise<void> {
    await this.prisma.alertIssue.updateMany({
      where: {
        ruleCode,
        fingerprint,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
      data: { status: 'CLOSED', closedAt: now },
    });
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}
