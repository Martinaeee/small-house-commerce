import { describe, expect, it } from "vitest";
import type { Category, Collection } from "./api";
import { buildNav } from "./nav";
import type { PublicStorefrontShell } from "./storefront-shell-api";

const leaf: Category = {
  id: "leaf-1",
  name: "Sofas",
  slug: "sofas",
  imageUrl: "/sofas.jpg",
  children: [],
};

const living: Category = {
  id: "root-living",
  name: "Living Room",
  slug: "living-room",
  imageUrl: "/living.jpg",
  children: [leaf],
};

const bedroom: Category = {
  id: "root-bedroom",
  name: "Bedroom",
  slug: "bedroom",
  imageUrl: null,
  children: [],
};

const collections: Collection[] = [
  {
    id: "collection-new",
    name: "New Arrivals",
    slug: "new-arrivals",
    type: "NAVIGATION",
    description: null,
    heroImage: null,
    sortOrder: 0,
  },
  {
    id: "collection-best",
    name: "Best Sellers",
    slug: "best-sellers",
    type: "NAVIGATION",
    description: null,
    heroImage: null,
    sortOrder: 1,
  },
];

type HeaderItem = PublicStorefrontShell["header"]["items"][number];

describe("buildNav configured shell navigation", () => {
  it("uses configured order and a category label override without mutating live data", () => {
    const configured: HeaderItem[] = [
      {
        id: "best",
        kind: "LINK",
        label: "Most loved",
        href: "/collections/best-sellers",
      },
      {
        id: "living",
        kind: "CATEGORY_ROOT",
        categoryId: living.id,
        label: "Lounge",
      },
      {
        id: "new",
        kind: "LINK",
        label: "Just in",
        href: "/collections/new-arrivals",
      },
    ];

    const result = buildNav([living, bedroom], collections, configured);

    expect(result.map((item) => item.kind === "tree" ? item.label : item.label)).toEqual([
      "Most loved",
      "Lounge",
      "Just in",
    ]);
    expect(result[1]).toMatchObject({
      kind: "tree",
      root: living,
      label: "Lounge",
      position: 1,
    });
    expect(result[1]?.kind === "tree" && result[1].root.children[0]).toBe(leaf);
    expect(living.name).toBe("Living Room");
  });

  it("omits a missing category target without dropping configured neighbors", () => {
    const configured: HeaderItem[] = [
      { id: "before", kind: "LINK", label: "Before", href: "/before" },
      {
        id: "missing",
        kind: "CATEGORY_ROOT",
        categoryId: "missing-root",
        label: "Missing",
      },
      { id: "after", kind: "LINK", label: "After", href: "/after" },
    ];

    expect(buildNav([living], collections, configured)).toEqual([
      { kind: "link", label: "Before", href: "/before", position: 0 },
      { kind: "link", label: "After", href: "/after", position: 2 },
    ]);
  });
});

describe("buildNav legacy fallback", () => {
  it("preserves the legacy flat-link and category ordering when config is null", () => {
    expect(buildNav([living, bedroom], collections, null)).toEqual([
      {
        kind: "link",
        label: "New Arrivals",
        href: "/collections/new-arrivals",
        position: 0,
      },
      { kind: "tree", root: living, label: "Living Room", position: 10 },
      { kind: "tree", root: bedroom, label: "Bedroom", position: 20 },
      {
        kind: "link",
        label: "Best Sellers",
        href: "/collections/best-sellers",
        position: 60,
      },
    ]);
  });

  it("keeps the two-argument call as the same legacy fallback", () => {
    expect(buildNav([living], collections)).toEqual(
      buildNav([living], collections, null),
    );
  });
});
