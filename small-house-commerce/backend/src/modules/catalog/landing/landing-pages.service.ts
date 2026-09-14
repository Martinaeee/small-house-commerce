import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { LandingPageStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ProductsService } from '../products.service.js';
import type {
  AdminLandingPageQuery,
  CreateLandingPageInput,
  UpdateLandingPageInput,
} from './dto/landing-page.dto.js';
import { effectiveStatus, type LandingEffectiveStatus } from './landing-page.util.js';

export interface AdminLandingPageRow {
  id: string;
  productId: string;
  productName: string;
  name: string;
  slug: string;
  adCode: string | null;
  titleOverride: string | null;
  promoEnabled: boolean;
  promoHeadline: string | null;
  promoSubtext: string | null;
  startAt: Date | null;
  endAt: Date | null;
  status: LandingPageStatus;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  effectiveStatus: LandingEffectiveStatus;
  views: number;
  orders: number;
  conversionRate: number;
}

// Inclusive date filter upper bound: the day after a YYYY-MM-DD date, at 00:00 UTC.
function nextUtcDay(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1));
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

// '' from a trimmed optional string is normalized to NULL; undefined stays
// undefined so PATCH only touches the fields the client sent.
function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.length > 0 ? value : null;
}

@Injectable()
export class LandingPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async adminListForProduct(productId: string) {
    await this.ensureProduct(productId);
    const rows = await this.prisma.productLandingPage.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  // Global "Single Pages" list: paged across all products with visit/order
  // metrics. Orders exclude CANCELLED/DENIED so the rate matches the admin hint.
  async adminList(query: AdminLandingPageQuery) {
    const where: Prisma.ProductLandingPageWhereInput = {};
    if (query.productId) where.productId = query.productId;
    if (query.status) where.status = query.status;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { titleOverride: { contains: search, mode: 'insensitive' } },
        { adCode: { contains: search, mode: 'insensitive' } },
        { product: { is: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      const updatedAt: Prisma.DateTimeFilter = {};
      if (query.dateFrom) updatedAt.gte = new Date(`${query.dateFrom}T00:00:00.000Z`);
      if (query.dateTo) updatedAt.lt = nextUtcDay(query.dateTo);
      where.updatedAt = updatedAt;
    }
    if (query.effectiveStatus) this.applyEffectiveStatus(where, query.effectiveStatus);

    const orderBy: Prisma.ProductLandingPageOrderByWithRelationInput[] =
      query.sortBy === 'title'
        ? [{ titleOverride: query.sortDir }]
        : [{ updatedAt: query.sortDir }];

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productLandingPage.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          productId: true,
          name: true,
          slug: true,
          adCode: true,
          titleOverride: true,
          promoEnabled: true,
          promoHeadline: true,
          promoSubtext: true,
          startAt: true,
          endAt: true,
          status: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
          product: { select: { name: true } },
        },
      }),
      this.prisma.productLandingPage.count({ where }),
    ]);

    const ids = rows.map((row) => row.id);
    const [visitGroups, orderGroups] = await Promise.all([
      this.prisma.landingPageVisit.groupBy({
        by: ['landingPageId'],
        where: { landingPageId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.orderAttribution.groupBy({
        by: ['landingPageId'],
        where: {
          landingPageId: { in: ids },
          order: { orderStatus: { notIn: ['CANCELLED', 'DENIED'] } },
        },
        _count: { _all: true },
      }),
    ]);
    const viewCount = new Map(visitGroups.map((g) => [g.landingPageId, g._count._all]));
    const orderCount = new Map(orderGroups.map((g) => [g.landingPageId, g._count._all]));

    const items: AdminLandingPageRow[] = rows.map(({ product, ...row }) => {
      const views = viewCount.get(row.id) ?? 0;
      const orders = orderCount.get(row.id) ?? 0;
      return {
        ...row,
        productName: product.name,
        views,
        orders,
        conversionRate: views === 0 ? 0 : Math.round((orders / views) * 10000) / 10000,
        effectiveStatus: effectiveStatus(row),
      };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  // One statement for the bulk "retitle selected pages" action.
  async bulkRetitle(ids: string[], titleOverride: string): Promise<{ updated: number }> {
    const result = await this.prisma.productLandingPage.updateMany({
      where: { id: { in: ids } },
      data: { titleOverride },
    });
    return { updated: result.count };
  }

  async adminCreate(productId: string, input: CreateLandingPageInput) {
    await this.ensureProduct(productId);
    try {
      const data: Prisma.ProductLandingPageUncheckedCreateInput = {
        // Explicit required fields after the spread so create types stay strict.
        ...this.scalarWritableData(input),
        productId,
        slug: input.slug,
        name: input.name,
        startAt: input.startAt ? new Date(input.startAt) : null,
        endAt: input.endAt ? new Date(input.endAt) : null,
      };
      const row = await this.prisma.productLandingPage.create({ data });
      return this.serialize(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`链接标识 ${input.slug} 已被使用，请换一个`);
      }
      throw error;
    }
  }

  async adminUpdate(id: string, input: UpdateLandingPageInput) {
    await this.ensureLandingPage(id);
    const row = await this.prisma.productLandingPage.update({
      where: { id },
      data: {
        ...this.scalarWritableData(input),
        startAt:
          input.startAt === undefined ? undefined : input.startAt === null ? null : new Date(input.startAt),
        endAt: input.endAt === undefined ? undefined : input.endAt === null ? null : new Date(input.endAt),
      },
    });
    return this.serialize(row);
  }

  async adminRemove(id: string) {
    await this.ensureLandingPage(id);
    await this.prisma.productLandingPage.delete({ where: { id } });
    return { id };
  }

  private async ensureProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException(`Product #${productId} not found`);
  }

  private async ensureLandingPage(id: string) {
    const row = await this.prisma.productLandingPage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Landing page #${id} not found`);
    return row;
  }

  // Mirror of landing-page.util.effectiveStatus expressed as Prisma filters.
  // LIVE = ACTIVE and (no past/future window edge excludes now).
  private applyEffectiveStatus(
    where: Prisma.ProductLandingPageWhereInput,
    value: NonNullable<AdminLandingPageQuery['effectiveStatus']>,
    now: Date = new Date(),
  ) {
    if (value === 'DISABLED') {
      where.status = 'DISABLED';
      return;
    }
    where.status = 'ACTIVE';
    if (value === 'SCHEDULED') {
      where.startAt = { gt: now };
    } else if (value === 'ENDED') {
      where.endAt = { lt: now };
    } else {
      where.AND = [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ];
    }
  }

  private scalarWritableData(input: CreateLandingPageInput | UpdateLandingPageInput) {
    return {
      name: input.name,
      adCode: optionalText(input.adCode),
      titleOverride: optionalText(input.titleOverride),
      imagesOverride:
        input.imagesOverride === undefined
          ? undefined
          : input.imagesOverride === null
            ? Prisma.DbNull
            : input.imagesOverride,
      seoTitle: optionalText(input.seoTitle),
      seoDescription: optionalText(input.seoDescription),
      promoEnabled: input.promoEnabled,
      promoHeadline: optionalText(input.promoHeadline),
      promoSubtext: optionalText(input.promoSubtext),
      status: input.status,
      sortOrder: input.sortOrder,
    };
  }

  private serialize<T extends { status: LandingPageStatus; startAt: Date | null; endAt: Date | null }>(
    row: T,
  ): T & { effectiveStatus: LandingEffectiveStatus } {
    return { ...row, effectiveStatus: effectiveStatus(row) };
  }
}
