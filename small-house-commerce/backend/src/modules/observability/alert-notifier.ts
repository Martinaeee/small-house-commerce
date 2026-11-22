import { Injectable, Logger } from '@nestjs/common';

export interface AlertNotification {
  ruleCode: string;
  severity: 'P0' | 'P1' | 'P2';
  title: string;
  detail: string;
  fingerprint: string;
  occurrences: number;
  firstSeenAt: Date;
}

/**
 * Feishu webhook notifier. The URL is configuration, never hardcoded; the
 * deployment reuses the certificate-check webhook from /etc/luwag/alert.env.
 * A missing URL logs the alert and leaves the DB row intact.
 */
@Injectable()
export class AlertNotifier {
  private readonly logger = new Logger(AlertNotifier.name);

  async send(alert: AlertNotification): Promise<void> {
    const url = process.env.ALERT_WEBHOOK_URL;
    const text = [
      `[${alert.severity}] ${alert.title}`,
      `rule: ${alert.ruleCode}`,
      `fingerprint: ${alert.fingerprint}`,
      `first seen: ${alert.firstSeenAt.toISOString()}`,
      `occurrences: ${alert.occurrences}`,
      alert.detail,
    ].join('\n');
    if (!url) {
      this.logger.warn(`Alert webhook not configured; alert kept in DB: ${text}`);
      return;
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        this.logger.warn(`Alert webhook responded ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Alert webhook failed: ${String(error)}`);
    }
  }
}
