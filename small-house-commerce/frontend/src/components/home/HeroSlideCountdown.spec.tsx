import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { HeroSlideCountdown } from "./HeroSlideCountdown";

// Task 19 RED/GREEN: client countdown (days/hours/minutes/seconds) to endsAt.
// null or already-past endsAt renders nothing; a live countdown reaches zero,
// locks the display there and stops ticking.

const ENDS_AT = "2026-01-01T00:00:00.000Z";

function secondCell(): HTMLElement | null {
  return document.querySelector('[data-countdown-unit="s"]');
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("HeroSlideCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-31T23:59:58.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when endsAt is null", () => {
    render(<HeroSlideCountdown endsAt={null} style={{}} layout={{}} />);
    expect(document.querySelector("[data-hero-countdown]")).toBeNull();
  });

  it("renders nothing when endsAt is already in the past", () => {
    render(<HeroSlideCountdown endsAt="2025-01-01T00:00:00.000Z" style={{}} layout={{}} />);
    expect(document.querySelector("[data-hero-countdown]")).toBeNull();
  });

  it("counts down by seconds and freezes at zero without further ticks", async () => {
    render(<HeroSlideCountdown endsAt={ENDS_AT} style={{}} layout={{}} />);
    const root = screen.getByTestId("hero-countdown");
    expect(root).toHaveAttribute("role", "timer");
    // 2 seconds to go from the frozen clock.
    expect(secondCell()?.textContent).toBe("02");

    await advance(1000);
    expect(secondCell()?.textContent).toBe("01");

    await advance(1000);
    expect(secondCell()?.textContent).toBe("00");
    const frozenText = root.textContent;

    // Reaching zero stops the clock: advancing further changes nothing.
    await advance(5000);
    expect(root.textContent).toBe(frozenText);
    expect(secondCell()?.textContent).toBe("00");
  });

  it("breaks the countdown into days/hours/minutes/seconds cells", async () => {
    vi.setSystemTime(new Date("2025-12-28T21:59:58.000Z")); // 3d 2h 0m 2s
    render(<HeroSlideCountdown endsAt={ENDS_AT} style={{}} layout={{}} />);
    const root = screen.getByTestId("hero-countdown");
    expect(root.querySelector('[data-countdown-unit="d"]')?.textContent).toBe("03");
    expect(root.querySelector('[data-countdown-unit="h"]')?.textContent).toBe("02");
    expect(root.querySelector('[data-countdown-unit="m"]')?.textContent).toBe("00");
    expect(root.querySelector('[data-countdown-unit="s"]')?.textContent).toBe("02");
  });
});