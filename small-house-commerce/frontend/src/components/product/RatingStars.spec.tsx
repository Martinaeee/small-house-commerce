import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RatingStars } from "./RatingStars";

describe("RatingStars", () => {
  it("paints filled and half stars in the amber star token", () => {
    render(<RatingStars value={4.5} />);

    const row = screen.getByRole("img", { name: "Rated 4.5 out of 5" });
    expect(row).toHaveClass("text-star");

    const glyphs = Array.from(row.querySelectorAll("span"));
    expect(glyphs.map((glyph) => glyph.textContent)).toEqual([
      "★",
      "★",
      "★",
      "★",
      "⯨",
    ]);
    glyphs.forEach((glyph) => expect(glyph).not.toHaveClass("text-border"));
  });

  it("keeps empty stars on the border token", () => {
    render(<RatingStars value={3} />);

    const row = screen.getByRole("img", { name: "Rated 3.0 out of 5" });
    const glyphs = Array.from(row.querySelectorAll("span"));
    expect(glyphs.map((glyph) => glyph.textContent)).toEqual([
      "★",
      "★",
      "★",
      "☆",
      "☆",
    ]);
    expect(glyphs[2]).not.toHaveClass("text-border");
    expect(glyphs[3]).toHaveClass("text-border");
    expect(glyphs[4]).toHaveClass("text-border");
  });
});
