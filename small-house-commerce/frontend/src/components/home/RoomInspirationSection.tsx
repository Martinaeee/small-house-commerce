import Link from "next/link";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function RoomInspirationSection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const image = str(p.imageUrl);
  const heading = str(p.heading) || section.title || "";
  const body = str(p.body);
  const products = section.products ?? [];

  if (!image && products.length === 0 && !body) {
    return <SectionPlaceholder title={section.title} message="Room inspiration coming soon." />;
  }

  return (
    <SectionShell>
      <SectionHeading title={heading} />
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={heading} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover" />
          ) : (
            <PlaceholderImage label="" className="aspect-[4/3] w-full rounded-xl" />
          )}
          {body ? <p className="mt-4 text-ink-secondary">{body}</p> : null}
        </div>
        {products.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
              Shop this room
            </h3>
            {products.map((product, index) => {
              const thumb = product.images[0]?.url;
              return (
                <Link
                  key={product.id}
                  href={`/products/${product.slug}`}
                  {...trackAttrs("ProductClick", section, index + 1)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-shadow hover:shadow-md"
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" loading="lazy" className="h-16 w-16 rounded-md object-cover" />
                  ) : (
                    <PlaceholderImage label="" className="h-16 w-16 rounded-md" />
                  )}
                  <span className="line-clamp-2 flex-1 text-sm font-medium text-ink">
                    {product.name}
                  </span>
                  {product.badge ? (
                    <span className="rounded bg-primary-light/60 px-2 py-1 text-xs text-cta">
                      {product.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
