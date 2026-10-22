import type { TKey } from "@/lib/admin-i18n";

/**
 * The API identifies its rows by stable key; the wording belongs to the
 * interface. These maps translate one into the other, and an unknown key
 * falls back to the key itself rather than rendering an empty line.
 */

const ATTENTION_LABEL: Record<string, TKey> = {
  AWAITING_FULFILLMENT: "dash_attention_awaiting_fulfillment",
  COD_TO_CONFIRM: "dash_attention_cod_to_confirm",
  FAILED_PAYMENTS: "dash_attention_failed_payments",
  REFUNDS_AFTER_SALES: "dash_attention_refunds_after_sales",
  LOW_STOCK: "dash_attention_low_stock",
  OUT_OF_STOCK: "dash_attention_out_of_stock",
  SCHEDULED_SOON: "dash_attention_scheduled_soon",
};

const ATTENTION_HINT: Record<string, TKey> = {
  FAILED_PAYMENTS_HINT: "dash_attention_failed_payments_hint",
  REFUNDS_AFTER_SALES_HINT: "dash_attention_refunds_after_sales_hint",
};

const TILE_LABEL: Record<string, TKey> = {
  TO_FULFILL: "dash_tile_to_fulfill",
  AWAITING_PAYMENT: "dash_tile_awaiting_payment",
  PROCESSING: "dash_tile_processing",
  SHIPPED: "dash_tile_shipped",
  DELIVERED: "dash_tile_delivered",
  CANCELLED: "dash_tile_cancelled",
  REFUND_REQUESTED: "dash_tile_refund_requested",
};

const PRODUCT_ISSUE_LABEL: Record<string, TKey> = {
  LOW_CONVERSION: "dash_issue_low_conversion",
  HIGH_CANCELLATION: "dash_issue_high_cancellation",
  HIGH_REFUND: "dash_issue_high_refund",
  LOW_TRAFFIC: "dash_issue_low_traffic",
  OUT_OF_STOCK: "dash_issue_out_of_stock",
};

const PRODUCT_ISSUE_DETAIL: Record<string, TKey> = {
  LOW_CONVERSION: "dash_attention_detail_low_conversion",
  HIGH_CANCELLATION: "dash_attention_detail_high_cancellation",
  HIGH_REFUND: "dash_attention_detail_high_refund",
  LOW_TRAFFIC: "dash_attention_detail_low_traffic",
  OUT_OF_STOCK: "dash_attention_detail_out_of_stock",
};

const DATA_NOTE: Record<string, TKey> = {
  TRAFFIC: "dash_note_traffic",
  PRODUCT_COST: "dash_note_product_cost",
  SHIPPING_COST: "dash_note_shipping_cost",
  PAYMENT_FEE: "dash_note_payment_fee",
  REFUND_AMOUNT: "dash_note_refund_amount",
};

export function attentionLabelKey(key: string): TKey | null {
  return ATTENTION_LABEL[key] ?? null;
}

export function attentionHintKey(key: string | undefined): TKey | null {
  return key ? (ATTENTION_HINT[key] ?? null) : null;
}

export function tileLabelKey(key: string): TKey | null {
  return TILE_LABEL[key] ?? null;
}

export function productIssueLabelKey(issue: string): TKey | null {
  return PRODUCT_ISSUE_LABEL[issue] ?? null;
}

export function productIssueDetailKey(issue: string): TKey | null {
  return PRODUCT_ISSUE_DETAIL[issue] ?? null;
}

export function dataNoteKey(key: string): TKey | null {
  return DATA_NOTE[key] ?? null;
}
