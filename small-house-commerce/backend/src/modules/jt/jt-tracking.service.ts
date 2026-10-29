import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LogisticsEventService } from '../orders/logistics-event.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { JtClient } from './jt.client.js';
import { readJtConfig, type JtConfig } from './jt.config.js';
import { parseScanTime, toEventInput } from './jt-tracking.mapper.js';

const CANDIDATE_SCAN = 200;
const BATCH_LIMIT = 25;
const DEFAULT_GAP_MS = 200;
const STALE_SHIPMENT_MS = 30 * 24 * 60 * 60 * 1000;

export function trackingBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  if (failures === 1) return 60 * 60 * 1000;
  if (failures === 2) return 6 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

export interface TrackingDueRow {
  trackingCheckedAt: Date | null;
  trackingFailures: number;
  shippedAt: Date;
}

export function isTrackingDue(row: TrackingDueRow, now: number): boolean {
  if (!row.trackingCheckedAt) return true;
  const age = now - new Date(row.shippedAt).getTime();
  const stale = age > STALE_SHIPMENT_MS ? 24 * 60 * 60 * 1000 : 0;
  const required = Math.max(trackingBackoffMs(row.trackingFailures), stale);
  return now - new Date(row.trackingCheckedAt).getTime() >= required;
}

export interface JtTickSummary {
  checked: number;
  appended: number;
  failed: number;
}

export interface JtRefreshResult {
  appended: number;
  skipped: number;
  signed: boolean;
}

export interface JtTrackingHealth {
  enabled: boolean;
  lastTickAt: string | null;
  lastFetched: number;
  lastFailed: number;
  pendingShipments: number;
  /** Shipped boxes whose carrier label does not match ours, so polling skips them. */
  carrierMismatch: number;
  lastError: string | null;
}

