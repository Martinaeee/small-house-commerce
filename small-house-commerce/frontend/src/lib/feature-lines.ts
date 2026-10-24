/**
 * Feature bullets are stored one per line in the product's `features` column.
 * A line that starts with this marker stays in the admin list but is not shown
 * on the storefront. Keeping the flag on the line itself means reordering or
 * editing never loses which bullet was hidden.
 */
export const HIDDEN_FEATURE_PREFIX = "[hidden] ";

export function isHiddenFeatureLine(line: string): boolean {
  return line.startsWith(HIDDEN_FEATURE_PREFIX);
}

export function featureLineText(line: string): string {
  return isHiddenFeatureLine(line)
    ? line.slice(HIDDEN_FEATURE_PREFIX.length)
    : line;
}

export function toggleFeatureLineVisibility(line: string): string {
  return isHiddenFeatureLine(line)
    ? featureLineText(line)
    : `${HIDDEN_FEATURE_PREFIX}${line}`;
}

export function parseFeatureLines(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Storefront-facing bullets: hidden entries and the marker are dropped. */
export function visibleFeatureLines(raw: string | null | undefined): string[] {
  return parseFeatureLines(raw)
    .filter((line) => !isHiddenFeatureLine(line))
    .map((line) => featureLineText(line).trim())
    .filter(Boolean);
}

export function serializeFeatureLines(
  rows: readonly { text: string; hidden: boolean }[],
): string | null {
  const lines = rows
    .map(({ text, hidden }) => {
      const trimmed = text.trim();
      return hidden ? `${HIDDEN_FEATURE_PREFIX}${trimmed}` : trimmed;
    })
    .filter((line) => featureLineText(line).trim() !== "");
  return lines.length > 0 ? lines.join("\n") : null;
}
