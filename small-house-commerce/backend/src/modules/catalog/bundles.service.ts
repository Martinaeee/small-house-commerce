import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import { computeBundleAvailability } from '../inventory/bundle-inventory.js';
import { setBundleComponentsSchema, type SetBundleComponentsInput } from './dto/bundle.dto.js';

@Injectable()
export class BundlesService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string) {
    const rows = await this.prisma.sku.findMany({
      where: {
        isBundle: false, status: 'ACTIVE', variant: { product: { status: 'ACTIVE' } },
        ...(q ? { OR: [
          { skuCode: { contains: q, mode: 'insensitive' as const } },
          { variant: { name: { contains: q, mode: 'insensitive' as const } } },
          { variant: { product: { name: { contains: q, mode: 'insensitive' as const } } } },
        ] } : {}),
      },
      take: 20, orderBy: { skuCode: 'asc' },
      include: { variant: { include: { product: true } }, inventory: true },
    });
    return rows.map((sku) => ({
      id: sku.id, skuCode: sku.skuCode, productId: sku.productId,
      productName: sku.variant.product.name, variantName: sku.variant.name,
      availableInventory: sku.inventory.reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0),
    }));
  }

  async getComponents(productId: string, skuId: string) {
    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      include: { bundleComponents: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        include: { componentSku: { include: { variant: { include: { product: true } }, inventory: true } } },
      } },
    });
    if (!sku || sku.productId !== productId) throw new NotFoundException('SKU not found in this product');
    if (!sku.isBundle) throw new BadRequestException('This SKU is not a virtual Bundle');
    const components = sku.bundleComponents.map((row) => ({
      id: row.id,
      componentSkuId: row.componentSkuId,
      quantity: row.quantity,
      position: row.position,
      componentSkuCode: row.componentSku.skuCode,
      componentProductName: row.componentSku.variant.product.name,
      componentVariantName: row.componentSku.variant.name,
      status: row.componentSku.status,
      productStatus: row.componentSku.variant.product.status,
      isBundle: row.componentSku.isBundle,
      availableInventory: row.componentSku.inventory.reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0),
    }));
    return { version: sku.bundleVersion, components, availableInventory: sku.status === 'ACTIVE' ? computeBundleAvailability(components) : 0 };
  }

  async setComponents(productId: string, skuId: string, input: SetBundleComponentsInput) {
    const parsed = setBundleComponentsSchema.parse(input);
    if (parsed.components.some((row) => row.componentSkuId === skuId)) throw new BadRequestException('A Bundle cannot contain itself');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM skus WHERE id = ${skuId}::uuid FOR UPDATE`;
      const sku = await tx.sku.findUnique({ where: { id: skuId } });
      if (!sku || sku.productId !== productId) throw new NotFoundException('SKU not found in this product');
      if (!sku.isBundle) throw new BadRequestException('This SKU is not a virtual Bundle');
      const components = await tx.sku.findMany({
        where: { id: { in: parsed.components.map((row) => row.componentSkuId) } },
        include: { variant: { include: { product: true } } },
      });
      if (components.length !== parsed.components.length || components.some((component) => component.isBundle || component.status !== 'ACTIVE' || component.variant.product.status !== 'ACTIVE')) {
        throw new BadRequestException('Components must be active ordinary SKUs from active products');
      }
      const updated = await tx.sku.updateMany({
        where: { id: skuId, isBundle: true, bundleVersion: parsed.expectedVersion },
        data: { bundleVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Bundle changed. Reload its components before saving.');
      await tx.skuBundleComponent.deleteMany({ where: { bundleSkuId: skuId } });
      await tx.skuBundleComponent.createMany({ data: parsed.components.map((component) => ({ ...component, bundleSkuId: skuId })) });
    });
    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return this.getComponents(productId, skuId);
  }
}
