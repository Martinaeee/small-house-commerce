import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell, SmartLink } from "./sectionShell";
import type { SectionProps } from "./sectionRegistry";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function SolutionsSection({ section, previewDevice }: SectionProps) {
  const items = Array.isArray(section.payload?.items) ? section.payload.items : [];
  const gridClass =
    previewDevice === "desktop"
      ? "grid grid-cols-3 gap-4"
      : previewDevice === "tablet"
        ? "grid grid-cols-2 gap-4"
        : previewDevice === "mobile"
          ? "grid grid-cols-1 gap-4"
          : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <SectionShell className="scroll-mt-20" style={section.style} previewDevice={previewDevice}>
      <div id="solutions" className="scroll-mt-20" />
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      {items.length === 0 ? (
        <SectionPlaceholder inside message="Solution collections are being prepared." />
      ) : (
        <div className={gridClass}>
          {items.slice(0, 6).map((item, index) => {
            const row = item as { title?: unknown; blurb?: unknown; link?: unknown };
            return (
              <SmartLink
                data-homepage-role="card"
                key={index}
                href={str(row.link) || "/collections"}
                {...trackAttrs("SolutionClick", section, index + 1)}
                className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md"
              >
                <span data-homepage-role="label" className="text-base font-semibold text-ink group-hover:text-cta">
                  {str(row.title)}
                </span>
                {str(row.blurb) ? (
                  <span data-homepage-role="body" className="text-sm text-ink-secondary">{str(row.blurb)}</span>
                ) : null}
              </SmartLink>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}
