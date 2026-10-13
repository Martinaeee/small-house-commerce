import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SiteSettingsProvider } from "@/components/site/SiteSettingsProvider";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site-settings";
import { Footer } from "./Footer";

vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins" },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const base = {
  collections: [],
  supportEmail: "support@luwag.ph",
  supportPhone: "",
  supportHours: "Mon–Sat, 9am–6pm (PHT)",
  newsletterEnabled: true,
};

function renderFooter(
  props: Partial<Parameters<typeof Footer>[0]> = {},
  settings: Partial<SiteSettings> = {},
) {
  return render(
    <SiteSettingsProvider settings={{ ...DEFAULT_SITE_SETTINGS, ...settings }}>
      <Footer {...base} {...props} />
    </SiteSettingsProvider>,
  );
}

describe("Footer subscribe integration", () => {
  it("renders the subscribe block inside the footer element", () => {
    renderFooter();

    const footer = document.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer).toContainElement(screen.getByTestId("newsletter-band"));
  });

  it("keeps the footer as the single dark surface around the subscribe block", () => {
    renderFooter();

    const footer = document.querySelector("footer");
    expect(footer?.className).toContain("bg-[#704632]");
  });

  it("renders the brand lockup in the on-dark tone", () => {
    renderFooter();

    const wordmark = document.querySelector('footer [aria-label="LUWAG"]');
    // `text-cta` is #6B4F3A — brown on brown. The lockup must switch tone
    // instead of trying to override the colour with another class.
    expect(wordmark?.className).toContain("text-[#fff8f1]");
    expect(wordmark?.className).not.toContain("text-cta");
    expect(wordmark?.querySelector("rect")?.getAttribute("fill")).toBe(
      "#FAF8F5",
    );
  });

  it("renders a normalized phone link when support phone is configured", () => {
    renderFooter({ supportPhone: "+63 (917) 123-4567" });

    expect(screen.getByRole("link", { name: "+63 (917) 123-4567" })).toHaveAttribute(
      "href",
      "tel:+639171234567",
    );
  });

  it("hides the phone row when support phone is empty", () => {
    renderFooter({ supportPhone: "" });

    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("omits the subscribe block and collapses to three columns when disabled", () => {
    renderFooter(
      { newsletterEnabled: false },
      { newsletterBandEnabled: false },
    );

    expect(screen.queryByTestId("newsletter-band")).toBeNull();
    expect(document.querySelector("footer")).not.toBeNull();
    const columns = document.querySelector("footer .grid");
    expect(columns?.className).toContain(
      "lg:grid-cols-[1.15fr_0.9fr_1fr]",
    );
    expect(columns?.className).not.toContain(
      "lg:grid-cols-[1.05fr_0.9fr_1fr_1.35fr]",
    );
  });
});
