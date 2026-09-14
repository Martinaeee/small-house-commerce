import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import type { LandingPageStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ProductsService } from '../products.service.js';
import type {
  CreateLandingPageInput,
  UpdateLandingPageInput,
} from './dto/landing-page.dto.js';
import { effectiveStatus, type LandingEffectiveStatus } from './landing-page.util.js';

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
