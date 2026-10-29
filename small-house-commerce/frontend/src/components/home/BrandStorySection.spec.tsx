import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrandStorySection } from "./BrandStorySection";
import type { HomepageSection } from "@/lib/api";
import { optimizedUploadImage } from "@/lib/image-url";

vi.mock("@/lib/fonts", () => ({
  poppins: { className: "font-poppins" },
  poppinsMedium: { className: "font-poppins-medium" },
  storySerif: { className: "font-story-serif" },
}));

function section(overrides: Partial<HomepageSection> = {}): HomepageSection {
  return {
    id: "00000000-0000-7000-8000-000000000401",
    type: "BRAND_STORY",
    title: null,
    subtitle: null,
    sortOrder: 100,
    payload: {
      imageUrl: "/uploads/catalog/2026/brand-story.jpg",
      imageAlt: "A sunlit living corner in a small condo",
      eyebrow: "SMALL SPACE. BIG POSSIBILITIES.",
      heading: "Room to breathe.\nRoom to live.",
      body: "Thoughtful furniture for everyday spaces.\nDesigned around the way real homes work,\nmove, and grow.",
      ctaText: "A little more about luwag",
      ctaLink: "/about",
    },
    products: [],
    ...overrides,
  } as HomepageSection;
}

const layout = () => document.querySelector("[data-brand-story-layout]");
const media = () => document.querySelector("[data-brand-story-media]");
const copy = () => document.querySelector("[data-brand-story-copy]");

