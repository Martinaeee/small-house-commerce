import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountdownBannerSection } from "./CountdownBannerSection";
import type { HomepageSection } from "@/lib/api";

const T0 = new Date("2026-10-08T12:00:00.000Z");

function section(overrides: Partial<HomepageSection> = {}): HomepageSection {
  return {
    id: "00000000-0000-7000-8000-000000000301",
    type: "COUNTDOWN_BANNER",
    title: "Flash sale",
    subtitle: "Up to 30% off",
    sortOrder: 0,
    payload: {
      endsAt: new Date(T0.getTime() + 90_000).toISOString(),
      ctaText: "Shop now",
      ctaLink: "/collections/sale",
    },
    products: [],
    ...overrides,
  } as HomepageSection;
}

function layout(): HTMLElement | null {
  return document.querySelector("[data-banner-layout]");
}

function unit(name: "d" | "h" | "m" | "s"): string | null {
  return document.querySelector(`[data-countdown-unit="${name}"]`)?.textContent ?? null;
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

describe("CountdownBannerSection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing on the server and the first hydration render (no time reads in render)", () => {
    // The storefront page is ISR-cached; time-dependent digits must never be
    // part of the server HTML or the first client render.
    expect(
      renderToString(<CountdownBannerSection section={section()} />),
    ).toBe("");
  });

  it("shows the copy, countdown digits and CTA once mounted and active", async () => {
    render(<CountdownBannerSection section={section()} />);
    await flush();

    expect(screen.getByText("Flash sale")).toBeVisible();
    expect(screen.getByText("Up to 30% off")).toBeVisible();
    expect(unit("m")).toBe("01");
    expect(unit("s")).toBe("30");
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Shop now" })).toHaveAttribute(
      "href",
      "/collections/sale",
    );
  });

  it("ticks down once per second", async () => {
    render(<CountdownBannerSection section={section()} />);
    await flush();

    await advance(1000);
    expect(unit("s")).toBe("29");

    await advance(59_000);
    expect(unit("m")).toBe("00");
    expect(unit("s")).toBe("30");
  });

  it("removes the entire section at the exact deadline", async () => {
    render(<CountdownBannerSection section={section()} />);
    await flush();
    expect(screen.getByText("Flash sale")).toBeVisible();

    await advance(90_000);

    expect(screen.queryByText("Flash sale")).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("link", { name: "Shop now" })).toBeNull();
    expect(document.querySelector("[data-banner-layout]")).toBeNull();
  });

  it("hides exactly at a non-whole-second deadline", async () => {
    render(
      <CountdownBannerSection
        section={section({
          payload: {
            endsAt: new Date(T0.getTime() + 1500).toISOString(),
            ctaText: "Shop now",
            ctaLink: "/collections/sale",
          },
        })}
      />,
    );
    await flush();
    expect(unit("s")).toBe("01");

    await advance(1400);
    expect(screen.getByText("Flash sale")).toBeVisible();

    await advance(101);
    expect(screen.queryByText("Flash sale")).toBeNull();
  });

  it("renders nothing for a null or invalid end time", async () => {
    const { rerender } = render(
      <CountdownBannerSection
        section={section({ payload: { endsAt: null } })}
      />,
    );
    await flush();
    expect(screen.queryByText("Flash sale")).toBeNull();

    rerender(
      <CountdownBannerSection
        section={section({ payload: { endsAt: "not-a-date" } })}
      />,
    );
    await flush();
    expect(screen.queryByText("Flash sale")).toBeNull();
  });

  it("hides when the schedule unpublishAt arrives before the end time", async () => {
    render(
      <CountdownBannerSection
        section={section({
          schedule: {
            publishAt: null,
            unpublishAt: new Date(T0.getTime() + 30_000).toISOString(),
          },
        })}
      />,
    );
    await flush();
    expect(screen.getByText("Flash sale")).toBeVisible();

    await advance(30_000);

    expect(screen.queryByText("Flash sale")).toBeNull();
  });

  it("revives when a past end time is replaced with a future one", async () => {
    const { rerender } = render(
      <CountdownBannerSection
        section={section({
          payload: { endsAt: new Date(T0.getTime() - 1000).toISOString() },
        })}
      />,
    );
    await flush();
    expect(screen.queryByText("Flash sale")).toBeNull();

    rerender(<CountdownBannerSection section={section()} />);
    await flush();

    expect(screen.getByText("Flash sale")).toBeVisible();
    expect(unit("s")).toBe("30");
  });

  it("keeps the stored section style and the preview-device layout", async () => {
    const { rerender } = render(
      <CountdownBannerSection
        section={section({ style: { backgroundColor: "#112233" } })}
        previewDevice="desktop"
      />,
    );
    await flush();

    expect(layout()).toHaveClass("flex-row");
    const shell = layout()?.closest("section");
    expect(shell).toHaveStyle({ backgroundColor: "#112233" });

    rerender(
      <CountdownBannerSection section={section()} previewDevice="mobile" />,
    );
    await flush();
    expect(layout()).toHaveClass("flex-col");
  });

  it("cleans up its timers on unmount", async () => {
    const { unmount } = render(<CountdownBannerSection section={section()} />);
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
