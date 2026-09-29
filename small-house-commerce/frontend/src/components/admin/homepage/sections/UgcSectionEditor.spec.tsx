import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { UgcSectionEditor } from "@/components/admin/homepage/sections/UgcSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const listProducts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { listProducts } }));

type UgcSection = SectionOf<"UGC">;
const UGC_ID = "00000000-0000-7000-8000-000000000107";
const PRODUCT_ID = "00000000-0000-7000-8000-000000000601";

function makeSection(
  payload: Partial<SectionPayloadMap["UGC"]> = {},
): UgcSection {
  return {
    id: UGC_ID,
    type: "UGC",
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: 70,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload,
  };
}

function Harness({
  initial = {},
}: {
  initial?: Partial<SectionPayloadMap["UGC"]>;
}): ReactNode {
  const [payload, setPayload] = useState<SectionPayloadMap["UGC"]>(initial);
  return (
    <>
      <UgcSectionEditor
        section={makeSection(payload)}
        onPayloadChange={(patch) =>
          setPayload((current) =>
            typeof patch === "function" ? patch(current) : { ...current, ...patch },
          )
        }
      />
      <pre data-testid="ugc-payload">{JSON.stringify(payload)}</pre>
    </>
  );
}

describe("UgcSectionEditor", () => {
  it("normalizes malformed entries and caps the editor at six entries", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness initial={{ entries: {} as unknown as SectionPayloadMap["UGC"]["entries"] }} />
      </AdminI18nProvider>,
    );

    expect(screen.getByText("No UGC entries yet.")).toBeVisible();
    for (let index = 0; index < 6; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Add UGC entry" }));
    }
    expect(screen.getByRole("button", { name: "Add UGC entry" })).toBeDisabled();
    expect(screen.getByText("The backend accepts up to 6 UGC entries.")).toBeVisible();
  });

  it("edits identity fields, reorders rows, and selects a related product", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({
      items: [
        {
          id: PRODUCT_ID,
          name: "Oak coffee table",
          slug: "oak-coffee-table",
          productCode: null,
          description: null,
          tagline: null,
          categoryId: "category",
          status: "ACTIVE",
          room: null,
          internalRole: null,
          solutions: [],
          width: null,
          height: null,
          depth: null,
          foldedWidth: null,
          foldedHeight: null,
          foldedDepth: null,
          materials: null,
          features: null,
          createdAt: "",
          updatedAt: "",
          catalogGraphVersion: 1,
          defaultDisplayVariantId: null,
          images: [],
          detailBlocks: [],
          variants: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            entries: [
              { name: "Mia", location: "Manila", comment: "Love it." },
              { name: "Noah", location: "Cebu", comment: "So useful." },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "UGC name 1" }), {
      target: { value: "Mia Santos" },
    });
    await waitFor(() => expect(within(screen.getByTestId("ugc-row-0")).getByRole("option", { name: "Oak coffee table" })).toBeVisible());
    fireEvent.change(screen.getByRole("combobox", { name: "UGC product 1" }), {
      target: { value: PRODUCT_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move UGC row 1 down" }));

    expect(screen.getByRole("textbox", { name: "UGC name 1" })).toHaveValue("Noah");
    expect(JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}")).toMatchObject({
      entries: [
        { name: "Noah", comment: "So useful." },
        { name: "Mia Santos", productId: PRODUCT_ID },
      ],
    });
  });

  it("removes an entry and preserves unrelated values", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            entries: [
              { name: "Mia", location: "Manila", comment: "Love it.", imageUrl: "/mia.jpg" },
              { name: "Noah", location: "Cebu", comment: "So useful." },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove UGC row 1" }));
    expect(JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}")).toEqual({
      entries: [{ name: "Noah", location: "Cebu", comment: "So useful." }],
    });
  });
});
