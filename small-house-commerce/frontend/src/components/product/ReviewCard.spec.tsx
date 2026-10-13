import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Review } from "@/lib/api";
import { ReviewCard } from "./ReviewCard";

const review: Review = {
  id: "review-timezone",
  authorName: "Shopper",
  location: null,
  rating: 5,
  title: null,
  comment: "Useful in a small space.",
  photos: [],
  createdAt: "2026-10-04T16:30:00.000Z",
  variant: null,
  helpfulCount: 0,
  verifiedPurchase: false,
};

describe("ReviewCard date", () => {
  it("renders the review calendar date in Asia/Manila on a UTC server", () => {
    render(<ReviewCard review={review} />);

    expect(
      screen.getByText("Reviewed on October 5, 2026"),
    ).toBeInTheDocument();
  });
});
