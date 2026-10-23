export interface DetailBlockLike {
  type: "IMAGE" | "VIDEO";
  url: string;
  altText?: string | null;
  optionValueId?: string | null;
  variantId?: string | null;
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
