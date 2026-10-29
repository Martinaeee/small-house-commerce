import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readJtConfig, type JtConfig } from './jt.config.js';
import type { JtDetail, JtEnvelope } from './jt.types.js';

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

/** MD5(password + fixed salt), uppercase — J&T's "密文". */
export function jtPasswordCipher(password: string): string {
  return createHash('md5')
    .update(password + 'jadada236t2', 'utf8')
    .digest('hex')
    .toUpperCase();
}

/** Body-level digest: base64(MD5(customerCode + cipher + privateKey)). */
export function jtBodyDigest(
  customerCode: string,
  password: string,
  privateKey: string,
): string {
  return createHash('md5')
    .update(customerCode + jtPasswordCipher(password) + privateKey, 'utf8')
    .digest('base64');
}

/** Header digest: base64(MD5(bizContent + privateKey)) over the exact JSON sent. */
export function jtHeaderDigest(bizContent: string, privateKey: string): string {
  return createHash('md5').update(bizContent + privateKey, 'utf8').digest('base64');
}

const TIMEOUT_MS = 15_000;

/** Exposed for the timeout test; the wire contract allows no longer a wait. */
export const JT_REQUEST_TIMEOUT_MS = TIMEOUT_MS;

/**
 * The only place that knows the J&T open-platform wire protocol: two-level
 * signing, a form-encoded `bizContent`, and one endpoint per feature. No
 * persistence and no retries — the worker owns cadence and backoff.
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

    const bizContent = JSON.stringify({
      customerCode: this.config.customerCode,
      digest: jtBodyDigest(
        this.config.customerCode,
        this.config.customerPassword,
        this.config.privateKey,
      ),
      billCode,
    });
    const headerDigest = jtHeaderDigest(bizContent, this.config.privateKey);

    let response: Response;
    try {
      response = await this.request(`${this.config.baseUrl}/logistics/trace`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          apiAccount: this.config.apiAccount,
          digest: headerDigest,
          timestamp: String(Date.now()),
        },
        body: new URLSearchParams({ bizContent }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
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

    if (String(parsed.code) !== '1') {
      const message = parsed.msg || `J&T rejected the request (HTTP ${response.status})`;
      this.logger.warn(
        `J&T trace rejected: ${message}${parsed.requestId ? ` (${parsed.requestId})` : ''}`,
      );
      throw new JtError(
        message,
        /sign|签名/i.test(message) ? 'SIGNATURE' : 'BUSINESS',
        parsed.requestId,
      );
    }

    const details = parsed.data?.details;
    return Array.isArray(details) ? details : [];
  }
}
