import Link from "next/link";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { CategoryRail } from "./CategoryRail";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { HomepageContentImage } from "./HomepageContentImage";
import { SectionHeading, SectionShell } from "./sectionShell";
import type { SectionProps } from "./sectionRegistry";
import { trackAttrs } from "@/lib/home-tracking";
import { moduleLayoutPresentation } from "@/lib/homepage-responsive";
import styles from "./CategoryTilesSection.module.css";

export function CategoryTilesSection({ section, previewDevice, interactionMode, appearance }: SectionProps) {
  const categories = section.categories ?? [];
  const layout = moduleLayoutPresentation("CATEGORY_TILES", section.payload?.layout, previewDevice, undefined, appearance);
  const gridClass =
    previewDevice === "desktop"
      ? "grid grid-cols-6 gap-4"
      : previewDevice === "tablet"
        ? "grid grid-cols-3 gap-4"
        : previewDevice === "mobile"
          ? "grid grid-cols-2 gap-4"
          : "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6";

  if (section.navigationEntries !== undefined || "entries" in section.payload) {
    const entries = section.navigationEntries ?? [];
    if (entries.length === 0) return null;
    const circles = section.payload.presentation === "CIRCLES";
    return (
      <SectionShell style={section.style} previewDevice={previewDevice}>
        <SectionHeading title={section.title} subtitle={section.subtitle} />
        <CategoryRail className={`${gridClass} ${layout?.className ?? ""}`.trim()} style={layout?.style} label="Shop by category">
          {entries.map((entry, index) => (
            <div key={entry.id} data-homepage-navigation-entry={entry.id} className="min-w-0">
              <Link href={entry.href} aria-label={entry.name}
                {...(interactionMode === "preview" ? {} : trackAttrs("CategoryClick", section, index + 1))}
                className={circles ? styles.circle : styles.tile} style={circles ? undefined : layout?.imageStyle}>
                {entry.imageUrl ? (
                  <HomepageContentImage src={entry.imageUrl} className="h-full w-full" />
                ) : <PlaceholderImage label="" className="h-full w-full" />}
              </Link>
              <p data-homepage-role="label" title={entry.name} className={styles.label}>{entry.name}</p>
            </div>
          ))}
        </CategoryRail>
      </SectionShell>
    );
  }

  if (categories.length === 0) {
    return (
      <SectionPlaceholder
        title={section.title}
        message="Categories are being prepared — check back soon."
        style={section.style}
        previewDevice={previewDevice}
      />
    );
  }

  return (
    <SectionShell style={section.style} previewDevice={previewDevice}>
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      <CategoryRail className={`${gridClass} ${layout?.className ?? ""}`.trim()} style={layout?.style} label="Shop by category">
        {categories.map((category, index) => (
          <Link
            key={category.id}
            href={`/categories/${category.slug}`}
            {...trackAttrs("CategoryClick", section, index + 1)}
            className="group relative block aspect-square overflow-hidden rounded-lg"
            style={layout?.imageStyle}
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
            <span data-homepage-role="label" className="absolute inset-x-0 bottom-0 p-3 text-sm font-semibold text-white">
              {category.name}
            </span>
          </Link>
        ))}
      </CategoryRail>
    </SectionShell>
  );
}
