import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CartProvider } from "@/components/cart/CartContext";
import { cardTestProduct } from "@/test/product-card-fixtures";
import { TrackRecommendations } from "./TrackRecommendations";

/**
 * The product row under the order-tracking page: a handful of products the
 * shopper may want after checking (or before checking) their order.
 */

function renderRecommendations(products: Parameters<typeof TrackRecommendations>[0]["products"]) {
  return render(
    <CartProvider>
      <TrackRecommendations products={products} />
    </CartProvider>,
  );
}

describe("TrackRecommendations", () => {
  it("offers the products it is given", () => {
    renderRecommendations([cardTestProduct()]);

    const section = screen.getByTestId("track-recommendations");
    expect(section).toHaveTextContent("Oak Side Table");
    // The card links to the product page.
    expect(
      section.querySelector('a[href="/products/oak-side-table"]'),
    ).not.toBeNull();
  });

  it("shows no section when there is nothing to offer", () => {
    renderRecommendations([]);

    expect(screen.queryByTestId("track-recommendations")).toBeNull();
  });
});
