import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { TextBlockSectionEditor } from "@/components/admin/homepage/sections/TextBlockSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const BRAND_ID = "00000000-0000-7000-8000-000000000108";
const CONFIDENCE_ID = "00000000-0000-7000-8000-000000000109";

type TextSectionType = "BRAND_STORY" | "CONFIDENCE";

type TextSection = SectionOf<TextSectionType>;

function makeSection<T extends TextSectionType>(
  type: T,
  payload: Partial<SectionPayloadMap[T]> = {},
): SectionOf<T> {
  return {
    id: type === "BRAND_STORY" ? BRAND_ID : CONFIDENCE_ID,
    type,
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: type === "BRAND_STORY" ? 80 : 90,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload,
  } as SectionOf<T>;
}

function Harness({ type }: { type: TextSectionType }): ReactNode {
  const [payload, setPayload] = useState<SectionPayloadMap[typeof type]>({
    heading: "Original heading",
    body: "Original body",
    bullets: ["One", "Two"],
  });
  const section = makeSection(type, payload);
  return (
    <>
      <TextBlockSectionEditor
        section={section as TextSection}
        onPayloadChange={(patch) =>
          setPayload((current) =>
            typeof patch === "function" ? patch(current) : { ...current, ...patch },
          )
        }
      />
      <pre data-testid={`${type.toLowerCase()}-payload`}>{JSON.stringify(payload)}</pre>
    </>
  );
}

describe("TextBlockSectionEditor", () => {
  it("edits a brand story text block and caps bullets at six", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness type="BRAND_STORY" />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Text block heading" }), {
      target: { value: "Made for real life" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add bullet" }));
    fireEvent.click(screen.getByRole("button", { name: "Add bullet" }));
    fireEvent.click(screen.getByRole("button", { name: "Add bullet" }));
    fireEvent.click(screen.getByRole("button", { name: "Add bullet" }));

    expect(screen.getByRole("button", { name: "Add bullet" })).toBeDisabled();
    expect(screen.getByText("The backend accepts up to 6 bullets.")).toBeVisible();
    expect(JSON.parse(screen.getByTestId("brand_story-payload").textContent ?? "{}")).toMatchObject({
      heading: "Made for real life",
      bullets: ["One", "Two", "", "", "", ""],
    });
  });

  it("keeps confidence as a distinct selected section while sharing the editor", () => {
    setAdminLang("en");
    render(
      <AdminI18nProvider>
        <Harness type="CONFIDENCE" />
      </AdminI18nProvider>,
    );

    expect(screen.getByTestId("section-content-editor-type")).toHaveTextContent("CONFIDENCE");
    fireEvent.change(screen.getByRole("textbox", { name: "Text block body" }), {
      target: { value: "Clear support, every day." },
    });

    expect(JSON.parse(screen.getByTestId("confidence-payload").textContent ?? "{}")).toMatchObject({
      heading: "Original heading",
      body: "Clear support, every day.",
      bullets: ["One", "Two"],
    });
  });

  it("renders a safe empty state for malformed text payload values", () => {
    setAdminLang("en");
    const malformed = makeSection("BRAND_STORY", {
      heading: 10 as unknown as string,
      body: null as unknown as string,
      bullets: {} as unknown as string[],
    });
    render(
      <AdminI18nProvider>
        <TextBlockSectionEditor
          section={malformed}
          onPayloadChange={() => undefined}
        />
      </AdminI18nProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Text block heading" })).toHaveValue("");
    expect(screen.getByText("No bullets yet.")).toBeVisible();
  });
});
