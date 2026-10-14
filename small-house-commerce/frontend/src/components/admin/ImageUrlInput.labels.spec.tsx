import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageUrlInput } from "@/components/admin/ImageUrlInput";

describe("ImageUrlInput localized copy extension", () => {
  it("renders caller-provided typed copy instead of its legacy default labels", () => {
    render(
      <ImageUrlInput
        ariaLabel="Hero image URL"
        value=""
        onChange={() => undefined}
        labels={{
          upload: "Upload image",
          uploading: "Uploading image…",
          invalidType: "Unsupported image type",
          tooLarge: "Image is too large",
          uploadFailed: "Image upload failed",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Upload image" })).toBeVisible();
  });
});
