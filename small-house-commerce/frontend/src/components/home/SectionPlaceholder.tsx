import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { SectionShell } from "./sectionShell";
import type { HomepageDevice } from "@/lib/homepage-document";

/**
 * Empty-content state for CMS sections with nothing configured yet.
 * Copy is deliberately neutral (spec §8: no invented people/quotes/photos).
 */
export function SectionPlaceholder({
  title,
  message,
  inside = false,
  style,
  previewDevice,
}: {
  title?: string | null;
  message: string;
  /** Render without SectionShell, inside a component that already has one. */
  inside?: boolean;
  style?: unknown;
  previewDevice?: HomepageDevice;
}) {
  const card = (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-background p-8 text-center">
      <PlaceholderImage label="" className="h-16 w-16 rounded-lg opacity-60" />
      {title ? <h2 className="text-2xl font-semibold text-ink">{title}</h2> : null}
      <p className="max-w-md text-sm text-ink-secondary">{message}</p>
    </div>
  );
  return inside ? card : <SectionShell style={style} previewDevice={previewDevice}>{card}</SectionShell>;
}
