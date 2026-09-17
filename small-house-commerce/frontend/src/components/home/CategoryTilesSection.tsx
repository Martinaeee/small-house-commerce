import Link from "next/link";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

export function CategoryTilesSection({ section }: { section: HomepageSection }) {
  const categories = section.categories ?? [];

  if (categories.length === 0) {
    return <SectionPlaceholder title={section.title} message="Categories are being prepared — check back soon." />;
  }

  return (
    <SectionShell>
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {categories.map((category, index) => (
          <Link
            key={category.id}
            href={`/categories/${category.slug}`}
            {...trackAttrs("CategoryClick", section, index + 1)}
            className="group relative block aspect-square overflow-hidden rounded-lg"
          >
            {category.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={category.imageUrl}
                alt={category.name}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <PlaceholderImage label="" className="absolute inset-0 h-full w-full" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />
            <span className="absolute inset-x-0 bottom-0 p-3 text-sm font-semibold text-white">
              {category.name}
            </span>
          </Link>
        ))}
      </div>
    </SectionShell>
  );
}
