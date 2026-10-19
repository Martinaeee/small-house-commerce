import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionShell } from "./sectionShell";
import type { Product } from "@/lib/api";
import type { SectionProps } from "./sectionRegistry";
import { trackAttrs } from "@/lib/home-tracking";
import { moduleLayoutPresentation } from "@/lib/homepage-responsive";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function ProductStorySection({ section, previewDevice, appearance }: SectionProps) {
  const p = section.payload ?? {};
  const layout = moduleLayoutPresentation("PRODUCT_STORY", p.layout, previewDevice, undefined, appearance);
  const product = (p.product ?? null) as Product | null;
  // Effective cover media from the backend contract — never images[0].
  const image =
    str(p.imageUrl) || product?.effectiveCoverMedia?.url || "";
  const heading = str(p.heading) || section.title || "";
  const body = str(p.body);
  const ctaLink = str(p.ctaLink) || (product ? `/products/${product.slug}` : "");
  const ctaText = str(p.ctaText) || (product ? "Shop this pick" : "");

  if (!image && !body && !product) {
    return <SectionPlaceholder title={section.title} message="Story coming soon." style={section.style} previewDevice={previewDevice} />;
  }

  // sortOrder 40 -> image left; sortOrder 60 -> image right.
  const reversed = section.sortOrder >= 55;
  const stackedPreview = previewDevice === "mobile";
  const gridClass = previewDevice
    ? `grid items-center gap-8 ${stackedPreview ? "grid-cols-1" : "grid-cols-2"}`
    : "grid grid-cols-1 items-center gap-8 md:grid-cols-2";
  const imageOrderClass = reversed
    ? stackedPreview
      ? ""
      : previewDevice
        ? "order-2"
        : "md:order-2"
    : "";
  const copyOrderClass = reversed
    ? stackedPreview
      ? ""
      : previewDevice
        ? "order-1"
        : "md:order-1"
    : "";

  return (
    <SectionShell style={section.style} previewDevice={previewDevice}>
      <div data-homepage-story-reversed={reversed} className={`${gridClass} ${layout?.className ?? ""}`.trim()} style={layout?.style}>
        <div data-homepage-role="media" className={imageOrderClass} style={layout?.imageStyle}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={heading} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover" style={layout?.imageStyle} />
          ) : (
            <PlaceholderImage label="" className={layout ? "h-full w-full rounded-xl" : "aspect-[4/3] w-full rounded-xl"} />
          )}
        </div>
        <div className={`flex flex-col gap-4 ${copyOrderClass}`}>
          {heading ? <h2 data-homepage-role="story-heading" className="text-3xl font-semibold text-ink">{heading}</h2> : null}
          {body ? <p data-homepage-role="body" className="whitespace-pre-line text-ink-secondary">{body}</p> : null}
          {product ? (
            <Link
              data-homepage-role="action"
              href={`/products/${product.slug}`}
              {...trackAttrs("ProductClick", section, 1)}
              className="text-sm font-semibold text-cta hover:underline"
            >
              {product.name}
            </Link>
          ) : null}
          {ctaLink && ctaText ? (
            <div>
              <ButtonLink data-homepage-role="action" href={ctaLink} variant="secondary" size="md">
                {ctaText}
              </ButtonLink>
            </div>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}
