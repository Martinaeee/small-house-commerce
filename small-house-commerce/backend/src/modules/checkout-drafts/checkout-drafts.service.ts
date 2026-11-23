import {
  ConflictException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { SlidingWindowRateLimiter, normalizeClientIp } from '../../common/rate-limit.window.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CHECKOUT_DRAFT_MAX_AGE_MS,
  CheckoutDraftExpiredError,
  hashCheckoutDraftToken,
  type ParsedCheckoutDraftToken,
} from './checkout-draft-token.js';
import type { CheckoutDraftSaveInput, CheckoutDraftQuery, CheckoutDraftFollowUpInput } from './dto/checkout-draft.dto.js';
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

export class CheckoutDraftCapacityError extends HttpException {
  readonly retryAfterSeconds: number;

  constructor(retryAfterMs: number) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    super({ statusCode: 429, message: 'Too many new checkout drafts. Please retry later.', retryAfterSeconds: seconds }, 429);
    this.retryAfterSeconds = seconds;
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
  followUpStatus: string | null;
  followUpNote: string | null;
  assignee: { id: string; name: string } | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface AdminCheckoutDraftFollowUpEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  operatorName: string | null;
  createdAt: string;
}

export interface AdminCheckoutDraftDetail extends AdminCheckoutDraftSummary {
  clientRevision: number;
  snapshot: CheckoutDraftSnapshot;
  productSnapshot: CheckoutDraftProductLine[];
  followUpEvents: AdminCheckoutDraftFollowUpEvent[];
}

interface AdminDraftRow {
  id: string;
  status: 'OPEN' | 'CONVERTED';
  hasUserInput: boolean;
  contactName: string | null;
  contactPhone: string | null;
  productSnapshot: unknown;
  orderId: string | null;
  order: { id: string; orderNumber: string; createdAt?: Date } | null;
  followUpStatus?: string | null;
  followUpNote?: string | null;
  assigneeId?: string | null;
  assignee?: { id: string; name: string } | null;
  nextFollowUpAt?: Date | null;
  lastContactedAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
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
    followUpStatus: row.followUpStatus ?? null,
    followUpNote: row.followUpNote ?? null,
    assignee: row.assignee ?? null,
    nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
    lastContactedAt: row.lastContactedAt?.toISOString() ?? null,
    convertedAt: row.order?.createdAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

@Injectable()
export class CheckoutDraftsService {
  private readonly creationLimiter = new SlidingWindowRateLimiter();

  constructor(private readonly prisma: PrismaService) {}

  async save(
    rawToken: string,
    input: CheckoutDraftSaveInput,
    now: Date = new Date(),
    clientIp?: string,
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
    const hasUserInput = Boolean(existing?.hasUserInput ||
      Object.values(snapshot.customer).some((value) => value.trim() !== '') ||
      snapshot.customerNote.trim() || snapshot.promoCodeInput.trim() || snapshot.promoCodeApplied ||
      // The date starts prefilled: its presence alone is not evidence of a shopper edit.
      (input.hasUserInput && snapshot.preferredDeliveryDate));
    const tokenExpiresAt = new Date(token.issuedAt.getTime() + CHECKOUT_DRAFT_MAX_AGE_MS);

    if (!existing) {
      // New anonymous rows have a separate, much lower budget. Typing into an
      // existing checkout does not consume it, including behind shared IPs.
      const ip = normalizeClientIp(clientIp);
      for (const [windowMs, limit] of [[60 * 60_000, 60], [24 * 60 * 60_000, 500]]) {
        const decision = this.creationLimiter.hit(`checkout-draft-new:${windowMs}:${ip}`, limit, windowMs, now.getTime());
        if (!decision.allowed) throw new CheckoutDraftCapacityError(decision.retryAfterMs);
      }
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
        return this.save(rawToken, input, now, clientIp);
      }
    }

