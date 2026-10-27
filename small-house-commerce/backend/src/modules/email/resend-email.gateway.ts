import type {
  BackInStockEmailOptions,
  EmailGateway,
  WelcomeEmailOptions,
} from './email.gateway.js';

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 5_000;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export class ResendEmailGateway implements EmailGateway {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo: string | null,
    private readonly request: typeof fetch = fetch,
  ) {}

  async sendWelcome(
    to: string,
    options: WelcomeEmailOptions,
  ): Promise<void> {
    const title = options.offerTitle || 'Thanks for subscribing';
    const body = options.offerBody
      ? `<p>${escapeHtml(options.offerBody)}</p>`
      : '<p>Thanks for joining LUWAG Living.</p>';
    const code = options.promoCode
      ? `<p>Your promo code: <strong>${escapeHtml(options.promoCode)}</strong></p>`
      : '';

    await this.post({
      from: this.from,
      to: [to],
      subject: title,
      html: `<h1>${escapeHtml(title)}</h1>${body}${code}<p><a href="${escapeHtml(options.unsubscribeUrl)}">Unsubscribe</a></p>`,
    });
  }

  async sendBackInStock(
    to: string,
    options: BackInStockEmailOptions,
  ): Promise<void> {
    await this.post({
      from: this.from,
      to: [to],
      subject: `${options.productName} is back in stock`,
      html: `<h1>${escapeHtml(options.productName)} is back in stock</h1><p><a href="${escapeHtml(options.productUrl)}">Shop now</a></p><p><a href="${escapeHtml(options.unsubscribeUrl)}">Unsubscribe</a></p>`,
    });
  }

  private async post(body: {
    from: string;
    to: string[];
    subject: string;
    html: string;
  }): Promise<void> {
    const payload = {
      ...body,
      // A reply to an automated message must reach a monitored inbox, not the
      // no-reply sender.
      ...(this.replyTo ? { reply_to: [this.replyTo] } : {}),
    };

    const response = await this.request(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Resend email failed (${response.status})`);
    }
  }
}
