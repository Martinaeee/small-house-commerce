import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readJtConfig, type JtConfig } from './jt.config.js';
import type { JtDetail, JtEnvelope, JtScan } from './jt.types.js';

export type JtErrorKind =
  | 'DISABLED'
  | 'TRANSPORT'
  | 'NON_JSON'
  | 'BUSINESS'
  | 'SIGNATURE';

export class JtError extends Error {
  constructor(
    message: string,
    readonly kind: JtErrorKind,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'JtError';
  }
}

/**
 * `data_digest` for the legacy TRACKQUERY protocol: base64 of the hex MD5 of
 * the exact `logistics_interface` string followed by the account key. This is
 * one level, unlike the open platform's two-level digest.
 */
export function jtDataDigest(logisticsInterface: string, key: string): string {
  const hex = createHash('md5').update(logisticsInterface + key, 'utf8').digest('hex');
  return Buffer.from(hex, 'utf8').toString('base64');
}

const TIMEOUT_MS = 15_000;

/**
 * The namespaced path is part of the contract: the gateway answers 404 without
 * `/jts-phl-order-api`, so it is appended here rather than asked of the
 * `JT_BASE_URL` value.
 */
const TRACE_PATH = '/jts-phl-order-api/api/track/trackForJson';

/** Exposed for the timeout test; the wire contract allows no longer a wait. */
export const JT_REQUEST_TIMEOUT_MS = TIMEOUT_MS;

/**
 * The only place that knows the J&T TRACKQUERY wire protocol: a form-encoded
 * body, one digest over the payload, and one endpoint. No persistence and no
 * retries — the worker owns cadence and backoff.
 */
@Injectable()
export class JtClient {
  private readonly logger = new Logger(JtClient.name);
  private readonly config: JtConfig;

  constructor(
    config: ConfigService,
    // Not a provider: optional keeps Nest from resolving it, and the default
    // lets tests inject a fake fetch.
    @Optional() private readonly request: typeof fetch = fetch,
  ) {
    this.config = readJtConfig(config);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async trace(billCode: string): Promise<JtDetail[]> {
    if (!this.config.enabled) {
      throw new JtError('J&T integration is disabled', 'DISABLED');
    }

    // `lang: "en"` is what makes `desc` arrive in English; without it the
    // carrier answers in whichever language its account defaults to.
    const payload = JSON.stringify({ billcode: billCode, lang: 'en' });
    const body = new URLSearchParams({
      msg_type: 'TRACKQUERY',
      eccompanyid: this.config.eccompanyid,
      logistics_interface: payload,
      data_digest: jtDataDigest(payload, this.config.key),
    }).toString();

    let response: Response;
    try {
      response = await this.request(
        `${this.config.baseUrl.replace(/\/+$/, '')}${TRACE_PATH}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    } catch (error) {
      throw new JtError(`J&T request failed: ${(error as Error).message}`, 'TRANSPORT');
    }

    // The body read sits on the same connection as the request: an abort or a
    // dropped socket here is a transport failure, not a malformed response.
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new JtError(
        `J&T response could not be read: ${(error as Error).message}`,
        'TRANSPORT',
      );
    }

    let parsed: JtEnvelope;
    try {
      parsed = JSON.parse(text) as JtEnvelope;
    } catch {
      throw new JtError(
        `J&T returned a non-JSON body (HTTP ${response.status})`,
        'NON_JSON',
      );
    }

    // The legacy envelope's failure flag is not documented, so the presence of
    // an `responseitems` array is the only success signal we act on. Anything
    // else is a rejection carrying whatever wording the gateway sent.
    if (!Array.isArray(parsed.responseitems)) {
      const message =
        parsed.reason ||
        parsed.msg ||
        parsed.message ||
        `J&T rejected the request (HTTP ${response.status})`;
      this.logger.warn(`J&T trace rejected: ${message}`);
      throw new JtError(message, /sign|digest|签名/i.test(message) ? 'SIGNATURE' : 'BUSINESS');
    }

    return parsed.responseitems
      .flatMap((item) => (Array.isArray(item?.details) ? item.details : []))
      .map(toDetail);
  }
}

function toDetail(scan: JtScan): JtDetail {
  return {
    scanTime: scan.scantime,
    scanTypeName: scan.scantype ?? '',
    scanTypeCode: scan.code == null ? '' : String(scan.code),
    desc: scan.desc ?? null,
  };
}
