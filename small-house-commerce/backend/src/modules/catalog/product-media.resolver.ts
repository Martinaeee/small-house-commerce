import { BadRequestException } from '@nestjs/common';

export type ResolvedMediaScope = 'SHARED' | 'OPTION_VALUE' | 'VARIANT';
export type ResolvedProductMediaScope = ResolvedMediaScope;

export interface MediaScopeRequest {
  variantId?: string;
  optionValueId?: string;
}

export interface ProductMediaItem {
  id: string;
  url: string;
  type: 'IMAGE' | 'VIDEO';
  altText: string | null;
  sortOrder: number;
}

export interface ProductMediaSet {
  resolvedScope: ResolvedProductMediaScope;
  scopeId?: string;
  media: ProductMediaItem[];
  catalogGraphVersion: number;
}

export interface ProductMediaGraph {
  id: string;
  catalogGraphVersion: number;
  options: Array<{
    id: string;
    isActive: boolean;
    isMediaDriver: boolean;
    values: Array<{ id: string; isActive: boolean }>;
  }>;
  variants: Array<{
    id: string;
    optionValues: Array<{ optionId: string; optionValueId: string }>;
  }>;
  images: Array<
    ProductMediaItem & {
      optionValueId: string | null;
      variantId: string | null;
    }
  >;
}

export interface AvailableMediaScopes {
  optionValueIds: string[];
  variantIds: string[];
}

export const MEDIA_SCOPE_QUERY_ERROR =
  'Exactly one of variantId or optionValueId is required';

const OPTION_VALUE_SCOPE_ERROR =
  'Option value is not an active media-driver value for this product';
const VARIANT_SCOPE_ERROR =
  "Variant does not belong to this product's current catalog graph";
const GRAPH_VERSION_ERROR = 'Product catalog graph changed; refresh and retry';
const DEFAULT_CACHE_CAPACITY = 128;

interface ProductMediaReader {
  product: {
    findFirst(args: unknown): Promise<ProductMediaGraph | null>;
  };
}

export function requiredMediaScope(
  variantId: unknown,
  optionValueId: unknown,
): MediaScopeRequest {
  const variantIsValid = typeof variantId === 'string' && variantId.length > 0;
  const optionValueIsValid =
    typeof optionValueId === 'string' && optionValueId.length > 0;

  if (variantIsValid === optionValueIsValid) {
    throw new BadRequestException(MEDIA_SCOPE_QUERY_ERROR);
  }

  return variantIsValid
    ? { variantId }
    : { optionValueId: optionValueId as string };
}

export function optionalMediaScope(
  variantId: unknown,
  optionValueId: unknown,
): MediaScopeRequest | undefined {
  if (variantId === undefined && optionValueId === undefined) return undefined;
  return requiredMediaScope(variantId, optionValueId);
}

