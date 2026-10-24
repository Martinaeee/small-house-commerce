import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export type LogisticsStatus =
  | 'SHIPPED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'SIGNED'
  | 'FAILED_DELIVERY'
  | 'RETURNING'
  | 'RETURNED';

export interface RecordLogisticsEventInput {
  normalizedStatus: LogisticsStatus;
  externalStatus?: string | null;
  externalEventId?: string | null;
  eventTime?: Date | null;
  province?: string | null;
  city?: string | null;
  rawPayloadReference?: string | null;
}

/**
 * §64-66 logistics events.
 *
 * The carrier's own wording is stored next to the normalized state, and the
 * events are append-only facts: recording one never moves the shipment or the
 * order on its own. A carrier can deliver the same webhook several times, so
 * `(shipment_id, external_event_id)` is the idempotency key; manual entries
 * without an external id are deduplicated by state and event time.
 */
@Injectable()
export class LogisticsEventService {
  constructor(private readonly prisma: PrismaService) {}

  async record(orderId: string, shipmentId: string, input: RecordLogisticsEventInput) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment || shipment.orderId !== orderId) {
      throw new NotFoundException('Shipment not found for this order');
    }

    const eventTime = input.eventTime ?? new Date();
    const externalEventId = input.externalEventId ?? null;

    const existing = await this.prisma.logisticsEvent.findFirst({
      where: externalEventId
        ? { shipmentId, externalEventId }
        : { shipmentId, externalEventId: null, normalizedStatus: input.normalizedStatus, eventTime },
    });
    if (existing) return existing;

    return this.prisma.logisticsEvent.create({
      data: {
        shipmentId,
        carrier: shipment.carrier,
        externalEventId,
        externalStatus: input.externalStatus ?? input.normalizedStatus,
        normalizedStatus: input.normalizedStatus,
        eventTime,
        province: input.province ?? null,
        city: input.city ?? null,
        rawPayloadReference: input.rawPayloadReference ?? null,
      },
    });
  }
}
