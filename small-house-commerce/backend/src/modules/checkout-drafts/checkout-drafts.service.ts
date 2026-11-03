import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CHECKOUT_DRAFT_MAX_AGE_MS,
  CheckoutDraftExpiredError,
  hashCheckoutDraftToken,
  type ParsedCheckoutDraftToken,
} from './checkout-draft-token.js';
import type { CheckoutDraftSaveInput, CheckoutDraftQuery } from './dto/checkout-draft.dto.js';
import {
  buildCheckoutDraftSnapshot,
  contactOf,
  type CheckoutDraftProductLine,
  type CheckoutDraftSnapshot,
} from './checkout-draft-snapshot.js';

const EMPTY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PRODUCT_LINES = 100;

export class CheckoutDraftConflictError extends ConflictException {
  constructor(readonly currentRevision: number) {
    super({
      statusCode: 409,
      message: 'A newer checkout draft revision was saved.',
      currentRevision,
    });
  }
}

export class CheckoutDraftGoneError extends GoneException {
  constructor() {
    super({ statusCode: 410, message: 'This checkout draft has expired.' });
  }
}

export interface AdminCheckoutDraftSummary {
  id: string;
  status: 'OPEN' | 'CONVERTED';
  hasUserInput: boolean;
  contactName: string | null;
  contactPhone: string | null;
  itemCount: number;
  firstItemName: string | null;
  firstItemThumbnail: string | null;
  orderId: string | null;
  orderNumber: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface AdminCheckoutDraftDetail extends AdminCheckoutDraftSummary {
  snapshot: CheckoutDraftSnapshot;
  productSnapshot: CheckoutDraftProductLine[];
}

interface AdminDraftRow {
  id: string;
  status: 'OPEN' | 'CONVERTED';
  hasUserInput: boolean;
  contactName: string | null;
  contactPhone: string | null;
  productSnapshot: unknown;
  orderId: string | null;
  order: { id: string; orderNumber: string } | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

function toSummary(row: AdminDraftRow): AdminCheckoutDraftSummary {
  const products = Array.isArray(row.productSnapshot)
    ? (row.productSnapshot as CheckoutDraftProductLine[])
    : [];
  return {
    id: row.id,
    status: row.status,
    hasUserInput: row.hasUserInput,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    itemCount: products.length,
    firstItemName: products[0]?.productName ?? null,
    firstItemThumbnail: products[0]?.thumbnailUrl ?? null,
    orderId: row.order?.id ?? row.orderId ?? null,
    orderNumber: row.order?.orderNumber ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

@Injectable()
export class CheckoutDraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    rawToken: string,
    input: CheckoutDraftSaveInput,
    now: Date = new Date(),
  ): Promise<{ status: 'OPEN' | 'CONVERTED' | 'EXPIRED'; revision: number; converted: boolean }> {
    const token = this.parseToken(rawToken, now);
    const existing = await this.prisma.checkoutDraft.findUnique({
      where: { tokenHash: token.hash },
    });

    if (existing?.status === 'CONVERTED') {
      return { status: 'CONVERTED', revision: existing.clientRevision, converted: true };
    }
    if (existing?.status === 'EXPIRED') throw new CheckoutDraftGoneError();
    if (existing && now >= existing.expiresAt) {
      await this.prisma.checkoutDraft.updateMany({
        where: { id: existing.id },
        data: {
          status: 'EXPIRED',
          snapshot: {},
          productSnapshot: [],
          contactName: null,
          contactPhone: null,
        },
      });
      throw new CheckoutDraftGoneError();
    }

    const snapshot = buildCheckoutDraftSnapshot(input);
    const contact = contactOf(snapshot);
    const hasUserInput = Boolean(input.hasUserInput || existing?.hasUserInput);
    const tokenExpiresAt = new Date(token.issuedAt.getTime() + CHECKOUT_DRAFT_MAX_AGE_MS);

    if (!existing) {
      const emptyExpiresAt = new Date(
        Math.min(now.getTime() + EMPTY_TTL_MS, tokenExpiresAt.getTime()),
      );
      try {
        const created = await this.prisma.checkoutDraft.create({
          data: {
            tokenHash: token.hash,
            tokenIssuedAt: token.issuedAt,
            status: 'OPEN',
            clientRevision: input.revision,
            hasUserInput,
            contactName: contact.name,
            contactPhone: contact.phone,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            productSnapshot: (await this.productSnapshot(input.items)) as unknown as Prisma.InputJsonValue,
            expiresAt: hasUserInput ? tokenExpiresAt : emptyExpiresAt,
          },
        });
        return { status: 'OPEN', revision: created.clientRevision, converted: false };
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        return this.save(rawToken, input, now);
      }
    }

    if (input.revision < existing.clientRevision) {
      throw new CheckoutDraftConflictError(existing.clientRevision);
    }
    if (input.revision === existing.clientRevision) {
      return { status: 'OPEN', revision: existing.clientRevision, converted: false };
    }

    let productSnapshot: CheckoutDraftProductLine[] = [];
    try {
      productSnapshot = await this.productSnapshot(input.items);
    } catch {
      productSnapshot = [];
    }

    const updated = await this.prisma.checkoutDraft.updateMany({
      where: {
        id: existing.id,
        status: 'OPEN',
        clientRevision: { lt: input.revision },
      },
      data: {
        clientRevision: input.revision,
        hasUserInput,
        contactName: contact.name,
        contactPhone: contact.phone,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        productSnapshot: productSnapshot as unknown as Prisma.InputJsonValue,
        expiresAt: hasUserInput ? tokenExpiresAt : existing.expiresAt,
      },
    });
    if (updated.count === 0) {
      const latest = await this.prisma.checkoutDraft.findUnique({
        where: { tokenHash: token.hash },
      });
      if (latest?.status === 'CONVERTED') {
        return { status: 'CONVERTED', revision: latest.clientRevision, converted: true };
      }
      throw new CheckoutDraftConflictError(latest?.clientRevision ?? existing.clientRevision);
    }
    return { status: 'OPEN', revision: input.revision, converted: false };
  }

  async read(
    rawToken: string,
    now: Date = new Date(),
  ): Promise<{ status: 'OPEN'; revision: number; snapshot: CheckoutDraftSnapshot } | null> {
    const token = this.parseToken(rawToken, now);
    const draft = await this.prisma.checkoutDraft.findUnique({
      where: { tokenHash: token.hash },
    });
    if (!draft) return null;
    if (draft.status === 'EXPIRED' || now >= draft.expiresAt) throw new CheckoutDraftGoneError();
    if (draft.status === 'CONVERTED') {
      throw new NotFoundException({
        statusCode: 404,
        message: 'This checkout was completed.',
      });
    }
    return {
      status: 'OPEN',
      revision: draft.clientRevision,
      snapshot: draft.snapshot as unknown as CheckoutDraftSnapshot,
    };
  }

  async list(query: CheckoutDraftQuery) {
    const where: Prisma.CheckoutDraftWhereInput = {
      status: query.status ?? { in: ['OPEN', 'CONVERTED'] },
      ...(query.search
        ? {
            OR: [
              { contactName: { contains: query.search, mode: 'insensitive' as const } },
              { contactPhone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.checkoutDraft.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          status: true,
          hasUserInput: true,
          contactName: true,
          contactPhone: true,
          productSnapshot: true,
          orderId: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
          order: { select: { id: true, orderNumber: true } },
        },
      }),
      this.prisma.checkoutDraft.count({ where }),
    ]);
    return {
      items: rows.map((row) => toSummary(row as AdminDraftRow)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: string, now: Date = new Date()) {
    const row = await this.prisma.checkoutDraft.findUnique({
      where: { id },
      include: { order: { select: { id: true, orderNumber: true } } },
    });
    if (!row || row.status === 'EXPIRED' || (row.status === 'OPEN' && now >= row.expiresAt)) {
      throw new NotFoundException({ statusCode: 404, message: 'Checkout draft not found.' });
    }
    return {
      ...toSummary(row as AdminDraftRow),
      snapshot: row.snapshot as unknown as CheckoutDraftSnapshot,
      productSnapshot: Array.isArray(row.productSnapshot)
        ? (row.productSnapshot as unknown as CheckoutDraftProductLine[])
        : [],
    };
  }

  private parseToken(rawToken: string, now: Date): ParsedCheckoutDraftToken {
    try {
      return hashCheckoutDraftToken(rawToken, now);
    } catch (error) {
      if (error instanceof CheckoutDraftExpiredError) throw new CheckoutDraftGoneError();
      throw new NotFoundException({ statusCode: 404, message: 'Checkout draft not found.' });
    }
  }

  private async productSnapshot(
    items: { skuId: string; quantity: number }[],
  ): Promise<CheckoutDraftProductLine[]> {
    if (items.length === 0) return [];
    const skus = await this.prisma.sku.findMany({
      where: { id: { in: items.map((item) => item.skuId).slice(0, MAX_PRODUCT_LINES) } },
      select: {
        id: true,
        skuCode: true,
        price: true,
        variant: {
          select: {
            name: true,
            images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: {
              where: { variantId: null },
              select: { url: true },
              orderBy: { sortOrder: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
    const byId = new Map(skus.map((sku) => [sku.id, sku]));
    return items.slice(0, MAX_PRODUCT_LINES).map((item) => {
      const sku = byId.get(item.skuId);
      return {
        skuId: item.skuId,
        skuCode: sku?.skuCode ?? null,
        productId: sku?.product.id ?? null,
        productName: sku?.product.name ?? null,
        productSlug: sku?.product.slug ?? null,
        variantName: sku?.variant.name ?? null,
        thumbnailUrl: sku?.variant.images[0]?.url ?? sku?.product.images[0]?.url ?? null,
        unitPrice: sku?.price == null ? null : sku.price.toString(),
        quantity: item.quantity,
      };
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
