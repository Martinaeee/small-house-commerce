import type { TKey } from "@/lib/admin-i18n";
import type { AdminFaqAnswerBlock, AdminFaqCategory, AdminFaqItem, AdminFaqMode } from "@/lib/admin-api";

export const FAQ_CATEGORY_LABEL_KEYS: Record<AdminFaqCategory, TKey> = {
  DELIVERY: "faq_category_delivery",
  PAYMENT_COD: "faq_category_payment_cod",
  RETURNS: "faq_category_returns",
  INSTALLATION: "faq_category_installation",
  UNCATEGORIZED: "faq_category_uncategorized",
};

export const FAQ_MODE_BADGE_KEYS: Record<AdminFaqMode, TKey> = {
  SHARED: "faq_mode_badge_shared",
  EXTEND: "faq_mode_badge_extend",
  CUSTOM: "faq_mode_badge_custom",
};

/** Legacy questions carry no category; they belong to UNCATEGORIZED, never guessed. */
export function faqCategoryOf(item: AdminFaqItem): AdminFaqCategory {
  return item.category ?? "UNCATEGORIZED";
}

/**
 * Whether a shared-library question applies to this product id. Absent
 * audience (legacy) and `ALL` both reach every inheriting product; a targeted
 * question only reaches its selection, and never "everything" when the
 * current product is unknown.
 */
export function audienceAppliesTo(
  item: AdminFaqItem,
  productId: string | null,
): boolean {
  const audience = item.audience;
  if (!productId) return !audience || audience.scope === "ALL";
  if (!audience || audience.scope === "ALL") return true;
  return audience.productIds.includes(productId);
}

/** One-line answer preview for list rows; the full answer lives in the dialog. */
export function answerSummary(answer: AdminFaqAnswerBlock[]): string {
  return answer
    .map((block) =>
      block.kind === "paragraph" ? block.text : block.items.join(" · "),
    )
    .join(" ");
}

export interface FaqRowFilters {
  search: string;
  status: "all" | "enabled" | "disabled";
  /** ISO timestamp; rows without a recorded time never match a recency filter. */
  updatedSince: string | null;
  /** Shared-library audience filter, not a product FAQ relationship. */
  productId?: string | null;
}

export function itemMatchesFilters(item: AdminFaqItem, filters: FaqRowFilters): boolean {
  if (filters.productId && !audienceAppliesTo(item, filters.productId)) return false;
  if (filters.status !== "all" && item.enabled !== (filters.status === "enabled")) {
    return false;
  }
  if (filters.updatedSince && (!item.updatedAt || item.updatedAt < filters.updatedSince)) {
    return false;
  }
  const query = filters.search.trim().toLowerCase();
  if (query) {
    const text = `${item.title} ${answerSummary(item.answer)}`.toLowerCase();
    if (!text.includes(query)) return false;
  }
  return true;
}

export function formatUpdatedAt(
  updatedAt: string | undefined,
  lang: string,
  unknownLabel: string,
): string {
  if (!updatedAt) return unknownLabel;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return unknownLabel;
  return date.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Re-inserts a moved item at a 0-based position and renumbers the rest. */
export function withPositions<T extends { position: number }>(items: T[]): T[] {
  return items.map((item, position) => ({ ...item, position }));
}

export function moveItemToIndex<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return items;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}
