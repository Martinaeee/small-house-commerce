import type { Prisma } from '../../generated/prisma/client.js';

/** A component binding as stored: identity, required quantity and liveness. */
export interface BundleDefinitionComponent {
  componentSkuId: string;
  quantity: number;
  status: string;
  productStatus: string;
  isBundle: boolean;
}

export interface BundleAvailabilityComponent extends BundleDefinitionComponent {
  availableInventory: number;
}

/**
 * Returns null for a definition that may be sold, or the reason it may not.
 * Shared by availability (which floors to zero) and by publication (which
 * refuses the save) so a definition can never be sellable but unpublished, or
 * published but unsellable.
 */
export function validateBundleDefinition(components: readonly BundleDefinitionComponent[]): string | null {
  if (components.length === 0) return 'add between 1 and 20 component SKUs';
  if (components.length > 20) return 'a Bundle cannot contain more than 20 component SKUs';
  const identities = new Set<string>();
  for (const component of components) {
    if (identities.has(component.componentSkuId)) return 'each component SKU can appear only once';
    if (component.isBundle) return 'a Bundle cannot contain another Bundle';
    if (component.status !== 'ACTIVE' || component.productStatus !== 'ACTIVE') return 'components must be active SKUs from active products';
    if (!Number.isInteger(component.quantity) || component.quantity < 1 || component.quantity > 1000) return 'component quantities must be whole numbers from 1 to 1000';
    identities.add(component.componentSkuId);
  }
  return null;
}

export function computeBundleAvailability(components: readonly BundleAvailabilityComponent[]): number {
  if (validateBundleDefinition(components) !== null) return 0;
  if (components.some(component => !Number.isSafeInteger(component.availableInventory) || component.availableInventory < 0)) return 0;
  return Math.max(0, Math.min(...components.map(component => Math.floor(component.availableInventory / component.quantity))));
}

/** Physical demand on one ordinary SKU. */
export interface BundleRequirement {
  skuId: string;
  quantity: number;
}

/** One requested line: an ordinary SKU, or a virtual SKU with its components. */
export interface BundleRequirementLine {
  skuId: string;
  isBundle: boolean;
  quantity: number;
  components?: readonly { componentSkuId: string; quantity: number }[];
}

/** Sums demand per ordinary SKU in a stable order, so lock order is fixed. */
export function aggregateRequirements(rows: readonly BundleRequirement[]): BundleRequirement[] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.skuId, (totals.get(row.skuId) ?? 0) + row.quantity);
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([skuId, quantity]) => ({ skuId, quantity }));
}

/**
 * Physical demand of a set of lines. A virtual SKU never demands itself — it
 * demands its components, and an empty or missing definition demands nothing,
 * so a Bundle can never be "available" on its own row.
 */
export function cartRequirements(lines: readonly BundleRequirementLine[]): BundleRequirement[] {
  return aggregateRequirements(lines.flatMap(line => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) return [];
    if (!line.isBundle) return [{ skuId: line.skuId, quantity: line.quantity }];
    return (line.components ?? []).map(component => ({
      skuId: component.componentSkuId,
      quantity: component.quantity * line.quantity,
    }));
  }));
}

/**
 * Physical demand of an already-ordered Bundle line, derived from its stored
 * snapshot rather than the current definition, so a later redefinition cannot
 * change what an existing order owes.
 */
export function requirementsFromBundleSnapshot(
  snapshot: { components: readonly { componentSkuId: string; quantity: number }[] } | null | undefined,
  lineQuantity: number,
): BundleRequirement[] {
  if (!Number.isInteger(lineQuantity) || lineQuantity < 1) return [];
  return aggregateRequirements((snapshot?.components ?? [])
    .filter(component => Number.isInteger(component.quantity) && component.quantity > 0)
    .map(component => ({
      skuId: component.componentSkuId,
      quantity: component.quantity * lineQuantity,
    })));
}

/** A stored Bundle definition with its components' liveness. */
export interface StoredBundleDefinition {
  skuId: string;
  status: string;
  productStatus: string;
  components: Array<{
    componentSkuId: string;
    quantity: number;
    status: string;
    productStatus: string;
    isBundle: boolean;
  }>;
}

export async function loadBundleDefinitions(
  tx: Prisma.TransactionClient,
  skuIds: readonly string[],
): Promise<Map<string, StoredBundleDefinition>> {
  if (skuIds.length === 0) return new Map();
  const rows = await tx.sku.findMany({
    where: { id: { in: [...skuIds] }, isBundle: true },
    select: {
      id: true,
      status: true,
      product: { select: { status: true } },
      bundleComponents: {
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: {
          componentSkuId: true,
          quantity: true,
          componentSku: {
            select: {
              status: true,
              isBundle: true,
              variant: { select: { product: { select: { status: true } } } },
            },
          },
        },
      },
    },
  });
  return new Map(rows.map(row => [row.id, {
    skuId: row.id,
    status: row.status,
    productStatus: row.product.status,
    components: row.bundleComponents.map(component => ({
      componentSkuId: component.componentSkuId,
      quantity: component.quantity,
      status: component.componentSku.status,
      productStatus: component.componentSku.variant.product.status,
      isBundle: component.componentSku.isBundle,
    })),
  }]));
}

/** Derived availability per virtual SKU from definitions and component stock. */
export function bundleAvailabilityFrom(
  definitions: ReadonlyMap<string, StoredBundleDefinition>,
  freeByComponent: ReadonlyMap<string, number>,
): Map<string, number> {
  const availability = new Map<string, number>();
  for (const [skuId, definition] of definitions) {
    availability.set(
      skuId,
      definition.status !== 'ACTIVE' || definition.productStatus !== 'ACTIVE'
        ? 0
        : computeBundleAvailability(definition.components.map(component => ({
            ...component,
            availableInventory: freeByComponent.get(component.componentSkuId) ?? 0,
          }))),
    );
  }
  return availability;
}

/**
 * Availability of the requested virtual SKUs, derived from their components'
 * free stock. Ordinary ids are absent from the result: their own inventory rows
 * stay authoritative.
 */
export async function getBundleAvailabilityForSkus(
  tx: Prisma.TransactionClient,
  skuIds: readonly string[],
): Promise<Map<string, number>> {
  const definitions = await loadBundleDefinitions(tx, skuIds);
  if (definitions.size === 0) return new Map();
  const componentIds = [...new Set(
    [...definitions.values()].flatMap(definition => definition.components.map(component => component.componentSkuId)),
  )];
  const freeByComponent = new Map<string, number>();
  if (componentIds.length > 0) {
    const grouped = await tx.inventory.groupBy({
      by: ['skuId'],
      where: { skuId: { in: componentIds } },
      _sum: { onHand: true, reserved: true },
    });
    for (const row of grouped) {
      freeByComponent.set(row.skuId, (row._sum.onHand ?? 0) - (row._sum.reserved ?? 0));
    }
  }
  return bundleAvailabilityFrom(definitions, freeByComponent);
}
