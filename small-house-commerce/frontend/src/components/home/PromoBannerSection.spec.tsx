import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromoBannerSection } from "./PromoBannerSection";
import type { HomepageSection } from "@/lib/api";

const T0 = new Date("2026-10-08T12:00:00.000Z");

function section(overrides: Partial<HomepageSection> = {}): HomepageSection {
  return {
    id: "00000000-0000-7000-8000-000000000302",
    type: "PROMO_BANNER",
    title: "Free delivery week",
    subtitle: "Metro Manila orders over P2,000",
    sortOrder: 0,
    payload: { ctaText: "Shop now", ctaLink: "/collections/sale" },
    products: [],
    ...overrides,
  } as HomepageSection;
}

function layout(): HTMLElement | null {
  return document.querySelector("[data-banner-layout]");
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("PromoBannerSection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("server-renders its copy and CTA (static content, no time reads in render)", () => {
    const html = renderToString(<PromoBannerSection section={section()} />);

    expect(html).toContain("Free delivery week");
    expect(html).toContain("Metro Manila orders over P2,000");
    expect(html).toContain("Shop now");
  });

  it("renders the CTA only when both text and link are present", () => {
    const { rerender } = render(
      <PromoBannerSection
        section={section({ payload: { ctaText: "Shop now" } })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();

    rerender(
      <PromoBannerSection
        section={section({ payload: { ctaLink: "/collections/sale" } })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();

    rerender(
      <PromoBannerSection
        section={section({ payload: { ctaText: "Go", ctaLink: "https://example.com" } })}
      />,
    );
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("stays visible without a schedule even after time passes", async () => {
    render(<PromoBannerSection section={section()} />);
    await flush();

    await advance(60 * 60 * 1000);

    expect(screen.getByText("Free delivery week")).toBeVisible();
  });

  it("hides once a schedule unpublishAt passes", async () => {
    render(
      <PromoBannerSection
        section={section({
          schedule: {
            publishAt: null,
            unpublishAt: new Date(T0.getTime() + 10_000).toISOString(),
          },
        })}
      />,
    );
    await flush();
    expect(screen.getByText("Free delivery week")).toBeVisible();

    await advance(10_000);

    expect(screen.queryByText("Free delivery week")).toBeNull();
  });

  it("renders subtitle-only content and follows the preview device layout", async () => {
    const { rerender } = render(
      <PromoBannerSection
        section={section({ title: null })}
        previewDevice="tablet"
      />,
    );
    await flush();
    expect(screen.getByText("Metro Manila orders over P2,000")).toBeVisible();
    expect(layout()).toHaveClass("flex-row");

    rerender(<PromoBannerSection section={section()} previewDevice="mobile" />);
    await flush();
    expect(layout()).toHaveClass("flex-col");
  });

  it("keeps the stored section style", async () => {
    render(
      <PromoBannerSection
        section={section({
          style: { backgroundColor: "#223344", textColor: "#ffffff" },
        })}
      />,
    );
    await flush();

    const shell = layout()?.closest("section");
    expect(shell).toHaveStyle({ backgroundColor: "#223344", color: "#ffffff" });
  });

  it("cleans up its timers on unmount", async () => {
    const { unmount } = render(
      <PromoBannerSection
        section={section({
          schedule: {
            publishAt: null,
            unpublishAt: new Date(T0.getTime() + 60_000).toISOString(),
          },
        })}
      />,
    );
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
