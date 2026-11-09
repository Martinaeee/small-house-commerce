import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_COLUMN_ORDER } from "./columns";
import { readColumnPrefs, writeColumnPrefs, readViews, writeViews } from "./prefs";

/**
 * Column layout is a browser preference. The order the operator dragged has
 * to survive a reload, and a corrupt or older payload has to fall back to a
 * table that still makes sense.
 */

const KEY = "luwag_orders_columns_v1";

beforeEach(() => {
  window.localStorage.clear();
});

describe("column prefs order", () => {
  it("keeps column order in saved views and upgrades legacy views without an order", () => {
    writeViews([{ id: "v1", name: "Morning", filters: { queue: "todo" }, hidden: ["phone"], widths: {}, order: ["total", "no"] }]);
    expect(readViews()[0].order.slice(0, 2)).toEqual(["total", "no"]);
    window.localStorage.setItem("luwag_orders_views_v1", JSON.stringify([{ id: "old", name: "Legacy", filters: {}, hidden: [], widths: {} }]));
    expect(readViews()[0].order).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it("round-trips the order the operator chose", () => {
    writeColumnPrefs({ hidden: [], widths: {}, order: ["total", "no"] });
    expect(readColumnPrefs().order.slice(0, 2)).toEqual(["total", "no"]);
    expect(readColumnPrefs().order).toHaveLength(DEFAULT_COLUMN_ORDER.length);
  });

  it("defaults to the reading order when nothing is saved", () => {
    expect(readColumnPrefs().order).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it("drops unknown keys and duplicates from a corrupt payload", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        hidden: [],
        widths: {},
        order: ["nope", 5, "phone", "phone"],
      }),
    );
    const order = readColumnPrefs().order;
    expect(order[0]).toBe("phone");
    expect(order.filter((key) => key === "phone")).toHaveLength(1);
    expect(order).toHaveLength(DEFAULT_COLUMN_ORDER.length);
  });

  it("appends columns a stale payload never knew about", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ hidden: [], widths: {}, order: ["customer", "no"] }),
    );
    const order = readColumnPrefs().order;
    expect(order.slice(0, 2)).toEqual(["customer", "no"]);
    expect(order).toHaveLength(DEFAULT_COLUMN_ORDER.length);
  });

  it("keeps an older payload without an order readable", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ hidden: ["ship"], widths: { total: 120 } }),
    );
    const prefs = readColumnPrefs();
    expect(prefs.hidden).toEqual(["ship"]);
    expect(prefs.widths.total).toBe(120);
    expect(prefs.order).toEqual(DEFAULT_COLUMN_ORDER);
  });
});
