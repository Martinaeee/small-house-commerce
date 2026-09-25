import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { adminApi, type AdminSearchResponse } from "@/lib/admin-api";
import AdminSearchPage from "./page";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.searchParams),
}));

function responseWithAllGroups(): AdminSearchResponse {
  return {
    query: "rolling cart",
    groups: {
      products: {
        items: [
          {
            kind: "PRODUCT",
            productId: "p1",
            name: "Rolling cart",
            productCode: "P-000001",
            slug: "rolling-cart",
            status: "ACTIVE",
            matchedField: "SKU_CODE",
            matchedText: "CART-L",
            matchedSku: {
              skuId: "s1",
              skuCode: "CART-L",
              skuStatus: "ACTIVE",
              variantId: "v1",
              variantName: "Large",
              price: "1590",
              availableInventory: 7,
            },
          },
        ],
        hasMore: false,
      },
      orders: {
        items: [
          {
            kind: "ORDER",
            orderId: "o1",
            orderNumber: "PH-000001",
            orderStatus: "NEW",
            confirmationStatus: "UNCONFIRMED",
            customerName: "Jane Cruz",
            normalizedPhone: "+639171234567",
            createdAt: "2026-09-25T00:00:00.000Z",
            matchedField: "ORDER_NUMBER",
            matchedText: "PH-000001",
          },
        ],
        hasMore: false,
      },
      customers: {
        items: [
          {
            kind: "CUSTOMER",
            customerId: "c1",
            name: "Jane Cruz",
            normalizedPhone: "+639171234567",
            email: "jane@example.com",
            riskLevel: "NORMAL",
            matchedField: "NAME",
            matchedText: "Jane Cruz",
          },
        ],
        hasMore: false,
      },
      shipments: {
        items: [
          {
            kind: "SHIPMENT",
            shipmentId: "sh1",
            trackingNumber: "TRACK-001",
            carrier: "LBC",
            status: "SHIPPING",
            orderId: "o1",
            orderNumber: "PH-000001",
            matchedField: "TRACKING_NUMBER",
            matchedText: "TRACK-001",
          },
        ],
        hasMore: false,
      },
    },
  };
}

function productOnlyResponse(): AdminSearchResponse {
  const products = responseWithAllGroups().groups.products!;
  return { query: "cart", groups: { products } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderPage() {
  return render(
    <AdminI18nProvider>
      <AdminSearchPage />
    </AdminI18nProvider>,
  );
}

function setupUser() {
  return userEvent.setup({
    advanceTimers: async (milliseconds) => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    },
  });
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AdminSearchPage", () => {
  const searchAdmin = vi.spyOn(adminApi, "searchAdmin");

  beforeEach(() => {
    setAdminLang("en");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    navigation.searchParams = "";
    navigation.replace.mockReset();
    searchAdmin.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("loads q from the URL, requests twenty rows per group, and renders every stable result link", async () => {
    navigation.searchParams = "q=rolling%20cart";
    searchAdmin.mockResolvedValue(responseWithAllGroups());

    renderPage();
    await advance(250);
    await flushPromises();

    expect(searchAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ q: "rolling cart", limit: 20 }),
    );
    expect(screen.getByRole("heading", { name: "Products" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Orders" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Customers" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Shipments" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Rolling cart/ })).toHaveAttribute(
      "href",
      "/admin/products/p1/edit?section=variants&sku=CART-L",
    );
    expect(screen.getByRole("link", { name: /PH-000001New/ })).toHaveAttribute(
      "href",
      "/admin/orders/o1",
    );
    expect(screen.getByRole("link", { name: /Jane CruzRisk NORMAL/ })).toHaveAttribute(
      "href",
      "/admin/customers/c1",
    );
    expect(screen.getByRole("link", { name: /TRACK-001Shipping/ })).toHaveAttribute(
      "href",
      "/admin/orders/o1#shipments",
    );
  });

  it("does not request or fake results without a valid q", async () => {
    renderPage();
    await advance(500);

    expect(screen.getByText("Enter at least 2 characters to search")).toBeVisible();
    expect(searchAdmin).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Products" })).not.toBeInTheDocument();
  });

  it("keeps edits local until submit and replaces the URL with the normalized query", async () => {
    navigation.searchParams = "q=chair";
    searchAdmin.mockResolvedValue({ query: "chair", groups: {} });
    const user = setupUser();
    renderPage();
    await advance(250);
    await flushPromises();

    const input = screen.getByRole("searchbox", {
      name: "Search products, orders, customers, and shipments",
    });
    await user.clear(input);
    await user.type(input, "  rolling   cart  ");
    await advance(500);

    expect(searchAdmin).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(navigation.replace).toHaveBeenCalledWith(
      "/admin/search?q=rolling%20cart",
    );
  });

  it("renders loading and empty states for the URL query", async () => {
    navigation.searchParams = "q=cart";
    const pending = deferred<AdminSearchResponse>();
    searchAdmin.mockReturnValue(pending.promise);
    renderPage();

    await advance(250);
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");

    await act(async () => {
      pending.resolve({ query: "cart", groups: {} });
      await pending.promise;
    });
    expect(screen.getByRole("status")).toHaveTextContent("No results found");
  });

  it("retries failures and omits groups absent from the successful response", async () => {
    navigation.searchParams = "q=cart";
    searchAdmin
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(productOnlyResponse());
    const user = setupUser();
    renderPage();

    await advance(250);
    await flushPromises();
    expect(screen.getByRole("alert")).toHaveTextContent("Search failed");

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await advance(250);
    await flushPromises();
    expect(screen.getByRole("heading", { name: "Products" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Orders" })).not.toBeInTheDocument();
  });
});
