import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { UgcSectionEditor } from "@/components/admin/homepage/sections/UgcSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const listProducts = vi.hoisted(() => vi.fn());
const uploadImage = vi.hoisted(() => vi.fn());
const getProduct = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminApi: { listProducts, uploadImage, getProduct } }));

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
  switchable = false,
}: {
  initial?: Partial<SectionPayloadMap["UGC"]>;
  switchable?: boolean;
}): ReactNode {
  const [payload, setPayload] = useState<SectionPayloadMap["UGC"]>(initial);
  const [sectionId, setSectionId] = useState(UGC_ID);
  return (
    <>
      {switchable ? <button onClick={() => {
        setSectionId("00000000-0000-7000-8000-000000000108");
        setPayload({ ...initial, entries: initial.entries?.map((entry) => ({ ...entry, name: "Other module", imageUrl: "/uploads/other.jpg" })) });
      }}>Switch section</button> : null}
      <UgcSectionEditor
        section={{ ...makeSection(payload), id: sectionId }}
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
  beforeEach(() => {
    listProducts.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    uploadImage.mockReset();
    getProduct.mockReset().mockRejectedValue(new Error("not linked"));
    setAdminLang("en");
  });

  it("shows the linked product photo and name instead of a raw id", async () => {
    setAdminLang("en");
    getProduct.mockResolvedValue({
      id: "00000000-0000-7000-8000-000000000601",
      name: "Classic Oak Shelf",
      slug: "classic-oak-shelf",
      productCode: "P-000001",
      images: [
        { id: "image-1", url: "/uploads/oak.jpg", type: "IMAGE", altText: null, sortOrder: 0 },
      ],
      variants: [],
    });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            entries: [
              {
                id: "row-a",
                name: "Ana",
                comment: "Fits our corner",
                imageUrl: "/uploads/ugc.jpg",
                productId: "00000000-0000-7000-8000-000000000601",
              },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    const current = await screen.findByTestId("ugc-row-1-product-current");
    expect(current).toHaveTextContent("Classic Oak Shelf");
    expect(screen.getByTestId("ugc-row-1-product-thumb")).toHaveAttribute(
      "src",
      "/uploads/oak.jpg",
    );
    expect(
      screen.queryByText("00000000-0000-7000-8000-000000000601"),
    ).not.toBeInTheDocument();
  });
  it("keeps the raw product id visible when the linked product can no longer be loaded", async () => {
    setAdminLang("en");
    getProduct.mockRejectedValue(new Error("gone"));
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            entries: [
              { id: "row-a", name: "Ana", comment: "Nice", productId: PRODUCT_ID },
            ],
          }}
        />
      </AdminI18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("ugc-row-1-product-id")).toHaveTextContent(PRODUCT_ID),
    );
  });
  it("keeps each quote on its own photo when choosing the featured image", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<AdminI18nProvider><Harness initial={{ entries: [
      { name: "Layout sample A", comment: "Sample text A", imageUrl: "/uploads/e2e/a.jpg" },
      { name: "", comment: "", imageUrl: "/uploads/e2e/b.jpg" },
    ] }} /></AdminI18nProvider>);
    expect(JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}").entries[0]).not.toHaveProperty("id");
    fireEvent.click(screen.getByRole("button", { name: "Photo collage" }));
    let payload = JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}");
    expect(payload.entries.every((row: { id?: string }) => /^[0-9a-f-]{36}$/i.test(row.id ?? ""))).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Set as featured photo" })[1]);
    payload = JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}");
    expect(payload.presentation.featuredEntryId).toBe(payload.entries[1].id);
    expect(payload.entries[1].comment).toBe("");
    expect(payload.entries[0].comment).toBe("Sample text A");
    fireEvent.click(screen.getByRole("checkbox", { name: "Show quote" }));
    fireEvent.click(screen.getByRole("button", { name: "Strong overlay" }));
    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    expect(screen.getByText("Complete the name and quote before publishing cards.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Photo collage" }));
    const restored = JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}");
    expect(restored.entries).toEqual(payload.entries);
    expect(restored.presentation).toMatchObject({ featuredEntryId: payload.entries[1].id, showQuote: false, overlay: "STRONG" });
    await waitFor(() => expect(listProducts).not.toHaveBeenCalled());
  });

  it("preserves stable ids through reorder and chooses a remaining featured photo after deletion", () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<AdminI18nProvider><Harness initial={{ entries: [
      { id: "first", name: "", comment: "First", imageUrl: "/uploads/a.jpg" },
      { id: "second", name: "", comment: "Second", imageUrl: "/uploads/b.jpg" },
    ], presentation: { layout: "COLLAGE", featuredEntryId: "second" } }} /></AdminI18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Move UGC row 2 up" }));
    let payload = JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}");
    expect(payload.entries.map((row: { id: string }) => row.id)).toEqual(["second", "first"]);
    expect(payload.presentation.featuredEntryId).toBe("second");
    fireEvent.click(screen.getByRole("button", { name: "Remove UGC row 1" }));
    payload = JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}");
    expect(payload.presentation.featuredEntryId).toBe("first");
    fireEvent.click(screen.getByRole("button", { name: "Remove UGC row 1" }));
    payload = JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}");
    expect(payload.entries).toEqual([]);
    expect(payload.presentation).not.toHaveProperty("featuredEntryId");
  });
  it.each(["reorder", "delete", "switch"] as const)("keeps a late collage upload scoped to its stable row after %s", async (operation) => {
    let resolveUpload: ((value: { url: string }) => void) | undefined;
    uploadImage.mockReturnValue(new Promise<{ url: string }>((resolve) => { resolveUpload = resolve; }));
    render(<AdminI18nProvider><Harness switchable initial={{ entries: [
      { id: "row-a", name: "Sample A", comment: "Sample quote A", imageUrl: "/uploads/original.jpg" },
      { id: "row-b", name: "Sample B", comment: "Sample quote B", imageUrl: "/uploads/b.jpg" },
    ], presentation: { layout: "COLLAGE", featuredEntryId: "row-a" } }} /></AdminI18nProvider>);
    const file = screen.getByTestId("ugc-row-0").querySelector('input[type="file"]')!;
    fireEvent.change(file, { target: { files: [new File(["image"], "a.jpg", { type: "image/jpeg" })] } });
    if (operation === "reorder") {
      fireEvent.click(screen.getByRole("button", { name: "Move UGC row 1 down" }));
      fireEvent.change(screen.getByRole("textbox", { name: "UGC comment 2" }), { target: { value: "Edited during upload" } });
    } else if (operation === "delete") fireEvent.click(screen.getByRole("button", { name: "Remove UGC row 1" }));
    else fireEvent.click(screen.getByRole("button", { name: "Switch section" }));
    await act(async () => { resolveUpload?.({ url: "/uploads/new.jpg" }); await Promise.resolve(); });
    const payload = JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}");
    if (operation === "reorder") {
      expect(payload.entries[1]).toMatchObject({ id: "row-a", imageUrl: "/uploads/new.jpg", comment: "Edited during upload" });
      expect(payload.presentation.featuredEntryId).toBe("row-a");
    } else if (operation === "delete") {
      expect(payload.entries).toHaveLength(1);
      expect(payload.entries[0]).toMatchObject({ id: "row-b", imageUrl: "/uploads/b.jpg" });
    } else expect(payload.entries.every((entry: { imageUrl: string }) => entry.imageUrl === "/uploads/other.jpg")).toBe(true);
  });

  it("keeps the original collage image when an upload fails", async () => {
    uploadImage.mockRejectedValue(new Error("Sample upload failure"));
    render(<AdminI18nProvider><Harness initial={{ entries: [{ id: "row-a", name: "", comment: "Sample quote", imageUrl: "/uploads/original.jpg" }], presentation: { layout: "COLLAGE", featuredEntryId: "row-a" } }} /></AdminI18nProvider>);
    const file = screen.getByTestId("ugc-row-0").querySelector('input[type="file"]')!;
    await act(async () => { fireEvent.change(file, { target: { files: [new File(["image"], "a.jpg", { type: "image/jpeg" })] } }); await Promise.resolve(); });
    expect(JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}").entries[0].imageUrl).toBe("/uploads/original.jpg");
  });

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
    fireEvent.click(screen.getByTestId("ugc-row-1-product-open"));
    const option = await screen.findByTestId("product-picker-option-oak-coffee-table");
    fireEvent.click(option);
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

  it("keeps the linked product visible when the product list excludes it", async () => {
    setAdminLang("en");
    listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    getProduct.mockResolvedValue({
      id: PRODUCT_ID,
      name: "Oak coffee table",
      slug: "oak-coffee-table",
      productCode: null,
      images: [],
      variants: [],
    });
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            entries: [{ name: "Mia", comment: "Love it.", productId: PRODUCT_ID }],
          }}
        />
      </AdminI18nProvider>,
    );

    expect(await screen.findByTestId("ugc-row-1-product-current")).toHaveTextContent(
      "Oak coffee table",
    );
    expect(JSON.parse(screen.getByTestId("ugc-payload").textContent ?? "{}").entries[0].productId).toBe(
      PRODUCT_ID,
    );
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
