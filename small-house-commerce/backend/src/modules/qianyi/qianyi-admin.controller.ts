import { Body, Controller, Get, Header, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QianyiClient, QianyiError } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';
import { buildSkuPayload, skuReadiness, type SkuSource } from './qianyi-sku.mapper.js';

const SKU_INCLUDE = {
  product: { select: { name: true, description: true } },
  variant: {
    include: {
      product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } },
    },
  },
} as const;

type SkuRow = {
  id: string;
  skuCode: string;
  qianyiSkuCode: string | null;
  packageWeight: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
  packageDepth: number | null;
  productWeight: number | null;
  product: { name: string; description: string | null };
  variant: { product: { images: Array<{ url: string }> } };
};

function toSource(row: SkuRow): SkuSource {
  return {
    id: row.id,
    skuCode: row.skuCode,
    packageWeight: row.packageWeight,
    packageWidth: row.packageWidth,
    packageHeight: row.packageHeight,
    packageDepth: row.packageDepth,
    productWeight: row.productWeight,
    product: { name: row.product.name, description: row.product.description },
    images: row.variant.product.images.map((image) => ({ url: image.url })),
  };
}

/**
 * Operator-facing Qianyi controls.
 *
 * Product creation is gated on an explicit tick per SKU: nothing is written to
 * Qianyi unless the operator selected that exact row in the preview list.
 */
@Controller('admin/qianyi')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class QianyiAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: QianyiClient,
    private readonly sync: QianyiSyncService,
  ) {}

  @Get('status')
  @Header('Cache-Control', 'private, no-store')
  async status() {
    return this.sync.health();
  }

  /** Everything the operator needs before ticking rows for creation. */
  @Get('skus')
  @Header('Cache-Control', 'private, no-store')
  async skus(@Query('unmapped') unmapped?: string) {
    const rows = (await this.prisma.sku.findMany({
      where: unmapped === 'true' ? { qianyiSkuCode: null } : undefined,
      include: SKU_INCLUDE,
      orderBy: { skuCode: 'asc' },
    })) as unknown as SkuRow[];

    return rows.map((row) => {
      const readiness = skuReadiness(toSource(row));
      return {
        id: row.id,
        skuCode: row.skuCode,
        qianyiSkuCode: row.qianyiSkuCode,
        suggestedCode: row.skuCode,
        title: row.product.name,
        ...readiness,
      };
    });
  }

  /** Creates ONLY the rows the operator ticked. Never bulk-creates. */
  @Post('skus/create')
  async create(@Body() body: { skuIds?: string[] }) {
    const results: Array<{ skuCode: string; ok: boolean; error?: string }> = [];
    for (const id of (body.skuIds ?? []).slice(0, 100)) {
      const row = (await this.prisma.sku.findUnique({
        where: { id },
        include: SKU_INCLUDE,
      })) as unknown as SkuRow | null;
      if (!row) continue;
      // Already mapped: never re-create it in Qianyi.
      if (row.qianyiSkuCode) continue;
      const source = toSource(row);
      if (!skuReadiness(source).ready) {
        results.push({ skuCode: row.skuCode, ok: false, error: 'missing dimensions or weight' });
        continue;
      }
      const payload = buildSkuPayload(source, row.skuCode);
      const { notes: _notes, ...wire } = payload;
      try {
        await this.client.call('INSERT_SKU_INFO', 'sku', wire);
        await this.prisma.sku.update({
          where: { id: row.id },
          data: { qianyiSkuCode: row.skuCode },
        });
        results.push({ skuCode: row.skuCode, ok: true });
      } catch (error) {
        const message =
          error instanceof QianyiError
            ? `${error.errorCode}: ${error.message}`
            : (error as Error).message;
        results.push({ skuCode: row.skuCode, ok: false, error: message.slice(0, 200) });
      }
    }
    return { results };
  }

  @Put('skus/:skuId/mapping')
  async map(@Param('skuId') skuId: string, @Body() body: { qianyiSkuCode?: string | null }) {
    const value = body.qianyiSkuCode?.trim() || null;
    await this.prisma.sku.update({ where: { id: skuId }, data: { qianyiSkuCode: value } });
    return { skuId, qianyiSkuCode: value };
  }

  @Get('jobs')
  @Header('Cache-Control', 'private, no-store')
  async jobs() {
    return this.prisma.qianyiSyncJob.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { order: { select: { orderNumber: true } } },
    });
  }

  @Post('jobs/:id/retry')
  async retry(@Param('id') id: string) {
    await this.sync.retry(id);
    return { retried: true };
  }
}
