import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';

export interface InventoryRequirement { skuId: string; quantity: number }

export interface BundleAvailabilityComponent {
  quantity: number;
  availableInventory: number;
  status: string;
  productStatus: string;
  isBundle: boolean;
}

export const bundleSnapshotSchema = z.object({
  version: z.literal(1),
  components: z.array(z.object({
    componentSkuId: z.string().min(1),
    quantityPerBundle: z.number().int().positive(),
    totalQuantity: z.number().int().positive(),
    position: z.number().int().nonnegative(),
    skuCode: z.string(),
    productName: z.string(),
    variantName: z.string(),
  })).min(1),
});
export type BundleSnapshot = z.infer<typeof bundleSnapshotSchema>;

const componentsInclude = {
  orderBy: [{ position: 'asc' }, { id: 'asc' }],
  include: { componentSku: { include: { variant: { include: { product: true } }, inventory: true } } },
} satisfies Prisma.SkuBundleComponentFindManyArgs;

function componentAvailability(row: Prisma.SkuBundleComponentGetPayload<{ include: typeof componentsInclude.include }>): BundleAvailabilityComponent {
  return {
    quantity: row.quantity,
    status: row.componentSku.status,
    productStatus: row.componentSku.variant.product.status,
    isBundle: row.componentSku.isBundle,
    availableInventory: row.componentSku.inventory.reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0),
  };
}

export async function getBundleAvailabilityForSkus(db: Pick<Prisma.TransactionClient, 'sku'>, skuIds: string[]): Promise<Map<string, number>> {
  if (skuIds.length === 0) return new Map();
  const bundles = await db.sku.findMany({
    where: { id: { in: skuIds }, isBundle: true },
    include: { bundleComponents: componentsInclude },
  });
  return new Map(bundles.map((sku) => [sku.id, sku.status === 'ACTIVE' ? computeBundleAvailability(sku.bundleComponents.map(componentAvailability)) : 0]));
}

export async function validateBundleProducts(db: Pick<Prisma.TransactionClient, 'sku'>, productIds: string[]): Promise<void> {
  const bundles = await db.sku.findMany({ where: { productId: { in: productIds }, isBundle: true, status: 'ACTIVE' }, include: { bundleComponents: componentsInclude } });
  for (const sku of bundles) {
    if (sku.bundleComponents.length === 0 || sku.bundleComponents.some(row => row.componentSku.isBundle || row.componentSku.status !== 'ACTIVE' || row.componentSku.variant.product.status !== 'ACTIVE')) {
      throw new BadRequestException(`Bundle ${sku.skuCode} needs active ordinary component SKUs before publishing`);
    }
  }
}

export async function expandBundleRequirements(skuId: string, quantity: number, tx: Prisma.TransactionClient): Promise<{ requirements: InventoryRequirement[]; snapshot: BundleSnapshot | null }> {
  // Lock the definition owner before reading components so checkout cannot mix two edits.
  await tx.$queryRaw`SELECT id FROM skus WHERE id = ${skuId}::uuid FOR SHARE`;
  const sku = await tx.sku.findUnique({ where: { id: skuId }, include: { bundleComponents: componentsInclude } });
  if (!sku) throw new BadRequestException('SKU not found');
  if (!sku.isBundle) return { requirements: [{ skuId, quantity }], snapshot: null };
  const components = sku.bundleComponents;
  if (sku.status !== 'ACTIVE' || components.length === 0 || components.some((row) => row.componentSku.isBundle || row.componentSku.status !== 'ACTIVE' || row.componentSku.variant.product.status !== 'ACTIVE')) {
    throw new BadRequestException('Bundle components are unavailable');
  }
  const snapshot: BundleSnapshot = { version: 1, components: components.map((row) => ({
    componentSkuId: row.componentSkuId,
    quantityPerBundle: row.quantity,
    totalQuantity: row.quantity * quantity,
    position: row.position,
    skuCode: row.componentSku.skuCode,
    productName: row.componentSku.variant.product.name,
    variantName: row.componentSku.variant.name,
  })) };
  return { requirements: requirementsFromBundleSnapshot(skuId, quantity, snapshot), snapshot };
}

export function computeBundleAvailability(components: readonly BundleAvailabilityComponent[]): number {
  if (components.length === 0 || components.some((item) => item.status !== 'ACTIVE' || item.productStatus !== 'ACTIVE' || item.isBundle || !Number.isInteger(item.quantity) || item.quantity <= 0)) return 0;
  return Math.max(0, Math.min(...components.map((item) => Math.floor(item.availableInventory / item.quantity))));
}

export function aggregateRequirements(requirements: readonly InventoryRequirement[]): InventoryRequirement[] {
  const totals = new Map<string, number>();
  for (const { skuId, quantity } of requirements) totals.set(skuId, (totals.get(skuId) ?? 0) + quantity);
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([skuId, quantity]) => ({ skuId, quantity }));
}

export function requirementsFromBundleSnapshot(skuId: string, quantity: number, snapshot: unknown): InventoryRequirement[] {
  if (snapshot === null || snapshot === undefined) return [{ skuId, quantity }];
  const parsed = bundleSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new BadRequestException('Invalid order Bundle snapshot');
  return parsed.data.components.map((component) => ({ skuId: component.componentSkuId, quantity: component.quantityPerBundle * quantity }));
}
