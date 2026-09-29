import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { en } from "@/i18n/en";
import { zh } from "@/i18n/zh";
import { SectionStyleFields } from "@/components/admin/homepage/SectionStyleFields";
import type { NonHeroHomepageSection } from "@/lib/homepage-document";

const SECTION_ID = "00000000-0000-7000-8000-000000000911";

function makeSection(style?: Record<string, unknown>): NonHeroHomepageSection {
  return {
    id: SECTION_ID,
    type: "USP",
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: 10,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    ...(style ? { style } : {}),
    payload: {},
  } as NonHeroHomepageSection;
}

describe("SectionStyleFields", () => {
  it("uses localized width and reset labels in Chinese", () => {
    setAdminLang("zh");
    render(
      <AdminI18nProvider>
        <SectionStyleFields section={makeSection()} onChange={() => undefined} />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("option", { name: "全宽" })).toBeVisible();
    expect(screen.getByRole("option", { name: "标准" })).toBeVisible();
    expect(screen.getByRole("option", { name: "窄版" })).toBeVisible();
    expect(screen.getAllByText("重置")).toHaveLength(5);
  });

  it("preserves unrelated style keys and clears only the selected override", () => {
    setAdminLang("en");
    let style: Record<string, unknown> | undefined = {
      backgroundColor: "#112233",
      customKey: "preserve",
    };
    const { rerender } = render(
      <AdminI18nProvider>
        <SectionStyleFields
          section={makeSection(style)}
          onChange={(patch) => {
            style = { ...style, ...patch };
            if (patch.backgroundColor === undefined) delete style.backgroundColor;
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset background color" }));
    rerender(
      <AdminI18nProvider>
        <SectionStyleFields section={makeSection(style)} onChange={() => undefined} />
      </AdminI18nProvider>,
    );

    expect(style).toEqual({ customKey: "preserve" });
    expect(screen.getByRole("textbox", { name: "Background color" })).toHaveValue("");
  });

  it("marks the panel as width-safe for narrow viewports", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <SectionStyleFields section={makeSection()} onChange={() => undefined} />
      </AdminI18nProvider>,
    );

    const panel = screen.getByRole("heading", { name: "Style" }).closest("section");
    expect(panel).toHaveClass("min-w-0");
    expect(panel).toHaveClass("overflow-x-hidden");
  });

  it("keeps the zh and en dictionaries key-for-key aligned", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
