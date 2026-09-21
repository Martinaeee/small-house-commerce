import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import {
  canonicalCombinationKey,
  deriveVariantName,
  isLegacyUnmappedCombinationKey,
  planVariantReconciliation,
  validateCatalogGraph,
} from './catalog-graph.js';
import {
  CatalogGraphVersionMismatchError,
  CatalogGraphVersionRequiredError,
  type CatalogGraphPatch,
  type EntityRef,
  type MediaWrite,
  type OptionWrite,
  type SkuWrite,
  type VariantWrite,
} from './dto/catalog-graph.dto.js';

const PENDING_GRAPH_NAME = '__pending_catalog_graph__';
const DISABLED_GRAPH_NAME = '__disabled_catalog_graph__';

const GRAPH_SNAPSHOT_INCLUDE = {
  options: {
    include: { values: true },
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
  },
  variants: {
    include: {
      optionValues: true,
      sku: {
        include: {
          _count: {
            select: {
              cartItems: true,
              inventory: true,
              reservations: true,
              inventoryMovements: true,
              orderItems: true,
            },
          },
        },
      },
      _count: {
        select: {
          images: true,
          defaultForProducts: true,
        },
      },
    },
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
  },
  images: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
  },
  detailBlocks: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ProductInclude;

type GraphSnapshot = Prisma.ProductGetPayload<{
  include: typeof GRAPH_SNAPSHOT_INCLUDE;
}>;
type SnapshotVariant = GraphSnapshot['variants'][number];
type SnapshotSku = NonNullable<SnapshotVariant['sku']>;

type GraphMedia = GraphSnapshot['images'][number];
export type AdminProduct = Omit<GraphSnapshot, 'images'> & {
  /** Legacy gallery contract: shared product media only. */
  images: GraphMedia[];
  /** Full admin media graph, including option-value and variant scopes. */
  media: GraphMedia[];
};

export class CatalogGraphMaterializationRequiredError extends Error {
  readonly code = 'CATALOG_GRAPH_MATERIALIZATION_REQUIRED';

  constructor() {
    super(
      'A graph-v0 product must map every persisted legacy variant before catalog graph writes.',
    );
    this.name = 'CatalogGraphMaterializationRequiredError';
  }
}

interface MutableOption {
  id: string;
  productId: string;
  kind: OptionWrite['kind'];
  name: string;
  position: number;
  presentation: OptionWrite['presentation'];
  isMediaDriver: boolean;
  isActive: boolean;
  isNew: boolean;
}

interface MutableValue {
  id: string;
  productId: string;
  optionId: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isActive: boolean;
  isNew: boolean;
}

interface Candidate {
  combinationKey: string;
  name: string;
  pairs: Array<{ optionId: string; valueId: string }>;
}

interface IncomingVariant {
  write: VariantWrite;
  requestedId: string;
  combinationKey: string;
  pairs: Array<{ optionId: string; valueId: string }>;
  clientKey?: string;
}

interface PlannedVariant {
  id: string;
  isNew: boolean;
  name: string;
  position: number;
  combinationKey: string;
  pairs: Array<{ optionId: string; valueId: string }>;
  incoming?: IncomingVariant;
  existing?: SnapshotVariant;
}

interface PlannedSkuCreate {
  id: string;
  productId: string;
  variantId: string;
  data: SkuWrite;
}

interface PlannedSkuUpdate {
  id: string;
  productId: string;
  variantId: string;
  data: SkuWrite;
}

interface PlannedMedia {
  id: string;
  isNew: boolean;
  data: {
    productId: string;
    optionValueId: string | null;
    variantId: string | null;
    url: string;
    type: MediaWrite['type'];
    altText: string | null;
    sortOrder: number;
  };
}

interface PersistencePlan {
  expectedVersion: number;
  options: MutableOption[];
  changedOptionIds: Set<string>;
  values: MutableValue[];
  changedValueIds: Set<string>;
  existingVariantIds: string[];
  variants: PlannedVariant[];
  disabledVariants: Array<{ id: string; name: string }>;
  deletedVariantIds: string[];
  skuCreates: PlannedSkuCreate[];
  skuUpdates: PlannedSkuUpdate[];
  skuDisableVariantIds: string[];
  media: PlannedMedia[];
  retiredMediaIds: string[];
  defaultDisplayVariantId: string | null | undefined;
}

@Injectable()
export class CatalogGraphService {
  constructor(private readonly prisma: PrismaService) {}