export interface JtTrackingOptions {
  gapMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls J&T for every shipped waybill.
 *
 * The carrier is the source of scans, never of state: events are append-only
 * facts, and the only state change this worker makes is the existing sign
 * flow, triggered by a Delivered scan. Return and problem scans are recorded
 * and nothing more — RTO still has to be counted in by hand.
 */
@Injectable()
export class JtTrackingService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JtTrackingService.name);
  private readonly config: JtConfig;
  private readonly gapMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastTickAt: Date | null = null;
  private lastFetched = 0;
  private lastFailed = 0;
  private lastError: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: JtClient,
    private readonly events: LogisticsEventService,
    private readonly orders: OrdersService,
    config: ConfigService,
    @Optional() options: JtTrackingOptions = {},
  ) {
    this.config = readJtConfig(config);
    this.gapMs = options.gapMs ?? DEFAULT_GAP_MS;
  }

  get enabled(): boolean {
    return this.client.enabled;
  }

  onModuleInit(): void {
    if (!this.client.enabled || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, this.config.pollMinutes * 60_000);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = Date.now()): Promise<JtTickSummary> {
    if (!this.client.enabled || this.running) {
      return { checked: 0, appended: 0, failed: 0 };
    }
    this.running = true;
    let checked = 0;
    let appended = 0;
    let failed = 0;
    try {
      const rows = await this.prisma.shipment.findMany({
        where: {
          status: 'SHIPPING',
          trackingNumber: { not: null },
          carrier: { equals: this.config.carrierName, mode: 'insensitive' },
        },
        orderBy: { shippedAt: 'asc' },
        take: CANDIDATE_SCAN,
        select: {
          id: true,
          shippedAt: true,
          trackingCheckedAt: true,
          trackingFailures: true,
        },
      });
      const due = rows.filter((row) => isTrackingDue(row, now)).slice(0, BATCH_LIMIT);

      for (const row of due) {
        if (checked > 0 && this.gapMs > 0) await sleep(this.gapMs);
        checked += 1;
        try {
          const result = await this.refreshShipment(null, row.id);
          appended += result.appended;
        } catch (error) {
          failed += 1;
          this.lastError = (error as Error).message;
          this.logger.warn(
            `J&T poll failed for shipment ${row.id}: ${this.lastError}`,
          );
        }
      }

      if (failed === 0) this.lastError = null;

      this.lastTickAt = new Date(now);
      this.lastFetched = checked - failed;
      this.lastFailed = failed;
      return { checked, appended, failed };
    } catch (error) {
      // A tick-level failure (the database refusing the candidate query, for
      // example) never reaches the per-shipment branch, so it has to be
      // recorded here or the status card goes blind.
      this.lastTickAt = new Date(now);
      this.lastFetched = 0;
      this.lastFailed = 0;
      this.lastError = (error as Error).message;
      this.logger.error(`J&T tick failed: ${this.lastError}`);
      throw error;
    } finally {
      this.running = false;
    }
  }

  async refreshShipment(
    orderId: string | null,
    shipmentId: string,
  ): Promise<JtRefreshResult> {
    if (!this.client.enabled) {
      throw new ConflictException('J&T tracking is disabled');
    }
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (orderId && shipment.orderId !== orderId) {
      throw new NotFoundException('Shipment not found for this order');
    }
    if (!shipment.trackingNumber) {
      throw new BadRequestException('Shipment has no tracking number');
    }
    if (!this.isJtCarrier(shipment.carrier)) {
      // A manual refresh must never query J&T with another carrier's waybill:
      // the request would fail and stamp this box with a tracking error the
      // worker (which skips it) can never clear.
      throw new BadRequestException(
        `Shipment carrier "${shipment.carrier}" is not handled by the J&T integration`,
      );
    }

    try {
      const details = await this.client.trace(shipment.trackingNumber);
      const existing = new Set(
        (
          await this.prisma.logisticsEvent.findMany({
            where: { shipmentId },
            select: { externalEventId: true },
          })
        ).map((event) => event.externalEventId),
      );

      const ordered = [...details].sort(
        (a, b) =>
          parseScanTime(a.scanTime).getTime() - parseScanTime(b.scanTime).getTime(),
      );

      let appended = 0;
      let skipped = 0;
      for (const detail of ordered) {
        const input = toEventInput(detail);
        if (!input) {
          skipped += 1;
          this.logger.warn(
            `Unmapped J&T scan ${detail.scanTypeCode} on ${shipment.trackingNumber}`,
          );
          continue;
        }
        if (!existing.has(input.externalEventId ?? null)) appended += 1;
        await this.events.record(shipment.orderId, shipmentId, input);
      }

      const signed = await this.signIfDelivered(shipment.orderId, shipmentId);

      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          trackingCheckedAt: new Date(),
          trackingError: null,
          trackingFailures: 0,
        },
      });

      return { appended, skipped, signed };
    } catch (error) {
      const message = (error as Error).message.slice(0, 300);
      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          trackingCheckedAt: new Date(),
          trackingError: message,
          trackingFailures: { increment: 1 },
        },
      });
      throw error;
    }
  }

  async health(): Promise<JtTrackingHealth> {
    const pendingShipments = await this.prisma.shipment.count({
      where: {
        status: 'SHIPPING',
        trackingNumber: { not: null },
        carrier: { equals: this.config.carrierName, mode: 'insensitive' },
      },
    });
    // Staff type the carrier by hand; a "JT" or "J&T Express PH" label silently
    // stops a box from being polled, so the count surfaces the drift.
    // Prisma rejects `mode` inside `not`, the negation has to be top-level.
    const carrierMismatch = await this.prisma.shipment.count({
      where: {
        status: 'SHIPPING',
        trackingNumber: { not: null },
        NOT: { carrier: { equals: this.config.carrierName, mode: 'insensitive' } },
      },
    });
    return {
      enabled: this.client.enabled,
      lastTickAt: this.lastTickAt ? this.lastTickAt.toISOString() : null,
      lastFetched: this.lastFetched,
      lastFailed: this.lastFailed,
      pendingShipments,
      carrierMismatch,
      lastError: this.lastError,
    };
  }

  private isJtCarrier(carrier: string): boolean {
    return (
      carrier.trim().toLowerCase() === this.config.carrierName.trim().toLowerCase()
    );
  }

  /**
   * A Delivered scan signs the box through the normal sign flow. Anything the
   * sign flow refuses (order already closed, after-sales, cancelled) is logged
   * and left alone: the scan itself is already recorded.
   */
  private async signIfDelivered(
    orderId: string,
    shipmentId: string,
  ): Promise<boolean> {
    const newest = await this.prisma.logisticsEvent.findFirst({
      where: { shipmentId },
      orderBy: { eventTime: 'desc' },
      select: { normalizedStatus: true },
    });
    if (!newest || newest.normalizedStatus !== 'SIGNED') return false;

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { status: true },
    });
    if (!shipment || shipment.status !== 'SHIPPING') return false;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { orderStatus: true },
    });
    if (!order || order.orderStatus !== 'SHIPPING') {
      this.logger.log(
        `J&T reports ${shipmentId} delivered but order ${orderId} is ${order?.orderStatus ?? 'missing'}`,
      );
      return false;
    }

    try {
      await this.orders.sign(orderId, shipmentId, null, { source: 'CARRIER' });
      return true;
    } catch (error) {
      this.logger.warn(
        `Auto-sign refused for shipment ${shipmentId}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
