import { SectionPlaceholder } from "./SectionPlaceholder";
import { SectionHeading, SectionShell, SmartLink } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";
import { trackAttrs } from "@/lib/home-tracking";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function SolutionsSection({ section }: { section: HomepageSection }) {
  const items = Array.isArray(section.payload?.items) ? section.payload.items : [];

  return (
    <SectionShell className="scroll-mt-20">
      <div id="solutions" className="scroll-mt-20" />
      <SectionHeading title={section.title} subtitle={section.subtitle} />
      {items.length === 0 ? (
        <SectionPlaceholder inside message="Solution collections are being prepared." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.slice(0, 6).map((item, index) => {
            const row = item as { title?: unknown; blurb?: unknown; link?: unknown };
            return (
              <SmartLink
                key={index}
                href={str(row.link) || "/collections"}
                {...trackAttrs("SolutionClick", section, index + 1)}
                className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md"
              >
                <span className="text-base font-semibold text-ink group-hover:text-cta">
                  {str(row.title)}
                </span>
                {str(row.blurb) ? (
                  <span className="text-sm text-ink-secondary">{str(row.blurb)}</span>
                ) : null}
              </SmartLink>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}
