import type { AdminCategoryNode, AdminCollectionRow, AdminProduct } from "./admin-api";

export type UnifiedGroupKind =
  | "CATEGORY"
  | "NAVIGATION"
  | "MARKETING"
  | "SCENARIO"
  | "SYSTEM";

export interface UnifiedGroupCounts {
  /** Primary-group products exactly on this node (all statuses). */
  direct: number;
  /** Explicit members attached to this node. */
  memberCount: number;
  /** Deduplicated primary subtree ∪ explicit members (all statuses). */
  subtree: number;
  /** Products in the subtree union that are ACTIVE (storefront-visible). */
  active: number;
}

export interface UnifiedGroupRow {
  id: string;
  name: string;
  slug: string;
  kind: UnifiedGroupKind;
  status: "ACTIVE" | "DISABLED";
  sortOrder: number;
  parentId: string | null;
  depth: number;
  children: UnifiedGroupRow[];
  counts: UnifiedGroupCounts;
  /** The collection row merged into this category, when one exists. */
  collectionId: string | null;
}

export interface UnifiedGroupInput {
  categories: AdminCategoryNode[];
  collections: AdminCollectionRow[];
  products: Pick<AdminProduct, "id" | "status" | "categoryId">[];
  memberIdsBySlug: Record<string, string[]>;
}

function bySortOrder<T extends { sortOrder: number; name: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

interface CategoryTotals {
  primaryIds: Set<string>;
  memberIds: Set<string>;
}

export function buildUnifiedGroups(input: UnifiedGroupInput): UnifiedGroupRow[] {
  const { categories, collections, products, memberIdsBySlug } = input;
  const collectionsBySlug = new Map(collections.map((row) => [row.slug, row]));
  const statusById = new Map(products.map((product) => [product.id, product.status]));

  const categorySlugs = new Set<string>();
  const collectSlugs = (nodes: AdminCategoryNode[]): void => {
    for (const node of nodes) {
      categorySlugs.add(node.slug);
      collectSlugs(node.children);
    }
  };
  collectSlugs(categories);

  const totals = (node: AdminCategoryNode): CategoryTotals => {
    const primaryIds = new Set(
      products.filter((product) => product.categoryId === node.id).map((product) => product.id),
    );
    const memberIds = new Set(memberIdsBySlug[node.slug] ?? []);
    for (const child of node.children) {
      const childTotals = totals(child);
      for (const id of childTotals.primaryIds) primaryIds.add(id);
      for (const id of childTotals.memberIds) memberIds.add(id);
    }
    return { primaryIds, memberIds };
  };

  const buildCategoryRow = (node: AdminCategoryNode, depth: number): UnifiedGroupRow => {
    const matched = collectionsBySlug.get(node.slug) ?? null;
    const subtree = totals(node);
    const union = new Set([...subtree.primaryIds, ...subtree.memberIds]);
    let active = 0;
    for (const id of union) {
      if (statusById.get(id) === "ACTIVE") active += 1;
    }
    return {
      id: node.id,
      name: node.name,
      slug: node.slug,
      kind: "CATEGORY",
      status: node.status,
      sortOrder: matched?.sortOrder ?? node.sortOrder,
      parentId: node.parentId,
      depth,
      counts: {
        direct: products.filter((product) => product.categoryId === node.id).length,
        memberCount: (memberIdsBySlug[node.slug] ?? []).length,
        subtree: union.size,
        active,
      },
      collectionId: matched?.id ?? null,
      children: bySortOrder(node.children).map((child) =>
        buildCategoryRow(child, depth + 1),
      ),
    };
  };

  const categoryRows = bySortOrder(categories).map((node) => buildCategoryRow(node, 0));

  const marketingRows: UnifiedGroupRow[] = bySortOrder(
    collections.filter((row) => !categorySlugs.has(row.slug)),
  ).map((row) => {
    const memberIds = memberIdsBySlug[row.slug] ?? [];
    const active = memberIds.filter((id) => statusById.get(id) === "ACTIVE").length;
    const total = row._count.products;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      kind: row.type,
      status: row.status,
      sortOrder: row.sortOrder,
      parentId: null,
      depth: 0,
      children: [],
      counts: {
        direct: total,
        memberCount: total,
        subtree: total,
        active,
      },
      collectionId: row.id,
    };
  });

  return [...categoryRows, ...marketingRows];
}

export function flattenUnifiedGroups(
  rows: UnifiedGroupRow[],
  expanded: ReadonlySet<string>,
): UnifiedGroupRow[] {
  const out: UnifiedGroupRow[] = [];
  const visit = (row: UnifiedGroupRow): void => {
    out.push(row);
    if (expanded.has(row.id)) {
      for (const child of row.children) visit(child);
    }
  };
  for (const row of rows) visit(row);
  return out;
}

export const GROUP_KIND_LABELS: Record<UnifiedGroupKind, string> = {
  CATEGORY: "商品分类",
  NAVIGATION: "导航集合",
  MARKETING: "营销集合",
  SCENARIO: "场景集合",
  SYSTEM: "系统集合",
};
