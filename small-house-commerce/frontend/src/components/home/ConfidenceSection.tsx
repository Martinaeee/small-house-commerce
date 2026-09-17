import type { HomepageSection } from "@/lib/api";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function ConfidenceSection({ section }: { section: HomepageSection }) {
  const p = section.payload ?? {};
  const heading = str(p.heading) || section.title || "Shop with confidence";
  const body = str(p.body);
  const bullets = Array.isArray(p.bullets) ? p.bullets.map((b) => str(b)).filter(Boolean) : [];

  return (
    <section className="border-t border-border bg-card">
      <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
        <h2 className="mb-4 text-2xl font-semibold text-ink">{heading}</h2>
        {body ? <p className="mb-4 max-w-2xl text-ink-secondary">{body}</p> : null}
        {bullets.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {bullets.slice(0, 6).map((bullet, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-border bg-background p-4 text-ink-secondary"
              >
                <span className="font-semibold text-cta">✓</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
