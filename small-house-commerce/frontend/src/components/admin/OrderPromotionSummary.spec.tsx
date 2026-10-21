import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrderPromotionSummary } from "./OrderPromotionSummary";

describe("OrderPromotionSummary", () => {
  it("shows the applied promo code as literal text", () => {
    render(<OrderPromotionSummary promoCode={'<SAVE10>'} />);

    expect(screen.getByText("Promo code")).toBeInTheDocument();
    expect(screen.getByText("<SAVE10>")).toBeInTheDocument();
    expect(document.querySelector("save10")).toBeNull();
  });

  it("renders nothing when the order has no promo code", () => {
    const { container } = render(<OrderPromotionSummary promoCode={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
