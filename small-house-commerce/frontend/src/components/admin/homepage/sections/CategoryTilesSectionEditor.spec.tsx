import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { CategoryTilesSectionEditor } from "@/components/admin/homepage/sections/CategoryTilesSectionEditor";
import type { SectionOf } from "@/components/admin/homepage/section-editor-registry";
import type { SectionPayloadMap } from "@/lib/homepage-section-payloads";

const listCategories = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({
  adminApi: { listCategories },
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
    <CategoryTilesSectionEditor
      section={makeSection(payload)}
      onPayloadChange={(patch) =>
        setPayload((current) =>
          typeof patch === "function" ? patch(current) : { ...current, ...patch },
        )
      }
    />
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
    expect(screen.queryByText(/categoryIds/)).not.toBeInTheDocument();
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
