import type { ProductMediaSet } from "./api";
import {
  clearProductMediaCacheForTests,
  loadProductMedia,
  productMediaCacheKey,
  type ProductMediaScope,
} from "./product-media";

const product = {
  id: "product-1",
  slug: "chair / special",
  catalogGraphVersion: 7,
};

const redSet: ProductMediaSet = {
  resolvedScope: "VARIANT",
  scopeId: "red/large",
  media: [
    {
      id: "red-1",
      url: "/red-1.jpg",
      type: "IMAGE",
      altText: "Red chair",
      sortOrder: 0,
    },
  ],
  catalogGraphVersion: 7,
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  clearProductMediaCacheForTests();
});

describe("scoped product media cache", () => {
  it("keys entries by product, graph version, and requested scope", () => {
    expect(
      productMediaCacheKey(product.id, 7, { variantId: "same" }),
    ).not.toBe(productMediaCacheKey("product-2", 7, { variantId: "same" }));
    expect(
      productMediaCacheKey(product.id, 7, { variantId: "same" }),
    ).not.toBe(productMediaCacheKey(product.id, 8, { variantId: "same" }));
    expect(
      productMediaCacheKey(product.id, 7, { variantId: "same" }),
    ).not.toBe(
      productMediaCacheKey(product.id, 7, { optionValueId: "same" }),
    );
  });

  it.each<[ProductMediaScope, string]>([
    [
      { variantId: "red/large" },
      "/api/v1/storefront/products/chair%20%2F%20special/media?variantId=red%2Flarge",
    ],
    [
      { optionValueId: "red & white" },
      "/api/v1/storefront/products/chair%20%2F%20special/media?optionValueId=red+%26+white",
    ],
  ])("requests exactly one encoded scope", async (scope, expectedUrl) => {
    const fetcher = vi.fn(async () => jsonResponse(redSet));

    await loadProductMedia(product, scope, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(expectedUrl, {
      headers: { Accept: "application/json" },
    });
  });

  it("deduplicates in-flight requests and reuses the resolved cache", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const scope = { variantId: "red/large" } as const;

    const first = loadProductMedia(product, scope, fetcher);
    const second = loadProductMedia(product, scope, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();

    resolveFetch(jsonResponse(redSet));
    await expect(Promise.all([first, second])).resolves.toEqual([redSet, redSet]);

    await expect(loadProductMedia(product, scope, fetcher)).resolves.toEqual(
      redSet,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not reuse a scope after the catalog graph version changes", async () => {
    const fetcher = vi.fn(async () => jsonResponse(redSet));
    const scope = { variantId: "red/large" } as const;

    await loadProductMedia(product, scope, fetcher);
    await loadProductMedia(
      { ...product, catalogGraphVersion: 8 },
      scope,
      vi.fn(async () =>
        jsonResponse({ ...redSet, catalogGraphVersion: 8 }),
      ),
    );

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects stale graph responses and permits a same-scope retry", async () => {
    const fetcher = vi
      .fn<(_: RequestInfo | URL, __?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({ ...redSet, catalogGraphVersion: 6 }),
      )
      .mockResolvedValueOnce(jsonResponse(redSet));
    const scope = { variantId: "red/large" } as const;

    await expect(loadProductMedia(product, scope, fetcher)).rejects.toThrow(
      "catalog graph changed",
    );
    await expect(loadProductMedia(product, scope, fetcher)).resolves.toEqual(
      redSet,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache HTTP failures", async () => {
    const fetcher = vi
      .fn<(_: RequestInfo | URL, __?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ message: "nope" }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(redSet));
    const scope = { variantId: "red/large" } as const;

    await expect(loadProductMedia(product, scope, fetcher)).rejects.toThrow(
      "Request failed: 500",
    );
    await expect(loadProductMedia(product, scope, fetcher)).resolves.toEqual(
      redSet,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
