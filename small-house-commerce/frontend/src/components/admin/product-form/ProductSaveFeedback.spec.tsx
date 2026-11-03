import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { ProductSaveFeedback } from "./ProductSaveFeedback";

function renderFeedback(tone: "success" | "error", onClose?: () => void) {
  return render(
    <AdminI18nProvider>
      <div style={{ transform: "translateY(-2000px)" }}>
        <ProductSaveFeedback tone={tone} message="保存结果内容" onClose={onClose} />
      </div>
    </AdminI18nProvider>,
  );
}

describe("ProductSaveFeedback", () => {
  beforeEach(() => {
    setAdminLang("zh");
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("escapes the scrolling and transformed editor container", () => {
    const view = renderFeedback("success");
    const feedback = screen.getByRole("status", { name: "保存结果" });
    expect(feedback).toHaveTextContent("保存结果内容");
    expect(view.container).not.toContainElement(feedback);
    const overlay = feedback.closest("[data-product-save-feedback]");
    expect(overlay).toHaveClass("fixed", "top-4");
    expect(overlay?.parentElement).toBe(document.body);
  });

  it("automatically dismisses success after six seconds", () => {
    const onClose = vi.fn();
    renderFeedback("success", onClose);
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByRole("status", { name: "保存结果" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status", { name: "保存结果" })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps failures visible until explicitly closed", () => {
    renderFeedback("error");
    act(() => vi.advanceTimersByTime(60_000));
    const feedback = screen.getByRole("alert", { name: "保存结果" });
    fireEvent.click(within(feedback).getByRole("button", { name: "关闭保存提示" }));
    expect(screen.queryByRole("alert", { name: "保存结果" })).not.toBeInTheDocument();
  });
});
