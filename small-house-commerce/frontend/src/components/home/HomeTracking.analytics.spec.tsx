import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { HomeTracking } from "./HomeTracking";

const analytics = vi.hoisted(() => ({ trackFirstParty: vi.fn() }));
vi.mock("@/lib/analytics", () => analytics);
vi.mock("@/lib/tracking", () => ({ track: vi.fn(), trackCustom: vi.fn() }));

/** Minimal IntersectionObserver stand-in the test drives by hand. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  observed: Element[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve(target: Element) {
    this.observed = this.observed.filter((element) => element !== target);
  }
  disconnect() {
    this.observed = [];
  }
  takeRecords() {
    return [];
  }
  trigger(isIntersecting = true) {
    this.callback(
      this.observed.map((target) => ({
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
      })) as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}

const SECTION_ID = "10000000-0000-7000-8000-000000000009";

function renderHomepage() {
  return render(
    <>
      <HomeTracking />
      <div data-homepage-section-id={SECTION_ID} data-homepage-section-type="HERO">
        <Link href="/products/rolling-cart">Rolling cart</Link>
      </div>
    </>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

describe("HomeTracking first-party events", () => {
  it("records an impression only once the section scrolls into view", () => {
    renderHomepage();
    const observer = MockIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    expect(analytics.trackFirstParty).not.toHaveBeenCalled();

    observer.trigger(true);

    expect(analytics.trackFirstParty).toHaveBeenCalledWith(
      "HOMEPAGE_SECTION_IMPRESSION",
      { sectionId: SECTION_ID, sectionType: "HERO" },
    );

    // The section is unobserved after the first sighting, so scrolling back
    // cannot inflate the impression count.
    expect(observer.observed).toHaveLength(0);
  });

  it("records a section click with the destination and product slug", async () => {
    const { getByRole } = renderHomepage();
    const link = getByRole("link", { name: "Rolling cart" });
    link.addEventListener("click", (event) => event.preventDefault());

    await userEvent.click(link);

    expect(analytics.trackFirstParty).toHaveBeenCalledWith(
      "HOMEPAGE_SECTION_CLICK",
      {
        sectionId: SECTION_ID,
        sectionType: "HERO",
        destination: "/products/rolling-cart",
        entityId: "rolling-cart",
      },
    );
  });
});
