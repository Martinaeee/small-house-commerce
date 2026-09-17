import Link from "next/link";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { HomepageSection, Product } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function UgcSection({ section }: { section: HomepageSection }) {
  const entries = Array.isArray(section.payload?.entries) ? section.payload.entries : [];

  if (entries.length === 0) {
    return <SectionPlaceholder title={section.title} message="Real home photos coming soon." />;
  }

  return (
    <SectionShell>
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.slice(0, 6).map((entry, index) => {
          const row = entry as {
            imageUrl?: unknown;
            name?: unknown;
            location?: unknown;
            comment?: unknown;
            product?: Product;
          };
          const image = str(row.imageUrl);
          return (
            <figure
              key={index}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              ) : (
                <PlaceholderImage label="" className="aspect-square w-full" />
              )}
              <figcaption className="flex flex-1 flex-col gap-2 p-4">
                <blockquote className="flex-1 text-sm text-ink-secondary">
                  “{str(row.comment)}”
                </blockquote>
                <p className="text-sm font-semibold text-ink">
                  {str(row.name)}
                  {str(row.location) ? (
                    <span className="font-normal text-ink-muted"> · {str(row.location)}</span>
                  ) : null}
                </p>
                {row.product ? (
                  <Link
                    href={`/products/${row.product.slug}`}
                    {...trackAttrs("ProductClick", section, index + 1)}
                    className="text-sm font-semibold text-cta hover:underline"
                  >
                    Shop {row.product.name}
                  </Link>
                ) : null}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </SectionShell>
  );
}
