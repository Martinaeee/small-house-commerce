import { SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function BrandStorySection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const heading = str(p.heading) || section.title || "";
  const body = str(p.body);
  const bullets = Array.isArray(p.bullets) ? p.bullets.map((b) => str(b)).filter(Boolean) : [];

  return (
    <SectionShell>
      <div className="max-w-3xl">
        {heading ? <h2 className="mb-3 text-2xl font-semibold text-ink">{heading}</h2> : null}
        {body ? <p className="leading-relaxed text-ink-secondary">{body}</p> : null}
        {bullets.length > 0 ? (
          <ul className="mt-5 flex flex-col gap-2 text-ink-secondary">
            {bullets.slice(0, 6).map((bullet, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="font-semibold text-cta">✓</span>
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </SectionShell>
  );
}
