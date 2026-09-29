import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { SectionCommonFields } from "@/components/admin/homepage/SectionCommonFields";
import type { NonHeroHomepageSection } from "@/lib/homepage-document";

const SECTION_ID = "00000000-0000-7000-8000-000000000910";

function makeSection(
  schedule: NonHeroHomepageSection["schedule"] = {
    publishAt: null,
    unpublishAt: null,
  },
): NonHeroHomepageSection {
  return {
    id: SECTION_ID,
    type: "USP",
    title: "Existing title",
    subtitle: "Existing subtitle",
    enabled: true,
    sortOrder: 10,
    schedule,
    products: [],
    payload: {},
  } as NonHeroHomepageSection;
}

describe("SectionCommonFields", () => {
  it("exposes Content and Advanced groups while keeping advanced schedule controls accessible", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <SectionCommonFields section={makeSection()} onChange={() => undefined} />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "Content" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Advanced" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Section enabled" })).toBeVisible();
    expect(screen.getByLabelText("Start time")).toBeVisible();
    expect(screen.getByLabelText("End time")).toBeVisible();
  });

  it("shows a field-level error when the end time is not later than the start time", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <SectionCommonFields
          section={makeSection({
            publishAt: "2026-10-02T09:00:00.000Z",
            unpublishAt: "2026-10-01T09:00:00.000Z",
          })}
          onChange={() => undefined}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "End time must be later than start time.",
    );
  });

  it("emits only the changed schedule field", () => {
    setAdminLang("en");
    let received: unknown;
    render(
      <AdminI18nProvider>
        <SectionCommonFields
          section={makeSection()}
          onChange={(patch) => {
            received = patch;
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "2026-10-01T09:30" },
    });

    expect(received).toEqual({
      schedule: {
        publishAt: new Date("2026-10-01T09:30").toISOString(),
      },
    });
  });
});
