export interface DetailBlockLike {
  type: "IMAGE" | "VIDEO";
  url: string;
  altText?: string | null;
  optionValueId?: string | null;
  variantId?: string | null;
  groupKey?: string | null;
}

export interface DetailScopeOption {
  id: string;
  position: number;
  isMediaDriver: boolean;
}

/**
 * Mirrors the gallery: an exact-variant set wins, then the first media-driver
 * option value, otherwise shared blocks. Rows without scope fields are shared.
 */
export function resolveDetailBlocksForSelection<T extends DetailBlockLike>(
  blocks: readonly T[],
  options: readonly DetailScopeOption[],
  selectedValueIds: Readonly<Record<string, string>>,
  resolvedVariantId: string | null,
): T[] {
  const variantScopes = new Set(
    blocks.map((block) => block.variantId).filter(Boolean),
  );
  const valueScopes = new Set(
    blocks.map((block) => block.optionValueId).filter(Boolean),
  );

  if (resolvedVariantId && variantScopes.has(resolvedVariantId)) {
    return blocks.filter((block) => block.variantId === resolvedVariantId);
  }

  for (const option of [...options].sort(
    (left, right) => left.position - right.position,
  )) {
    if (!option.isMediaDriver) continue;
    const valueId = selectedValueIds[option.id];
    if (valueId && valueScopes.has(valueId)) {
      return blocks.filter((block) => block.optionValueId === valueId);
    }
  }

  return blocks.filter((block) => !block.optionValueId && !block.variantId);
}

export interface PartitionedDetailBlocks<T extends DetailBlockLike> {
  valid: T[];
  featured: T | null;
  remaining: T[];
}

export function partitionDetailBlocks<T extends DetailBlockLike>(
  blocks: readonly T[],
): PartitionedDetailBlocks<T> {
  const valid = blocks.filter((block) => block.url.trim() !== "");
  return {
    valid,
    featured: valid[0] ?? null,
    remaining: valid.slice(1),
  };
}

export type DetailModule<T extends DetailBlockLike> =
  | { kind: "single"; block: T }
  | { kind: "carousel"; groupKey: string; blocks: T[] };

/**
 * Consecutive rows sharing a non-null group key form one swipeable module;
 * a lone keyed row stays a plain single block. Row order is preserved.
 */
export function groupDetailModules<T extends DetailBlockLike>(
  blocks: readonly T[],
): Array<DetailModule<T>> {
  const modules: Array<DetailModule<T>> = [];
  for (const block of blocks) {
    const key = block.groupKey?.trim() || null;
    const last = modules.at(-1);
    if (key && last?.kind === "carousel" && last.groupKey === key) {
      last.blocks.push(block);
      continue;
    }
    modules.push(
      key
        ? { kind: "carousel", groupKey: key, blocks: [block] }
        : { kind: "single", block },
    );
  }
  return modules;
}
