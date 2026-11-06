import type { TKey } from "@/lib/admin-i18n";

/**
 * Common phone outcomes operators pick from when they leave a follow-up note.
 * The text stays editable after insertion, so this only saves typing.
 */
export const FOLLOW_UP_NOTE_TEMPLATES = [
  { id: "CHECK_PURCHASE", key: "checkout_drafts_followup_template_check_purchase" },
  { id: "NO_ANSWER", key: "checkout_drafts_followup_template_no_answer" },
  { id: "RECONSIDER", key: "checkout_drafts_followup_template_reconsider" },
  { id: "CONFIRM_DETAILS", key: "checkout_drafts_followup_template_confirm_details" },
  { id: "WAITING_ADDRESS", key: "checkout_drafts_followup_template_waiting_address" },
  { id: "DECLINED", key: "checkout_drafts_followup_template_declined" },
] as const;

export type FollowUpNoteTemplateId = (typeof FOLLOW_UP_NOTE_TEMPLATES)[number]["id"];

/** Resolve a template id to its note text, filling in the draft's first product. */
export function followUpNoteFromTemplate(
  id: string,
  productName: string | null | undefined,
  t: (key: TKey) => string,
): string | null {
  const template = FOLLOW_UP_NOTE_TEMPLATES.find((item) => item.id === id);
  if (!template) return null;
  const product = productName?.trim() || t("checkout_drafts_followup_template_product_fallback");
  return t(template.key).replace("{product}", product);
}
