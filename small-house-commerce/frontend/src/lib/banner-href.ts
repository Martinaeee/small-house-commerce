// Reject backslashes before URL parsing because WHATWG normalizes them to slashes.
export function isBannerHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || value[index] === "\\") return false;
  }
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  if (value.startsWith("#")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
