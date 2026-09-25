import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/admin/Badge";

describe("Badge semantic admin tones", () => {
  it.each([
    ["green", "bg-admin-success-soft", "text-admin-success"],
    ["amber", "bg-admin-warning-soft", "text-admin-warning"],
    ["red", "bg-admin-error-soft", "text-admin-error"],
    ["neutral", "bg-admin-neutral-soft", "text-ink-secondary"],
  ] as const)("maps %s to shared token classes", (tone, background, foreground) => {
    render(<Badge value={tone} tone={tone} />);

    expect(screen.getByText(tone)).toHaveClass(background, foreground);
  });
});
