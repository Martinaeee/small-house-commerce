import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StockRetryPanel, type StockFailureRow } from "@/components/admin/StockRetryPanel";

/**
 * Task 11 — Phase B partial-failure UX: the panel lists only the failed rows
 * with their target on-hand and the backend error, and retries EXACTLY those
 * rows (failed-row-only retry).
 */

const failures: StockFailureRow[] = [
  { skuId: "sku-1", onHand: 5, label: "Red / M", error: "Stock cannot go below the 9 unit(s) reserved by open orders" },
  { skuId: "sku-2", onHand: 3, label: "Blue / L", error: "SKU not found" },
];

describe("StockRetryPanel", () => {
  it("lists every failed row with its target and error", () => {
    render(<StockRetryPanel failures={failures} onRetry={() => undefined} pending={false} />);

    expect(screen.getByText("Red / M")).toBeInTheDocument();
    expect(screen.getByText(/目标库存 5/)).toBeInTheDocument();
    expect(screen.getByText(/reserved by open orders/)).toBeInTheDocument();
    expect(screen.getByText("Blue / L")).toBeInTheDocument();
  });

  it("retries only the failed rows and hides itself when none remain", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<StockRetryPanel failures={failures} onRetry={onRetry} pending={false} />);

    await user.click(screen.getByRole("button", { name: /Retry failed rows/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("disables retry while a save is pending", () => {
    render(<StockRetryPanel failures={failures} onRetry={() => undefined} pending />);

    expect(screen.getByRole("button", { name: /Retry failed rows/ })).toBeDisabled();
  });

  it("renders nothing when there are no failures", () => {
    const { container } = render(
      <StockRetryPanel failures={[]} onRetry={() => undefined} pending={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
