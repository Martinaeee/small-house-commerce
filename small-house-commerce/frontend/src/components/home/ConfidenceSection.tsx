import { sectionStylePresentation } from "./sectionShell";
import type { SectionProps } from "./sectionRegistry";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function ConfidenceSection({ section, previewDevice }: SectionProps) {
  const p = section.payload ?? {};
  const heading = str(p.heading) || section.title || "Shop with confidence";
  const body = str(p.body);
  const bullets = Array.isArray(p.bullets) ? p.bullets.map((b) => str(b)).filter(Boolean) : [];

  const presentation = sectionStylePresentation(section.style);
  const innerStyle = {
    paddingTop: presentation.style.paddingTop === undefined ? 48 : 0,
    paddingBottom: presentation.style.paddingBottom === undefined ? 48 : 0,
  };
  const horizontalPaddingClass =
    previewDevice === "mobile"
      ? "px-4"
      : previewDevice
        ? "px-6"
        : "px-4 sm:px-6";
  const bulletsClass =
    previewDevice === "mobile"
      ? "grid grid-cols-1 gap-3"
      : previewDevice
        ? "grid grid-cols-3 gap-3"
        : "grid grid-cols-1 gap-3 md:grid-cols-3";

  return (
    <section
      className={`border-t border-border bg-card ${presentation.textColorClass}`.trim()}
      style={presentation.style}
    >
      <div
        className={`mx-auto ${presentation.widthClass} ${horizontalPaddingClass}`}
        style={innerStyle}
      >
        <h2 className="mb-4 text-2xl font-semibold text-ink">{heading}</h2>
        {body ? <p className="mb-4 max-w-2xl text-ink-secondary">{body}</p> : null}
        {bullets.length > 0 ? (
          <ul className={bulletsClass}>
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
