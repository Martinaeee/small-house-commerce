import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminFaqItem } from "./admin-api";
import { faqApi } from "./faq-api";

const authMock = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("./admin-auth", () => ({
  adminAuthedFetch: authMock.fetch,
  adminAuthedText: vi.fn(),
}));

const item: AdminFaqItem = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "How does delivery work?",
  answer: [{ kind: "paragraph", text: "We deliver nationwide." }],
  enabled: true,
  position: 0,
  defaultOpen: false,
  category: "DELIVERY",
};

describe("faqApi shared impact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.fetch.mockResolvedValue({ productCount: 7, version: 3 });
  });

  it("posts the exact proposed shared library and expected version", async () => {
    await expect(faqApi.previewSharedImpact([item], 3)).resolves.toEqual({
      productCount: 7,
      version: 3,
    });

    expect(authMock.fetch).toHaveBeenCalledWith(
      "/api/v1/admin/faq/shared/impact",
      {
        method: "POST",
        body: JSON.stringify({ items: [item], expectedVersion: 3 }),
      },
    );
  });
});
