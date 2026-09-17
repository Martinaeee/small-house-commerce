/**
 * Recently Viewed product ids, localStorage "sh:rv".
 * Newest first, de-duplicated, capped at 12. SSR-safe: every read returns [].
 */
const KEY = "sh:rv";
const MAX = 12;

export function getRecentProductIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

export function recordProductView(id: string): string[] {
  if (typeof window === "undefined") return [];
  const ids = [id, ...getRecentProductIds().filter((x) => x !== id)].slice(0, MAX);
  window.localStorage.setItem(KEY, JSON.stringify(ids));
  return ids;
}
