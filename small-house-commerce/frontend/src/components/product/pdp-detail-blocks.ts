export interface DetailBlockLike {
  type: "IMAGE" | "VIDEO";
  url: string;
  altText?: string | null;
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
