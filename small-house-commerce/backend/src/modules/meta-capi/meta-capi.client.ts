import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One outbox row as the Graph API sees it. */
export interface MetaOutboxEvent {
  eventName: string;
  eventId: string;
  eventTime: Date;
  actionSource: string;
  eventSourceUrl: string;
  customData: unknown;
  fbp: string | null;
  fbc: string | null;
  clientIp: string | null;
  clientUserAgent: string | null;
  phoneHash: string | null;
}

interface GraphUserData {
  ph?: string;
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

/**
 * Minimal Graph API client for `POST /{pixel-id}/events`.
 *
 * The access token travels in the Authorization header, not the query
 * string, so it never lands in proxy or access logs.
 */
@Injectable()
export class MetaCapiClient {
  private readonly pixelId: string;
  private readonly accessToken: string;
  private readonly testEventCode: string | null;
  private readonly apiVersion: string;

  constructor(
    config: ConfigService,
    // Not a provider: optional keeps Nest from resolving it, and the default
    // applies so tests can still inject a fake fetch.
    @Optional() private readonly request: typeof fetch = fetch,
  ) {
    this.pixelId = config.get<string>('meta.pixelId') ?? '';
    this.accessToken = config.get<string>('meta.accessToken') ?? '';
    this.testEventCode = config.get<string>('meta.testEventCode') ?? null;
    this.apiVersion = config.get<string>('meta.apiVersion') ?? 'v23.0';
  }

  get enabled(): boolean {
    return Boolean(this.pixelId && this.accessToken);
  }

  buildPayload(event: MetaOutboxEvent): Record<string, unknown> {
    const userData: GraphUserData = {};
    if (event.phoneHash) userData.ph = event.phoneHash;
    if (event.fbp) userData.fbp = event.fbp;
    if (event.fbc) userData.fbc = event.fbc;
    if (event.clientIp) userData.client_ip_address = event.clientIp;
    if (event.clientUserAgent) userData.client_user_agent = event.clientUserAgent;

    return {
      data: [
        {
          event_name: event.eventName,
          event_time: Math.floor(event.eventTime.getTime() / 1000),
          event_id: event.eventId,
          action_source: event.actionSource,
          event_source_url: event.eventSourceUrl,
          user_data: userData,
          custom_data: event.customData,
        },
      ],
      ...(this.testEventCode ? { test_event_code: this.testEventCode } : {}),
    };
  }

  async send(event: MetaOutboxEvent): Promise<void> {
    if (!this.enabled) throw new Error('Meta CAPI is not configured');
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.pixelId}/events`;
    const response = await this.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this.buildPayload(event)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Meta CAPI responded ${response.status}: ${detail.slice(0, 300)}`,
      );
    }
  }
}
