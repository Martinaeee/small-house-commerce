import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HeaderItem,
  ShellIssue,
} from "@/lib/storefront-shell-document";
import type {
  AdminCategoryNode,
  AdminCollectionRow,
} from "@/lib/admin-api";
import { HeaderContentEditor } from "./HeaderContentEditor";

const apiMock = vi.hoisted(() => ({
  listCategories: vi.fn(),
  listCollections: vi.fn(),
  listProducts: vi.fn(),
  listLandingPages: vi.fn(),
  getProduct: vi.fn(),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));
vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    t: (key: string) => key,
  }),
}));

const ROOT_ID = "00000000-0000-7000-8000-000000000101";
const CHILD_ID = "00000000-0000-7000-8000-000000000102";
const COLLECTION_ID = "00000000-0000-7000-8000-000000000201";

const CHILD: AdminCategoryNode = {
  id: CHILD_ID,
  parentId: ROOT_ID,
  name: "Sofas",
  slug: "sofas",
  sortOrder: 0,
  imageUrl: null,
  status: "ACTIVE",
  heroStyle: null,
  children: [],
};

const ROOT: AdminCategoryNode = {
  id: ROOT_ID,
  parentId: null,
  name: "Living Room",
  slug: "living-room",
  sortOrder: 0,
  imageUrl: null,
  status: "ACTIVE",
  heroStyle: null,
  children: [CHILD],
};

const COLLECTION: AdminCollectionRow = {
  id: COLLECTION_ID,
  name: "New Arrivals",
  slug: "new-arrivals",
  type: "NAVIGATION",
  description: null,
  seoTitle: null,
  seoDescription: null,
  status: "ACTIVE",
  sortOrder: 0,
  heroImage: null,
  heroStyle: null,
  _count: { products: 4 },
};

function categoryItem(
  id: string,
  targetId = ROOT_ID,
  enabled = true,
): HeaderItem {
  return {
    id,
    kind: "CATEGORY_ROOT",
    targetId,
    labelOverride: "",
    enabled,
  };
}

function collectionItem(id: string, enabled = true): HeaderItem {
  return {
    id,
    kind: "COLLECTION",
    targetId: COLLECTION_ID,
    labelOverride: "",
    enabled,
  };
}

function linkItem(id: string, enabled = true): HeaderItem {
  return {
    id,
    kind: "STRUCTURED_LINK",
    label: `Link ${id}`,
    link: { type: "INTERNAL", path: `/${id}` },
    enabled,
  };
}

function Harness({
  initial = [],
  pendingUploads = new Set<"horizontal" | "square">(),
  issues = [],
}: {
  initial?: HeaderItem[];
  pendingUploads?: ReadonlySet<"horizontal" | "square">;
  issues?: ShellIssue[];
}) {
  const [items, setItems] = useState<HeaderItem[]>(() => structuredClone(initial));
  return (
    <>
      <HeaderContentEditor
        items={items}
        onChange={setItems}
        pendingUploads={pendingUploads}
        issues={issues}
      />
      <output data-testid="header-state">{JSON.stringify(items)}</output>
    </>
  );
}

function state(): HeaderItem[] {
  return JSON.parse(screen.getByTestId("header-state").textContent!);
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`header-row-${id}`);
}

/** Category/collection options settle in an effect; await them inside act. */
async function renderSettled(ui: React.ReactElement): Promise<void> {
  await act(async () => {
    render(ui);
  });
  await screen.findByRole("option", { name: "Living Room" });
}

