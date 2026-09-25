import { describe, expect, it } from "vitest";
import type {
  AdminSearchResponse,
  CustomerSearchHit,
  OrderSearchHit,
  ProductSearchHit,
  ShipmentSearchHit,
} from "./admin-api";
import {
  ADMIN_SEARCH_GROUPS,
  adminSearchHitHref,
  adminSearchOptionId,
  flattenAdminSearchResults,
} from "./admin-search";

function productSkuHit(skuCode = "SKU-1"): ProductSearchHit {
  return {
    kind: "PRODUCT",
    productId: "p1",
    name: "Chair",
    productCode: "P-000001",
    slug: "chair",
    status: "ACTIVE",
    matchedField: "SKU_CODE",
    matchedText: skuCode,
    matchedSku: {
      skuId: "s1",
      skuCode,
      skuStatus: "ACTIVE",
      variantId: "v1",
      variantName: "Large",
      price: "1590",
      availableInventory: 7,
    },
  };
}

function orderHit(): OrderSearchHit {
  return {
    kind: "ORDER",
    orderId: "o1",
    orderNumber: "PH-000001",
    orderStatus: "NEW",
    confirmationStatus: "UNCONFIRMED",
    customerName: "Jane",
    normalizedPhone: "+639171234567",
    createdAt: "2026-09-25T00:00:00.000Z",
    matchedField: "ORDER_NUMBER",
    matchedText: "PH-000001",
  };
}

function customerHit(): CustomerSearchHit {
  return {
    kind: "CUSTOMER",
    customerId: "c1",
    name: "Jane",
    normalizedPhone: "+639171234567",
    email: null,
    riskLevel: "NORMAL",
    matchedField: "NAME",
    matchedText: "Jane",
  };
}

function shipmentHit(): ShipmentSearchHit {
  return {
    kind: "SHIPMENT",
    shipmentId: "sh1",
    trackingNumber: "TRACK-1",
    carrier: "LBC",
    status: "SHIPPING",
    orderId: "o1",
    orderNumber: "PH-000001",
    matchedField: "TRACKING_NUMBER",
    matchedText: "TRACK-1",
  };
}

function responseWithAllGroups(): AdminSearchResponse {
  return {
    query: "chair",
    groups: {
      products: { items: [productSkuHit()], hasMore: false },
      orders: { items: [orderHit()], hasMore: false },
      customers: { items: [customerHit()], hasMore: false },
      shipments: { items: [shipmentHit()], hasMore: false },
    },
  };
}

describe("admin search result model", () => {
  it("declares the stable group order once", () => {
    expect(ADMIN_SEARCH_GROUPS).toEqual([
      "products",
      "orders",
      "customers",
      "shipments",
    ]);
  });

  it("flattens groups in Products, Orders, Customers, Shipments order", () => {
    const flat = flattenAdminSearchResults(responseWithAllGroups());
    expect(flat.map(({ hit }) => hit.kind)).toEqual([
      "PRODUCT",
      "ORDER",
      "CUSTOMER",
      "SHIPMENT",
    ]);
    expect(flat.map(({ group }) => group)).toEqual(ADMIN_SEARCH_GROUPS);
  });

  it("skips omitted and empty groups without sentinels", () => {
    const response: AdminSearchResponse = {
      query: "chair",
      groups: {
        products: { items: [], hasMore: false },
        orders: { items: [orderHit()], hasMore: false },
      },
    };
    expect(flattenAdminSearchResults(response)).toEqual([
      { group: "orders", hit: orderHit() },
    ]);
  });

  it("builds encoded stable context links", () => {
    expect(adminSearchHitHref(productSkuHit("CAR WH/L"))).toBe(
      "/admin/products/p1/edit?section=variants&sku=CAR%20WH%2FL",
    );
    expect(
      adminSearchHitHref({ ...productSkuHit(), matchedField: "NAME", matchedSku: null }),
    ).toBe("/admin/products/p1/edit");
    expect(adminSearchHitHref(orderHit())).toBe("/admin/orders/o1");
    expect(adminSearchHitHref(customerHit())).toBe("/admin/customers/c1");
    expect(adminSearchHitHref(shipmentHit())).toBe("/admin/orders/o1#shipments");
  });

  it("uses entity id plus matched SKU id for stable option ids", () => {
    expect(adminSearchOptionId(productSkuHit("SKU-1"))).toBe(
      "search-product-p1-sku-s1",
    );
    expect(adminSearchOptionId(orderHit())).toBe("search-order-o1");
    expect(adminSearchOptionId(customerHit())).toBe("search-customer-c1");
    expect(adminSearchOptionId(shipmentHit())).toBe("search-shipment-sh1");
  });
});
