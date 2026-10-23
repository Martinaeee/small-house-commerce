import type { TKey } from "@/lib/admin-i18n";

/**
 * The column set of the order workbench (draft §A).
 *
 * The order of the keys is the order the operator reads the table in:
 * identity first (order no, customer, phone), then state, then the goods,
 * then the money, then time, then the address and the actions.
 */
export type WorkbenchColumnKey =
  | "no"
  | "customer"
  | "phone"
  | "status"
  | "product"
  | "sku"
  | "qty"
  | "unit"
  | "total"
  | "ship"
  | "at"
  | "note"
  | "address"
  | "region"
  | "history"
  | "actions"
  | "owner";

export interface WorkbenchColumn {
  key: WorkbenchColumnKey;
  labelKey: TKey;
  /** Default width in px; the operator can drag it. */
  width: number;
  /** `left` = first frozen column, `left2` = second frozen column. */
  sticky?: "left" | "left2" | "right";
  align?: "right";
  /** Hidden until the operator switches it on (column panel). */
  defaultHidden?: boolean;
}

export const WORKBENCH_COLUMNS: WorkbenchColumn[] = [
  { key: "no", labelKey: "orders_col_no", width: 132, sticky: "left" },
  { key: "customer", labelKey: "orders_col_customer", width: 118, sticky: "left2" },
  { key: "phone", labelKey: "orders_col_phone", width: 142 },
  { key: "status", labelKey: "orders_col_status", width: 168 },
  { key: "product", labelKey: "orders_col_product", width: 230 },
  { key: "sku", labelKey: "orders_col_sku", width: 196 },
  { key: "qty", labelKey: "orders_col_qty", width: 96, align: "right" },
  { key: "unit", labelKey: "orders_col_unit", width: 104, align: "right" },
  { key: "total", labelKey: "orders_col_total", width: 116, align: "right" },
  { key: "ship", labelKey: "orders_col_ship_cost", width: 112, align: "right", defaultHidden: true },
  { key: "at", labelKey: "orders_col_at", width: 140 },
  { key: "note", labelKey: "orders_col_note", width: 160 },
  { key: "address", labelKey: "orders_col_address", width: 200 },
  { key: "region", labelKey: "orders_col_region", width: 150 },
  { key: "history", labelKey: "orders_col_history", width: 104 },
  { key: "actions", labelKey: "orders_col_actions", width: 196, sticky: "right" },
  { key: "owner", labelKey: "orders_col_owner", width: 120, defaultHidden: true },
];

export const DEFAULT_HIDDEN_COLUMNS: WorkbenchColumnKey[] = WORKBENCH_COLUMNS.filter(
  (column) => column.defaultHidden,
).map((column) => column.key);

export const MIN_COLUMN_WIDTH = 72;

/** The columns the operator sees, in reading order. */
export function visibleColumns(
  hidden: readonly WorkbenchColumnKey[],
): WorkbenchColumn[] {
  return WORKBENCH_COLUMNS.filter((column) => !hidden.includes(column.key));
}

/**
 * The frozen columns need an explicit left offset, because the first column
 * can be resized: the second frozen column starts where the first one ends.
 */
export function stickyLeftOffsets(
  columns: readonly WorkbenchColumn[],
  widths: Readonly<Record<string, number>>,
): Record<string, number> {
  const offsets: Record<string, number> = {};
  let acc = 0;
  for (const column of columns) {
    if (column.sticky === "left") {
      offsets[column.key] = 0;
      acc = widths[column.key] ?? column.width;
    } else if (column.sticky === "left2") {
      offsets[column.key] = acc;
    }
  }
  return offsets;
}