    if (input.revision < existing.clientRevision) {
      throw new CheckoutDraftConflictError(existing.clientRevision);
    }
    if (input.revision === existing.clientRevision) {
      if (!isDeepStrictEqual(existing.snapshot, snapshot)) {
        throw new CheckoutDraftConflictError(existing.clientRevision);
      }
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

  async list(query: CheckoutDraftQuery, now: Date = new Date()) {
    const dueOnly = query.dueOnly === true;
    const where: Prisma.CheckoutDraftWhereInput = {
      status: query.status ?? { in: ['OPEN', 'CONVERTED'] },
      ...(query.followUpStatus
        ? { followUpStatus: query.followUpStatus === 'UNFOLLOWED' ? null : query.followUpStatus }
        : dueOnly
          ? { followUpStatus: { in: ['TO_CONTACT', 'NO_ANSWER', 'FOLLOW_UP_LATER'] } }
          : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(dueOnly ? { nextFollowUpAt: { lte: now } } : {}),
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
          followUpStatus: true,
          followUpNote: true,
          nextFollowUpAt: true,
          lastContactedAt: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
          order: { select: { id: true, orderNumber: true, createdAt: true } },
          assignee: { select: { id: true, name: true } },
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
      include: {
        order: { select: { id: true, orderNumber: true, createdAt: true } },
        assignee: { select: { id: true, name: true } },
        followUpEvents: {
          orderBy: { createdAt: 'asc' },
          include: { operator: { select: { id: true, name: true } } },
        },
      },
    });
    if (!row || row.status === 'EXPIRED' || (row.status === 'OPEN' && now >= row.expiresAt)) {
      throw new NotFoundException({ statusCode: 404, message: 'Checkout draft not found.' });
    }
    return {
      ...toSummary(row as unknown as AdminDraftRow),
      clientRevision: row.clientRevision,
      snapshot: row.snapshot as unknown as CheckoutDraftSnapshot,
      productSnapshot: Array.isArray(row.productSnapshot)
        ? (row.productSnapshot as unknown as CheckoutDraftProductLine[])
        : [],
      followUpEvents: (row.followUpEvents ?? []).map((event) => ({
        id: event.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        operatorName: event.operator?.name ?? null,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  /**
   * 客服记录一次回访：既更新草稿的当前结论，也追加一条不可改写的留痕。
   * 已转订单的草稿不再跟进；过期草稿按不存在处理。
   */
  async followUp(
    id: string,
    input: CheckoutDraftFollowUpInput,
    operatorId: string,
    now: Date = new Date(),
  ) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.checkoutDraft.findUnique({ where: { id } });
      if (!draft || draft.status === 'EXPIRED' || (draft.status === 'OPEN' && now >= draft.expiresAt)) {
        throw new NotFoundException({ statusCode: 404, message: 'Checkout draft not found.' });
      }
      if (draft.status === 'CONVERTED') {
        throw new ConflictException({
          statusCode: 409,
          message: 'This checkout draft already became an order.',
        });
      }
      const fromStatus = draft.followUpStatus;
      const data = {
        followUpStatus: input.status,
        lastContactedAt: now,
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.nextFollowUpAt !== undefined
          ? { nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null }
          : {}),
        ...(input.note !== undefined ? { followUpNote: input.note || null } : {}),
      };
      const updated = await tx.checkoutDraft.update({
        where: { id },
        data,
        include: {
          order: { select: { id: true, orderNumber: true } },
          assignee: { select: { id: true, name: true } },
        },
      });
      await tx.checkoutDraftFollowUpEvent.create({
        data: {
          draftId: id,
          operatorId,
          fromStatus,
          toStatus: input.status,
          note: input.note ?? null,
          createdAt: now,
        },
      });
      return toSummary(updated as unknown as AdminDraftRow);
    });
  }

  /**
   * 24h 内没有任何主动输入的空草稿抹掉内容；令牌满 30 天的行整行删除。
   * 分批执行、可重复运行；空草稿的 24h 与令牌 30h 寿命是两件事。
   */
  async prune(now: Date = new Date()): Promise<{ expired: number; deleted: number }> {
    const deleted = await this.prisma.checkoutDraft.deleteMany({
      where: {
        tokenIssuedAt: {
          lte: new Date(now.getTime() - CHECKOUT_DRAFT_MAX_AGE_MS),
        },
      },
    });
    const emptyCutoff = new Date(now.getTime() - EMPTY_TTL_MS);
    const tokenFloor = new Date(now.getTime() - CHECKOUT_DRAFT_MAX_AGE_MS);
    let expired = 0;
    for (let batch = 0; batch < 10; batch += 1) {
      const rows = await this.prisma.checkoutDraft.findMany({
        where: {
          status: 'OPEN',
          hasUserInput: false,
          createdAt: { lte: emptyCutoff },
          tokenIssuedAt: { gt: tokenFloor },
        },
        select: { id: true, tokenIssuedAt: true },
        take: 200,
      });
      if (rows.length === 0) break;
      const tombstone = await this.prisma.checkoutDraft.updateMany({
        where: { id: { in: rows.map((row) => row.id) }, status: 'OPEN', hasUserInput: false },
        data: {
          status: 'EXPIRED',
          snapshot: {},
          productSnapshot: [],
          contactName: null,
          contactPhone: null,
        },
      });
      expired += tombstone.count;
      if (rows.length < 200) break;
    }
    return { expired, deleted: deleted.count };
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
