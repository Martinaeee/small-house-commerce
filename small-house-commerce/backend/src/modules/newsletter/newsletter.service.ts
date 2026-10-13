import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_GATEWAY, type EmailGateway } from '../email/email.gateway.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { SubscriberQuery } from './dto/newsletter.dto.js';
import { findAvailableNewsletterPromotion } from './promotion-availability.js';
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js';

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Neutralizes spreadsheet formula injection and quotes fields that would
 * otherwise break the CSV row (comma, quote, or newline).
 */
function csvSafe(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    private readonly config: ConfigService,
  ) {}

  async subscribe(input: {
    email: string;
    source: 'POPUP' | 'FOOTER';
  }): Promise<{
    ok: true;
    promoCode: string | null;
    offerTitle: string;
    offerBody: string;
  }> {
    const normalizedEmail = normalizeEmail(input.email);
    await this.prisma.newsletterSubscriber.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        source: input.source,
      },
      update: {
        status: 'SUBSCRIBED',
        unsubscribedAt: null,
      },
    });

    const [settings, promotion] = await Promise.all([
      this.settings.getRow(),
      findAvailableNewsletterPromotion(this.prisma),
    ]);
    const promoCode = promotion?.code ?? null;
    const unsubscribeUrl = this.unsubscribeUrl(normalizedEmail);

    try {
      await this.email.sendWelcome(normalizedEmail, {
        offerTitle: settings.newsletterOfferTitle,
        offerBody: settings.newsletterOfferBody,
        promoCode,
        unsubscribeUrl,
      });
    } catch (error) {
      this.logger.warn(
        `Welcome email delivery failed for ${normalizedEmail}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      ok: true,
      promoCode,
      offerTitle: settings.newsletterOfferTitle,
      offerBody: settings.newsletterOfferBody,
    };
  }

  async unsubscribeByToken(token: string): Promise<boolean> {
    const secret = this.config.getOrThrow<string>('jwt.secret');
    const email = verifyUnsubscribeToken(token, secret);
    if (!email) return false;

    const result = await this.prisma.newsletterSubscriber.updateMany({
      where: { email },
      data: {
        status: 'UNSUBSCRIBED',
        unsubscribedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  async listSubscribers(query: SubscriberQuery) {
    const where = {
      ...(query.status ? { status: query.status as 'SUBSCRIBED' | 'UNSUBSCRIBED' } : {}),
      ...(query.source ? { source: query.source as 'POPUP' | 'FOOTER' } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.newsletterSubscriber.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.newsletterSubscriber.count({ where }),
    ]);
    return { page: query.page, pageSize: query.pageSize, total, items };
  }

  async setSubscriberStatus(
    id: string,
    status: 'SUBSCRIBED' | 'UNSUBSCRIBED',
  ) {
    const existing = await this.prisma.newsletterSubscriber.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Subscriber not found');

    return this.prisma.newsletterSubscriber.update({
      where: { id },
      data:
        status === 'SUBSCRIBED'
          ? { status: 'SUBSCRIBED', unsubscribedAt: null }
          : { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() },
    });
  }

  async exportSubscribersCsv(): Promise<string> {
    const rows = await this.prisma.newsletterSubscriber.findMany({
      orderBy: { createdAt: 'asc' },
    });
    const header = 'email,status,source,createdAt,unsubscribedAt';
    const body = rows.map((row) =>
      [
        csvSafe(row.email),
        row.status,
        row.source,
        row.createdAt.toISOString(),
        row.unsubscribedAt ? row.unsubscribedAt.toISOString() : '',
      ].join(','),
    );
    return [header, ...body].join('\r\n');
  }

  private unsubscribeUrl(normalizedEmail: string): string {
    const secret = this.config.getOrThrow<string>('jwt.secret');
    const token = signUnsubscribeToken(normalizedEmail, secret);
    const baseUrl =
      this.config.get<string>('email.storefrontBaseUrl') ??
      'http://localhost:3001';
    return `${baseUrl.replace(/\/$/, '')}/api/v1/storefront/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
  }
}
