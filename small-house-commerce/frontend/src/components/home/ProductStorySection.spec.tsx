import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HomepageSection } from "@/lib/api";
import { ProductStorySection } from "./ProductStorySection";
import { optimizedUploadImage } from "@/lib/image-url";

const section: HomepageSection = {
  id: "story-responsive", type: "PRODUCT_STORY", title: "Thoughtful living", subtitle: null, sortOrder: 60,
  payload: { heading: "Make room for everyday living", body: "Furniture for a calmer home.",
    imageUrl: "/uploads/story.jpg", productId: "table", ctaLink: "/products/table", ctaText: "Explore the table",
    layout: { gap: 24, imageRatio: "LANDSCAPE", overrides: { mobile: { gap: 8, imageRatio: "PORTRAIT" } } } },
};

describe("ProductStorySection responsive display", () => {
  it.each([["desktop", 24, "4 / 3"], ["mobile", 8, "3 / 4"]] as const)("consumes %s gap and image ratio without rewriting story content", (device, gap, ratio) => {
    const original = structuredClone(section);
    const { container } = render(<ProductStorySection section={section} previewDevice={device} />);
    expect(container.querySelector<HTMLElement>(".grid")!.style.gap).toBe(`${gap}px`);
    expect(screen.getByRole("img").style.aspectRatio).toBe(ratio);
    expect(screen.getByRole("img")).toHaveAttribute("src", optimizedUploadImage("/uploads/story.jpg", 1440));
    expect(screen.getByRole("heading", { name: "Make room for everyday living" })).toBeVisible();
    expect(screen.getByText("Furniture for a calmer home.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Explore the table" })).toHaveAttribute("href", "/products/table");
    expect(section).toEqual(original);
  });
});
