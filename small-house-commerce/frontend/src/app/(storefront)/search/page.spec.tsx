import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Paged, Product } from "@/lib/api";
import SearchPage from "./page";

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/storefront/products?")) {
        return response({ items: [], total: 0, page: 1, pageSize: 24 } satisfies Paged<Product>);
      }
      if (url.includes("/storefront/categories")) {
        return response([] satisfies Category[]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SearchPage filter panel", () => {
  it("shows results without the room/solution/price filter chips", async () => {
    render(await SearchPage({ searchParams: Promise.resolve({ q: "chair" }) }));

    expect(screen.getByRole("heading", { name: /Search results for/ })).toBeInTheDocument();
    expect(screen.queryByText("Narrow Space")).toBeNull();
    expect(screen.queryByText("Rental Friendly")).toBeNull();
    expect(screen.queryByText("Under ₱1,000")).toBeNull();
    expect(screen.queryByText("Room")).toBeNull();
    expect(screen.queryByText("Solution")).toBeNull();
    expect(screen.queryByText("Price")).toBeNull();
  });
});