async function chooseAddKind(kind: HeaderItem["kind"]): Promise<void> {
  fireEvent.change(
    screen.getByRole("combobox", {
      name: "storefront_shell_header_add_kind",
    }),
    { target: { value: kind } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listCategories.mockResolvedValue([ROOT]);
  apiMock.listCollections.mockResolvedValue({
    items: [COLLECTION],
    total: 1,
    page: 1,
    pageSize: 100,
  });
  apiMock.listProducts.mockResolvedValue({ items: [] });
  apiMock.listLandingPages.mockResolvedValue({ items: [] });
  let id = 900;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () =>
      `00000000-0000-7000-8000-${String(++id).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HeaderContentEditor", () => {
  it("adds only an active root category and preserves its target id", async () => {
    await renderSettled(<Harness />);

    expect(screen.queryByRole("option", { name: "Sofas" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_header_add" }),
    );

    expect(state()).toEqual([
      expect.objectContaining({
        id: "00000000-0000-7000-8000-000000000901",
        kind: "CATEGORY_ROOT",
        targetId: ROOT_ID,
        labelOverride: "",
        enabled: true,
      }),
    ]);
    fireEvent.change(
      within(row("00000000-0000-7000-8000-000000000901")).getByRole(
        "textbox",
        { name: "storefront_shell_header_label" },
      ),
      { target: { value: "Rooms" } },
    );
    expect(state()[0]).toEqual(
      expect.objectContaining({ targetId: ROOT_ID, labelOverride: "Rooms" }),
    );
    expect(ROOT.name).toBe("Living Room");
  });

  it("adds a collection and a structured INTERNAL link", async () => {
    await renderSettled(<Harness />);

    await chooseAddKind("COLLECTION");
    expect(await screen.findByRole("option", { name: "New Arrivals" })).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_header_add" }),
    );

    await chooseAddKind("STRUCTURED_LINK");
    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_header_add" }),
    );

    const items = state();
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: "COLLECTION",
        targetId: COLLECTION_ID,
      }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        kind: "STRUCTURED_LINK",
        link: { type: "INTERNAL", path: "/" },
      }),
    );

    const linkRow = row(items[1].id);
    const path = within(linkRow).getByRole("textbox", {
      name: "homepage_builder_link_internal_path",
    });
    fireEvent.change(path, { target: { value: "/about-luwag" } });
    fireEvent.blur(path);
    await waitFor(() =>
      expect(state()[1]).toEqual(
        expect.objectContaining({
          link: { type: "INTERNAL", path: "/about-luwag" },
        }),
      ),
    );
  });

  it("focuses the stable addressed row from an unavailable-target issue", async () => {
    const issue: ShellIssue = {
      code: "HEADER_TARGET_UNAVAILABLE",
      path: ["header", "items", "0", "targetId"],
      message: "This category is unavailable",
      itemId: "missing-row",
    };
    render(
      <Harness
        initial={[categoryItem("missing-row", "missing-category")]}
        issues={[issue]}
      />,
    );
    await waitFor(() => expect(apiMock.listCategories).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: "This category is unavailable" }),
    );

    expect(document.activeElement).toBe(row("missing-row"));
  });

  it("keeps zero enabled rows saveable while surfacing a publish issue", async () => {
    await renderSettled(<Harness initial={[categoryItem("row-1", ROOT_ID, false)]} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "storefront_shell_header_zero_enabled",
    );
    const label = within(row("row-1")).getByRole("textbox", {
      name: "storefront_shell_header_label",
    });
    expect(label).toBeEnabled();
    fireEvent.change(label, { target: { value: "Still editable" } });
    expect(state()[0]).toEqual(
      expect.objectContaining({ labelOverride: "Still editable" }),
    );
  });

  it("reorders only the array while preserving every row payload", async () => {
    const initial = [
      categoryItem("row-1"),
      collectionItem("row-2"),
      linkItem("row-3"),
    ];
    render(<Harness initial={initial} />);
    await screen.findByRole("option", { name: "Living Room" });

    fireEvent.click(
      within(row("row-2")).getByRole("button", {
        name: "storefront_shell_move_up",
      }),
    );

    expect(state()).toEqual([initial[1], initial[0], initial[2]]);
  });

  it("allows a disabled ninth row but blocks enabling a ninth", async () => {
    const eight = Array.from({ length: 8 }, (_, index) =>
      linkItem(`row-${index + 1}`),
    );
    await renderSettled(<Harness initial={eight} />);
    await chooseAddKind("STRUCTURED_LINK");
    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_header_add" }),
    );

    const ninth = state()[8];
    expect(state()).toHaveLength(9);
    expect(ninth.enabled).toBe(false);
    await act(async () => {
      fireEvent.click(
        within(row(ninth.id)).getByRole("button", {
          name: "storefront_shell_enable",
        }),
      );
    });

    expect(state()[8].enabled).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "storefront_shell_header_enabled_limit",
    );
  });

  it("blocks total draft row 25 at the absolute safety bound", async () => {
    const twentyFour = Array.from({ length: 24 }, (_, index) =>
      linkItem(`row-${index + 1}`, index < 8),
    );
    await act(async () => {
      render(<Harness initial={twentyFour} />);
    });
    await waitFor(() => expect(apiMock.listCategories).toHaveBeenCalled());

    const add = screen.getByRole("button", {
      name: "storefront_shell_header_add",
    });
    expect(add).toBeDisabled();
    fireEvent.click(add);

    expect(state()).toHaveLength(24);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "storefront_shell_header_row_limit",
    );
  });

  it("locks add, delete, move, drag and enable/hide while a Logo upload is pending", async () => {
    await renderSettled(
      <Harness
        initial={[categoryItem("row-1"), collectionItem("row-2", false)]}
        pendingUploads={new Set(["horizontal"])}
      />,
    );

    expect(
      screen.getByRole("button", { name: "storefront_shell_header_add" }),
    ).toBeDisabled();
    const second = row("row-2");
    for (const name of [
      "storefront_shell_drag",
      "storefront_shell_move_up",
      "storefront_shell_delete",
      "storefront_shell_enable",
    ]) {
      expect(within(second).getByRole("button", { name })).toBeDisabled();
    }
  });
});
