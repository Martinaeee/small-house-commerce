import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function measureBody(scrollHeight: number, clientHeight: number) {
  const body = document.getElementById("review-body-r1")!;
  Object.defineProperties(body, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  });
  fireEvent.resize(window);
  return body;
}

describe("ReviewCard phone clamp", () => {
  it("reveals the full review through the inline ellipsis without a separate Read more row", async () => {
    render(<ul><ReviewCard review={review("A sturdy desk for a small room. ".repeat(8))} /></ul>);
    const body = measureBody(160, 60);
    expect(body).toHaveClass("line-clamp-3", "sm:line-clamp-none");

    const more = await screen.findByRole("button", { name: "Read full review" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveAttribute("aria-controls", body.id);
    expect(more).toHaveClass("sm:hidden");
    expect(more).toHaveTextContent("…");
    expect(screen.queryByText("Read more")).not.toBeInTheDocument();

    fireEvent.click(more);

    expect(body).not.toHaveClass("line-clamp-3");
    expect(screen.queryByRole("button", { name: "Read full review" })).not.toBeInTheDocument();
    expect(screen.queryByText("Show less")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Helpful" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
  });

  it("does not fade a review that fits, even when the comment has many characters", async () => {
    render(<ul><ReviewCard review={review("A compact and sturdy desk. ".repeat(6))} /></ul>);
    const body = measureBody(60, 60);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Read full review" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Read more" })).toBeNull();
    expect(body).toHaveClass("whitespace-pre-line");
  });

  it("updates the ellipsis when wrapping changes after a resize", async () => {
    render(<ul><ReviewCard review={review("One\nTwo\nThree\nFour")} /></ul>);
    measureBody(80, 60);
    expect(await screen.findByRole("button", { name: "Read full review" })).toBeInTheDocument();

    measureBody(80, 80);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Read full review" })).toBeNull());
  });
});
