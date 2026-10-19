/**
 * crypto.randomUUID exists only in secure contexts; the production admin is
 * served over plain http where it is undefined. Fall back to a collision-safe
 * locally-generated id so admin add/duplicate flows keep working.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
