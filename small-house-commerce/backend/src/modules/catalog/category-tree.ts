/** Minimal category edge needed to walk the parent/child tree. */
export interface CategoryTreeEdge {
  id: string;
  parentId: string | null;
}

/**
 * Returns `[rootId, ...all descendant ids]` breadth-first.
 *
 * `rootId` is always included, so filtering a leaf (or an unknown id) behaves
 * exactly like a single-id equality filter. Callers pass the row set they want
 * considered (e.g. ACTIVE categories only for the storefront); an inactive
 * branch is simply absent from `all` and never expanded into.
 */
export function expandCategoryIds(all: CategoryTreeEdge[], rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const category of all) {
    if (!category.parentId) continue;
    const siblings = childrenByParent.get(category.parentId);
    if (siblings) {
      siblings.push(category.id);
    } else {
      childrenByParent.set(category.parentId, [category.id]);
    }
  }

  const ids = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childId of childrenByParent.get(current) ?? []) {
      ids.push(childId);
      queue.push(childId);
    }
  }
  return ids;
}
