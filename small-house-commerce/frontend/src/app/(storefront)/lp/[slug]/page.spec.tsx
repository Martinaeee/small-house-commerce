import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LandingPageComposite, Product } from "@/lib/api";
import LandingPageRoute from "./page";

vi.mock("@/lib/product-jsonld", () => ({
  absoluteUrl: (value: string) => value,
  buildProductJsonLd: () => ({}),
}));

function product(
  id: string,
  options: {
    inventory?: number;
    status?: "ACTIVE" | "DISABLED";
    price?: number | null;
  } = {},
): Product {
  return {
    id,
    name: id,
    slug: id,
    categoryId: "category-1",
    images: [],
    variants: [
      {
        id: `${id}-variant`,
        name: id,
        position: 0,
        combinationKey: `${id}:variant`,
        optionValueIds: [],
        sku: {
          id: `${id}-sku`,
          skuCode: `${id}-sku`,
          status: options.status ?? "ACTIVE",
          price: options.price === undefined ? 100 : options.price,
          compareAtPrice: null,
          availableInventory: options.inventory ?? 1,
        },
      },
    ],
  } as unknown as Product;
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const current = product("current", { inventory: 5 });
const landing = {
  product: current,
  landingPage: {
    id: "landing-1",
    slug: "campaign",
    titleOverride: "Campaign current",
    imagesOverride: null,
    seoTitle: null,
    seoDescription: null,
    promoEnabled: false,
    promoHeadline: null,
    promoSubtext: null,
  },
} as LandingPageComposite;
const relatedItems = [
  current,
  product("oos", { inventory: 0 }),
  product("a"),
  product("disabled", { status: "DISABLED", inventory: 8 }),
  product("b"),
  product("unpriced", { price: null, inventory: 8 }),
  product("c"),
  product("d"),
  product("e"),
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/storefront/lp/campaign")) return response(landing);
      if (url.includes("/storefront/categories")) return response([]);
      if (url.includes("/storefront/products?categoryId=")) {
        return response({ items: relatedItems });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pdpViewFrom(fragment: ReactElement<{ children: ReactNode }>): ReactElement<{
  related: Product[];
}> {
  const view = Children.toArray(fragment.props.children).find(
    (child) =>
      isValidElement(child) &&
      typeof child.props === "object" &&
      child.props !== null &&
      "related" in child.props,
  );
  if (!isValidElement(view)) throw new Error("PdpView was not rendered");
  return view as ReactElement<{ related: Product[] }>;
}

describe("LandingPageRoute related products", () => {
  it("uses the same buyable non-current four-item selection as the canonical PDP", async () => {
    const fragment = (await LandingPageRoute({
      params: Promise.resolve({ slug: "campaign" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactNode }>;
    const view = pdpViewFrom(fragment);

    expect(view.props.related.map(({ id }) => id)).toEqual(["a", "b", "c", "d"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/storefront/products?categoryId=category-1&pageSize=9",
      ),
      expect.any(Object),
    );
  });
});
