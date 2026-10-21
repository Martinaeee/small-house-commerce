import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingBlocksLayout, LandingContentView } from "./LandingContentView";
import type { LandingContent } from "@/lib/marketing-content";

const saved: LandingContent = {
  schemaVersion: 1, seoTitle: null, seoDescription: null, startAt: null, endAt: null,
  blocks: [
    { id: "hero", type: "hero", sourceKey: null, props: { title: "Independent title", tagline: "Small space", promoHeadline: null, promoSubtext: null } },
    { id: "buy", type: "buy", sourceKey: null, props: {} },
    { id: "copy", type: "richText", sourceKey: null, props: { html: "<p><strong>Verified markup</strong></p>" } },
  ],
};

describe("shared landing content renderer", () => {
  it("renders the independent title and only server-approved rich markup", () => {
    render(<LandingContentView content={saved} approvedContent={saved} product={null} preview />);
    expect(screen.getByRole("heading", { name: "Independent title" })).toBeInTheDocument();
    expect(screen.getByText("Verified markup").tagName).toBe("STRONG");
    expect(screen.getByText(/Purchase is unavailable/)).toBeInTheDocument();
  });

  it("never executes unsaved HTML that differs from the validated document", () => {
    const changed: LandingContent = { ...saved, blocks: [saved.blocks[0], saved.blocks[1], { id: "copy", type: "richText", sourceKey: null, props: { html: '<img src="bad" onerror="bad()"><script>bad()</script>' } }] };
    const { container } = render(<LandingContentView content={changed} approvedContent={saved} product={null} preview />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('img[src="bad"]')).toBeNull();
    expect(container).toHaveTextContent('<script>bad()</script>');
  });

  it("marks the editable block layout for adjacent gallery and purchase styling", () => {
    const { container } = render(<LandingBlocksLayout><div /></LandingBlocksLayout>);
    expect(container.firstChild).toHaveClass("landing-blocks-layout");
  });

  it("keeps the inherited product lead fixed above reorderable detail blocks", () => {
    const inherited: LandingContent = {
      ...saved,
      blocks: [
        saved.blocks[2],
        saved.blocks[1],
        saved.blocks[0],
        { id: "gallery", type: "gallery", sourceKey: null, props: { media: [] } },
      ],
    };

    const { container } = render(<LandingContentView content={inherited} approvedContent={inherited} product={null} preview />);
    const article = container.querySelector("article");
    const lead = container.querySelector('[data-landing-product-lead="true"]');

    expect(article?.firstElementChild).toBe(lead);
    expect(lead).toHaveClass("lg:grid-cols-2");
    expect(lead?.querySelector('[data-landing-block="gallery"]')).toBeInTheDocument();
    expect(lead?.querySelector('[data-landing-block="hero"]')).toBeInTheDocument();
    expect(lead?.querySelector('[data-landing-block="buy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-landing-block="richText"]')?.closest('[data-landing-product-lead="true"]')).toBeNull();
  });
});
