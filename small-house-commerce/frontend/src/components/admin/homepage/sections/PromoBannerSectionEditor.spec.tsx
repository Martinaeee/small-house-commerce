import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { PromoBannerSectionEditor } from "@/components/admin/homepage/sections/PromoBannerSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { PromoBannerPayload } from "@/lib/homepage-section-payloads";

const SECTION_ID = "00000000-0000-7000-8000-000000000301";

function Harness({ initial = {} }: { initial?: PromoBannerPayload }): ReactNode {
  const [payload, setPayload] = useState<PromoBannerPayload>(initial);
  const section = {
    id: SECTION_ID,
    type: "PROMO_BANNER",
    title: "Sale",
    subtitle: null,
    enabled: true,
    sortOrder: 0,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload,
  } as SectionOf<"PROMO_BANNER">;
  return (
    <>
      <PromoBannerSectionEditor
        section={section}
        onPayloadChange={(patch) =>
          setPayload((current) =>
            typeof patch === "function" ? patch(current) : { ...current, ...patch },
          )
        }
      />
      <pre data-testid="promo-payload">{JSON.stringify(payload)}</pre>
    </>
  );
}

function payload(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("promo-payload").textContent ?? "{}");
}

describe("PromoBannerSectionEditor", () => {
  it("edits the CTA text and removes the key again when cleared", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Banner CTA text" }), {
      target: { value: "Shop now" },
    });
    expect(payload()).toEqual({ ctaText: "Shop now" });

    fireEvent.change(screen.getByRole("textbox", { name: "Banner CTA text" }), {
      target: { value: "" },
    });
    expect(payload()).toEqual({});
  });

  it("commits a valid CTA link and keeps an incomplete URL visible while typing", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    const link = screen.getByRole("textbox", { name: "Banner CTA link" });
    fireEvent.change(link, { target: { value: "h" } });
    expect(link).toHaveValue("h");
    expect(payload()).toEqual({});

    fireEvent.change(link, { target: { value: "/collections/sale" } });
    expect(payload()).toEqual({ ctaLink: "/collections/sale" });
  });

  it("commits links the backend accepts and buffers links it would reject", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    const link = screen.getByRole("textbox", { name: "Banner CTA link" });

    fireEvent.change(link, { target: { value: "HTTPS://EXAMPLE.COM/SALE" } });
    expect(payload()).toEqual({ ctaLink: "HTTPS://EXAMPLE.COM/SALE" });

    fireEvent.change(link, { target: { value: "https://exa mple.com" } });
    expect(link).toHaveValue("https://exa mple.com");
    expect(payload()).toEqual({ ctaLink: "HTTPS://EXAMPLE.COM/SALE" });
  });

  it("renders a safe empty state for malformed payload values", () => {
    setAdminLang("en");
    const malformed = {
      id: SECTION_ID,
      type: "PROMO_BANNER",
      title: null,
      subtitle: null,
      enabled: true,
      sortOrder: 0,
      schedule: { publishAt: null, unpublishAt: null },
      products: [],
      payload: { ctaText: 42, ctaLink: {} },
    } as unknown as SectionOf<"PROMO_BANNER">;
    render(
      <AdminI18nProvider>
        <PromoBannerSectionEditor
          section={malformed}
          onPayloadChange={() => undefined}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Banner CTA text" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Banner CTA link" })).toHaveValue("");
  });
});
