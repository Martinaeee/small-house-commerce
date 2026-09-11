import type { Category, Collection } from "@/lib/api";

/**
 * Header navigation model (spec 2026-09-11-navigation-mega-menu-design §4.2).
 * Tree roots open the mega menu / drawer accordion; flat links render plain.
 */

export interface NavLink {
  kind: "link";
  label: string;
  href: string;
  position: number;
}

export interface NavTree {
  kind: "tree";
  root: Category;
  position: number;
}

export type NavItem = NavLink | NavTree;

/** Flat links render only when their backing collection actually exists. */
const FLAT_LINKS = [
  {
    label: "New Arrivals",
    collectionSlug: "new-arrivals",
    href: "/collections/new-arrivals",
    position: 0,
  },
  {
    label: "Solutions",
    collectionSlug: "small-space-solutions",
    href: "/collections/small-space-solutions",
    position: 50,
  },
  {
    label: "Best Sellers",
    collectionSlug: "best-sellers",
    href: "/collections/best-sellers",
    position: 60,
  },
] as const;

export function buildNav(roots: Category[], collections: Collection[]): NavItem[] {
  const available = new Set(collections.map((c) => c.slug));
  const items: NavItem[] = FLAT_LINKS.filter((f) => available.has(f.collectionSlug)).map(
    (f) => ({ kind: "link", label: f.label, href: f.href, position: f.position }),
  );
  roots.forEach((root, i) => {
    items.push({ kind: "tree", root, position: (i + 1) * 10 });
  });
  return items.sort((a, b) => a.position - b.position);
}

/** Finds a category (root or leaf) by slug anywhere in the tree. */
export function findCategory(roots: Category[], slug: string): Category | null {
  for (const root of roots) {
    if (root.slug === slug) return root;
    const leaf = root.children.find((c) => c.slug === slug);
    if (leaf) return leaf;
  }
  return null;
}
