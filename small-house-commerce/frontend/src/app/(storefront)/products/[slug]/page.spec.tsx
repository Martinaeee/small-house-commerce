import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/api";
import ProductDetailPage, { generateMetadata } from "./page";

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
const seoProduct = {
  ...product("seo-product"),
  name: "Storefront product name",
  description: "Storefront description fallback.",
  seoTitle: "Independent SEO title",
  metaDescription: "Independent meta description.",
  images: [],
};
const fallbackProduct = {
  ...product("fallback-product"),
  name: "Fallback product name",
  description: "Fallback product description.",
  images: [],
};
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
      if (url.includes("/storefront/products/seo-product")) {
        return response(seoProduct);
      }
      if (url.includes("/storefront/products/fallback-product")) {
        return response(fallbackProduct);
      }
      if (url.includes("/storefront/products/current")) {
        return response(current);
      }
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

describe("ProductDetailPage metadata", () => {
  it("uses independent SEO fields while keeping the canonical queryless", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "seo-product" }),
    });

    expect(metadata).toMatchObject({
      title: "Independent SEO title",
      description: "Independent meta description.",
      alternates: { canonical: "/products/seo-product" },
      openGraph: {
        title: "Independent SEO title",
        description: "Independent meta description.",
        url: "/products/seo-product",
      },
      twitter: {
        title: "Independent SEO title",
        description: "Independent meta description.",
      },
    });
  });

  it("preserves the existing name and description fallback", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "fallback-product" }),
    });

    expect(metadata).toMatchObject({
      title: "Fallback product name",
      description: "Fallback product description.",
      alternates: { canonical: "/products/fallback-product" },
    });
  });
});

describe("ProductDetailPage related products", () => {
  it("passes the first four genuinely buyable non-current category products", async () => {
    const view = (await ProductDetailPage({
      params: Promise.resolve({ slug: "current" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ related: Product[] }>;

    expect(view.props.related.map(({ id }) => id)).toEqual(["a", "b", "c", "d"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/storefront/products?categoryId=category-1&page=2&pageSize=9",
      ),
      expect.any(Object),
    );
  });
});