function compareMedia(left: ProductMediaItem, right: ProductMediaItem): number {
  return (
    left.sortOrder - right.sortOrder ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function publicMedia(rows: ProductMediaGraph['images']): ProductMediaItem[] {
  return [...rows]
    .sort(compareMedia)
    .map(({ id, url, type, altText, sortOrder }) => ({
      id,
      url,
      type,
      altText,
      sortOrder,
    }));
}

function sharedMedia(graph: ProductMediaGraph): ProductMediaSet {
  return {
    resolvedScope: 'SHARED',
    media: publicMedia(
      graph.images.filter(
        (item) => item.optionValueId === null && item.variantId === null,
      ),
    ),
    catalogGraphVersion: graph.catalogGraphVersion,
  };
}

function activeMediaDriverValues(graph: ProductMediaGraph) {
  const values = new Map<string, string>();
  for (const option of graph.options) {
    if (!option.isActive || !option.isMediaDriver) continue;
    for (const value of option.values) {
      if (value.isActive) values.set(value.id, option.id);
    }
  }
  return values;
}

function optionValueMedia(
  graph: ProductMediaGraph,
  optionValueId: string,
): ProductMediaSet | null {
  const media = publicMedia(
    graph.images.filter(
      (item) => item.optionValueId === optionValueId && item.variantId === null,
    ),
  );
  return media.length === 0
    ? null
    : {
        resolvedScope: 'OPTION_VALUE',
        scopeId: optionValueId,
        media,
        catalogGraphVersion: graph.catalogGraphVersion,
      };
}

/**
 * Pure scope resolver. It validates ownership against the supplied current
 * product graph, then selects one complete scope. Scope media is never merged.
 */
export function resolveProductMedia(
  graph: ProductMediaGraph,
  request: MediaScopeRequest,
): ProductMediaSet {
  const driverValues = activeMediaDriverValues(graph);

  if (request.optionValueId !== undefined) {
    if (!driverValues.has(request.optionValueId)) {
      throw new BadRequestException(OPTION_VALUE_SCOPE_ERROR);
    }
    return optionValueMedia(graph, request.optionValueId) ?? sharedMedia(graph);
  }

  if (request.variantId !== undefined) {
    const variant = graph.variants.find(
      (candidate) => candidate.id === request.variantId,
    );
    if (!variant) throw new BadRequestException(VARIANT_SCOPE_ERROR);

    const exactMedia = publicMedia(
      graph.images.filter(
        (item) => item.variantId === variant.id && item.optionValueId === null,
      ),
    );
    if (exactMedia.length > 0) {
      return {
        resolvedScope: 'VARIANT',
        scopeId: variant.id,
        media: exactMedia,
        catalogGraphVersion: graph.catalogGraphVersion,
      };
    }

    const driverValueId = variant.optionValues.find(
      (assignment) =>
        driverValues.get(assignment.optionValueId) === assignment.optionId,
    )?.optionValueId;
    if (driverValueId) {
      const resolved = optionValueMedia(graph, driverValueId);
      if (resolved) return resolved;
    }
  }

  return sharedMedia(graph);
}

export function availableMediaScopes(
  graph: ProductMediaGraph,
): AvailableMediaScopes {
  const driverValues = activeMediaDriverValues(graph);
  const optionValueIdsWithMedia = new Set(
    graph.images
      .filter(
        (item) =>
          item.optionValueId !== null &&
          item.variantId === null &&
          driverValues.has(item.optionValueId),
      )
      .map((item) => item.optionValueId as string),
  );
  const variantIds = new Set(graph.variants.map((variant) => variant.id));
  const variantIdsWithMedia = new Set(
    graph.images
      .filter(
        (item) =>
          item.variantId !== null &&
          item.optionValueId === null &&
          variantIds.has(item.variantId),
      )
      .map((item) => item.variantId as string),
  );

  return {
    optionValueIds: graph.options.flatMap((option) =>
      option.isActive && option.isMediaDriver
        ? option.values
            .filter(
              (value) =>
                value.isActive && optionValueIdsWithMedia.has(value.id),
            )
            .map((value) => value.id)
        : [],
    ),
    variantIds: graph.variants
      .filter((variant) => variantIdsWithMedia.has(variant.id))
      .map((variant) => variant.id),
  };
}

function cloneMediaSet(mediaSet: ProductMediaSet): ProductMediaSet {
  return {
    ...mediaSet,
    media: mediaSet.media.map((item) => ({ ...item })),
  };
}

function scopeCacheKey(
  productId: string,
  graphVersion: number,
  request: MediaScopeRequest,
): string {
  const scope = request.variantId
    ? `variant:${request.variantId}`
    : request.optionValueId
      ? `option-value:${request.optionValueId}`
      : 'shared';
  return `${productId}:${graphVersion}:${scope}`;
}

export class ProductMediaResolver {
  private readonly cache = new Map<string, ProductMediaSet>();

  constructor(
    private readonly prisma: ProductMediaReader,
    private readonly cacheCapacity = DEFAULT_CACHE_CAPACITY,
  ) {
    if (!Number.isInteger(cacheCapacity) || cacheCapacity < 1) {
      throw new Error(
        'Product media cache capacity must be a positive integer',
      );
    }
  }

  async resolveProductMedia(
    productId: string,
    graphVersion: number,
    request: MediaScopeRequest,
  ): Promise<ProductMediaSet> {
    const normalized = requiredMediaScope(
      request.variantId,
      request.optionValueId,
    );
    const key = scopeCacheKey(productId, graphVersion, normalized);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cloneMediaSet(cached);
    }

    const graph = await this.loadGraph(productId, graphVersion);
    const resolved = resolveProductMedia(graph, normalized);
    this.cacheResult(key, resolved);
    return cloneMediaSet(resolved);
  }

  async resolveInitialProductMedia(
    productId: string,
    graphVersion: number,
    request?: MediaScopeRequest,
  ): Promise<{
    initialMediaSet: ProductMediaSet;
    availableMediaScopes: AvailableMediaScopes;
  }> {
    const normalized = request
      ? requiredMediaScope(request.variantId, request.optionValueId)
      : undefined;
    const graph = await this.loadGraph(productId, graphVersion);
    const initialMediaSet = resolveProductMedia(graph, normalized ?? {});
    const key = scopeCacheKey(productId, graphVersion, normalized ?? {});
    this.cacheResult(key, initialMediaSet);
    return {
      initialMediaSet: cloneMediaSet(initialMediaSet),
      availableMediaScopes: availableMediaScopes(graph),
    };
  }

  private async loadGraph(
    productId: string,
    graphVersion: number,
  ): Promise<ProductMediaGraph> {
    const graph = await this.prisma.product.findFirst({
      where: {
        id: productId,
        status: 'ACTIVE',
        catalogGraphVersion: graphVersion,
      },
      select: {
        id: true,
        catalogGraphVersion: true,
        options: {
          select: {
            id: true,
            isActive: true,
            isMediaDriver: true,
            values: {
              select: { id: true, isActive: true },
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
            },
          },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
        },
        variants: {
          select: {
            id: true,
            optionValues: {
              select: { optionId: true, optionValueId: true },
            },
          },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
        },
        images: {
          select: {
            id: true,
            url: true,
            type: true,
            altText: true,
            sortOrder: true,
            optionValueId: true,
            variantId: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (
      !graph ||
      graph.id !== productId ||
      graph.catalogGraphVersion !== graphVersion
    ) {
      throw new BadRequestException(GRAPH_VERSION_ERROR);
    }
    return graph;
  }

  private cacheResult(key: string, value: ProductMediaSet): void {
    this.cache.delete(key);
    this.cache.set(key, cloneMediaSet(value));
    while (this.cache.size > this.cacheCapacity) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
