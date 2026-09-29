import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { SolutionsSectionEditor } from "@/components/admin/homepage/sections/SolutionsSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

type SolutionsSection = SectionOf<"SOLUTIONS">;
const SOLUTIONS_ID = "00000000-0000-7000-8000-000000000104";

function makeSection(
  payload: Partial<SectionPayloadMap["SOLUTIONS"]> = {},
): SolutionsSection {
  return {
    id: SOLUTIONS_ID,
    type: "SOLUTIONS",
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: 40,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload,
  };
}

function Harness({
  initial = {},
}: {
  initial?: Partial<SectionPayloadMap["SOLUTIONS"]>;
}): ReactNode {
  const [payload, setPayload] = useState<SectionPayloadMap["SOLUTIONS"]>(initial);
  return (
    <>
      <SolutionsSectionEditor
        section={makeSection(payload)}
        onPayloadChange={(patch) =>
          setPayload((current) =>
            typeof patch === "function" ? patch(current) : { ...current, ...patch },
          )
        }
      />
      <pre data-testid="solutions-payload">{JSON.stringify(payload)}</pre>
    </>
  );
}

describe("SolutionsSectionEditor", () => {
  it("normalizes malformed rows and limits the list to six backend rows", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness initial={{ items: {} as unknown as SectionPayloadMap["SOLUTIONS"]["items"] }} />
      </AdminI18nProvider>,
    );

    expect(screen.getByText("No solutions yet.")).toBeVisible();
    for (let index = 0; index < 6; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add solution" }));
    }
    expect(screen.getByRole("button", { name: "Add solution" })).toBeDisabled();
    expect(screen.getByText("The backend accepts up to 6 solution rows.")).toBeVisible();
  });

  it("sanitizes malformed oversized rows before writing another field", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            items: Array.from({ length: 7 }, (_, index) => ({
              title: `Solution ${index + 1}`,
              blurb: `Blurb ${index + 1}`,
              link: `/solution-${index + 1}`,
            })),
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Solution title 1" }), {
      target: { value: "Updated solution" },
    });
    const payload = JSON.parse(screen.getByTestId("solutions-payload").textContent ?? "{}");
    expect(payload.items).toHaveLength(6);
    expect(payload.items[0]).toMatchObject({ title: "Updated solution" });
  });

  it("edits fields through the typed callback and reorders by stable row identity", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            items: [
              { title: "Small spaces", blurb: "For apartments", link: "/small" },
              { title: "Warm homes", blurb: "For families", link: "/warm" },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Solution title 1" }), {
      target: { value: "Small-space storage" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Solution link 1" }), {
      target: { value: "https://example.com/storage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move solution row 1 down" }));

    expect(screen.getByRole("textbox", { name: "Solution title 1" })).toHaveValue(
      "Warm homes",
    );
    expect(screen.getByRole("textbox", { name: "Solution title 2" })).toHaveValue(
      "Small-space storage",
    );
    expect(JSON.parse(screen.getByTestId("solutions-payload").textContent ?? "{}")).toMatchObject({
      items: [
        { title: "Warm homes", link: "/warm" },
        { title: "Small-space storage", link: "https://example.com/storage", blurb: "For apartments" },
      ],
    });
  });

  it("keeps an optional blurb edit focused", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness initial={{ items: [{ title: "Small spaces", link: "/small" }] }} />
      </AdminI18nProvider>,
    );

    const blurb = screen.getByRole("textbox", { name: "Solution blurb 1" });
    blurb.focus();
    fireEvent.change(blurb, { target: { value: "A" } });

    expect(document.activeElement).toBe(blurb);
  });

  it("keeps an incomplete solution link visible while it is being typed", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness initial={{ items: [{ title: "Small spaces", link: "" }] }} />
      </AdminI18nProvider>,
    );

    const link = screen.getByRole("textbox", { name: "Solution link 1" });
    fireEvent.change(link, { target: { value: "h" } });

    expect(link).toHaveValue("h");
  });

  it("removes a row without rewriting other rows", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            items: [
              { title: "One", link: "/one" },
              { title: "Two", link: "/two" },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove solution row 1" }));
    expect(screen.getByRole("textbox", { name: "Solution title 1" })).toHaveValue("Two");
    expect(JSON.parse(screen.getByTestId("solutions-payload").textContent ?? "{}")).toEqual({
      items: [{ title: "Two", link: "/two" }],
    });
  });
});
