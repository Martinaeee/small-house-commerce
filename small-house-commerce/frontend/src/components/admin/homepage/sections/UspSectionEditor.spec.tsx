import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { UspSectionEditor } from "@/components/admin/homepage/sections/UspSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const USP_ID = "00000000-0000-7000-8000-000000000101";
type UspSection = SectionOf<"USP">;

type HarnessProps = {
  initial?: Partial<SectionPayloadMap["USP"]>;
};

function makeSection(payload: Partial<SectionPayloadMap["USP"]> = {}): UspSection {
  return {
    id: USP_ID,
    type: "USP",
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: 10,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload,
  };
}

function Harness({ initial = {} }: HarnessProps): ReactNode {
  const [payload, setPayload] = useState<SectionPayloadMap["USP"]>(initial);
  return (
    <UspSectionEditor
      section={makeSection(payload)}
      onPayloadChange={(patch) =>
        setPayload((current) =>
          typeof patch === "function" ? patch(current) : { ...current, ...patch },
        )
      }
    />
  );
}

describe("UspSectionEditor", () => {
  it("normalizes an empty payload, adds up to four rows, and exposes supported icons", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    expect(screen.getByText("No trust points yet.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add trust point" }));

    expect(screen.getByTestId("usp-item-row-0")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "USP icon 1" })).toHaveValue(
      "shield",
    );

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add trust point" }));
    }
    expect(screen.getByRole("button", { name: "Add trust point" })).toBeDisabled();
  });

  it("validates non-empty labels and writes icon and label edits through the payload callback", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness initial={{ items: [{ icon: "shield", label: "Fast delivery" }] }} />
      </AdminI18nProvider>,
    );

    const label = screen.getByRole("textbox", { name: "USP label 1" });
    fireEvent.change(label, { target: { value: "   " } });
    fireEvent.blur(label);
    expect(screen.getByText("Label is required.")).toBeVisible();
    expect(label).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(screen.getByRole("combobox", { name: "USP icon 1" }), {
      target: { value: "truck" },
    });
    fireEvent.change(label, { target: { value: "Nationwide delivery" } });

    expect(label).toHaveValue("Nationwide delivery");
    expect(screen.getByRole("combobox", { name: "USP icon 1" })).toHaveValue(
      "truck",
    );
    expect(screen.queryByText("Label is required.")).not.toBeInTheDocument();
  });

  it("reorders rows by stable row identity and only enables removal above the backend minimum", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            items: [
              { icon: "home", label: "Made for homes" },
              { icon: "lock", label: "Secure checkout" },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move USP row 1 down" }));
    expect(screen.getByRole("textbox", { name: "USP label 1" })).toHaveValue(
      "Secure checkout",
    );
    expect(screen.getByRole("textbox", { name: "USP label 2" })).toHaveValue(
      "Made for homes",
    );

    expect(
      screen.getByRole("button", { name: "Remove USP row 1" }),
    ).toBeEnabled();
  });
});
