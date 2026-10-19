import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { CategoryTilesSectionEditor } from "@/components/admin/homepage/sections/CategoryTilesSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const listCategories = vi.hoisted(() => vi.fn());
const listCollections = vi.hoisted(() => vi.fn());
const uploadImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({
  adminApi: { listCategories, listCollections, uploadImage },
}));

const CATEGORY_TILES_ID = "00000000-0000-7000-8000-000000000102";
type CategoryTilesSection = SectionOf<"CATEGORY_TILES">;

function makeSection(
  payload: Partial<SectionPayloadMap["CATEGORY_TILES"]> = {},
): CategoryTilesSection {
  return {
    id: CATEGORY_TILES_ID,
    type: "CATEGORY_TILES",
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: 20,
    schedule: { publishAt: null, unpublishAt: null },
    products: [],
    payload,
  };
}

function Harness({
  initial = {},
}: {
  initial?: Partial<SectionPayloadMap["CATEGORY_TILES"]>;
}): ReactNode {
  const [payload, setPayload] = useState<
    SectionPayloadMap["CATEGORY_TILES"]
  >(initial);
  return (
    <>
      <CategoryTilesSectionEditor
        section={makeSection(payload)}
        onPayloadChange={(patch) =>
          setPayload((current) =>
            typeof patch === "function" ? patch(current) : { ...current, ...patch },
          )
        }
      />
      <pre data-testid="category-payload">{JSON.stringify(payload)}</pre>
    </>
  );
}

const categories = [
  {
    id: "00000000-0000-7000-8000-000000000201",
    parentId: null,
    name: "Living room",
    slug: "living-room",
    sortOrder: 0,
    imageUrl: null,
    status: "ACTIVE",
    heroStyle: null,
    children: [
      {
        id: "00000000-0000-7000-8000-000000000202",
        parentId: "00000000-0000-7000-8000-000000000201",
        name: "Coffee tables",
        slug: "coffee-tables",
        sortOrder: 0,
        imageUrl: null,
        status: "ACTIVE",
        heroStyle: null,
        children: [],
      },
    ],
  },
  {
    id: "00000000-0000-7000-8000-000000000203",
    parentId: null,
    name: "Bedroom",
    slug: "bedroom",
    sortOrder: 1,
    imageUrl: null,
    status: "ACTIVE",
    heroStyle: null,
    children: [],
  },
];

