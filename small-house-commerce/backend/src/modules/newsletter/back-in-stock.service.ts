import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BackInStockSubscription,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  EMAIL_GATEWAY,
  type EmailGateway,
} from '../email/email.gateway.js';
import { isEmailDeliveryEnabled } from '../email/email-delivery-readiness.js';
import { normalizeEmail } from './newsletter.service.js';
import {
  signBackInStockUnsubscribeToken,
  verifyBackInStockUnsubscribeToken,
} from './back-in-stock-token.js';
import type {
  BackInStockQuery,
  BackInStockSubscribeInput,
} from './dto/back-in-stock.dto.js';

const DELIVERY_BATCH_SIZE = 10;
const LAST_ERROR_MAX_LENGTH = 1_000;
const DELIVERY_NOT_CONFIGURED_ERROR = 'Email delivery is not configured';
const STOCK_ALERTS_UNAVAILABLE_MESSAGE =
  'Stock alerts are temporarily unavailable';

export type BackInStockClaim = BackInStockSubscription;

type AdminRow = BackInStockSubscription & {
  sku: {
    skuCode: string;
    variant: { name: string };
  };
};

@Injectable()
export class BackInStockService {
  private readonly logger = new Logger(BackInStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_GATEWAY) private readonly email: EmailGateway,
    private readonly config: ConfigService,
  ) {}

  async subscribe(input: BackInStockSubscribeInput): Promise<{ ok: true }> {
    this.assertDeliveryEnabled();
    const email = normalizeEmail(input.email);

    return this.prisma.$transaction(async (tx) => {
      const sku = await tx.sku.findUnique({
        where: { id: input.skuId },
        include: { variant: { include: { product: true } } },
      });
      if (!sku) throw new NotFoundException('SKU not found');
      if (
        sku.status !== 'ACTIVE' ||
        sku.price === null ||
        sku.variant.product.status !== 'ACTIVE'
      ) {
        throw new BadRequestException(
          'This item is not available for stock alerts',
        );
      }

      const availability = await this.snapshotForChangedSkusWithin(tx, [
        sku.id,
      ]);
      if ((availability.get(sku.id) ?? 0) > 0) {
        throw new BadRequestException('This item is already in stock');
      }

      await tx.backInStockSubscription.upsert({
        where: { email_skuId: { email, skuId: sku.id } },
        create: {
          email,
          skuId: sku.id,
          productName: sku.variant.product.name,
          productSlug: sku.variant.product.slug,
        },
        update: {
          status: 'PENDING',
          productName: sku.variant.product.name,
          productSlug: sku.variant.product.slug,
          lastError: null,
          notifiedAt: null,
        },
      });

      return { ok: true as const };
    });
  }

  async cancelByToken(token: string): Promise<boolean> {
    const secret = this.config.getOrThrow<string>('jwt.secret');
    const id = verifyBackInStockUnsubscribeToken(token, secret);
    if (!id) return false;

    const result = await this.prisma.backInStockSubscription.updateMany({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    return result.count > 0;
  }

  async list(query: BackInStockQuery) {
    const where = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.backInStockSubscription.findMany({
        where,
        include: {
          sku: { select: { skuCode: true, variant: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.backInStockSubscription.count({ where }),
    ]);
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: rows.map((row) => this.toAdminRow(row)),
    };
  }

  async resend(id: string) {
    this.assertDeliveryEnabled();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.backInStockSubscription.findUnique({
        where: { id },
      });
      if (!existing) throw new NotFoundException('Stock alert not found');
      if (existing.status !== 'PENDING' || existing.lastError === null) {
        throw new BadRequestException(
          'Only failed stock alerts can be resent',
        );
      }
      const availability = await this.snapshotForChangedSkusWithin(tx, [
        existing.skuId,
      ]);
      if ((availability.get(existing.skuId) ?? 0) <= 0) {
        throw new BadRequestException('This item is not currently in stock');
      }
      const rows = await tx.backInStockSubscription.updateManyAndReturn({
        where: { id, status: 'PENDING', lastError: { not: null } },
        data: { status: 'SENT', lastError: null, notifiedAt: null },
      });
      if (rows.length === 0) {
        throw new BadRequestException(
          'Only failed stock alerts can be resent',
        );
      }
      return rows[0];
    });

    await this.deliverClaims([claimed]);
    const row = await this.prisma.backInStockSubscription.findUnique({
      where: { id },
      include: {
        sku: { select: { skuCode: true, variant: { select: { name: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Stock alert not found');
    return this.toAdminRow(row);
  }

  /**
   * Locks every directly changed SKU, then snapshots the same direct-SKU
   * availability contract the current storefront uses.
   */
  async snapshotForChangedSkusWithin(
    tx: Prisma.TransactionClient,
    changedSkuIds: readonly string[],
  ): Promise<Map<string, number>> {
    const affected = [...new Set(changedSkuIds)].sort();
    if (affected.length === 0) return new Map();

    for (const skuId of affected) {
      await tx.$queryRaw`
        SELECT 1::int AS locked
        FROM (SELECT pg_advisory_xact_lock(hashtext(${`back-in-stock:${skuId}`}))) AS acquired
      `;
    }

    const result = new Map<string, number>(affected.map((id) => [id, 0]));
    const grouped = await tx.inventory.groupBy({
      by: ['skuId'],
      where: { skuId: { in: affected }, sku: { isBundle: false } },
      _sum: { onHand: true, reserved: true },
    });
    for (const row of grouped) {
      result.set(
        row.skuId,
        (row._sum.onHand ?? 0) - (row._sum.reserved ?? 0),
      );
    }
    return result;
  }

  async claimTransitionsWithin(
    tx: Prisma.TransactionClient,
    before: ReadonlyMap<string, number>,
    after: ReadonlyMap<string, number>,
  ): Promise<BackInStockClaim[]> {
    const restocked = [...before]
      .filter(
        ([skuId, available]) =>
          available <= 0 && (after.get(skuId) ?? available) > 0,
      )
      .map(([skuId]) => skuId)
      .sort();
    if (restocked.length === 0) return [];

    if (!isEmailDeliveryEnabled(this.config)) {
      await tx.backInStockSubscription.updateMany({
        where: { skuId: { in: restocked }, status: 'PENDING' },
        data: { lastError: DELIVERY_NOT_CONFIGURED_ERROR },
      });
      return [];
    }

    const claims = await tx.backInStockSubscription.updateManyAndReturn({
      where: { skuId: { in: restocked }, status: 'PENDING' },
      data: { status: 'SENT', lastError: null, notifiedAt: null },
    });
    return claims.sort(
      (a, b) =>
        a.skuId.localeCompare(b.skuId) || a.id.localeCompare(b.id),
    );
  }

  async deliverClaims(claims: readonly BackInStockClaim[]): Promise<void> {
    if (!isEmailDeliveryEnabled(this.config)) {
      if (claims.length > 0) {
        await this.prisma.backInStockSubscription.updateMany({
          where: {
            id: { in: claims.map(({ id }) => id) },
            status: 'SENT',
            notifiedAt: null,
          },
          data: {
            status: 'PENDING',
            lastError: DELIVERY_NOT_CONFIGURED_ERROR,
          },
        });
      }
      return;
    }

    for (let start = 0; start < claims.length; start += DELIVERY_BATCH_SIZE) {
      await Promise.all(
        claims
          .slice(start, start + DELIVERY_BATCH_SIZE)
          .map((claim) => this.deliverOne(claim)),
      );
    }
  }

  private async deliverOne(claim: BackInStockClaim): Promise<void> {
    const current = await this.prisma.backInStockSubscription.findUnique({
      where: { id: claim.id },
      select: { status: true, notifiedAt: true },
    });
    if (!current || current.status !== 'SENT' || current.notifiedAt !== null) {
      return;
    }

    try {
      await this.email.sendBackInStock(claim.email, {
        productName: claim.productName,
        productUrl: this.productUrl(claim.productSlug),
        unsubscribeUrl: this.unsubscribeUrl(claim.id),
      });
      await this.prisma.backInStockSubscription.updateMany({
        where: { id: claim.id, status: 'SENT', notifiedAt: null },
        data: { notifiedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, LAST_ERROR_MAX_LENGTH);
      this.logger.warn(
        `Back-in-stock email delivery failed for ${claim.id}: ${message}`,
      );
      await this.prisma.backInStockSubscription.updateMany({
        where: { id: claim.id, status: 'SENT', notifiedAt: null },
        data: { status: 'PENDING', lastError: message },
      });
    }
  }

  private assertDeliveryEnabled(): void {
    if (!isEmailDeliveryEnabled(this.config)) {
      throw new ServiceUnavailableException(STOCK_ALERTS_UNAVAILABLE_MESSAGE);
    }
  }

  private productUrl(slug: string): string {
    return `${this.storefrontBaseUrl()}/products/${encodeURIComponent(slug)}`;
  }

  private unsubscribeUrl(id: string): string {
    const secret = this.config.getOrThrow<string>('jwt.secret');
    const token = signBackInStockUnsubscribeToken(id, secret);
    return `${this.storefrontBaseUrl()}/api/v1/storefront/back-in-stock/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  private storefrontBaseUrl(): string {
    return (
      this.config.get<string>('email.storefrontBaseUrl') ??
      'http://localhost:3001'
    ).replace(/\/$/, '');
  }

  private toAdminRow(row: AdminRow) {
    const { sku, ...subscription } = row;
    return {
      ...subscription,
      skuCode: sku.skuCode,
      variantName: sku.variant.name,
    };
  }
}
