import type { ReactNode } from "react";
import { TrustBar } from "@/components/ui/TrustBar";
import { SectionShell } from "./sectionShell";
import type { HomepageSection } from "@/lib/api";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function UspIcon({ icon }: { icon?: string }): ReactNode {
  const common = "h-6 w-6 text-cta";
  switch (icon) {
    case "home":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M3 11l9-8 9 8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "lock":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
        </svg>
      );
    case "truck":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" strokeLinejoin="round" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      );
    case "shield":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={common}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" strokeLinejoin="round" />
          <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

export function UspSection({ section }: { section: HomepageSection }) {
  const items = Array.isArray(section.payload?.items) ? section.payload.items : [];
  if (items.length === 0) {
    return (
      <SectionShell className="py-10">
        <TrustBar />
      </SectionShell>
    );
  }

  return (
    <SectionShell className="py-10">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {items.slice(0, 4).map((item, index) => (
          <div key={index} className="flex flex-col items-center gap-2 text-center">
            <UspIcon icon={str((item as { icon?: unknown }).icon) || undefined} />
            <span className="text-sm font-semibold text-ink">
              {str((item as { label?: unknown }).label)}
            </span>
            {str((item as { sub?: unknown }).sub) ? (
              <span className="text-xs text-ink-secondary">
                {str((item as { sub?: unknown }).sub)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
