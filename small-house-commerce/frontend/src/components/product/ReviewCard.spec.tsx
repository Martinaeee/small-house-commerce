import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Review } from "@/lib/api";
import { ReviewCard } from "./ReviewCard";

function review(comment: string): Review {
  return {
    id: "r1",
    authorName: "Mika",
    location: null,
    rating: 5,
    title: null,
    comment,
    photos: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    variant: null,
    helpfulCount: 0,
    verifiedPurchase: false,
  };
}

describe("ReviewCard phone clamp", () => {
  it("clamps a long review to three lines on phones and expands on demand", () => {
    render(
      <ul>
        <ReviewCard review={review("x".repeat(200))} />
      </ul>,
    );

    const body = document.getElementById("review-body-r1")!;
    expect(body).toHaveClass("line-clamp-3", "sm:line-clamp-none");

    const toggle = screen.getByRole("button", { name: "Read more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveClass("sm:hidden");

    fireEvent.click(toggle);

    expect(body).not.toHaveClass("line-clamp-3");
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("leaves a short review untouched and offers no toggle", () => {
    render(
      <ul>
        <ReviewCard review={review("Sturdy and compact.")} />
      </ul>,
    );

    expect(screen.queryByRole("button", { name: "Read more" })).toBeNull();
    expect(document.getElementById("review-body-r1")).toHaveClass(
      "whitespace-pre-line",
    );
  });
});
