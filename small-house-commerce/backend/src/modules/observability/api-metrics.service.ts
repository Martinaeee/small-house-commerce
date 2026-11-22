import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface ApiMetricSample {
  requestId: string;
  routeGroup: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  sampledAt: Date;
}

const FLUSH_MS = 5_000;
const MAX_QUEUE = 2_000;

/**
 * Buffered writer for P3 request samples. Business requests only enqueue; the
 * database write happens on a timer, so a slow or failing database never adds
 * latency to a storefront response. A full queue drops new samples and counts
 * them instead of growing without bound.
 */
@Injectable()
export class ApiMetricsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ApiMetricsService.name);
  private queue: ApiMetricSample[] = [];
  private dropped = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private lastPruneAt = 0;
  private readonly since = new Date().toISOString();
  private lastFlushAt: string | null = null;
  private writeFailed = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || !this.enabled()) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_MS);
    this.timer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  enabled(): boolean {
    return process.env.API_METRICS_ENABLED === 'true';
  }

  sampleRate(): number {
    const raw = Number(process.env.API_METRICS_SAMPLE_RATE);
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 1;
  }

  record(sample: ApiMetricSample): void {
    if (!this.enabled()) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.dropped += 1;
      return;
    }
    this.queue.push(sample);
  }

  status() {
    return { since: this.since, queued: this.queue.length, dropped: this.dropped, lastFlushAt: this.lastFlushAt, writeFailed: this.writeFailed };
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      await this.prisma.apiRequestMetric.createMany({ data: batch });
      this.lastFlushAt = new Date().toISOString();
      this.writeFailed = false;
      await this.prune().catch((error: unknown) => {
        this.logger.warn(`API metric retention cleanup failed: ${String(error)}`);
      });
    } catch (error) {
      this.logger.warn(`API metric flush failed (${batch.length} samples dropped): ${String(error)}`);
      this.dropped += batch.length;
      this.writeFailed = true;
    } finally {
      this.flushing = false;
    }
  }

  private async prune(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPruneAt < 6 * 3_600_000) return;
    this.lastPruneAt = now;
    const days = Number(process.env.API_METRICS_RETENTION_DAYS);
    const retentionDays = Number.isFinite(days) && days >= 1 ? Math.round(days) : 30;
    await this.prisma.apiRequestMetric.deleteMany({
      where: { sampledAt: { lt: new Date(now - retentionDays * 86_400_000) } },
    });
  }
}