  async applyPatch(
    productId: string,
    expectedVersion: number,
    patch: CatalogGraphPatch,
  ): Promise<AdminProduct> {
    return this.applyPatchWithProductMutation(
      productId,
      expectedVersion,
      patch,
    );
  }

  async applyPatchWithProductMutation(
    productId: string,
    expectedVersion: number,
    patch: CatalogGraphPatch,
    mutateProduct?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<AdminProduct> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new CatalogGraphVersionRequiredError();
    }

    const plan = await this.planOutsideTransaction(
      productId,
      expectedVersion,
      patch,
    );
    const saved = await this.prisma.$transaction((tx) =>
      this.persistPlan(tx, productId, plan, mutateProduct),
    );

    await revalidateCache([CACHE_TAGS.STOREFRONT]);

    const media = saved.images;
    return {
      ...saved,
      images: media.filter(
        ({ optionValueId, variantId }) =>
          optionValueId === null && variantId === null,
      ),
      media,
    };
  }

  private async planOutsideTransaction(
    productId: string,
    expectedVersion: number,
    patch: CatalogGraphPatch,
  ): Promise<PersistencePlan> {
    const snapshot = await this.prisma.product.findUnique({
      where: { id: productId },
      include: GRAPH_SNAPSHOT_INCLUDE,
    });
    if (!snapshot) throw new NotFoundException('Product not found');

    const requiresLegacyMaterialization =
      snapshot.catalogGraphVersion === 0 &&
      snapshot.options.length === 0 &&
      snapshot.variants.length > 0;

    const existingOptions = new Map(
      snapshot.options.map((option) => [option.id, option]),
    );
    const existingValues = new Map(
      snapshot.options.flatMap((option) =>
        option.values.map((value) => [value.id, value] as const),
      ),
    );
    const existingVariants = new Map(
      snapshot.variants.map((variant) => [variant.id, variant]),
    );
    const existingMedia = new Map(
      snapshot.images.map((media) => [media.id, media]),
    );

    await this.assertMaterializationOptionValueIdentities(
      productId,
      patch,
      requiresLegacyMaterialization,
      existingOptions,
      existingValues,
    );

    this.assertOwnedRetirements(
      patch,
      existingOptions,
      existingValues,
      existingVariants,
      existingMedia,
    );

    const optionClientIds = new Map<string, string>();
    const valueClientIds = new Map<string, string>();
    const variantClientRequestedIds = new Map<string, string>();

    const options = new Map<string, MutableOption>();
    const values = new Map<string, MutableValue>();
    for (const option of snapshot.options) {
      options.set(option.id, {
        id: option.id,
        productId,
        kind: option.kind,
        name: option.name,
        position: option.position,
        presentation: option.presentation,
        isMediaDriver: option.isMediaDriver,
        isActive: option.isActive,
        isNew: false,
      });
      for (const value of option.values) {
        values.set(value.id, {
          id: value.id,
          productId,
          optionId: option.id,
          label: value.label,
          position: value.position,
          swatchHex: value.swatchHex,
          thumbnailUrl: value.thumbnailUrl,
          thumbnailAlt: value.thumbnailAlt,
          isActive: value.isActive,
          isNew: false,
        });
      }
    }

    const changedOptionIds = new Set<string>();
    const changedValueIds = new Set<string>();
    for (const write of patch.options) {
      const optionId = this.resolveChangedRowId(
        write,
        existingOptions,
        optionClientIds,
        'option',
      );
      const isNew = !existingOptions.has(optionId);
      options.set(optionId, {
        id: optionId,
        productId,
        kind: write.kind,
        name: write.name,
        position: write.position,
        presentation: write.presentation,
        isMediaDriver: write.isMediaDriver,
        isActive: write.isActive,
        isNew,
      });
      changedOptionIds.add(optionId);

      for (const valueWrite of write.values) {
        const valueId = this.resolveChangedRowId(
          valueWrite,
          existingValues,
          valueClientIds,
          'option value',
        );
        const storedValue = existingValues.get(valueId);
        if (storedValue && storedValue.optionId !== optionId) {
          throw new BadRequestException(
            `Option value ${valueId} does not belong to option ${optionId}.`,
          );
        }
        values.set(valueId, {
          id: valueId,
          productId,
          optionId,
          label: valueWrite.label,
          position: valueWrite.position,
          swatchHex: valueWrite.swatchHex ?? null,
          thumbnailUrl: valueWrite.thumbnailUrl ?? null,
          thumbnailAlt: valueWrite.thumbnailAlt ?? null,
          isActive: valueWrite.isActive,
          isNew: !storedValue,
        });
        changedValueIds.add(valueId);
      }
    }

    for (const optionId of patch.retirements.optionIds) {
      const option = options.get(optionId)!;
      option.isActive = false;
      changedOptionIds.add(optionId);
    }
    for (const valueId of patch.retirements.optionValueIds) {
      const value = values.get(valueId)!;
      value.isActive = false;
      changedValueIds.add(valueId);
    }

    const optionList = [...options.values()];
    const valueList = [...values.values()];
    validateCatalogGraph(
      optionList.map((option) => ({
        id: option.id,
        name: option.name,
        position: option.position,
        isActive: option.isActive,
        isMediaDriver: option.isMediaDriver,
        values: valueList
          .filter((value) => value.optionId === option.id)
          .map((value) => ({
            id: value.id,
            label: value.label,
            isActive: value.isActive,
          })),
      })),
    );

    const activeOptions = optionList
      .filter((option) => option.isActive)
      .sort(
        (left, right) =>
          left.position - right.position || left.id.localeCompare(right.id),
      );
    const candidates = this.buildCandidates(activeOptions, valueList);
    const activeOptionIds = new Set(activeOptions.map((option) => option.id));
    if (requiresLegacyMaterialization) {
      const mappedPersistedIds = new Set(
        patch.variants.flatMap((variant) =>
          variant.id === undefined ? [] : [variant.id],
        ),
      );
      if (
        mappedPersistedIds.size !== snapshot.variants.length ||
        snapshot.variants.some(({ id }) => !mappedPersistedIds.has(id)) ||
        [...mappedPersistedIds].some((id) => !existingVariants.has(id))
      ) {
        throw new CatalogGraphMaterializationRequiredError();
      }
    }

    const incomingVariants = patch.variants.map((write) => {
      let requestedId: string;
      let clientKey: string | undefined;
      if (write.id !== undefined) {
        requestedId = write.id;
        if (!existingVariants.has(requestedId)) {
          throw new BadRequestException(
            `Variant ${requestedId} does not belong to product ${productId}.`,
          );
        }
      } else {
        clientKey = write.clientKey;
        requestedId = randomUUID();
        variantClientRequestedIds.set(clientKey, requestedId);
      }

      const pairs = write.optionValueRefs.map((ref) => {
        let valueId: string;
        try {
          valueId = this.resolveRef(
            ref,
            existingValues,
            valueClientIds,
            'option value',
          );
        } catch (error) {
          if (requiresLegacyMaterialization && write.id !== undefined) {
            throw new CatalogGraphMaterializationRequiredError();
          }
          throw error;
        }
        const value = values.get(valueId);
        if (!value || !value.isActive || !activeOptionIds.has(value.optionId)) {
          if (requiresLegacyMaterialization && write.id !== undefined) {
            throw new CatalogGraphMaterializationRequiredError();
          }
          throw new BadRequestException(
            `Option value ${valueId} is not active for product ${productId}.`,
          );
        }
        return { optionId: value.optionId, valueId };
      });
      try {
        this.assertCompleteVariantSelection(pairs, activeOptions, requestedId);
      } catch (error) {
        if (requiresLegacyMaterialization && write.id !== undefined) {
          throw new CatalogGraphMaterializationRequiredError();
        }
        throw error;
      }
      return {
        write,
        requestedId,
        combinationKey: canonicalCombinationKey(pairs),
        pairs,
        clientKey,
      } satisfies IncomingVariant;
    });

    const incomingByKey = new Map<string, IncomingVariant>();
    for (const incoming of incomingVariants) {
      if (incomingByKey.has(incoming.combinationKey)) {
        if (requiresLegacyMaterialization) {
          throw new CatalogGraphMaterializationRequiredError();
        }
        throw new BadRequestException(
          `Two variant rows resolve to combination ${incoming.combinationKey}.`,
        );
      }
      incomingByKey.set(incoming.combinationKey, incoming);
    }

    const incomingByPersistedId = new Map(
      incomingVariants
        .filter((incoming) => incoming.write.id !== undefined)
        .map((incoming) => [incoming.requestedId, incoming] as const),
    );
    const effectiveExisting = snapshot.variants.map((variant) => {
      const incoming = incomingByPersistedId.get(variant.id);
      let combinationKey = variant.combinationKey;
      if (incoming && incoming.combinationKey !== combinationKey) {
        if (
          requiresLegacyMaterialization &&
          isLegacyUnmappedCombinationKey(combinationKey, variant.id)
        ) {
          combinationKey = incoming.combinationKey;
        } else {
          throw new BadRequestException(
            `Variant ${variant.id} cannot be reassigned to a different combination.`,
          );
        }
      }
      return {
        id: variant.id,
        combinationKey,
        hasHistory: this.variantHasReferences(variant),
      };
    });

    const reconciliation = planVariantReconciliation(
      effectiveExisting,
      candidates.map(({ combinationKey }) => combinationKey),
    );
    const effectiveById = new Map(
      effectiveExisting.map((row) => [row.id, row]),
    );
    const existingByKey = new Map(
      effectiveExisting.map((row) => [
        row.combinationKey,
        existingVariants.get(row.id)!,
      ]),
    );

    for (const variantId of patch.retirements.variantIds) {
      const effective = effectiveById.get(variantId)!;
      if (
        candidates.some(
          ({ combinationKey }) => combinationKey === effective.combinationKey,
        )
      ) {
        throw new BadRequestException(
          `Variant ${variantId} cannot be retired while its option combination is active.`,
        );
      }
    }

    const variants: PlannedVariant[] = candidates.map((candidate, index) => {
      const existing = existingByKey.get(candidate.combinationKey);
      const incoming = incomingByKey.get(candidate.combinationKey);
      const id = existing?.id ?? incoming?.requestedId ?? randomUUID();
      if (incoming?.clientKey)
        variantClientRequestedIds.set(incoming.clientKey, id);
      return {
        id,
        isNew: !existing,
        name: candidate.name || 'Default',
        position: incoming?.write.position ?? index,
        combinationKey: candidate.combinationKey,
        pairs: candidate.pairs,
        incoming,
        existing,
      };
    });

    const disabledVariantRows = reconciliation.disable.map((row) =>
      existingVariants.get(row.id)!,
    );
    const deletedVariantIds = reconciliation.delete.map(({ id }) => id);
    const desiredVariantIds = new Set(variants.map(({ id }) => id));

    const skuCreates: PlannedSkuCreate[] = [];
    const skuUpdates: PlannedSkuUpdate[] = [];
    for (const variant of variants) {
      const skuWrite = variant.incoming?.write.sku;
      const existingSku = variant.existing?.sku ?? null;
      if (skuWrite && existingSku) {
        skuUpdates.push({
          id: existingSku.id,
          productId,
          variantId: variant.id,
          data: skuWrite,
        });
      } else if (skuWrite && !existingSku) {
        skuCreates.push({
          id: randomUUID(),
          productId,
          variantId: variant.id,
          data: skuWrite,
        });
      } else if (skuWrite === null && existingSku) {
        skuUpdates.push({
          id: existingSku.id,
          productId,
          variantId: variant.id,
          data: {
            ...this.skuWriteFromSnapshot(existingSku),
            status: 'DISABLED',
          },
        });
      }
    }

    const skuDisableVariantIds = disabledVariantRows
      .filter(({ sku }) => sku !== null)
      .map(({ id }) => id);

    const media = this.planMedia(
      productId,
      patch,
      existingMedia,
      existingValues,
      valueClientIds,
      existingVariants,
      variantClientRequestedIds,
      desiredVariantIds,
      new Set(deletedVariantIds),
    );

    const defaultDisplayVariantId = this.resolveDefaultDisplayVariant(
      productId,
      patch.defaultDisplayVariant,
      existingVariants,
      variantClientRequestedIds,
      desiredVariantIds,
      new Set(deletedVariantIds),
    );

    const desiredNames = new Set(variants.map(({ name }) => name));
    const disabledVariants = disabledVariantRows.map((variant) => ({
      id: variant.id,
      name: desiredNames.has(variant.name)
        ? `${DISABLED_GRAPH_NAME}${variant.id}`
        : variant.name,
    }));

    return {
      expectedVersion,
      options: optionList,
      changedOptionIds,
      values: valueList,
      changedValueIds,
      existingVariantIds: snapshot.variants.map(({ id }) => id),
      variants,
      disabledVariants,
      deletedVariantIds,
      skuCreates,
      skuUpdates,
      skuDisableVariantIds,
      media: media.rows,
      retiredMediaIds: media.retiredIds,
      defaultDisplayVariantId,
    };
  }

  private async persistPlan(
    tx: Prisma.TransactionClient,
    productId: string,
    plan: PersistencePlan,
    mutateProduct?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<GraphSnapshot> {
    const revision = await tx.product.updateMany({
      where: { id: productId, catalogGraphVersion: plan.expectedVersion },
      data: { catalogGraphVersion: { increment: 1 } },
    });
    if (revision.count === 0) {
      const current = await tx.product.findUnique({
        where: { id: productId },
        select: { catalogGraphVersion: true },
      });
      if (!current) throw new NotFoundException('Product not found');
      throw new CatalogGraphVersionMismatchError(
        plan.expectedVersion,
        current.catalogGraphVersion,
      );
    }

    if (mutateProduct) await mutateProduct(tx);

    const changedExistingOptionIds = plan.options
      .filter(({ id, isNew }) => !isNew && plan.changedOptionIds.has(id))
      .map(({ id }) => id);
    if (changedExistingOptionIds.length > 0) {
      await tx.productOption.updateMany({
        where: { id: { in: changedExistingOptionIds } },
        data: { isActive: false },
      });
    }

    const optionCreates = plan.options.filter(({ isNew }) => isNew);
    if (optionCreates.length > 0) {
      await tx.productOption.createMany({
        data: optionCreates.map(({ isNew: _isNew, ...option }) => option),
      });
    }
    await Promise.all(
      plan.options
        .filter(({ id, isNew }) => !isNew && plan.changedOptionIds.has(id))
        .map(({ id, productId: _productId, isNew: _isNew, ...data }) =>
          tx.productOption.update({ where: { id }, data }),
        ),
    );

    const changedExistingValueIds = plan.values
      .filter(({ id, isNew }) => !isNew && plan.changedValueIds.has(id))
      .map(({ id }) => id);
    if (changedExistingValueIds.length > 0) {
      await tx.productOptionValue.updateMany({
        where: { id: { in: changedExistingValueIds } },
        data: { isActive: false },
      });
    }

    const valueCreates = plan.values.filter(({ isNew }) => isNew);
    if (valueCreates.length > 0) {
      await tx.productOptionValue.createMany({
        data: valueCreates.map(({ isNew: _isNew, ...value }) => value),
      });
    }
    await Promise.all(
      plan.values
        .filter(({ id, isNew }) => !isNew && plan.changedValueIds.has(id))
        .map(({ id, productId: _productId, isNew: _isNew, ...data }) =>
          tx.productOptionValue.update({ where: { id }, data }),
        ),
    );

    await Promise.all(
      plan.existingVariantIds.map((id) =>
        tx.productVariant.update({
          where: { id },
          data: { name: `${PENDING_GRAPH_NAME}${id}` },
        }),
      ),
    );

    if (plan.deletedVariantIds.length > 0) {
      await tx.productVariant.deleteMany({
        where: { id: { in: plan.deletedVariantIds } },
      });
    }

    const variantCreates = plan.variants.filter(({ isNew }) => isNew);
    if (variantCreates.length > 0) {
      await tx.productVariant.createMany({
        data: variantCreates.map((variant) => ({
          id: variant.id,
          productId,
          name: variant.name,
          position: variant.position,
          combinationKey: variant.combinationKey,
        })),
      });
    }
    await Promise.all([
      ...plan.variants
        .filter(({ isNew }) => !isNew)
        .map((variant) =>
          tx.productVariant.update({
            where: { id: variant.id },
            data: {
              name: variant.name,
              position: variant.position,
              combinationKey: variant.combinationKey,
            },
          }),
        ),
      ...plan.disabledVariants.map((variant) =>
        tx.productVariant.update({
          where: { id: variant.id },
          data: { name: variant.name },
        }),
      ),
    ]);

    if (plan.skuCreates.length > 0) {
      await tx.sku.createMany({
        data: plan.skuCreates.map(({ data, ...identity }) => ({
          id: identity.id,
          productId: identity.productId,
          variantId: identity.variantId,
          ...this.withoutUndefined(data),
        })),
      });
    }
    await Promise.all(
      plan.skuUpdates.map(({ id, productId: skuProductId, variantId, data }) =>
        tx.sku.update({
          where: { id },
          data: {
            ...this.withoutUndefined(data),
            productId: skuProductId,
            variantId,
          },
        }),
      ),
    );
    if (plan.skuDisableVariantIds.length > 0) {
      await tx.sku.updateMany({
        where: { variantId: { in: plan.skuDisableVariantIds } },
        data: { status: 'DISABLED' },
      });
    }

    const assignmentVariantIds = plan.variants.map(({ id }) => id);
    if (assignmentVariantIds.length > 0) {
      await tx.productVariantOptionValue.deleteMany({
        where: { variantId: { in: assignmentVariantIds } },
      });
      const assignments = plan.variants.flatMap((variant) =>
        variant.pairs.map(({ optionId, valueId }) => ({
          variantId: variant.id,
          productId,
          optionId,
          optionValueId: valueId,
        })),
      );
      if (assignments.length > 0) {
        await tx.productVariantOptionValue.createMany({ data: assignments });
      }
    }

    if (plan.retiredMediaIds.length > 0) {
      await tx.productImage.deleteMany({
        where: { id: { in: plan.retiredMediaIds } },
      });
    }
    const mediaCreates = plan.media.filter(({ isNew }) => isNew);
    if (mediaCreates.length > 0) {
      await tx.productImage.createMany({
        data: mediaCreates.map(({ id, data }) => ({ id, ...data })),
      });
    }
    await Promise.all(
      plan.media
        .filter(({ isNew }) => !isNew)
        .map(({ id, data }) =>
          tx.productImage.update({
            where: { id },
            data: {
              optionValueId: data.optionValueId,
              variantId: data.variantId,
              url: data.url,
              type: data.type,
              altText: data.altText,
              sortOrder: data.sortOrder,
            },
          }),
        ),
    );

    if (plan.defaultDisplayVariantId !== undefined) {
      await tx.product.update({
        where: { id: productId },
        data: { defaultDisplayVariantId: plan.defaultDisplayVariantId },
      });
    }

    return tx.product.findUniqueOrThrow({
      where: { id: productId },
      include: GRAPH_SNAPSHOT_INCLUDE,
    });
  }

  private buildCandidates(
    options: MutableOption[],
    values: MutableValue[],
  ): Candidate[] {
    let pairs: Array<Array<{ optionId: string; valueId: string }>> = [[]];
    for (const option of options) {
      const activeValues = values
        .filter((value) => value.optionId === option.id && value.isActive)
        .sort(
          (left, right) =>
            left.position - right.position || left.id.localeCompare(right.id),
        );
      pairs = pairs.flatMap((existing) =>
        activeValues.map((value) => [
          ...existing,
          { optionId: option.id, valueId: value.id },
        ]),
      );
    }

    const valueById = new Map(values.map((value) => [value.id, value]));
    const optionById = new Map(options.map((option) => [option.id, option]));
    return pairs.map((candidatePairs) => ({
      pairs: candidatePairs,
      combinationKey: canonicalCombinationKey(candidatePairs),
      name: deriveVariantName(
        candidatePairs.map(({ optionId, valueId }) => ({
          optionPosition: optionById.get(optionId)!.position,
          valueLabel: valueById.get(valueId)!.label,
        })),
      ),
    }));
  }

  private assertCompleteVariantSelection(
    pairs: Array<{ optionId: string; valueId: string }>,
    activeOptions: MutableOption[],
    variantId: string,
  ): void {
    const selectedOptionIds = new Set(pairs.map(({ optionId }) => optionId));
    if (
      pairs.length !== activeOptions.length ||
      selectedOptionIds.size !== activeOptions.length ||
      activeOptions.some(({ id }) => !selectedOptionIds.has(id))
    ) {
      throw new BadRequestException(
        `Variant ${variantId} must select exactly one value from every active option.`,
      );
    }
  }

  private planMedia(
    productId: string,
    patch: CatalogGraphPatch,
    existingMedia: Map<string, GraphMedia>,
    existingValues: Map<
      string,
      GraphSnapshot['options'][number]['values'][number]
    >,
    valueClientIds: Map<string, string>,
    existingVariants: Map<string, SnapshotVariant>,
    variantClientIds: Map<string, string>,
    desiredVariantIds: Set<string>,
    deletedVariantIds: Set<string>,
  ): { rows: PlannedMedia[]; retiredIds: string[] } {
    const retiredIds = patch.retirements.mediaIds;
    const retired = new Set(retiredIds);
    const rows = patch.media.map((write) => {
      let id: string;
      let isNew: boolean;
      if (write.id !== undefined) {
        id = write.id;
        isNew = false;
        if (!existingMedia.has(id)) {
          throw new BadRequestException(
            `Media ${id} does not belong to product ${productId}.`,
          );
        }
        if (retired.has(id)) {
          throw new BadRequestException(
            `Media ${id} cannot be changed and retired together.`,
          );
        }
      } else {
        id = randomUUID();
        isNew = true;
      }

      let optionValueId: string | null = null;
      if (write.optionValueId) {
        if (!existingValues.has(write.optionValueId)) {
          throw new BadRequestException(
            `Option value ${write.optionValueId} does not belong to product ${productId}.`,
          );
        }
        optionValueId = write.optionValueId;
      } else if (write.optionValueClientKey) {
        optionValueId = valueClientIds.get(write.optionValueClientKey) ?? null;
        if (!optionValueId) {
          throw new BadRequestException(
            `Unknown option value client key ${write.optionValueClientKey}.`,
          );
        }
      }

      let variantId: string | null = null;
      if (write.variantId) {
        if (!existingVariants.has(write.variantId)) {
          throw new BadRequestException(
            `Variant ${write.variantId} does not belong to product ${productId}.`,
          );
        }
        variantId = write.variantId;
      } else if (write.variantClientKey) {
        variantId = variantClientIds.get(write.variantClientKey) ?? null;
        if (!variantId) {
          throw new BadRequestException(
            `Unknown variant client key ${write.variantClientKey}.`,
          );
        }
      }
      if (
        variantId &&
        !desiredVariantIds.has(variantId) &&
        deletedVariantIds.has(variantId)
      ) {
        throw new BadRequestException(
          `Media cannot target retired variant ${variantId}.`,
        );
      }

      return {
        id,
        isNew,
        data: {
          productId,
          optionValueId,
          variantId,
          url: write.url,
          type: write.type,
          altText: write.altText ?? null,
          sortOrder: write.sortOrder,
        },
      } satisfies PlannedMedia;
    });
    return { rows, retiredIds };
  }

  private resolveDefaultDisplayVariant(
    productId: string,
    ref: EntityRef | null | undefined,
    existingVariants: Map<string, SnapshotVariant>,
    variantClientIds: Map<string, string>,
    desiredVariantIds: Set<string>,
    deletedVariantIds: Set<string>,
  ): string | null | undefined {
    if (ref === undefined || ref === null) return ref;
    let variantId: string;
    if (ref.id !== undefined) {
      variantId = ref.id;
      if (!existingVariants.has(variantId)) {
        throw new BadRequestException(
          `Variant ${variantId} does not belong to product ${productId}.`,
        );
      }
    } else {
      const resolved = variantClientIds.get(ref.clientKey);
      if (!resolved) {
        throw new BadRequestException(
          `Unknown variant client key ${ref.clientKey}.`,
        );
      }
      variantId = resolved;
    }
    if (!desiredVariantIds.has(variantId) && deletedVariantIds.has(variantId)) {
      throw new BadRequestException(
        `Default display variant ${variantId} is retired.`,
      );
    }
    return variantId;
  }

  private async assertMaterializationOptionValueIdentities(
    productId: string,
    patch: CatalogGraphPatch,
    requiresLegacyMaterialization: boolean,
    existingOptions: ReadonlyMap<string, unknown>,
    existingValues: ReadonlyMap<string, unknown>,
  ): Promise<void> {
    if (!requiresLegacyMaterialization) return;

    const optionIds = new Set<string>();
    const valueIds = new Set<string>();
    for (const option of patch.options) {
      if (option.id !== undefined && !existingOptions.has(option.id)) {
        optionIds.add(option.id);
      }
      for (const value of option.values) {
        if (value.id !== undefined && !existingValues.has(value.id)) {
          valueIds.add(value.id);
        }
      }
    }
    for (const optionId of patch.retirements.optionIds) {
      if (!existingOptions.has(optionId)) optionIds.add(optionId);
    }
    for (const valueId of patch.retirements.optionValueIds) {
      if (!existingValues.has(valueId)) valueIds.add(valueId);
    }
    for (const variant of patch.variants) {
      for (const ref of variant.optionValueRefs) {
        if (ref.id !== undefined && !existingValues.has(ref.id)) {
          valueIds.add(ref.id);
        }
      }
    }
    for (const media of patch.media) {
      if (
        media.optionValueId !== undefined &&
        !existingValues.has(media.optionValueId)
      ) {
        valueIds.add(media.optionValueId);
      }
    }

    if (optionIds.size === 0 && valueIds.size === 0) return;

    const [persistedOptions, persistedValues] = await Promise.all([
      optionIds.size === 0
        ? []
        : this.prisma.productOption.findMany({
            where: { id: { in: [...optionIds] } },
            select: { id: true, productId: true },
          }),
      valueIds.size === 0
        ? []
        : this.prisma.productOptionValue.findMany({
            where: { id: { in: [...valueIds] } },
            select: { id: true, productId: true },
          }),
    ]);

    const foreignOption = persistedOptions.find(
      ({ productId: ownerId }) => ownerId !== productId,
    );
    if (foreignOption) {
      throw new BadRequestException(
        `option ${foreignOption.id} does not belong to this product.`,
      );
    }
    const foreignValue = persistedValues.find(
      ({ productId: ownerId }) => ownerId !== productId,
    );
    if (foreignValue) {
      throw new BadRequestException(
        `option value ${foreignValue.id} does not belong to this product.`,
      );
    }

    const persistedOptionIds = new Set(persistedOptions.map(({ id }) => id));
    const persistedValueIds = new Set(persistedValues.map(({ id }) => id));
    if (
      [...optionIds].some((id) => !persistedOptionIds.has(id)) ||
      [...valueIds].some((id) => !persistedValueIds.has(id))
    ) {
      throw new CatalogGraphMaterializationRequiredError();
    }
  }

  private resolveChangedRowId<T extends { id: string }>(
    ref: EntityRef,
    existing: Map<string, T>,
    clientIds: Map<string, string>,
    label: string,
  ): string {
    if (ref.id !== undefined) {
      if (!existing.has(ref.id)) {
        throw new BadRequestException(
          `${label} ${ref.id} does not belong to this product.`,
        );
      }
      return ref.id;
    }
    const id = randomUUID();
    clientIds.set(ref.clientKey, id);
    return id;
  }

  private resolveRef<T extends { id: string }>(
    ref: EntityRef,
    existing: Map<string, T>,
    clientIds: Map<string, string>,
    label: string,
  ): string {
    if (ref.id !== undefined) {
      if (!existing.has(ref.id)) {
        throw new BadRequestException(
          `${label} ${ref.id} does not belong to this product.`,
        );
      }
      return ref.id;
    }
    const id = clientIds.get(ref.clientKey);
    if (!id)
      throw new BadRequestException(
        `Unknown ${label} client key ${ref.clientKey}.`,
      );
    return id;
  }

  private assertOwnedRetirements(
    patch: CatalogGraphPatch,
    options: Map<string, { id: string }>,
    values: Map<string, { id: string }>,
    variants: Map<string, { id: string }>,
    media: Map<string, { id: string }>,
  ): void {
    const checks: Array<[string[], Map<string, { id: string }>, string]> = [
      [patch.retirements.optionIds, options, 'Option'],
      [patch.retirements.optionValueIds, values, 'Option value'],
      [patch.retirements.variantIds, variants, 'Variant'],
      [patch.retirements.mediaIds, media, 'Media'],
    ];
    for (const [ids, rows, label] of checks) {
      for (const id of ids) {
        if (!rows.has(id)) {
          throw new BadRequestException(
            `${label} ${id} does not belong to this product.`,
          );
        }
      }
    }
  }

  private variantHasReferences(variant: SnapshotVariant): boolean {
    return (
      (variant.sku !== null && this.skuHasReferences(variant.sku)) ||
      variant._count.images > 0 ||
      variant._count.defaultForProducts > 0
    );
  }

  private skuHasReferences(sku: SnapshotSku): boolean {
    return Object.values(sku._count).some((count) => count > 0);
  }

  private skuWriteFromSnapshot(sku: SnapshotSku): SkuWrite {
    return {
      skuCode: sku.skuCode,
      status: sku.status,
      supplierId: sku.supplierId,
      supplierSku: sku.supplierSku,
      supplierCost: sku.supplierCost === null ? null : Number(sku.supplierCost),
      costCurrency: sku.costCurrency,
      landedCost: sku.landedCost === null ? null : Number(sku.landedCost),
      price: sku.price === null ? null : Number(sku.price),
      compareAtPrice:
        sku.compareAtPrice === null ? null : Number(sku.compareAtPrice),
      productWeight: sku.productWeight,
      packageWidth: sku.packageWidth,
      packageHeight: sku.packageHeight,
      packageDepth: sku.packageDepth,
      packageWeight: sku.packageWeight,
      volumetricWeight: sku.volumetricWeight,
    };
  }

  private withoutUndefined<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
      Object.entries(value).filter(([, field]) => field !== undefined),
    ) as T;
  }
}
