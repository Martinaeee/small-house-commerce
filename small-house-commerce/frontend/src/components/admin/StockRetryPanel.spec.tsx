import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { StockRetryPanel, type StockFailureRow } from "@/components/admin/StockRetryPanel";

/**
 * Task 11 — Phase B partial-failure UX: the panel lists only the failed rows
 * with their target on-hand and the backend message, and "Retry failed rows"
 * resubmits only those rows.
 *
 * Task 3 — the panel copy is fully localized through the admin i18n provider
 * (zh default, coherent en toggle).
 */

const failures: StockFailureRow[] = [
  { skuId: "sku-1", onHand: 5, label: "Red / M", error: "Stock cannot go below the 9 unit(s) reserved by open orders" },
  { skuId: "sku-2", onHand: 3, label: "Blue / L", error: "SKU not found" },
];

function renderPanel(props: Partial<Parameters<typeof StockRetryPanel>[0]> = {}) {
  return render(
    <AdminI18nProvider>
      <StockRetryPanel
        failures={failures}
        onRetry={() => undefined}
        pending={false}
        {...props}
      />
    </AdminI18nProvider>,
  );
}

describe("StockRetryPanel", () => {
  beforeEach(() => {
    setAdminLang("zh");
  });

  it("lists every failed row with its target and error", () => {
    renderPanel();

    expect(screen.getByText("Red / M")).toBeInTheDocument();
    expect(screen.getByText(/目标库存 5/)).toBeInTheDocument();
    expect(screen.getByText(/reserved by open orders/)).toBeInTheDocument();
    expect(screen.getByText("Blue / L")).toBeInTheDocument();
    expect(screen.getByText(/2 项库存写入失败/)).toBeInTheDocument();
  });

  it("retries only the failed rows and hides itself when none remain", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onRetry });

    await user.click(screen.getByRole("button", { name: /重试失败行/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("disables retry while a save is pending", () => {
    renderPanel({ pending: true });

    expect(screen.getByRole("button", { name: /重试失败行/ })).toBeDisabled();
  });

  /**
   * Rows the save could not address carry `skuId: ""`, so a panel can hold two
   * rows with the same label — the row key must not collapse them.
   */
  const unresolvedRow: StockFailureRow = {
    skuId: "",
    onHand: 5,
    label: "Blue",
    error:
      "Could not resolve the new SKU id from the save response (check the SKU code).",
  };

  it("renders two unresolved rows with the same label without a key collision", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderPanel({ failures: [unresolvedRow, { ...unresolvedRow, onHand: 3 }] });

    expect(screen.getAllByText("Blue")).toHaveLength(2);
    expect(screen.getByText(/目标库存 5/)).toBeInTheDocument();
    expect(screen.getByText(/目标库存 3/)).toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("disables retry while every remaining row is unresolved", () => {
    // Nothing left is retryable, so the button must not offer a dead end.
    renderPanel({ failures: [unresolvedRow] });

    expect(screen.getByRole("button", { name: /重试失败行/ })).toBeDisabled();
    expect(screen.getByText("Blue")).toBeInTheDocument();
  });

  it("keeps retry enabled while at least one row can be retried", () => {
    renderPanel({
      failures: [unresolvedRow, failures[0]],
    });

    expect(screen.getByRole("button", { name: /重试失败行/ })).toBeEnabled();
  });

  it("renders nothing when there are no failures", () => {
    const { container } = render(
      <AdminI18nProvider>
        <StockRetryPanel failures={[]} onRetry={() => undefined} pending={false} />
      </AdminI18nProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders a coherent English panel through the same provider", () => {
    setAdminLang("en");
    renderPanel();

    expect(screen.getByText(/2 stock write\(s\) failed/)).toBeInTheDocument();
    expect(screen.getByText(/Target stock 5/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry failed rows" })).toBeInTheDocument();
  });
});
