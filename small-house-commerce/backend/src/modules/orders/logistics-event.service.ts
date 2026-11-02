import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

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
  /** The carrier's own wording, kept verbatim for the guest timeline. */
  description?: string | null;
  /** Rider phone from the scan; shown to phone-verified guests only. */
  staffContact?: string | null;
  /** Delivery or problem photo; admin only. */
  signatureImageUrl?: string | null;
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

    try {
      return await this.prisma.logisticsEvent.create({
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
          externalDescription: input.description ?? null,
          staffContact: input.staffContact ?? null,
          signatureImageUrl: input.signatureImageUrl ?? null,
        },
      });
    } catch (error) {
      // Two writers can pass the lookup above at the same time (a poll and a
      // manual refresh). Losing the unique constraint is not a failure: the
      // other writer stored exactly this fact, so read it back.
      if (
        externalEventId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.logisticsEvent.findFirst({
          where: { shipmentId, externalEventId },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }
}
