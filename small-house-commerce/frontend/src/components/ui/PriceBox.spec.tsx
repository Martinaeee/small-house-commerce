import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceBox } from "./PriceBox";

describe("PriceBox PDP presentation", () => {
  it("keeps the real price, compare-at, percentage and saving in one wrapping price group", () => {
    render(<PriceBox price={2599} compareAtPrice={2999} size="lg" showSavings />);
    const price = screen.getByTestId("price");
    const group = price.parentElement!;
    expect(price).toHaveClass("text-2xl", "whitespace-nowrap");
    expect(group).toHaveClass("flex-wrap");
    expect(group).toContainElement(screen.getByText("₱2,999.00"));
    expect(group).toContainElement(screen.getByText("13% OFF"));
    expect(group).toContainElement(screen.getByText("Save ₱400.00"));
  });

  it("recalculates every discount value when the selected SKU price changes", () => {
    const { rerender } = render(<PriceBox price={2599} compareAtPrice={2999} size="lg" showSavings />);
    rerender(<PriceBox price={2199} compareAtPrice={2999} size="lg" showSavings />);
    expect(screen.getByTestId("price")).toHaveTextContent("₱2,199.00");
    expect(screen.getByText("27% OFF")).toBeVisible();
    expect(screen.getByText("Save ₱800.00")).toBeVisible();
    expect(screen.queryByText("Save ₱400.00")).toBeNull();
  });

  it.each([null, undefined, 100, 80])("never invents a discount for compareAtPrice=%s", compareAtPrice => {
    render(<PriceBox price={100} compareAtPrice={compareAtPrice} size="lg" showSavings />);
    expect(screen.getByTestId("price")).toHaveTextContent("₱100.00");
    expect(screen.queryByText(/OFF|Save/)).toBeNull();
    expect(document.querySelector(".line-through")).toBeNull();
  });

  it("keeps zero-price savings truthful and hides the entire group when price is unresolved", () => {
    const { rerender, container } = render(<PriceBox price={0} compareAtPrice={100} size="lg" showSavings />);
    expect(screen.getByText("100% OFF")).toBeVisible();
    expect(screen.getByText("Save ₱100.00")).toBeVisible();
    rerender(<PriceBox price={null} compareAtPrice={100} size="lg" showSavings />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leaves the shared default size and sticky mobile discount rule unchanged", () => {
    render(<PriceBox price={100} compareAtPrice={200} hideDiscountBadgeOnMobile />);
    expect(screen.getByTestId("price")).toHaveClass("text-lg");
    expect(screen.getByText("50% OFF")).toHaveClass("hidden", "sm:inline");
    expect(screen.queryByText(/Save/)).toBeNull();
  });
});
