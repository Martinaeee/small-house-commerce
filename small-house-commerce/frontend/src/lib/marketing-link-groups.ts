import type { CampaignLinkRow } from "./marketing-api";

export type LinkGroupKey = "FB_POST" | "META_AD" | "OTHER";

export interface LinkGroup {
  key: LinkGroupKey;
  rows: CampaignLinkRow[];
}

const order: LinkGroupKey[] = ["FB_POST", "META_AD", "OTHER"];

function bucket(row: CampaignLinkRow): LinkGroupKey {
  if (row.sourceType === "FB_POST") return "FB_POST";
  if (row.sourceType === "META_AD") return "META_AD";
  return "OTHER";
}

/**
 * Newest registered post date first, undated posts last, then newest record.
 * Meta ads and other sources carry no post date, so they end up ordered by
 * creation time — the same order the table used before grouping.
 */
function newestFirst(a: CampaignLinkRow, b: CampaignLinkRow): number {
  const left = a.postDate ?? "";
  const right = b.postDate ?? "";
  if (left !== right) {
    if (!left) return 1;
    if (!right) return -1;
    return left < right ? 1 : -1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}

export function groupLinksBySource(rows: CampaignLinkRow[]): LinkGroup[] {
  const buckets: Record<LinkGroupKey, CampaignLinkRow[]> = { FB_POST: [], META_AD: [], OTHER: [] };
  for (const row of rows) buckets[bucket(row)].push(row);
  return order
    .map((key) => ({ key, rows: buckets[key].sort(newestFirst) }))
    .filter((group) => group.rows.length > 0);
}
