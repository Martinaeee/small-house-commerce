import { describe, expect, it } from "vitest";
import { deserializeProduct } from "@/app/admin/(shell)/products/[id]/edit/page";
import { appendImage, serializeFormValue, type ProductFormValue } from "@/components/admin/ProductForm";
import type { AdminProduct } from "@/lib/admin-api";

/**
 * Regression cover for gallery ordering.
 *
 * `sortOrder` is what the admin grid reads to decide which card is the cover
 * (lowest sortOrder wins), and what the PDP gallery sorts by. Two ways it
 * drifted:
 *  - a newly added card was created with a blank sortOrder, which serializes
 *    to 0 — so every added image claimed the cover slot;
 *  - rows already stored with equal sortOrder (production had 0,0,0,0) all
 *    rendered the 封面 badge and ordered arbitrarily.
 */

function productWithImages(orders: number[]): AdminProduct {
  return {
    id: "p1",
    name: "Chair",
    slug: "chair",
    description: null,
    tagline: null,
    categoryId: "c1",
    status: "ACTIVE",
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    materials: null,
    features: null,
    detailBlocks: [],
    variants: [],
    images: orders.map((sortOrder, index) => ({
      id: `img${index}`,
      url: `https://example.test/${index}.jpg`,
      type: "IMAGE" as const,
      altText: null,
      sortOrder,
    })),
  } as unknown as AdminProduct;
}

describe("deserializeProduct — image ordering", () => {
  it("keeps a well-ordered gallery as-is", () => {
    const value = deserializeProduct(productWithImages([0, 1, 2]));

    expect(value.images.map((image) => image.sortOrder)).toEqual(["0", "1", "2"]);
  });

  it("renumbers a gallery whose rows share a sortOrder", () => {
    // The backend returns images ordered by sortOrder asc, so the list order
    // is the truth; the stored numbers are what needs repairing.
    const value = deserializeProduct(productWithImages([0, 0, 0, 0]));

    expect(value.images.map((image) => image.sortOrder)).toEqual(["0", "1", "2", "3"]);
  });
});

describe("appendImage", () => {
  it("gives the new card the next sortOrder so it never steals the cover", () => {
    const value = deserializeProduct(productWithImages([0, 1, 2]));

    const next = appendImage(value.images, "IMAGE");

    expect(next.map((image) => image.sortOrder)).toEqual(["0", "1", "2", "3"]);
  });

  it("leaves an untouched new card droppable, so it cannot block the save", () => {
    // The serializer skips a row whose url, altText AND sortOrder are all
    // blank — that is what lets an operator click "Add photo" and then save
    // without filling it in. Numbering the new card broke that skip: the
    // sortOrder alone made the row "non-blank", so the save was rejected with
    // "Image URL is required." for a card the operator never intended to keep.
    const value = deserializeProduct(productWithImages([0, 1, 2]));
    const withNew = appendImage(value.images, "IMAGE");
    expect(withNew[withNew.length - 1].sortOrder).not.toBe("");

    const result = serializeFormValue({
      ...value,
      name: "Chair",
      slug: "chair",
      categoryId: "01a09021-fef4-72ed-b62c-4081b27a6abf",
      images: withNew,
    } as ProductFormValue);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.images).toHaveLength(3);
    expect(result.value.images.map((image) => image.sortOrder)).toEqual([0, 1, 2]);
  });

  it("serializes to distinct sort orders that survive the save payload", () => {
    const value = deserializeProduct(productWithImages([0, 0]));
    const withNew = appendImage(appendImage(value.images, "IMAGE"), "VIDEO").map(
      (image, index) => ({
        ...image,
        url: image.url || `https://example.test/added-${index}.jpg`,
      }),
    );

    const result = serializeFormValue({
      ...value,
      name: "Chair",
      slug: "chair",
      categoryId: "01a09021-fef4-72ed-b62c-4081b27a6abf",
      images: withNew,
    } as ProductFormValue);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const orders = result.value.images.map((image) => image.sortOrder);
    expect(orders).toEqual([0, 1, 2, 3]);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
