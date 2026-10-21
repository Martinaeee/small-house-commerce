import { describe, expect, it, vi } from "vitest";
import LegacyLandingPages from "./page";
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
describe("legacy landing page entry", () => {
  it("redirects to the unified page workbench with product context intact", async () => {
    await LegacyLandingPages({ searchParams: Promise.resolve({ productId: "product/1" }) });
    expect(redirect).toHaveBeenLastCalledWith("/admin/marketing?productId=product%2F1");
  });
});
