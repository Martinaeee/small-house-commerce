import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { CountdownBannerSectionEditor } from "@/components/admin/homepage/sections/CountdownBannerSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { CountdownBannerPayload } from "@/lib/homepage-section-payloads";

const SECTION_ID = "00000000-0000-7000-8000-000000000302";

function Harness({
  initial = { endsAt: null },
  publishAt = null,
}: {
  initial?: CountdownBannerPayload;
  publishAt?: string | null;
}): ReactNode {
  const [payload, setPayload] = useState<CountdownBannerPayload>(initial);
  const section = {
    id: SECTION_ID,
    type: "COUNTDOWN_BANNER",
    title: "Flash sale",
    subtitle: null,
    enabled: true,
    sortOrder: 0,
    schedule: { publishAt, unpublishAt: null },
    products: [],
    payload,
  } as SectionOf<"COUNTDOWN_BANNER">;
  return (
    <>
      <CountdownBannerSectionEditor
        section={section}
        onPayloadChange={(patch) =>
          setPayload((current) =>
            typeof patch === "function" ? patch(current) : { ...current, ...patch },
          )
        }
      />
      <pre data-testid="countdown-payload">{JSON.stringify(payload)}</pre>
    </>
  );
}

function payload(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("countdown-payload").textContent ?? "{}");
}

describe("CountdownBannerSectionEditor", () => {
  it("sets an end time as an ISO datetime and clears it back to null", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    const input = screen.getByLabelText("Countdown end time");
    fireEvent.change(input, { target: { value: "2026-12-31T23:59" } });

    const endsAt = payload().endsAt;
    expect(typeof endsAt).toBe("string");
    expect(Number.isNaN(Date.parse(endsAt as string))).toBe(false);

    fireEvent.change(input, { target: { value: "" } });
    expect(payload()).toEqual({ endsAt: null });
  });

  it("explains that drafts may leave the end time empty and warns once it has passed", () => {
    setAdminLang("en");
    const { rerender } = render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    expect(
      screen.getByText("Drafts may leave this empty; publishing requires a future time."),
    ).toBeVisible();

    rerender(
      <AdminI18nProvider>
        <Harness
          key="past"
          initial={{ endsAt: new Date(Date.now() - 60_000).toISOString() }}
        />
      </AdminI18nProvider>,
    );
    expect(
      screen.getByText("This time has passed; the banner will not show."),
    ).toBeVisible();
  });

  it("warns when the end time is not after the section start time", () => {
    setAdminLang("en");
    const publishAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const beforeStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const afterStart = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const warning =
      "The end time is not after this section's start time; publishing will be blocked.";

    const { rerender } = render(
      <AdminI18nProvider>
        <Harness
          key="before-start"
          initial={{ endsAt: beforeStart }}
          publishAt={publishAt}
        />
      </AdminI18nProvider>,
    );
    expect(screen.getByText(warning)).toBeVisible();

    rerender(
      <AdminI18nProvider>
        <Harness
          key="after-start"
          initial={{ endsAt: afterStart }}
          publishAt={publishAt}
        />
      </AdminI18nProvider>,
    );
    expect(screen.queryByText(warning)).toBeNull();
  });

  it("edits the optional CTA fields through the same payload updater", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Banner CTA text" }), {
      target: { value: "Ends soon" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Banner CTA link" }), {
      target: { value: "#featured" },
    });

    expect(payload()).toEqual({
      endsAt: null,
      ctaText: "Ends soon",
      ctaLink: "#featured",
    });
  });

  it("renders a safe empty state for malformed payload values", () => {
    setAdminLang("en");
    const malformed = {
      id: SECTION_ID,
      type: "COUNTDOWN_BANNER",
      title: null,
      subtitle: null,
      enabled: true,
      sortOrder: 0,
      schedule: { publishAt: null, unpublishAt: null },
      products: [],
      payload: { endsAt: "not-a-date", ctaText: 7, ctaLink: [] },
    } as unknown as SectionOf<"COUNTDOWN_BANNER">;
    render(
      <AdminI18nProvider>
        <CountdownBannerSectionEditor
          section={malformed}
          onPayloadChange={() => undefined}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByLabelText("Countdown end time")).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Banner CTA text" })).toHaveValue("");
  });
});
