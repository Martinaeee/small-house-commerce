import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readQianyiConfig, type QianyiConfig } from './qianyi.config.js';

export interface QianyiResponse {
  state?: string;
  errorCode?: string;
  errorMsg?: string;
  result?: unknown;
}

/** Business failure returned by Qianyi, or a transport/parse failure. */
export class QianyiError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
  ) {
    super(message);
    this.name = 'QianyiError';
  }
}

export interface QianyiSignatureInput {
  appId: string;
  bizParam: string;
  serviceType: string;
  timestamp: string;
}

/**
 * MD5 over `appId=…bizParam=…serviceType=…timestamp=…` with the secret appended
 * raw (no `=`), keys in ASCII order. Verified against the live API: the
 * figures printed in the published doc's §1.1.4 example do not reproduce, so
 * that example is not a usable test vector.
 *
 * The `bizParam` value here must be the exact string handed to the HTTP layer.
 */
export function signQianyiRequest(
  params: QianyiSignatureInput,
  secret: string,
): string {
  const base =
    `appId=${params.appId}` +
    `bizParam=${params.bizParam}` +
    `serviceType=${params.serviceType}` +
    `timestamp=${params.timestamp}`;
  return createHash('md5').update(base + secret, 'utf8').digest('hex');
}

/**
 * The only place that knows the Qianyi wire protocol. One method, one path per
 * module (`shop`, `warehouse`, `salesOrder`, `sku`, `firstLeg`).
 */
@Injectable()
export class QianyiClient {
  private readonly logger = new Logger(QianyiClient.name);
  private readonly config: QianyiConfig;

  constructor(
    config: ConfigService,
    // Not a provider: optional keeps Nest from resolving it, and the default
    // applies so tests can still inject a fake fetch.
    @Optional() private readonly request: typeof fetch = fetch,
  ) {
    this.config = readQianyiConfig(config);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async call(
    serviceType: string,
    path: string,
    bizParam: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.config.enabled) {
      throw new QianyiError('Qianyi integration is disabled', 'DISABLED');
    }
    const timestamp = String(Date.now());
    const json = JSON.stringify(bizParam);
    const sign = signQianyiRequest(
      {
        appId: this.config.appId,
        bizParam: json,
        serviceType,
        timestamp,
      },
      this.config.secret,
    );

    const form = new FormData();
    form.set('appId', this.config.appId);
    form.set('bizParam', json);
    form.set('serviceType', serviceType);
    form.set('timestamp', timestamp);
    form.set('sign', sign);

    let response: Response;
    try {
      response = await this.request(
        `${this.config.baseUrl}/api/v1/${path}`,
        { method: 'POST', body: form, signal: AbortSignal.timeout(20_000) },
      );
    } catch (error) {
      throw new QianyiError(
        `Qianyi request failed: ${(error as Error).message}`,
        'TRANSPORT',
      );
    }

    const text = await response.text();
    let parsed: QianyiResponse;
    try {
      parsed = JSON.parse(text) as QianyiResponse;
    } catch {
      throw new QianyiError(
        `Qianyi returned a non-JSON body (HTTP ${response.status})`,
        'NON_JSON',
      );
    }

    const ok = parsed.state === 'success' || String(parsed.errorCode ?? '') === '0';
    if (!ok) {
      // HTTP 200 does not mean success here; the business code decides.
      this.logger.warn(
        `qianyi ${serviceType} failed: ${parsed.errorCode} ${parsed.errorMsg ?? ''}`,
      );
      throw new QianyiError(
        parsed.errorMsg || `Qianyi error ${parsed.errorCode ?? 'UNKNOWN'}`,
        parsed.errorCode ?? 'UNKNOWN',
      );
    }
    return parsed.result ?? null;
  }
}
