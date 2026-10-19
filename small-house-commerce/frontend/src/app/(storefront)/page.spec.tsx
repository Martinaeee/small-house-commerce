import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHomepage, type HomepageSection } from "@/lib/api";
import HomePage from "./page";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  getHomepage: vi.fn(),
}));

const section: HomepageSection = {
  id: "00000000-0000-7000-8000-000000000801", type: "BRAND_STORY", title: "Layout illustration",
  subtitle: null, sortOrder: 20, payload: { body: "Furniture for everyday small-space living." },
};

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe("HomePage appearance", () => {
  it.each([undefined, "STUDIO_V3"] as const)("uses only the public response appearance (%s)", async (appearance) => {
    vi.mocked(getHomepage).mockResolvedValue({ sections: [section], ...(appearance ? { appearance } : {}) });
    const { container } = render(await HomePage());
    const heading = screen.getByRole("heading", { name: "Layout illustration" });
    const root = heading.closest("[data-homepage-appearance]");
    if (appearance) expect(root).toHaveAttribute("data-homepage-appearance", appearance);
    else expect(root).toBeNull();
    expect(heading.closest("[data-homepage-section-type]")).toHaveAttribute("data-homepage-section-type", "BRAND_STORY");
    expect(container.querySelector('script[type="application/ld+json"]')).not.toBeNull();
    expect(getHomepage).toHaveBeenCalledOnce();
  });
});
