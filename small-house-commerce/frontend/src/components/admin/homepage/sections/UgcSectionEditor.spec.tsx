import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { UgcSectionEditor } from "@/components/admin/homepage/sections/UgcSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const listProducts = vi.hoisted(() => vi.fn());
const uploadImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { listProducts, uploadImage } }));

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

  it("sanitizes malformed oversized entries before writing another field", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            entries: Array.from({ length: 7 }, (_, index) => ({
              name: `Name ${index + 1}`,
              comment: `Comment ${index + 1}`,
            })),
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "UGC name 1" }), {
      target: { value: "Updated name" },
    });
    const payload = JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}");
    expect(payload.entries).toHaveLength(6);
    expect(payload.entries[0].name).toBe("Updated name");
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

  it("preserves optional fields when editing an unrelated identity field", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            entries: [
              {
                name: "Mia",
                location: "Manila",
                comment: "Love it.",
                imageUrl: "/mia.jpg",
                productId: PRODUCT_ID,
              },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "UGC name 1" }), {
      target: { value: "Mia Santos" },
    });

    expect(JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}")).toEqual({
      entries: [
        {
          name: "Mia Santos",
          location: "Manila",
          comment: "Love it.",
          imageUrl: "/mia.jpg",
          productId: PRODUCT_ID,
        },
      ],
    });
  });

  it("keeps an existing product option visible when search results exclude it", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            entries: [{ name: "Mia", comment: "Love it.", productId: PRODUCT_ID }],
          }}
        />
      </AdminI18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole("option", { name: PRODUCT_ID })).toBeVisible());
    expect(screen.getByRole("combobox", { name: "UGC product 1" })).toHaveValue(PRODUCT_ID);
  });

  it("keeps an in-progress location edit focused", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <AdminI18nProvider>
        <Harness initial={{ entries: [{ name: "Mia", comment: "Love it." }] }} />
      </AdminI18nProvider>,
    );

    const location = screen.getByRole("textbox", { name: "UGC location 1" });
    location.focus();
    fireEvent.change(location, { target: { value: "M" } });

    expect(document.activeElement).toBe(location);
  });

  it("applies a completed image upload to the row after it moves", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    let resolveUpload: ((value: { url: string }) => void) | undefined;
    uploadImage.mockReturnValue(
      new Promise<{ url: string }>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            entries: [
              { name: "Mia", comment: "Love it." },
              { name: "Noah", comment: "Useful." },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    const file = new File(["image"], "mia.jpg", { type: "image/jpeg" });
    const fileInput = screen
      .getByTestId("ugc-row-0")
      .querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) throw new Error("missing file input");
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Move UGC row 1 down" }));
    resolveUpload?.({ url: "/uploads/mia.jpg" });

    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}")).toMatchObject({
        entries: [
          { name: "Noah", comment: "Useful." },
          { name: "Mia", comment: "Love it.", imageUrl: "/uploads/mia.jpg" },
        ],
      }),
    );
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
