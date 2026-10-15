import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LandingPageComposite, Product } from "@/lib/api";
import LandingPageRoute from "./page";
import { LandingContentView } from "@/components/product/LandingContentView";

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
    publishedRevision: 1,
    content: {
      schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null,
      blocks: [
        { id: "hero", type: "hero", sourceKey: null, props: { title: "Campaign current", tagline: null, promoHeadline: null, promoSubtext: null } },
        { id: "buy", type: "buy", sourceKey: null, props: {} },
      ],
    },
  },
} as LandingPageComposite;
const relatedPageOne = [
  current,
  ...Array.from({ length: 8 }, (_, index) =>
    product(`oos-${index}`, { inventory: 0 }),
  ),
];
const relatedPageTwo = ["a", "b", "c", "d"].map((id) => product(id));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/storefront/lp/campaign")) return response(landing);
      if (url.includes("/storefront/categories")) return response([]);
      if (url.includes("/storefront/products?categoryId=")) {
        const pageTwo = url.includes("page=2");
        return response({
          items: pageTwo ? relatedPageTwo : relatedPageOne,
          total: relatedPageOne.length + relatedPageTwo.length,
          page: pageTwo ? 2 : 1,
          pageSize: 9,
        });
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
  it("renders published content without merging marketing fields into the live product", async () => {
    const fragment = await LandingPageRoute({ params: Promise.resolve({ slug: "campaign" }), searchParams: Promise.resolve({}) }) as ReactElement<{ children: ReactNode }>;
    const view = Children.toArray(fragment.props.children).find((child) => isValidElement(child) && child.type === LandingContentView);
    expect(view).toBeDefined();
    const props = (view as ReactElement<{ content: unknown; approvedContent: unknown; product: Product }>).props;
    expect(props.content).toEqual(landing.landingPage.content);
    expect(props.approvedContent).toEqual(landing.landingPage.content);
    expect(props.product.name).toBe("current");
    expect(props.product.variants[0].sku?.price).toBe(100);
  });

  it("uses the same buyable non-current four-item selection as the canonical PDP", async () => {
    const fragment = (await LandingPageRoute({
      params: Promise.resolve({ slug: "campaign" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactNode }>;
    const view = pdpViewFrom(fragment);

    expect(view.props.related.map(({ id }) => id)).toEqual(["a", "b", "c", "d"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/storefront/products?categoryId=category-1&page=2&pageSize=9",
      ),
      expect.any(Object),
    );
  });
});
