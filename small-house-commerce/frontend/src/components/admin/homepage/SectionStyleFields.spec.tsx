import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { en } from "@/i18n/en";
import { zh } from "@/i18n/zh";
import { SectionStyleFields } from "@/components/admin/homepage/SectionStyleFields";
import type { SectionStyle } from "@/lib/homepage-document";

describe("SectionStyleFields", () => {
  it("uses localized width and reset labels in Chinese", () => {
    setAdminLang("zh");
    render(
      <AdminI18nProvider>
        <SectionStyleFields value={{}} onChange={() => undefined} />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("option", { name: "全宽" })).toBeVisible();
    expect(screen.getByRole("option", { name: "标准" })).toBeVisible();
    expect(screen.getByRole("option", { name: "窄版" })).toBeVisible();
    expect(screen.getAllByText("重置")).toHaveLength(5);
  });

  it("emits an undefined field when a single override is reset", () => {
    setAdminLang("en");
    const onChange = vi.fn();
    render(
      <AdminI18nProvider>
        <SectionStyleFields
          value={{ backgroundColor: "#112233", paddingTop: 24 }}
          onChange={onChange}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset background color" }));

    expect(onChange).toHaveBeenCalledWith({ backgroundColor: undefined });
    // The panel keeps rendering the values it was given (controlled).
    expect(screen.getByRole("textbox", { name: "Background color" })).toHaveValue("#112233");
  });

  it("uses compact controls that do not outrank section headings", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <SectionStyleFields value={{}} onChange={() => undefined} />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Background color" })).toHaveClass(
      "text-sm",
      "py-2",
    );
  });

  it("marks the panel as width-safe for narrow viewports", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <SectionStyleFields value={{}} onChange={() => undefined} />
      </AdminI18nProvider>,
    );

    const panel = screen.getByRole("heading", { name: "Style" }).closest("section");
    expect(panel).toHaveClass("min-w-0");
    expect(panel).toHaveClass("overflow-x-hidden");
  });

  it("reads only whitelisted style keys and clamps padding into range", () => {
    setAdminLang("en");
    const onChange = vi.fn();
    render(
      <AdminI18nProvider>
        <SectionStyleFields
          value={{ paddingTop: 24 } as SectionStyle}
          onChange={onChange}
        />
      </AdminI18nProvider>,
    );

    const padding = screen.getByRole("spinbutton", { name: "Top spacing (px)" });
    fireEvent.change(padding, { target: { value: "900" } });
    fireEvent.blur(padding);
    expect(onChange).toHaveBeenCalledWith({ paddingTop: 240 });
  });

  it("keeps the zh and en dictionaries key-for-key aligned", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
