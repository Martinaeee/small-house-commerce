import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection, Paged, Product } from "@/lib/api";
import CollectionPage from "./page";

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const COLLECTION = {
  id: "collection-1",
  name: "All Products",
  slug: "all-products",
  type: "MANUAL",
  description: null,
  heroImage: null,
  heroStyle: null,
  sections: [],
} as unknown as Collection;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/collections/all-products/products")) {
        return response({ items: [], total: 0, page: 1, pageSize: 24 } satisfies Paged<Product>);
      }
      if (url.includes("/storefront/collections/all-products")) return response(COLLECTION);
      throw new Error(`Unexpected URL: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CollectionPage filter panel", () => {
  it("renders the collection without the room/solution/price filter chips", () => {
    return CollectionPage({
      params: Promise.resolve({ slug: "all-products" }),
      searchParams: Promise.resolve({}),
    }).then(async (tree) => {
      render(await tree);

      expect(screen.getByRole("heading", { name: /All Products Products/ })).toBeInTheDocument();
      expect(screen.queryByText("Narrow Space")).toBeNull();
      expect(screen.queryByText("Rental Friendly")).toBeNull();
      expect(screen.queryByText("Under ₱1,000")).toBeNull();
      expect(screen.queryByText("Room")).toBeNull();
      expect(screen.queryByText("Solution")).toBeNull();
      expect(screen.queryByText("Price")).toBeNull();
    });
  });
});