describe("BrandStorySection", () => {
  it("shows a section title above the card when the published title is empty", () => {
    render(<BrandStorySection section={section()} />);

    const title = screen.getByRole("heading", { name: "About LUWAG", level: 2 });
    expect(title).toBeVisible();
    expect(layout()!.contains(title)).toBe(false);
    expect(title.compareDocumentPosition(layout()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Room to breathe\./ })).toBeVisible();
  });

  it("uses the configured section title and subtitle without replacing the card headline", () => {
    render(
      <BrandStorySection
        section={section({ title: "Our Story", subtitle: "Made for real homes" })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Our Story" })).toBeVisible();
    expect(screen.getByText("Made for real homes")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "About LUWAG" })).toBeNull();
    expect(screen.getByRole("heading", { name: /Room to breathe\./ })).toBeVisible();
  });

  it("keeps the legacy copy headline separate from the default section title", () => {
    render(
      <BrandStorySection
        section={section({
          title: "Our Story",
          payload: { imageUrl: "/story.jpg", body: "Made for real homes" },
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "About LUWAG" })).toBeVisible();
    const headline = screen.getByRole("heading", { name: "Our Story" });
    expect(layout()!.contains(headline)).toBe(true);
  });

  it("renders the brand image beside the copy", () => {
    render(<BrandStorySection section={section()} />);

    const image = screen.getByRole("img", {
      name: "A sunlit living corner in a small condo",
    });
    expect(image).toHaveAttribute(
      "src",
      optimizedUploadImage("/uploads/catalog/2026/brand-story.jpg", 1440),
    );
    expect(screen.getByText("SMALL SPACE. BIG POSSIBILITIES.")).toBeVisible();
    expect(screen.getByText(/Room to breathe\./)).toBeVisible();
    expect(screen.getByText(/Thoughtful furniture for everyday spaces\./)).toBeVisible();
  });

  it("sits in the storefront's content column instead of breaking the page grid", () => {
    render(<BrandStorySection section={section()} />);

    // The mockup is a standalone artboard, but on the homepage the block has
    // to line up with the sections around it — a full-bleed band would run
    // past the 1200px column the rest of the page uses.
    const wrapper = document.querySelector("section");
    expect(wrapper).toHaveClass("max-w-[1200px]");
    expect(wrapper).not.toHaveClass("max-w-none");
  });

  it("splits the section into the design's photo and copy columns", () => {
    render(<BrandStorySection section={section()} />);

    // One column below the desktop breakpoint; 1672:941 artboard proportions
    // above it, with the photo taking 57.7% of the width.
    expect(layout()).toHaveClass("grid-cols-1");
    expect(layout()).toHaveClass("min-[900px]:grid-cols-[57.7%_42.3%]");
    expect(layout()).toHaveClass("min-[900px]:aspect-[1672/941]");
    expect(layout()).toHaveClass("[container-type:inline-size]");
  });

  it("fills the media column with the upload instead of letterboxing it", () => {
    render(<BrandStorySection section={section()} />);

    const image = screen.getByRole("img");
    expect(image).toHaveClass("object-cover");
    expect(image).not.toHaveClass("object-contain");
    // The photo runs to the section's top, bottom and left edges.
    expect(media()).toHaveClass("overflow-hidden");
    expect(image).toHaveClass("h-full");
    expect(image).toHaveClass("w-full");
  });

  it("sets the copy panel on the storefront card surface", () => {
    render(<BrandStorySection section={section()} />);

    // The mockup's copy panel is a warm off-white; on the page the same
    // surface is the storefront's card (white + hairline border), so the
    // block reads as one card next to the other cards.
    expect(layout()).toHaveClass("bg-card");
    expect(layout()).toHaveClass("border-border");
    expect(layout()).toHaveClass("rounded-lg");
    expect(copy()).not.toBeNull();
  });

  it("sets the heading and body in the serif face, the eyebrow in Poppins", () => {
    render(<BrandStorySection section={section()} />);

    expect(screen.getByRole("heading", { name: /Room to breathe\./ })).toHaveClass("font-story-serif");
    expect(
      screen.getByText(/Thoughtful furniture for everyday spaces\./),
    ).toHaveClass("font-story-serif");
    expect(
      screen.getByText("SMALL SPACE. BIG POSSIBILITIES."),
    ).toHaveClass("font-poppins-medium");
  });

  it("keeps the line breaks the design puts in the heading and body", () => {
    render(<BrandStorySection section={section()} />);

    const heading = screen.getByRole("heading", { name: /Room to breathe\./ });
    expect(heading.textContent).toBe("Room to breathe.\nRoom to live.");
    expect(heading).toHaveClass("whitespace-pre-line");

    // The body keeps the authored breaks on the artboard, but flows freely
    // in the narrow stacked layout.
    expect(
      screen.getByText(/Thoughtful furniture for everyday spaces\./),
    ).toHaveClass("min-[900px]:whitespace-pre-line");
    expect(
      screen.getByText(/Thoughtful furniture for everyday spaces\./),
    ).toHaveClass("whitespace-normal");
  });

  it("falls back to the heading for the image alt text", () => {
    render(
      <BrandStorySection
        section={section({
          payload: {
            imageUrl: "/uploads/catalog/2026/brand-story.jpg",
            heading: "Room to breathe.",
          },
        })}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Room to breathe." }),
    ).toBeInTheDocument();
  });

  it("renders a placeholder block when no image is set", () => {
    render(
      <BrandStorySection
        section={section({
          payload: {
            heading: "Room to breathe.",
            imageUrl: undefined,
          },
        })}
      />,
    );

    expect(document.querySelector("img")).toBeNull();
    // The placeholder repeats the heading as its label, so match the heading
    // role rather than the text.
    expect(
      screen.getByRole("heading", { name: "Room to breathe." }),
    ).toBeVisible();
  });

  it("shows the empty state when the section has no content at all", () => {
    render(<BrandStorySection section={section({ title: null, payload: {} })} />);

    expect(screen.getByText("Brand story coming soon.")).toBeVisible();
    expect(layout()).toBeNull();
  });

  it("links the CTA only when both the text and the destination are set", () => {
    const { rerender } = render(<BrandStorySection section={section()} />);
    expect(
      screen.getByRole("link", { name: /A little more about luwag/ }),
    ).toHaveAttribute("href", "/about");

    rerender(
      <BrandStorySection
        section={section({ payload: { ctaText: "A little more about luwag" } })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();

    rerender(
      <BrandStorySection
        section={section({ payload: { ctaLink: "/about" } })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("stacks the columns in a mobile preview and keeps them side by side on desktop", () => {
    const { rerender } = render(
      <BrandStorySection section={section()} previewDevice="mobile" />,
    );
    expect(layout()).toHaveClass("grid-cols-1");
    expect(layout()).not.toHaveClass("aspect-[1672/941]");

    // The tablet frame is 768px wide, below the live 900px breakpoint, so it
    // stacks exactly like the storefront does at that width.
    rerender(
      <BrandStorySection section={section()} previewDevice="tablet" />,
    );
    expect(layout()).toHaveClass("grid-cols-1");
    expect(layout()).not.toHaveClass("aspect-[1672/941]");

    rerender(
      <BrandStorySection section={section()} previewDevice="desktop" />,
    );
    expect(layout()).toHaveClass("grid-cols-[57.7%_42.3%]");
    expect(layout()).toHaveClass("aspect-[1672/941]");
  });

  it("exposes its own content roles so the studio appearance keeps the artboard type", () => {
    render(<BrandStorySection section={section()} />);

    // The studio appearance (STUDIO_V3) restyles every section by role, so
    // the brand story uses its own role names: its type scale is fixed by the
    // approved mockup and must not be replaced by the studio heading size.
    expect(screen.getByRole("heading", { name: /Room to breathe\./ })).toHaveAttribute(
      "data-homepage-role",
      "brand-story-heading",
    );
    expect(
      screen.getByText(/Thoughtful furniture for everyday spaces\./),
    ).toHaveAttribute("data-homepage-role", "brand-story-body");
    expect(
      document.querySelector('[data-homepage-role="brand-story-media"]'),
    ).not.toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute(
      "data-homepage-role",
      "brand-story-action",
    );
  });

  it("applies the style override of the previewed device", () => {
    const { container } = render(
      <BrandStorySection
        section={section({
          style: { paddingTop: 31, overrides: { mobile: { paddingTop: 0 } } },
        })}
        previewDevice="mobile"
      />,
    );

    // The shell needs the device to resolve the operator's mobile padding;
    // without it the admin canvas shows the desktop spacing.
    expect(container.querySelector("section")).toHaveStyle({ paddingTop: "0px" });
  });

  it("still renders the bullet list of a section published before the split layout", () => {
    render(
      <BrandStorySection
        section={section({
          payload: {
            imageUrl: "/uploads/catalog/2026/brand-story.jpg",
            heading: "Our Story",
            bullets: ["One", "Two"],
          },
        })}
      />,
    );

    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("data-homepage-role", "brand-story-list");
    expect(list.textContent).toContain("One");
    expect(list.textContent).toContain("Two");
  });
});
