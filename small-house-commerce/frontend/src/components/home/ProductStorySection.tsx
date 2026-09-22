import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionShell } from "./sectionShell";
import type { HomepageSection, Product } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function ProductStorySection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const product = (p.product ?? null) as Product | null;
  // Effective cover media from the backend contract — never images[0].
  const image =
    str(p.imageUrl) || product?.effectiveCoverMedia?.url || "";
  const heading = str(p.heading) || section.title || "";
  const body = str(p.body);
  const ctaLink = str(p.ctaLink) || (product ? `/products/${product.slug}` : "");
  const ctaText = str(p.ctaText) || (product ? "Shop this pick" : "");

  if (!image && !body && !product) {
    return <SectionPlaceholder title={section.title} message="Story coming soon." />;
  }

  // sortOrder 40 -> image left; sortOrder 60 -> image right.
  const reversed = section.sortOrder >= 55;

  return (
    <SectionShell>
      <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2">
        <div className={reversed ? "md:order-2" : ""}>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={heading} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover" />
          ) : (
            <PlaceholderImage label="" className="aspect-[4/3] w-full rounded-xl" />
          )}
        </div>
        <div className={`flex flex-col gap-4 ${reversed ? "md:order-1" : ""}`}>
          {heading ? <h2 className="text-3xl font-semibold text-ink">{heading}</h2> : null}
          {body ? <p className="whitespace-pre-line text-ink-secondary">{body}</p> : null}
          {product ? (
            <Link
              href={`/products/${product.slug}`}
              {...trackAttrs("ProductClick", section, 1)}
              className="text-sm font-semibold text-cta hover:underline"
            >
              {product.name}
            </Link>
          ) : null}
          {ctaLink && ctaText ? (
            <div>
              <ButtonLink href={ctaLink} variant="secondary" size="md">
                {ctaText}
              </ButtonLink>
            </div>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}
