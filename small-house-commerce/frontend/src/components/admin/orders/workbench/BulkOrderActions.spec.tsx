import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type { AdminOrderListRow } from "@/lib/admin-api";
import { BulkOrderActions } from "./BulkOrderActions";
const api = vi.hoisted(() => ({ bulkOrders: vi.fn() }));
vi.mock("@/lib/admin-api", () => ({ adminApi: api }));
const rows = [
  { id: "a", orderNumber: "PH100001" },
  { id: "b", orderNumber: "PH100002" },
] as AdminOrderListRow[];
function setup(denied: string[] = []) {
  const done = vi.fn();
  render(
    <AdminI18nProvider>
      <BulkOrderActions
        rows={rows}
        assignees={[{ id: "staff", name: "Ana" }]}
        hasPermission={(p) => !denied.includes(p)}
        onDone={done}
      />
    </AdminI18nProvider>,
  );
  return done;
}
beforeEach(() => {
  cleanup();
  setAdminLang("zh");
  vi.clearAllMocks();
});
describe("bulk order actions", () => {
  it("requires confirmation before cancelling and reports partial failures by order number", async () => {
    api.bulkOrders.mockResolvedValue({
      results: [
        { id: "a", ok: true },
        { id: "b", ok: false, error: "Already shipped" },
      ],
    });
    const done = setup();
    await userEvent.click(screen.getByRole("button", { name: "批量取消" }));
    expect(api.bulkOrders).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "执行批量操作" }));
    expect(await screen.findByText(/Already shipped/)).toHaveTextContent(
      "PH100002",
    );
    expect(screen.getByRole("status")).toHaveTextContent("成功 1");
    expect(api.bulkOrders).toHaveBeenCalledWith({
      action: "cancel",
      ids: ["a", "b"],
    });
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("lists the selected order numbers and waits for the delete confirmation", async () => {
    api.bulkOrders.mockResolvedValue({
      results: [
        { id: "a", ok: true },
        { id: "b", ok: true },
      ],
    });
    const done = setup();
    await userEvent.click(screen.getByRole("button", { name: "批量删除" }));
    expect(api.bulkOrders).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("确认删除订单？")).toBeInTheDocument();
    expect(within(dialog).getByText("PH100001")).toBeInTheDocument();
    expect(within(dialog).getByText("PH100002")).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认删除 2 单" }),
    );
    expect(api.bulkOrders).toHaveBeenCalledWith({
      action: "delete",
      ids: ["a", "b"],
    });
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("hides write actions the operator has no permission for", () => {
    setup(["ORDER_CONFIRM", "ORDER_CANCEL", "ORDER_ASSIGN", "ORDER_DELETE"]);
    expect(
      screen.queryByRole("button", { name: "批量确认" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "批量取消" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "批量指派" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "批量删除" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "批量打印打包单" }),
    ).toBeInTheDocument();
  });
  it("does not submit an assignment until a staff member is selected", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "批量指派" }));
    expect(screen.getByRole("button", { name: "执行批量操作" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("指派给"), "staff");
    expect(screen.getByRole("button", { name: "执行批量操作" })).toBeEnabled();
  });
});
