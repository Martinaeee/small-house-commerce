import { BadRequestException, Body, Controller, Get, Header, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QianyiClient, qianyiRows } from './qianyi.client.js';
import { QianyiSyncService } from './qianyi-sync.service.js';
import { skuReadiness, type SkuSource } from './qianyi-sku.mapper.js';

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
 * SKUs are created in the Qianyi console by staff. This API only binds an
 * existing Qianyi code to a local SKU, after checking the code exists.
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

  /** Local SKUs with their bound code and the data gaps staff need to fill in Qianyi. */
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
        title: row.product.name,
        ...readiness,
      };
    });
  }

  @Put('skus/:skuId/mapping')
  async map(@Param('skuId') skuId: string, @Body() body: { qianyiSkuCode?: string | null }) {
    const value = body.qianyiSkuCode?.trim() || null;
    // A code that is absent from the Qianyi catalog fails the whole order later,
    // so the binding is checked against the catalog while the operator is here.
    if (value && this.client.enabled) {
      const payload = await this.client.call('QUERY_SIMPLE_LIST_SKU', 'sku', {
        shop: this.client.shop, page: 1, pageSize: 5, skus: [value],
      });
      if (!qianyiRows(payload).some(row => row.sku === value)) {
        throw new BadRequestException(`Qianyi SKU ${value} was not found in the catalog`);
      }
    }
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
  async retry(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.sync.retry(id, user.userId);
  }

  /**
   * A create may already have reached Qianyi. Only an operator who verified
   * the order is absent there may open it for one more create.
   */
  @Post('jobs/:id/authorize-retry')
  async authorizeRetry(@Param('id') id: string, @CurrentUser() user: { userId: string },
    @Body() body: { confirmedAbsent?: boolean }) {
    return this.sync.authorizeCreateRetry(id, user.userId, body.confirmedAbsent === true);
  }

  /**
   * Re-queues a push that was skipped for a missing SKU mapping. Refuses with
   * the exact SKUs still unmapped, and arms the duplicate check before the
   * worker pushes anything.
   */
  @Post('jobs/:id/requeue')
  async requeue(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.sync.requeueSkipped(id, user.userId);
  }
}
