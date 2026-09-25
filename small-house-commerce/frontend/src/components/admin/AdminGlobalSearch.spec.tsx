import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminSearchResponse,
  type ProductSearchHit,
} from "@/lib/admin-api";
import { AdminGlobalSearch } from "./AdminGlobalSearch";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

const ALL_SEARCH_PERMISSIONS = [
  "PRODUCT_MANAGE",
  "ORDER_VIEW_ALL",
  "CUSTOMER_MANAGE",
];

function productHit(
  productId = "p1",
  name = "Chair",
  skuId = "s1",
): ProductSearchHit {
  return {
    kind: "PRODUCT",
    productId,
    name,
    productCode: "P-000001",
    slug: "chair",
    status: "ACTIVE",
    matchedField: "SKU_CODE",
    matchedText: "CHAIR-L",
    matchedSku: {
      skuId,
      skuCode: "CHAIR-L",
      skuStatus: "ACTIVE",
      variantId: "v1",
      variantName: "Large",
      price: "1590",
      availableInventory: 7,
    },
  };
}

function responseWithAllGroups(query = "chair"): AdminSearchResponse {
  return {
    query,
    groups: {
      products: { items: [productHit()], hasMore: false },
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

function responseWithProduct(name: string): AdminSearchResponse {
  return {
    query: name,
    groups: {
      products: {
        items: [productHit("p-old", name, "s-old")],
        hasMore: false,
      },
    },
  };
}

function responseWithOrder(orderNumber: string): AdminSearchResponse {
  const base = responseWithAllGroups(orderNumber).groups.orders!;
  return {
    query: orderNumber,
    groups: {
      orders: {
        ...base,
        items: base.items.map((item) => ({
          ...item,
          orderNumber,
          matchedText: orderNumber,
        })),
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderSearch({ permissions = ALL_SEARCH_PERMISSIONS }: { permissions?: string[] } = {}) {
  return render(
    <AdminI18nProvider>
      <AdminGlobalSearch permissions={permissions} />
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

async function openAndType(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
): Promise<HTMLInputElement> {
  await user.click(screen.getByRole("button", { name: "全局搜索" }));
  const input = screen.getByRole<HTMLInputElement>("combobox", {
    name: "搜索商品、订单、客户和物流",
  });
  await user.type(input, query);
  return input;
}

async function replaceQuery(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
): Promise<void> {
  const input = screen.getByRole("combobox", {
    name: "搜索商品、订单、客户和物流",
  });
  await user.clear(input);
  await user.type(input, query);
}

describe("AdminGlobalSearch", () => {
  const searchAdmin = vi.spyOn(adminApi, "searchAdmin");

  beforeEach(() => {
    setAdminLang("zh");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchAdmin.mockReset();
    navigation.push.mockReset();
    document.body.style.overflow = "";
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.style.overflow = "";
  });

  it("opens with Control+K, focuses the combobox, and restores opener focus on Escape", async () => {
    const user = setupUser();
    renderSearch();
    const trigger = screen.getByRole("button", { name: "全局搜索" });
    trigger.focus();

    await user.keyboard("{Control>}k{/Control}");

    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
    const input = screen.getByRole("combobox", {
      name: "搜索商品、订单、客户和物流",
    });
    expect(input).toHaveFocus();
    expect(document.getElementById(input.getAttribute("aria-controls")!)).toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "全局搜索" })).not.toBeInTheDocument();
  });

  it("supports Meta+K and ignores bare k", async () => {
    const user = setupUser();
    renderSearch();

    await user.keyboard("k");
    expect(screen.queryByRole("dialog", { name: "全局搜索" })).not.toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
  });

  it("moves across real options only and Enter uses the highlighted stable href", async () => {
    searchAdmin.mockResolvedValue(responseWithAllGroups());
    const user = setupUser();
    renderSearch();
    const input = await openAndType(user, "chair");
    await advance(250);
    await flushPromises();

    expect(screen.getByText("Chair")).toBeVisible();
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "search-product-p1-sku-s1");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(navigation.push).toHaveBeenCalledWith("/admin/orders/o1");
  });

  it("cannot activate an option removed by a newer response", async () => {
    searchAdmin
      .mockResolvedValueOnce(responseWithProduct("Old chair"))
      .mockResolvedValueOnce(responseWithOrder("PH-NEW"));
    const user = setupUser();
    renderSearch();
    await openAndType(user, "old");
    await advance(250);
    await flushPromises();
    await user.keyboard("{ArrowDown}");

    await replaceQuery(user, "new");
    await advance(250);
    await flushPromises();
    expect(screen.getByText("PH-NEW")).toBeVisible();
    await user.keyboard("{Enter}");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("uses the same href for pointer activation", async () => {
    searchAdmin.mockResolvedValue(responseWithAllGroups());
    const user = setupUser();
    renderSearch();
    await openAndType(user, "chair");
    await advance(250);
    await flushPromises();

    await user.click(screen.getByRole("option", { name: /TRACK-001/ }));
    expect(navigation.push).toHaveBeenCalledWith("/admin/orders/o1#shipments");
  });

  it("renders groups in contract order, omits absent groups, and caps dialog groups at five", async () => {
    const products = Array.from({ length: 6 }, (_, index) =>
      productHit(`p${index + 1}`, `Chair ${index + 1}`, `s${index + 1}`),
    );
    searchAdmin.mockResolvedValue({
      query: "chair",
      groups: {
        products: { items: products, hasMore: true },
        orders: responseWithAllGroups().groups.orders,
        shipments: responseWithAllGroups().groups.shipments,
      },
    });
    const user = setupUser();
    renderSearch();
    await openAndType(user, "chair");
    await advance(250);
    await flushPromises();

    const dialog = screen.getByRole("dialog", { name: "全局搜索" });
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual([
      "商品",
      "订单",
      "物流",
    ]);
    expect(within(dialog).queryByRole("heading", { name: "客户" })).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("option")).toHaveLength(7);
    expect(dialog).toHaveTextContent("新订单");
    expect(dialog).toHaveTextContent("待确认");
    expect(dialog).toHaveTextContent("配送中");
    expect(dialog).toHaveTextContent("在售");
    expect(within(dialog).queryByText("Chair 6")).not.toBeInTheDocument();
  });

  it("announces loading, empty, error, retry, and local length validation", async () => {
    const pending = deferred<AdminSearchResponse>();
    searchAdmin
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ query: "chair", groups: {} });
    const user = setupUser();
    renderSearch();
    await openAndType(user, "chair");
    await advance(250);
    expect(screen.getByRole("status")).toHaveTextContent("正在搜索");

    await act(async () => {
      pending.resolve({ query: "chair", groups: {} });
      await pending.promise;
    });
    expect(screen.getByRole("status")).toHaveTextContent("没有找到结果");

    await replaceQuery(user, "table");
    await advance(250);
    await flushPromises();
    expect(screen.getByRole("alert")).toHaveTextContent("搜索失败");
    await user.click(screen.getByRole("button", { name: "重试" }));
    await advance(250);
    await flushPromises();
    expect(screen.getByRole("status")).toHaveTextContent("没有找到结果");

    await replaceQuery(user, "x".repeat(101));
    expect(screen.getByRole("alert")).toHaveTextContent("最多输入 100 个字符");
    expect(searchAdmin).toHaveBeenCalledTimes(3);
  });

  it("does not request below two characters but enables the two-character boundary", async () => {
    searchAdmin.mockResolvedValue({ query: "ab", groups: {} });
    const user = setupUser();
    renderSearch();
    await openAndType(user, "a");
    await advance(500);
    expect(searchAdmin).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole("combobox", { name: "搜索商品、订单、客户和物流" }),
      "b",
    );
    await advance(250);
    expect(searchAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ q: "ab", limit: 5 }),
    );
  });

  it("shows an honest unavailable state and never requests unsupported groups", async () => {
    const user = setupUser();
    renderSearch({ permissions: ["ORDER_VIEW_OWN"] });

    await user.click(screen.getByRole("button", { name: "全局搜索" }));
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toHaveTextContent(
      "当前账户没有可搜索的模块",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await advance(500);
    expect(searchAdmin).not.toHaveBeenCalled();
  });

  it("locks body scroll, traps focus, and restores cleanup", async () => {
    const user = setupUser();
    const { unmount } = renderSearch();
    await openAndType(user, "ab");
    const input = screen.getByRole("combobox", {
      name: "搜索商品、订单、客户和物流",
    });
    const viewAll = screen.getByRole("button", { name: "查看全部结果" });

    expect(document.body.style.overflow).toBe("hidden");
    input.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(viewAll).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(input).toHaveFocus();

    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
