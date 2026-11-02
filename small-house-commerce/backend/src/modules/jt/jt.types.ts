/** One scan as J&T reports it inside `data.details[]`. */
export interface JtDetail {
  scanTime: string;
  desc?: string | null;
  scanTypeName: string;
  scanTypeCode: string;
  /// The platform documents both names for the courier phone and does not say
  /// which one a given account receives, so either may arrive.
  staffConcatPhone?: string | null;
  staffContact?: string | null;
  scanNetworkProvince?: string | null;
  scanNetworkCity?: string | null;
  scanNetworkArea?: string | null;
  sigPicUrl?: string | null;
  timeZone?: string | null;
}

export interface JtEnvelope {
  code: string | number;
  msg?: string;
  data?: { billCode?: string; details?: JtDetail[] } | null;
  requestId?: string;
}
