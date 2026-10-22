import { describe, expect, it } from "vitest";
import { cardTestProduct } from "@/test/product-card-fixtures";
import {
  selectTrackRecommendations,
  TRACK_RECOMMENDATION_LIMIT,
} from "./track-order-products";

/**
 * The product row under the order-tracking page. It offers the store's own
 * published products - a product that cannot be bought right now is left out.
 */

describe("selectTrackRecommendations", () => {
  it("keeps the products that can still be bought", () => {
    const buyable = cardTestProduct();

    expect(selectTrackRecommendations([buyable])).toHaveLength(1);
  });

  it("leaves out a product whose stock is gone", () => {
    const soldOut = cardTestProduct({
      variants: [
        {
          id: "red-variant",
          name: "Red",
          position: 0,
          combinationKey: "color:red",
          optionValueIds: ["red"],
          sku: {
            id: "red-sku",
            skuCode: "RED",
            status: "ACTIVE",
            price: 100,
            compareAtPrice: null,
            availableInventory: 0,
          },
        },
      ],
    });

    expect(selectTrackRecommendations([soldOut])).toHaveLength(0);
  });

  it("keeps at most the limit", () => {
    const products = Array.from({ length: 6 }, (_, index) =>
      cardTestProduct({ id: `product-${index}` }),
    );

    expect(selectTrackRecommendations(products)).toHaveLength(
      TRACK_RECOMMENDATION_LIMIT,
    );
  });
});