describe("CategoryTilesSectionEditor", () => {
  it("offers circular navigation without silently converting an existing category list", async () => {
    setAdminLang("en");
    listCategories.mockResolvedValue([]);
    render(<AdminI18nProvider><Harness initial={{ categoryIds: [] }} /></AdminI18nProvider>);
    expect(await screen.findByRole("button", { name: "Circular images" })).toBeVisible();
    expect(JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}")).not.toHaveProperty("entries");
  });

  it("converts on an explicit choice, preserves order and never selects an image", async () => {
    setAdminLang("en");
    listCategories.mockResolvedValue(categories);
    const ids = [categories[0].id, categories[1].id];
    render(<AdminI18nProvider><Harness initial={{ categoryIds: ids, layout: { gap: 0 } }} /></AdminI18nProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Circular images" }));
    const converted = JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}");
    expect(converted).not.toHaveProperty("categoryIds");
    expect(converted).toMatchObject({ presentation: "CIRCLES", layout: { gap: 0 } });
    expect(converted.entries.map((entry: { link: unknown }) => entry.link)).toEqual(ids.map((id) => ({ type: "CATEGORY", id })));
    for (const entry of converted.entries) {
      expect(entry.id).toMatch(/^[a-f0-9-]{36}$/i);
      expect(entry).not.toHaveProperty("imageUrl");
    }
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Living room" })).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Tiles" }));
    expect(JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}")).toEqual({ ...converted, presentation: "TILES" });
  });

  it("adds stable empty entries up to six and allows reorder/removal", async () => {
    setAdminLang("en");
    listCategories.mockResolvedValue([]);
    render(<AdminI18nProvider><Harness initial={{ entries: [], presentation: "CIRCLES" }} /></AdminI18nProvider>);
    const add = await screen.findByRole("button", { name: "Add homepage entry" });
    for (let i = 0; i < 6; i++) fireEvent.click(add);
    const before = JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}").entries;
    expect(new Set(before.map((entry: { id: string }) => entry.id)).size).toBe(6);
    expect(before.every((entry: { link: unknown }) => entry.link === null)).toBe(true);
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move homepage entry 1 down" }));
    const reordered = JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}").entries;
    expect(reordered.map((entry: { id: string }) => entry.id)).toEqual([before[1].id, before[0].id, ...before.slice(2).map((entry: { id: string }) => entry.id)]);
    fireEvent.click(screen.getByRole("button", { name: "Remove homepage entry 1" }));
    expect(JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}").entries).toHaveLength(5);
    expect(add).toBeEnabled();
  });

  it("keeps homepage images and real catalog targets independent", async () => {
    setAdminLang("en");
    listCategories.mockResolvedValue(categories);
    listCollections.mockResolvedValue({ items: [{ id: categories[1].id, name: "Sample collection" }], total: 1 });
    const entryId = "00000000-0000-7000-8000-000000000701";
    render(<AdminI18nProvider><Harness initial={{ entries: [{ id: entryId, imageUrl: "/uploads/e2e/original.jpg", link: { type: "CATEGORY", id: categories[0].id } }], presentation: "CIRCLES" }} /></AdminI18nProvider>);
    const image = screen.getByRole("textbox", { name: "Homepage image 1" });
    expect(image).toHaveValue("/uploads/e2e/original.jpg");
    fireEvent.change(screen.getByRole("combobox", { name: "Link type" }), { target: { value: "COLLECTION" } });
    fireEvent.click(await screen.findByRole("button", { name: "Sample collection" }));
    expect(image).toHaveValue("/uploads/e2e/original.jpg");
    fireEvent.change(image, { target: { value: "/uploads/e2e/replacement.jpg" } });
    await waitFor(() => expect(JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}").entries[0]).toEqual({ id: entryId, imageUrl: "/uploads/e2e/replacement.jpg", link: { type: "COLLECTION", id: categories[1].id } }));
  });

  it("copies a category cover only after an explicit action", async () => {
    setAdminLang("en");
    const cover = "/uploads/e2e/category-cover.jpg";
    listCategories.mockResolvedValue([{ ...categories[0], imageUrl: cover }]);
    render(<AdminI18nProvider><Harness initial={{ entries: [{ id: "00000000-0000-7000-8000-000000000701", imageUrl: "/uploads/e2e/custom.jpg", link: { type: "CATEGORY", id: categories[0].id } }] }} /></AdminI18nProvider>);
    const image = screen.getByRole("textbox", { name: "Homepage image 1" });
    expect(image).toHaveValue("/uploads/e2e/custom.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Use category cover" }));
    await waitFor(() => expect(image).toHaveValue(cover));
  });

  it("keeps the original image after an upload fails", async () => {
    setAdminLang("en");
    uploadImage.mockRejectedValueOnce(new Error("Upload failed"));
    render(<AdminI18nProvider><Harness initial={{ entries: [{ id: "00000000-0000-7000-8000-000000000701", imageUrl: "/uploads/e2e/original.jpg", link: null }] }} /></AdminI18nProvider>);
    const row = screen.getByRole("region", { name: "Homepage entry 1" });
    fireEvent.change(row.querySelector('input[type="file"]')!, { target: { files: [new File(["test"], "photo.jpg", { type: "image/jpeg" })] } });
    expect(await within(row).findByRole("alert")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Homepage image 1" })).toHaveValue("/uploads/e2e/original.jpg");
  });

  it.each(["reorder", "remove"] as const)("keeps late uploads attached to their identity after %s", async (action) => {
    setAdminLang("en");
    let finish!: (value: { url: string }) => void;
    uploadImage.mockReturnValueOnce(new Promise<{ url: string }>((resolve) => { finish = resolve; }));
    const entries = [
      { id: "00000000-0000-7000-8000-000000000701", imageUrl: "/uploads/e2e/first.jpg", link: null },
      { id: "00000000-0000-7000-8000-000000000702", imageUrl: "/uploads/e2e/second.jpg", link: null },
    ];
    render(<AdminI18nProvider><Harness initial={{ entries, presentation: "CIRCLES" }} /></AdminI18nProvider>);
    const row = screen.getByRole("region", { name: "Homepage entry 1" });
    fireEvent.change(row.querySelector('input[type="file"]')!, { target: { files: [new File(["test"], "photo.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(within(row).getByRole("button", { name: "Uploading…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: action === "reorder" ? "Move homepage entry 1 down" : "Remove homepage entry 1" }));
    await act(async () => { finish({ url: "/uploads/e2e/completed.jpg" }); });
    const stored = JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}").entries;
    expect(stored[0]).toEqual(entries[1]);
    if (action === "remove") expect(stored).toHaveLength(1);
    else expect(stored[1]).toEqual({ ...entries[0], imageUrl: "/uploads/e2e/completed.jpg" });
  });

  it("cancels a late upload when another section reuses the same entry identity", async () => {
    setAdminLang("en");
    let finish!: (value: { url: string }) => void;
    uploadImage.mockReturnValueOnce(new Promise<{ url: string }>((resolve) => { finish = resolve; }));
    const entryId = "00000000-0000-7000-8000-000000000701";
    function SwitchingHarness() {
      const [id, setId] = useState(CATEGORY_TILES_ID);
      const [payload, setPayload] = useState<SectionPayloadMap["CATEGORY_TILES"]>({ entries: [{ id: entryId, imageUrl: "/uploads/e2e/old.jpg", link: null }] });
      return <><button onClick={() => { setId("00000000-0000-7000-8000-000000000999"); setPayload({ entries: [{ id: entryId, imageUrl: "/uploads/e2e/other-section.jpg", link: null }] }); }}>Switch section</button>
        <CategoryTilesSectionEditor section={{ ...makeSection(payload), id }} onPayloadChange={(patch) => setPayload((current) => typeof patch === "function" ? patch(current) : { ...current, ...patch })} />
        <pre data-testid="category-payload">{JSON.stringify(payload)}</pre></>;
    }
    render(<AdminI18nProvider><SwitchingHarness /></AdminI18nProvider>);
    const row = screen.getByRole("region", { name: "Homepage entry 1" });
    fireEvent.change(row.querySelector('input[type="file"]')!, { target: { files: [new File(["test"], "photo.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(within(row).getByRole("button", { name: "Uploading…" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Switch section" }));
    await act(async () => { finish({ url: "/uploads/e2e/late.jpg" }); });
    expect(JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}").entries).toEqual([{ id: entryId, imageUrl: "/uploads/e2e/other-section.jpg", link: null }]);
  });

  it("loads nested category options, stores UUIDs, and never stores display names", async () => {
    setAdminLang("en");
    listCategories.mockResolvedValue(categories);
    render(
      <AdminI18nProvider>
        <Harness initial={{ categoryIds: [] }} />
      </AdminI18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Living room" })).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Coffee tables" }));

    expect(screen.getByTestId("category-tile-row-00000000-0000-7000-8000-000000000202")).toHaveTextContent(
      "Coffee tables",
    );
    const saved = JSON.parse(screen.getByTestId("category-payload").textContent ?? "{}");
    expect(saved.categoryIds).toEqual([categories[0].children[0].id]);
    expect(saved).not.toHaveProperty("entries");
    expect(screen.getByRole("button", { name: "Add category" })).toBeEnabled();
  });

  it("renders a safe empty state when the stored category ids are malformed", async () => {
    setAdminLang("en");
    listCategories.mockResolvedValue([]);
    render(
      <AdminI18nProvider>
        <Harness
          initial={{
            categoryIds: {} as unknown as SectionPayloadMap["CATEGORY_TILES"]["categoryIds"],
          }}
        />
      </AdminI18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("No categories selected yet.")).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "Add category" })).toBeEnabled();
  });

  it("reorders and removes by category id, with the six-category maximum disabling add", async () => {
    setAdminLang("en");
    listCategories.mockResolvedValue([]);
    const ids = Array.from(
      { length: 6 },
      (_, index) => `00000000-0000-7000-8000-00000000020${index}`,
    );
    render(
      <AdminI18nProvider>
        <Harness initial={{ categoryIds: ids }} />
      </AdminI18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("No matching categories.")).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "Add category" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Move category 1 down" }),
    );
    expect(
      screen.getByTestId(`category-tile-row-${ids[1]}`),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Remove category ${ids[0]}` }),
    ).toBeEnabled();
  });

  it("shows a safe empty legacy payload without inventing a category name", async () => {
    setAdminLang("en");
    listCategories.mockResolvedValue([]);
    render(
      <AdminI18nProvider>
        <Harness />
      </AdminI18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("No categories selected yet.")).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "Add category" })).toBeEnabled();
  });
});
