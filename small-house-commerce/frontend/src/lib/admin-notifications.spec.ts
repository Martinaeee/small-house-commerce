import { describe, expect, it } from "vitest";
import {
  ADMIN_NOTIFICATION_HREFS,
  adminNotificationHref,
  parseAdminNotificationsResponse,
  type AdminNotificationItem,
} from "./admin-notifications";

const validItems = [
  {
    kind: "ORDER_NEEDS_REVIEW",
    count: 1,
    href: "/admin/orders?confirmation=NEEDS_REVIEW",
  },
  {
    kind: "ORDER_UNCONFIRMED",
    count: 2,
    href: "/admin/orders?confirmation=UNCONFIRMED",
  },
  {
    kind: "PRODUCT_MISSING_MEDIA",
    count: 3,
    href: "/admin/products?attention=missing_media",
  },
  {
    kind: "PRODUCT_NO_PRICED_SKU",
    count: 4,
    href: "/admin/products?attention=no_priced_sku",
  },
  {
    kind: "PRODUCT_INCOMPLETE_SHIPPING",
    count: 5,
    href: "/admin/products?attention=incomplete_shipping",
  },
  {
    kind: "PRODUCT_STALE_DRAFT",
    count: 0,
    href: "/admin/products?attention=stale_draft",
  },
] as const;

function payload(items: readonly unknown[] = validItems, totalCount = 15) {
  return { totalCount, items };
}

describe("parseAdminNotificationsResponse", () => {
  it("accepts every allowlisted kind with exact hrefs and non-negative integer counts", () => {
    expect(parseAdminNotificationsResponse(payload())).toEqual(payload());
    expect(ADMIN_NOTIFICATION_HREFS).toEqual(
      Object.fromEntries(validItems.map(({ kind, href }) => [kind, href])),
    );
  });

  it.each([
    ["a non-object response", null],
    ["a non-array items field", { totalCount: 0, items: null }],
    [
      "an unknown kind",
      payload([
        {
          kind: "INVENTORY_LOW",
          count: 1,
          href: "/admin/inventory",
        },
      ], 1),
    ],
    [
      "a mismatched href",
      payload([
        {
          ...validItems[0],
          href: "/admin/orders?confirmation=UNCONFIRMED",
        },
      ], 1),
    ],
    [
      "an external href",
      payload([
        {
          ...validItems[0],
          href: "https://example.com/admin/orders",
        },
      ], 1),
    ],
    [
      "a negative count",
      payload([{ ...validItems[0], count: -1 }], -1),
    ],
    [
      "a fractional count",
      payload([{ ...validItems[0], count: 1.5 }], 1.5),
    ],
    [
      "a duplicate kind",
      payload([validItems[0], validItems[0]], 2),
    ],
    ["a total mismatch", payload(validItems, 14)],
  ])("rejects %s", (_label, value) => {
    expect(() => parseAdminNotificationsResponse(value)).toThrow(
      "Invalid admin notifications response",
    );
  });
});

describe("adminNotificationHref", () => {
  it("derives navigation from the allowlisted kind after verifying the wire href", () => {
    expect(
      adminNotificationHref({
        kind: "ORDER_UNCONFIRMED",
        count: 2,
        href: "/admin/orders?confirmation=UNCONFIRMED",
      }),
    ).toBe("/admin/orders?confirmation=UNCONFIRMED");
  });

  it("fails closed for a mismatched or unknown item", () => {
    expect(
      adminNotificationHref({
        kind: "ORDER_UNCONFIRMED",
        count: 2,
        href: "https://example.com",
      } as unknown as AdminNotificationItem),
    ).toBeNull();
    expect(
      adminNotificationHref({
        kind: "INVENTORY_LOW",
        count: 2,
        href: "/admin/inventory",
      } as unknown as AdminNotificationItem),
    ).toBeNull();
  });
});
