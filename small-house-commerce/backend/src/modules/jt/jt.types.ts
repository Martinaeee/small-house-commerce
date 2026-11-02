/** One scan as J&T reports it inside `responseitems[].details[]`. */
export interface JtScan {
  scantime: string;
  scantype?: string | null;
  desc?: string | null;
  /** Scan code; which namespace it belongs to is confirmed on a real waybill. */
  code?: string | number | null;
}

export interface JtResponseItem {
  details?: JtScan[] | null;
}

/** The TRACKQUERY envelope. Only `responseitems` is trusted as a success signal. */
export interface JtEnvelope {
  responseitems?: JtResponseItem[] | null;
  responseFlag?: string | null;
  reason?: string | null;
  msg?: string | null;
  message?: string | null;
}

/** A scan in the shape the mapper and the persistence layer understand. */
export interface JtDetail {
  scanTime: string;
  desc?: string | null;
  scanTypeName: string;
  scanTypeCode: string;
}
