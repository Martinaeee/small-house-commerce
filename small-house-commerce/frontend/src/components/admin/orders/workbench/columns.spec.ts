import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMN_ORDER,
  WORKBENCH_COLUMNS,
  moveColumnKey,
  stickyLeftOffsets,
  visibleColumns,
  type WorkbenchColumnKey,
} from "./columns";

/**
 * The operator decides the reading order of the table, not the person who
 * wrote the column list: `visibleColumns` is what turns the saved order into
 * the table. A saved order is untrusted (localStorage can hold anything).
 */

const moved = (from: WorkbenchColumnKey, to: number): WorkbenchColumnKey[] =>
  visibleColumns([], DEFAULT_COLUMN_ORDER)
    .map((column) => column.key)
    .filter((key) => key !== from)
    .flatMap((key, index) => (index === to ? [from, key] : [key]));

describe("visibleColumns", () => {
  it("keeps the default reading order when the operator has not moved anything", () => {
    expect(
      visibleColumns([], DEFAULT_COLUMN_ORDER).map((column) => column.key),
    ).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it("reads the table in the saved order", () => {
    const order = moved("at", 0);
    expect(visibleColumns([], order).map((column) => column.key)).toEqual(
      order,
    );
  });

  it("hides a column wherever it sits in the order", () => {
    const keys = visibleColumns(["phone"], moved("total", 1)).map(
      (column) => column.key,
    );
    expect(keys).not.toContain("phone");
    expect(keys[1]).toBe("total");
  });

  it("appends keys that a stale saved order does not know yet", () => {
    const keys = visibleColumns([], ["total", "no"]).map(
      (column) => column.key,
    );
    expect(keys[0]).toBe("total");
    expect(keys[1]).toBe("no");
    expect(keys.slice(2)).toEqual(
      DEFAULT_COLUMN_ORDER.filter((key) => key !== "total" && key !== "no"),
    );
  });

  it("keeps frozen offsets correct when customer and order number swap places", () => {
    const columns = visibleColumns([], ["customer", "no"]);
    const offsets = stickyLeftOffsets(columns, { customer: 160 });
    expect(offsets.customer).toBe(0);
    expect(offsets.no).toBe(160);
  });

  it("does not keep moved columns pinned over the operator's chosen reading order", () => {
    const columns = visibleColumns([], ["phone", "actions", "no", "customer"]);
    expect(columns.find((c) => c.key === "no")?.sticky).toBeUndefined();
    expect(columns.find((c) => c.key === "customer")?.sticky).toBeUndefined();
    expect(columns.find((c) => c.key === "actions")?.sticky).toBeUndefined();
    const original = visibleColumns([]);
    expect(original[0].sticky).toBe("left");
    expect(original[1].sticky).toBe("left2");
  });

  it("ignores unknown and duplicated keys in a corrupt saved order", () => {
    const keys = visibleColumns(
      [],
      ["phone", "phone", "nope" as WorkbenchColumnKey, "customer"],
    ).map((column) => column.key);
    expect(keys[0]).toBe("phone");
    expect(keys.filter((key) => key === "phone")).toHaveLength(1);
    expect(keys).toContain("customer");
    expect(keys).toHaveLength(WORKBENCH_COLUMNS.length);
  });
});

describe("moveColumnKey", () => {
  const order = [...DEFAULT_COLUMN_ORDER];

  it("moves a column to the position it was dropped on", () => {
    expect(moveColumnKey(order, 0, 3).slice(0, 4)).toEqual([
      order[1],
      order[2],
      order[3],
      order[0],
    ]);
  });

  it("moves a column backwards", () => {
    expect(moveColumnKey(order, 5, 1).slice(0, 3)).toEqual([
      order[0],
      order[5],
      order[1],
    ]);
  });

  it("leaves the order alone for impossible moves", () => {
    expect(moveColumnKey(order, 2, 2)).toEqual(order);
    expect(moveColumnKey(order, -1, 4)).toEqual(order);
    expect(moveColumnKey(order, 2, order.length)).toEqual(order);
  });

  it("does not mutate the order it was given", () => {
    const original = [...order];
    moveColumnKey(order, 0, 4);
    expect(order).toEqual(original);
  });
});
