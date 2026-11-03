import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomepageContentImage } from "./HomepageContentImage";
import { optimizedUploadImage } from "@/lib/image-url";

describe("HomepageContentImage", () => {
  it("replaces a failed image with an inert placeholder and retries a different source", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { container, rerender } = render(<HomepageContentImage src="/uploads/first.jpg" className="h-full w-full" />);
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("alt", "");
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild).toHaveClass("h-full", "w-full");
    rerender(<HomepageContentImage src="/uploads/second.jpg" />);
    expect(container.querySelector("img")).toHaveAttribute("src", optimizedUploadImage("/uploads/second.jpg", 1440));
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
