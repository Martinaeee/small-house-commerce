import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { MarketingWorkspaceNav } from "./MarketingWorkspaceNav";

const mount = (props: Partial<Parameters<typeof MarketingWorkspaceNav>[0]> = {}) =>
  render(<AdminI18nProvider><MarketingWorkspaceNav active="pages" {...props} /></AdminI18nProvider>);

beforeEach(() => {
  localStorage.clear();
  setAdminLang("zh");
});

afterEach(() => vi.restoreAllMocks());

describe("marketing workspace navigation", () => {
  it("keeps the three business entries and carries the product context", () => {
    mount({ productId: "product/1" });
    expect(screen.getByRole("link", { name: "页面" })).toHaveAttribute("href", "/admin/marketing?productId=product%2F1");
    expect(screen.getByRole("link", { name: "商品比较" })).toHaveAttribute("href", "/admin/marketing/compare?productId=product%2F1");
    expect(screen.getByRole("link", { name: "优化师总览" })).toHaveAttribute("href", "/admin/marketing/optimizers?productId=product%2F1");
    expect(screen.getByRole("link", { name: "页面" })).toHaveAttribute("aria-current", "page");
  });

  it("marks exactly the active entry", () => {
    mount({ active: "compare" });
    expect(screen.getByRole("link", { name: "商品比较" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "页面" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "优化师总览" })).not.toHaveAttribute("aria-current");
  });

  it("blocks navigation away from unsaved edits unless the discard is confirmed", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mount({ unsaved: true });
    const link = screen.getByRole("link", { name: "优化师总览" });
    expect(fireEvent.click(link)).toBe(false);
    expect(confirm).toHaveBeenCalled();
    confirm.mockReturnValue(true);
    expect(fireEvent.click(link)).toBe(true);
  });
});
