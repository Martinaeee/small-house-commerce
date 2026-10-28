import type {
  LogisticsStatus,
  RecordLogisticsEventInput,
} from '../orders/logistics-event.service.js';
import type { JtDetail } from './jt.types.js';

/**
 * J&T scan codes we act on. Everything else is a node we cannot classify and
 * is dropped: a wrong guess would move the order state machine on hearsay.
 */
const SCAN_STATUS: Record<string, LogisticsStatus> = {
  '106': 'SHIPPED',
  '109': 'IN_TRANSIT',
  '110': 'IN_TRANSIT',
  '112': 'OUT_FOR_DELIVERY',
  '113': 'SIGNED',
  '116': 'RETURNING',
  '117': 'RETURNED',
  '118': 'FAILED_DELIVERY',
};

export function mapScanType(code: string): LogisticsStatus | null {
  return SCAN_STATUS[String(code).trim()] ?? null;
}

/**
 * J&T sends `yyyy-MM-dd HH:mm:ss` with no zone. It is UTC+8 (Philippine
 * local time), so it is pinned explicitly instead of being read as the
 * server's local time.
 */
export function parseScanTime(value: string): Date {
  return new Date(`${value.trim().replace(' ', 'T')}+08:00`);
}

export function toEventInput(detail: JtDetail): RecordLogisticsEventInput | null {
  const normalizedStatus = mapScanType(detail.scanTypeCode);
  if (!normalizedStatus) return null;
  const eventTime = parseScanTime(detail.scanTime);
  if (Number.isNaN(eventTime.getTime())) return null;

  return {
    normalizedStatus,
    externalEventId: `${detail.scanTypeCode.trim()}:${detail.scanTime.trim()}`,
    externalStatus: detail.scanTypeName,
    eventTime,
    province: detail.scanNetworkProvince ?? null,
    city: detail.scanNetworkCity ?? null,
    description: detail.desc ?? null,
    staffContact: detail.staffConcatPhone ?? null,
    signatureImageUrl: detail.sigPicUrl ?? null,
  };
}
