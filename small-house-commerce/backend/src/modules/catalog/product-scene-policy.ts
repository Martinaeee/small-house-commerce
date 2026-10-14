import { BadRequestException } from '@nestjs/common';

export interface SceneMediaRow {
  id?: string;
  productId: string;
  optionValueId: string | null;
  variantId: string | null;
  url: string;
  type: 'IMAGE' | 'VIDEO';
  isScene?: boolean;
}

export interface LegacySceneImageWrite {
  url: string;
  type: 'IMAGE' | 'VIDEO';
  altText?: string;
  sortOrder: number;
  isScene?: boolean;
}

export function resolveSceneFlag(
  previous: SceneMediaRow | undefined,
  next: SceneMediaRow,
): boolean {
  if (next.isScene && next.type !== 'IMAGE') {
    throw new BadRequestException('Scene media must be an image.');
  }
  if (next.isScene !== undefined) return next.isScene;
  if (
    next.type !== 'IMAGE' || previous?.type !== 'IMAGE' ||
    previous.productId !== next.productId ||
    previous.optionValueId !== next.optionValueId ||
    previous.variantId !== next.variantId
  ) return false;
  return previous.isScene ?? false;
}

export function assertSceneMedia(rows: readonly SceneMediaRow[]): void {
  const scopes = new Set<string>();
  for (const row of rows) {
    if (!row.isScene) continue;
    if (row.type !== 'IMAGE') {
      throw new BadRequestException('Scene media must be an image.');
    }
    const scope = JSON.stringify([row.productId, row.optionValueId, row.variantId]);
    if (scopes.has(scope)) {
      const label = row.variantId
        ? `variant ${row.variantId}`
        : row.optionValueId ? `option value ${row.optionValueId}` : 'shared gallery';
      throw new BadRequestException(`Only one scene image is allowed in the ${label} of product ${row.productId}.`);
    }
    scopes.add(scope);
  }
}

export function prepareLegacySceneImages(
  existing: readonly SceneMediaRow[],
  incoming: readonly LegacySceneImageWrite[],
): Array<LegacySceneImageWrite & { isScene: boolean }> {
  const storedByKey = new Map<string, SceneMediaRow[]>();
  const incomingCounts = new Map<string, number>();
  const keyFor = (row: { url: string; type: string }) => JSON.stringify([row.url, row.type]);
  for (const row of existing) {
    const key = keyFor(row);
    const matches = storedByKey.get(key) ?? [];
    matches.push(row);
    storedByKey.set(key, matches);
  }
  for (const row of incoming) {
    const key = keyFor(row);
    incomingCounts.set(key, (incomingCounts.get(key) ?? 0) + 1);
  }
  const resolved = incoming.map(row => {
    const key = keyFor(row);
    const matches = storedByKey.get(key) ?? [];
    if (
      row.isScene === undefined && matches.some(match => match.isScene) &&
      (matches.length !== 1 || incomingCounts.get(key) !== 1)
    ) {
      throw new BadRequestException('Cannot uniquely preserve scene metadata for ambiguous duplicate media URLs; provide explicit scene flags.');
    }
    return {
      ...row,
      isScene: row.isScene ?? (matches.some(match => match.isScene) && row.type === 'IMAGE'),
    };
  });
  assertSceneMedia(resolved.map(row => ({
    ...row, productId: 'legacy', optionValueId: null, variantId: null,
  })));
  return resolved;
}
