import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider } from "@/lib/admin-i18n";
import { DateRangePicker } from "@/components/admin/marketing/DateRangePicker";

const mount = (props: Partial<Parameters<typeof DateRangePicker>[0]> = {}) =>
  render(
    <AdminI18nProvider>
      <DateRangePicker
        label="触达日期"
        value={{ from: "2026-10-30", to: "2026-11-05" }}
        onChange={() => {}}
        {...props}
      />
    </AdminI18nProvider>,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T02:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("date range picker", () => {
  it("shows the chosen range on its trigger", () => {
    mount();
    const trigger = screen.getByRole("button", { name: "触达日期" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("2026/10/30 – 2026/11/05");
  });

  it("applies a preset from the picker", () => {
    const onChange = vi.fn();
    mount({ onChange });
    fireEvent.click(screen.getByRole("button", { name: "触达日期" }));
    const dialog = screen.getByRole("dialog", { name: "触达日期" });
    fireEvent.click(within(dialog).getByRole("button", { name: "今天和昨天" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "更新" }));
    expect(onChange).toHaveBeenCalledWith({ from: "2026-11-04", to: "2026-11-05" });
    expect(screen.queryByRole("dialog", { name: "触达日期" })).not.toBeInTheDocument();
  });

  it("selects a range by clicking two days and keeps the order", () => {
    const onChange = vi.fn();
    mount({ onChange, value: { from: "2026-11-01", to: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "触达日期" }));
    const dialog = screen.getByRole("dialog", { name: "触达日期" });
    fireEvent.click(within(dialog).getByRole("button", { name: "2026-11-03" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "2026-11-01" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "更新" }));
    expect(onChange).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-11-03" });
  });

  it("cancels without applying and closes on Escape", () => {
    const onChange = vi.fn();
    mount({ onChange });
    fireEvent.click(screen.getByRole("button", { name: "触达日期" }));
    const dialog = screen.getByRole("dialog", { name: "触达日期" });
    fireEvent.click(within(dialog).getByRole("button", { name: "今天" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "触达日期" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "触达日期" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "触达日期" })).not.toBeInTheDocument();
  });

  it("clears an optional range", () => {
    const onChange = vi.fn();
    mount({ onChange, allowEmpty: true, value: { from: "2026-10-30", to: "2026-11-05" } });
    fireEvent.click(screen.getByRole("button", { name: "触达日期" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "触达日期" })).getByRole("button", { name: "清除" }));
    expect(onChange).toHaveBeenCalledWith({ from: "", to: "" });
  });

  it("shows two months and refuses days after the maximum", () => {
    mount({ max: "2026-11-05" });
    fireEvent.click(screen.getByRole("button", { name: "触达日期" }));
    const dialog = screen.getByRole("dialog", { name: "触达日期" });
    expect(within(dialog).getAllByRole("heading").length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByRole("button", { name: "2026-11-06" })).toBeDisabled();
  });
});
