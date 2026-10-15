import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MarketingTouchObserver } from "@/components/tracking/MarketingTouchObserver";
import { LandingViewTracker } from "@/components/product/LandingViewTracker";

const state = vi.hoisted(() => ({ path: "/products/chair", search: "cl=abcdefghijklmnop" }));
const mocks = vi.hoisted(() => ({ touch: vi.fn().mockResolvedValue(undefined), oldView: vi.fn().mockResolvedValue(undefined), oldPersist: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path, useSearchParams: () => new URLSearchParams(state.search) }));
vi.mock("@/lib/tracking", () => ({ recordMarketingTouch: mocks.touch, persistLandingPage: mocks.oldPersist, LANDING_VISIT_SESSION_KEY: "sh:lpvisit" }));
vi.mock("@/lib/api", () => ({ api: { recordLandingPageView: mocks.oldView } }));

beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); state.path = "/products/chair"; state.search = "cl=abcdefghijklmnop"; });

describe("storefront-only touch observers", () => {
  it("observes search-only client navigations and does not duplicate StrictMode effects", () => {
    const { rerender } = render(<StrictMode><MarketingTouchObserver /></StrictMode>);
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(mocks.touch).toHaveBeenLastCalledWith({ path: "/products/chair", search: "cl=abcdefghijklmnop" });
    state.search = "cl=qrstuvwxyzABCDEF";
    rerender(<StrictMode><MarketingTouchObserver /></StrictMode>);
    expect(mocks.touch).toHaveBeenCalledTimes(2);
    expect(mocks.touch).toHaveBeenLastCalledWith({ path: "/products/chair", search: "cl=qrstuvwxyzABCDEF" });
  });

  it("leaves public landing pages to their actual published-page tracker", () => {
    state.path = "/lp/chair-ad";
    render(<MarketingTouchObserver />);
    expect(mocks.touch).not.toHaveBeenCalled();
  });

  it("uses the real page identity and replaces the old raw view beacon", () => {
    state.path = "/lp/chair-ad";
    const { rerender } = render(<StrictMode><LandingViewTracker landingPageId="page-1" slug="chair-ad" /></StrictMode>);
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(mocks.touch).toHaveBeenLastCalledWith({ path: "/lp/chair-ad", search: "cl=abcdefghijklmnop", landingPageId: "page-1" });
    expect(mocks.oldView).not.toHaveBeenCalled();
    expect(mocks.oldPersist).not.toHaveBeenCalled();
    state.search = "cl=second-code";
    rerender(<StrictMode><LandingViewTracker landingPageId="page-1" slug="chair-ad" /></StrictMode>);
    expect(mocks.touch).toHaveBeenCalledTimes(2);
  });
});
