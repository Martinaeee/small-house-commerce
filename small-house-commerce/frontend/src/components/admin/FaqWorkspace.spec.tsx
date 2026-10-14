import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminFaqItem, AdminFaqProductCandidate, AdminProduct } from "@/lib/admin-api";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { AdminApiError } from "@/lib/admin-auth";
import { adminApi } from "@/lib/admin-api";
import { faqApi } from "@/lib/faq-api";
import { FaqWorkspace } from "./FaqWorkspace";

const navState = vi.hoisted(() => ({
  searchParams: "",
  listeners: new Set<() => void>(),
}));

// Mirrors the real Next hook: useSearchParams is an external store, so a
// router.replace re-renders every reader.
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({
      replace: (url: string) => {
        const index = url.indexOf("?");
        navState.searchParams = index === -1 ? "" : url.slice(index + 1);
        for (const listener of navState.listeners) listener();
      },
      push: vi.fn(),
      refresh: vi.fn(),
    }),
    usePathname: () => "/admin/faq",
    useSearchParams: () => {
      const snapshot = React.useSyncExternalStore(
        (callback: () => void) => {
          navState.listeners.add(callback);
          return () => {
            navState.listeners.delete(callback);
          };
        },
        () => navState.searchParams,
        () => navState.searchParams,
      );
      return React.useMemo(() => new URLSearchParams(snapshot), [snapshot]);
    },
  };
});

vi.mock("@/lib/faq-api", () => ({
  faqApi: {
    getShared: vi.fn(),
    getSharedPreview: vi.fn(),
    previewSharedImpact: vi.fn(),
    updateShared: vi.fn(),
    getProductGroups: vi.fn(),
    listProducts: vi.fn(),
  },
}));

vi.mock("@/lib/admin-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin-api")>("@/lib/admin-api");
  return {
    ...actual,
    adminApi: {
      listProducts: vi.fn(),
      getProduct: vi.fn(),
      updateProduct: vi.fn(),
    },
  };
});

const sharedItem: AdminFaqItem = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "How does delivery work?",
  answer: [{ kind: "paragraph", text: "We deliver nationwide." }],
  enabled: true,
  position: 0,
  defaultOpen: true,
  category: "DELIVERY",
  updatedAt: "2026-10-05T00:00:00.000Z",
};

const legacySharedItem: AdminFaqItem = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "A legacy question?",
  answer: [{ kind: "paragraph", text: "From before categories existed." }],
  enabled: false,
  position: 1,
  defaultOpen: false,
};

const productItem: AdminFaqItem = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Does it fit a narrow hallway?",
  answer: [{ kind: "paragraph", text: "Yes." }],
  enabled: true,
  position: 0,
  defaultOpen: false,
  updatedAt: "2026-10-08T00:00:00.000Z",
};

const productGroup = {
  product: {
    id: "product-1",
    name: "Narrow Storage Cart",
    slug: "narrow-cart",
    status: "ACTIVE" as const,
    productCode: "P-000021",
    thumbnailUrl: "/uploads/cart.png",
    thumbnailAlt: "Cart",
  },
  faq: { mode: "EXTEND" as const, version: 2, items: [productItem] },
};

const productWithoutFaq = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Compact Desk",
  slug: "compact-desk",
  status: "ACTIVE" as const,
  productCode: "P-000032",
  images: [],
} as unknown as AdminProduct;

function renderWorkspace(props: {
  canEditShared: boolean;
  canEditProducts: boolean;
}) {
  return render(
    <AdminI18nProvider>
      <FaqWorkspace {...props} />
    </AdminI18nProvider>,
  );
}

function sharedRegion() {
  return within(screen.getByRole("region", { name: "Shared questions" }));
}

function productRegion() {
  return within(
    screen.getByRole("region", { name: "Product-specific questions" }),
  );
}

async function openProductGroup(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(productRegion().getByText(name));
}

async function confirmSharedImpact(
  user: ReturnType<typeof userEvent.setup>,
  productCount = 7,
) {
  const confirmation = within(
    await screen.findByRole("dialog", {
      name: "Confirm shared FAQ changes",
    }),
  );
  expect(
    confirmation.getByText(
      `This change will update the shared FAQ shown by ${productCount} active products. Continue?`,
    ),
  ).toBeInTheDocument();
  await user.click(
    confirmation.getByRole("button", { name: "Save shared FAQ" }),
  );
}

function stubApi() {
  vi.mocked(faqApi.getShared).mockResolvedValue({
    id: "shared",
    version: 3,
    items: [sharedItem, legacySharedItem],
    usage: { productCount: 12 },
  });
  vi.mocked(faqApi.getSharedPreview).mockResolvedValue({ items: [sharedItem] });
  vi.mocked(faqApi.getProductGroups).mockResolvedValue({
    items: [productGroup],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(adminApi.listProducts).mockResolvedValue({
    items: [productWithoutFaq],
    total: 1,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(adminApi.getProduct).mockResolvedValue(productWithoutFaq);
  vi.mocked(faqApi.listProducts).mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.mocked(faqApi.previewSharedImpact).mockResolvedValue({
    productCount: 7,
    version: 3,
  });
  vi.mocked(faqApi.updateShared).mockResolvedValue({ version: 4 });
  vi.mocked(adminApi.updateProduct).mockResolvedValue({
    ...productWithoutFaq,
    faq: { mode: "EXTEND", version: 3, items: [productItem] },
  } as AdminProduct);
}

describe("FaqWorkspace", () => {
  beforeEach(() => {
    setAdminLang("en");
    vi.resetAllMocks();
    navState.searchParams = "";
    navState.listeners.clear();
    stubApi();
  });

  it("renders the FAQ structure without any question or answer inputs", async () => {
    renderWorkspace({ canEditShared: true, canEditProducts: true });

    await screen.findByText("How does delivery work?");
    expect(
      sharedRegion().getByText("Delivery & receiving"),
    ).toBeInTheDocument();
    expect(sharedRegion().getByText("Uncategorized")).toBeInTheDocument();
    expect(screen.getByText("Narrow Storage Cart")).toBeInTheDocument();
    // The list is the structure view: every editor lives behind a dialog.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  });

  it("uses a wide list shell and a single compact filter toolbar", async () => {
    const { container } = renderWorkspace({
      canEditShared: true,
      canEditProducts: true,
    });
    await screen.findByText("Delivery & receiving");

    expect(container.querySelector("[data-faq-workspace]")).toHaveClass(
      "max-w-[1280px]",
    );
    const filters = within(
      screen.getByRole("toolbar", { name: "FAQ filters" }),
    );
    expect(
      filters.getByPlaceholderText("Search FAQ, product or code…"),
    ).toBeInTheDocument();
    expect(filters.getByRole("combobox", { name: "FAQ type" })).toBeInTheDocument();
    expect(filters.getByRole("combobox", { name: "Category" })).toBeInTheDocument();
    expect(filters.getByRole("combobox", { name: "Product" })).toBeInTheDocument();
    expect(filters.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(filters.getByRole("combobox", { name: "Updated" })).toBeInTheDocument();
    expect(filters.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("shows scan-friendly summary metrics for shared and product FAQ", async () => {
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText("Delivery & receiving");

    const shared = sharedRegion();
    expect(shared.getByText("Reusable questions inherited by products.")).toBeInTheDocument();
    expect(shared.getByTestId("faq-shared-question-count")).toHaveTextContent(
      "Questions2",
    );
    expect(shared.getByTestId("faq-shared-product-count")).toHaveTextContent(
      "Applied products12",
    );

    const product = productRegion();
    expect(product.getByText("Product-specific questions grouped by product.")).toBeInTheDocument();
    expect(product.getByTestId("faq-product-count")).toHaveTextContent(
      "Products1",
    );
    expect(product.getByTestId("faq-product-question-count")).toHaveTextContent(
      "Questions1",
    );
  });

  it("resets every URL-backed FAQ filter from the compact toolbar", async () => {
    navState.searchParams =
      "view=product&search=chair&category=DELIVERY&product=product-1&status=enabled&updated=7d&page=2";
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText("Narrow Storage Cart");

    await user.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(navState.searchParams).toBe(""));
    expect(
      screen.getByPlaceholderText("Search FAQ, product or code…"),
    ).toHaveValue("");
  });

  it("keeps only Edit visible on rows and moves secondary actions into More", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText("Delivery & receiving");

    const editAction = screen.getByRole("button", {
      name: "Edit — How does delivery work?",
    });
    expect(editAction).toBeInTheDocument();
    expect(editAction).toHaveClass("h-8", "whitespace-nowrap");
    expect(editAction).not.toHaveClass("h-12");
    expect(
      screen.queryByRole("button", {
        name: "Duplicate — How does delivery work?",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Disable — How does delivery work?" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "More actions — How does delivery work?",
      }),
    );
    const duplicateAction = screen.getByRole("button", {
      name: "Duplicate — How does delivery work?",
    });
    expect(duplicateAction).toBeInTheDocument();
    expect(duplicateAction.closest(".overflow-x-auto")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Disable — How does delivery work?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete — How does delivery work?" }),
    ).toBeInTheDocument();
  });

  it("uses one product Add action and moves Open product into group More", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText("Narrow Storage Cart");

    const group = productRegion().getByText("Narrow Storage Cart").closest("details")!;
    expect(
      within(group).getAllByRole("button", { name: /Add product FAQ/ }),
    ).toHaveLength(1);
    expect(
      within(group).queryByRole("link", { name: "Open product" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(group).getByRole("button", {
        name: "More actions — Narrow Storage Cart",
      }),
    );
    expect(
      screen.getByRole("link", {
        name: "Open product — Narrow Storage Cart",
      }),
    ).toBeInTheDocument();
  });

  it("groups shared questions by category and files legacy rows under uncategorized", async () => {
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    const shared = sharedRegion();
    const delivery = shared
      .getByText("Delivery & receiving")
      .closest("details")!;
    expect(
      within(delivery).getByText("How does delivery work?"),
    ).toBeInTheDocument();
    expect(
      within(delivery).queryByText("A legacy question?"),
    ).not.toBeInTheDocument();

    const uncategorized = shared.getByText("Uncategorized").closest("details")!;
    expect(
      within(uncategorized).getByText("A legacy question?"),
    ).toBeInTheDocument();
  });

  it("shows status and updated columns and marks legacy rows as not recorded", async () => {
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    const shared = sharedRegion();
    const delivery = shared
      .getByText("Delivery & receiving")
      .closest("details")!;
    expect(within(delivery).getByText("Enabled")).toBeInTheDocument();
    expect(
      within(delivery).queryByText("Not recorded"),
    ).not.toBeInTheDocument();

    const uncategorized = shared.getByText("Uncategorized").closest("details")!;
    expect(within(uncategorized).getByText("Disabled")).toBeInTheDocument();
    expect(within(uncategorized).getByText("Not recorded")).toBeInTheDocument();
  });

  it("keeps localized update dates from colliding with row actions", async () => {
    setAdminLang("zh");
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("配送与签收");

    const shared = within(
      screen.getByRole("region", { name: "共享问题" }),
    );
    const delivery = shared.getByText("配送与签收").closest("details")!;
    expect(within(delivery).getByRole("columnheader", { name: "更新时间" })).toHaveClass(
      "w-36",
    );
    const row = within(delivery).getByText("How does delivery work?").closest("tr")!;
    expect(within(row).getAllByRole("cell")[2]).toHaveClass(
      "whitespace-nowrap",
    );
  });

  it("gives shared and product question tables a local horizontal scroll area", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText("Delivery & receiving");

    const sharedTable = sharedRegion().getAllByRole("table")[0]!;
    expect(sharedTable).toHaveClass("min-w-[720px]");
    expect(sharedTable.parentElement).toHaveClass("overflow-x-auto");

    await openProductGroup(user, "Narrow Storage Cart");
    const productGroup = productRegion()
      .getByText("Narrow Storage Cart")
      .closest("details")!;
    const productTable = within(productGroup).getByRole("table");
    expect(productTable).toHaveClass("min-w-[720px]");
    expect(productTable.parentElement).toHaveClass("overflow-x-auto");
  });

  it("keeps shared categories open by default and product groups collapsed", async () => {
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText("How does delivery work?");

    const delivery = sharedRegion()
      .getByText("Delivery & receiving")
      .closest("details") as HTMLDetailsElement;
    expect(delivery.open).toBe(true);

    const group = screen
      .getByText("Narrow Storage Cart")
      .closest("details") as HTMLDetailsElement;
    expect(group.open).toBe(false);
  });

  it("filters shared rows by the search text and re-queries the product list", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText("Delivery & receiving");

    await user.type(
      screen.getByLabelText("Search questions, answers, product name or code"),
      "delivery",
    );
    await waitFor(() => {
      expect(faqApi.getProductGroups).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "delivery", page: 1 }),
      );
    });
    await waitFor(() => {
      expect(
        sharedRegion().queryByText("A legacy question?"),
      ).not.toBeInTheDocument();
    });
    expect(
      sharedRegion().getByText("How does delivery work?"),
    ).toBeInTheDocument();
  });

  it("switches views between all, shared and product sections", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText("Delivery & receiving");

    await user.click(screen.getByRole("tab", { name: "Product FAQ" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Shared questions" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("region", { name: "Product-specific questions" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Shared FAQ" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Product-specific questions" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("region", { name: "Shared questions" }),
    ).toBeInTheDocument();
  });

  it("edits a shared question in a dialog and saves the full library", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.click(
      screen.getByRole("button", { name: "Edit — How does delivery work?" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    expect(dialog.getByLabelText("Question")).toHaveValue(
      "How does delivery work?",
    );
    expect(dialog.getByLabelText(/^Answer/)).toHaveValue(
      "We deliver nationwide.",
    );
    expect(dialog.getByLabelText("Category")).toHaveValue("DELIVERY");

    await user.clear(dialog.getByLabelText("Question"));
    await user.type(dialog.getByLabelText("Question"), "How fast is delivery?");
    await user.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(faqApi.previewSharedImpact).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            id: sharedItem.id,
            title: "How fast is delivery?",
          }),
          expect.objectContaining({
            id: legacySharedItem.id,
            title: "A legacy question?",
          }),
        ],
        3,
      );
    });
    expect(faqApi.updateShared).not.toHaveBeenCalled();
    await confirmSharedImpact(user);
    await waitFor(() => {
      expect(faqApi.updateShared).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            id: sharedItem.id,
            title: "How fast is delivery?",
          }),
          expect.objectContaining({
            id: legacySharedItem.id,
            title: "A legacy question?",
          }),
        ],
        3,
      );
    });
    expect(
      vi.mocked(faqApi.previewSharedImpact).mock.invocationCallOrder[0]!,
    ).toBeLessThan(vi.mocked(faqApi.updateShared).mock.invocationCallOrder[0]!);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the edited draft and skips PUT when impact confirmation is canceled", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.click(
      screen.getByRole("button", { name: "Edit — How does delivery work?" }),
    );
    const editor = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    await user.clear(editor.getByLabelText("Question"));
    await user.type(editor.getByLabelText("Question"), "Draft delivery question?");
    await user.click(editor.getByRole("button", { name: "Save" }));

    const confirmation = within(
      await screen.findByRole("dialog", {
        name: "Confirm shared FAQ changes",
      }),
    );
    expect(faqApi.updateShared).not.toHaveBeenCalled();
    await user.click(confirmation.getByRole("button", { name: "Cancel" }));

    const restored = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    expect(restored.getByLabelText("Question")).toHaveValue(
      "Draft delivery question?",
    );
    expect(faqApi.updateShared).not.toHaveBeenCalled();
  });

  it("keeps the original dialog and draft visible when impact loading fails", async () => {
    const user = userEvent.setup();
    vi.mocked(faqApi.previewSharedImpact).mockRejectedValue(
      new Error("Affected products could not be calculated."),
    );
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.click(
      screen.getByRole("button", { name: "Edit — How does delivery work?" }),
    );
    const editor = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    await user.clear(editor.getByLabelText("Question"));
    await user.type(editor.getByLabelText("Question"), "Unsaved delivery draft?");
    await user.click(editor.getByRole("button", { name: "Save" }));

    expect(
      await editor.findByRole("alert"),
    ).toHaveTextContent("Affected products could not be calculated.");
    expect(editor.getByLabelText("Question")).toHaveValue(
      "Unsaved delivery draft?",
    );
    expect(faqApi.updateShared).not.toHaveBeenCalled();
  });

  it("creates a shared question through the toolbar dialog", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.click(screen.getByRole("button", { name: "+ New shared FAQ" }));
    const dialog = within(
      await screen.findByRole("dialog", { name: "New shared question" }),
    );
    await user.type(
      dialog.getByLabelText("Question"),
      "Do you ship to Visayas?",
    );
    await user.type(dialog.getByLabelText(/^Answer/), "Yes, nationwide.");
    await user.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(faqApi.previewSharedImpact).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ title: "Do you ship to Visayas?" }),
        ]),
        3,
      );
    });
    expect(faqApi.updateShared).not.toHaveBeenCalled();
    await confirmSharedImpact(user);
    await waitFor(() => {
      expect(faqApi.updateShared).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ title: "Do you ship to Visayas?" }),
        ]),
        3,
      );
    });
    expect(vi.mocked(faqApi.updateShared).mock.calls[0]?.[0]).toHaveLength(3);
    expect(
      vi.mocked(faqApi.previewSharedImpact).mock.invocationCallOrder[0]!,
    ).toBeLessThan(vi.mocked(faqApi.updateShared).mock.invocationCallOrder[0]!);
  });

  it("duplicates a shared question with a copy suffix and a fresh id", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.click(
      screen.getByRole("button", {
        name: "More actions — How does delivery work?",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Duplicate — How does delivery work?",
      }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Duplicate shared question" }),
    );
    expect(dialog.getByLabelText("Question")).toHaveValue(
      "How does delivery work? (copy)",
    );
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(faqApi.previewSharedImpact).toHaveBeenCalled(),
    );
    await confirmSharedImpact(user);

    await waitFor(() => {
      const [items] = vi.mocked(faqApi.updateShared).mock.calls[0]!;
      expect(items).toHaveLength(3);
      const copy = items.find(
        (item) => item.title === "How does delivery work? (copy)",
      );
      expect(copy?.id).not.toBe(sharedItem.id);
      // Legacy rows serialize with the all-products default so the server
      // stores an explicit, unambiguous scope on the next save.
      expect(copy?.audience).toEqual({ scope: "ALL" });
    });
  });

  it("keeps a duplicated maximum-length shared question inside the title limit", async () => {
    const user = userEvent.setup();
    const longTitle = "Q".repeat(200);
    vi.mocked(faqApi.getShared).mockResolvedValue({ id: "shared", version: 3, items: [{ ...sharedItem, title: longTitle }] });
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText(longTitle);
    await user.click(screen.getByRole("button", { name: `More actions — ${longTitle}` }));
    await user.click(screen.getByRole("button", { name: `Duplicate — ${longTitle}` }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("Question")).toHaveValue("Q".repeat(193) + " (copy)");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(faqApi.previewSharedImpact).toHaveBeenCalled());
    await confirmSharedImpact(user);
    await waitFor(() => expect(faqApi.updateShared).toHaveBeenCalled());
    const items = vi.mocked(faqApi.updateShared).mock.calls[0]?.[0];
    expect(items?.[1]?.title.length).toBe(200);
    expect(items?.[0]?.title).toBe(longTitle);
  });

  it("toggles a shared question's status with one save", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.click(
      screen.getByRole("button", {
        name: "More actions — How does delivery work?",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Disable — How does delivery work?" }),
    );
    await waitFor(() => {
      expect(faqApi.previewSharedImpact).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: sharedItem.id, enabled: false }),
        ]),
        3,
      );
    });
    expect(faqApi.updateShared).not.toHaveBeenCalled();
    await confirmSharedImpact(user);
    await waitFor(() => {
      expect(faqApi.updateShared).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: sharedItem.id, enabled: false }),
        ]),
        3,
      );
    });
    expect(
      vi.mocked(faqApi.previewSharedImpact).mock.invocationCallOrder[0]!,
    ).toBeLessThan(vi.mocked(faqApi.updateShared).mock.invocationCallOrder[0]!);
  });

  it("moves a shared question within its category through the versioned save", async () => {
    const user = userEvent.setup();
    const shippingSecond: AdminFaqItem = {
      ...sharedItem,
      id: "55555555-5555-4555-8555-555555555555",
      title: "When will delivery arrive?",
      position: 2,
    };
    vi.mocked(faqApi.getShared).mockResolvedValue({
      id: "shared",
      version: 3,
      items: [sharedItem, legacySharedItem, shippingSecond],
      usage: { productCount: 12 },
    });
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText(shippingSecond.title);

    await user.click(
      screen.getByRole("button", {
        name: `Move up — ${shippingSecond.title}`,
      }),
    );

    await waitFor(() => {
      expect(faqApi.previewSharedImpact).toHaveBeenCalledWith(
        [
          expect.objectContaining({ id: shippingSecond.id, position: 0 }),
          expect.objectContaining({ id: legacySharedItem.id, position: 1 }),
          expect.objectContaining({ id: sharedItem.id, position: 2 }),
        ],
        3,
      );
    });
    expect(faqApi.updateShared).not.toHaveBeenCalled();
    await confirmSharedImpact(user);
    await waitFor(() => {
      expect(faqApi.updateShared).toHaveBeenCalledWith(
        [
          expect.objectContaining({ id: shippingSecond.id, position: 0 }),
          expect.objectContaining({ id: legacySharedItem.id, position: 1 }),
          expect.objectContaining({ id: sharedItem.id, position: 2 }),
        ],
        3,
      );
    });
    expect(
      vi.mocked(faqApi.previewSharedImpact).mock.invocationCallOrder[0]!,
    ).toBeLessThan(vi.mocked(faqApi.updateShared).mock.invocationCallOrder[0]!);
  });

  it("asks which products a shared question applies to", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");
    await user.click(
      screen.getByRole("button", {
        name: "More actions — How does delivery work?",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Edit — How does delivery work?" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    expect(dialog.getByRole("radio", { name: "All products" })).toBeChecked();
    expect(
      dialog.getByRole("radio", { name: "Selected products" }),
    ).not.toBeChecked();
  });

  it("narrows a shared question to at least two selected products", async () => {
    const user = userEvent.setup();
    const cartFixture: AdminFaqProductCandidate = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Curved Cart",
      slug: "curved-cart",
      productCode: "P-000021",
      status: "ACTIVE",
      thumbnailUrl: null,
      faqMode: "SHARED",
    };
    const deskFixture: AdminFaqProductCandidate = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Compact Desk",
      slug: "compact-desk",
      productCode: "P-000032",
      status: "ACTIVE",
      thumbnailUrl: null,
      faqMode: "SHARED",
    };
    vi.mocked(faqApi.listProducts).mockImplementation(async (query) => ({
      items: query.search ? [cartFixture, deskFixture] : [],
      total: query.search ? 2 : 0,
    }));

    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");
    await user.click(
      screen.getByRole("button", {
        name: "More actions — How does delivery work?",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Edit — How does delivery work?" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    await user.click(dialog.getByRole("radio", { name: "Selected products" }));
    expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(dialog.getByLabelText(/Search products/), "cart");
    await user.click(
      await dialog.findByRole("checkbox", { name: "Curved Cart" }),
    );
    expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(
      dialog.getByRole("checkbox", { name: "Compact Desk" }),
    );
    expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(faqApi.previewSharedImpact).toHaveBeenCalled(),
    );
    await confirmSharedImpact(user);
    await waitFor(() => expect(faqApi.updateShared).toHaveBeenCalled());
    const [items] = vi.mocked(faqApi.updateShared).mock.calls[0]!;
    const edited = items.find((item) => item.id === sharedItem.id)!;
    expect(edited.audience).toEqual({
      scope: "PRODUCTS",
      productIds: [cartFixture.id, deskFixture.id],
    });
  });

  it("re-labels an existing targeted audience when the question is edited", async () => {
    const user = userEvent.setup();
    const cartFixture: AdminFaqProductCandidate = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Curved Cart",
      slug: "curved-cart",
      productCode: "P-000021",
      status: "ACTIVE",
      thumbnailUrl: null,
      faqMode: "SHARED",
    };
    const deskFixture: AdminFaqProductCandidate = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Compact Desk",
      slug: "compact-desk",
      productCode: "P-000032",
      status: "ACTIVE",
      thumbnailUrl: null,
      faqMode: "SHARED",
    };
    const targeted: AdminFaqItem = {
      ...sharedItem,
      id: "99999999-9999-4999-8999-999999999999",
      title: "Only for curated carts?",
      audience: {
        scope: "PRODUCTS",
        productIds: [cartFixture.id, deskFixture.id],
      },
    };
    vi.mocked(faqApi.getShared).mockResolvedValue({
      id: "shared",
      version: 3,
      items: [targeted],
      usage: { productCount: 2 },
    });
    vi.mocked(faqApi.listProducts).mockImplementation(async (query) => ({
      items: query.ids ? [cartFixture, deskFixture] : [],
      total: query.ids ? 2 : 0,
    }));

    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Only for curated carts?");
    expect(sharedRegion().getByText("2 products")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "More actions — Only for curated carts?" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Edit — Only for curated carts?" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    expect(
      dialog.getByRole("radio", { name: "Selected products" }),
    ).toBeChecked();
    expect(await dialog.findByRole("button", { name: "Remove Curved Cart" })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Remove Compact Desk" })).toBeInTheDocument();
    expect(dialog.getByText("2 products")).toBeInTheDocument();
  });

  it("limits shared rows to their audience when filtering by product", async () => {
    navState.searchParams = "product=product-1";
    vi.mocked(faqApi.getShared).mockResolvedValue({
      id: "shared", version: 3, items: [sharedItem,
        { ...sharedItem, id: "target-1", title: "For this product?", audience: { scope: "PRODUCTS", productIds: ["product-1", "product-2"] } },
        { ...sharedItem, id: "target-2", title: "For other products?", audience: { scope: "PRODUCTS", productIds: ["product-3", "product-4"] } },
      ],
    });
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    expect(await sharedRegion().findByText(sharedItem.title)).toBeVisible();
    expect(sharedRegion().getByText("For this product?")).toBeVisible();
    expect(sharedRegion().queryByText("For other products?")).not.toBeInTheDocument();
  });

  it("changes product settings without sending shared-only audience metadata", async () => {
    const user = userEvent.setup();
    vi.mocked(faqApi.getProductGroups).mockResolvedValue({ items: [
      { ...productGroup, faq: { ...productGroup.faq, items: [
        { ...productItem, category: "DELIVERY", audience: { scope: "PRODUCTS", productIds: ["product-2", "product-3"] } },
      ] } },
    ], total: 1, page: 1, pageSize: 20 });
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText(productGroup.product.name);
    await user.click(productRegion().getByRole("button", { name: /settings/i }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(adminApi.updateProduct).toHaveBeenCalled());
    expect(vi.mocked(adminApi.updateProduct).mock.calls[0]?.[1].faq?.items[0]).not.toHaveProperty("audience");
  });

  it("asks for confirmation before deleting a shared question", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.click(
      screen.getByRole("button", {
        name: "More actions — How does delivery work?",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete — How does delivery work?" }),
    );
    const confirm = within(
      await screen.findByRole("dialog", { name: "Delete this question?" }),
    );
    await user.click(confirm.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      const [items, version] = vi.mocked(
        faqApi.previewSharedImpact,
      ).mock.calls[0]!;
      expect(items).toHaveLength(1);
      expect(items[0]?.id).toBe(legacySharedItem.id);
      expect(version).toBe(3);
    });
    expect(faqApi.updateShared).not.toHaveBeenCalled();
    await confirmSharedImpact(user);
    await waitFor(() => {
      const [items] = vi.mocked(faqApi.updateShared).mock.calls[0]!;
      expect(items).toHaveLength(1);
      expect(items[0]?.id).toBe(legacySharedItem.id);
    });
    expect(
      vi.mocked(faqApi.previewSharedImpact).mock.invocationCallOrder[0]!,
    ).toBeLessThan(vi.mocked(faqApi.updateShared).mock.invocationCallOrder[0]!);
  });

  it("shows a product group with its code, count and mode, and lists its questions on expand", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText("Narrow Storage Cart");

    const product = productRegion();
    expect(product.getByText(/P-000021/)).toBeInTheDocument();
    expect(product.getByText(/1 questions/)).toBeInTheDocument();
    expect(product.getByText("Shared + product")).toBeInTheDocument();

    const group = product.getByText("Narrow Storage Cart").closest("details")!;
    expect((group as HTMLDetailsElement).open).toBe(false);

    await openProductGroup(user, "Narrow Storage Cart");
    expect((group as HTMLDetailsElement).open).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "Edit — Does it fit a narrow hallway?",
      }),
    ).toBeInTheDocument();
    expect(within(group).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("adds a product question through the picker and the editor dialog", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText("Narrow Storage Cart");

    await user.click(screen.getByRole("button", { name: "+ New product FAQ" }));
    const picker = within(
      await screen.findByRole("dialog", { name: "Choose a product" }),
    );
    expect(await picker.findByText(/P-000032/)).toBeInTheDocument();
    await user.click(picker.getByRole("button", { name: /Compact Desk/ }));

    const editor = within(
      await screen.findByRole("dialog", { name: "New product question" }),
    );
    expect(editor.getByText(/P-000032 · Compact Desk/)).toBeInTheDocument();
    await user.type(editor.getByLabelText("Question"), "Is assembly required?");
    await user.type(editor.getByLabelText(/^Answer/), "No assembly needed.");
    await user.click(editor.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(adminApi.updateProduct).toHaveBeenCalledWith(
        productWithoutFaq.id,
        {
          faq: {
            mode: "EXTEND",
            expectedVersion: 0,
            items: [
              expect.objectContaining({
                title: "Is assembly required?",
                answer: [{ kind: "paragraph", text: "No assembly needed." }],
              }),
            ],
          },
        },
      );
    });
    expect(faqApi.updateShared).not.toHaveBeenCalled();
    const productPayload = vi.mocked(adminApi.updateProduct).mock.calls[0]?.[1];
    expect(productPayload?.faq?.items[0]).not.toHaveProperty("category");
  });

  it("edits a product question with its sort order and saves the whole list", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText("Narrow Storage Cart");
    await openProductGroup(user, "Narrow Storage Cart");

    await user.click(
      screen.getByRole("button", {
        name: "Edit — Does it fit a narrow hallway?",
      }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Edit product question" }),
    );
    expect(dialog.getByLabelText("Sort order")).toHaveValue(1);
    await user.clear(dialog.getByLabelText("Question"));
    await user.type(
      dialog.getByLabelText("Question"),
      "Will it fit a narrow hallway?",
    );
    await user.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(adminApi.updateProduct).toHaveBeenCalledWith(
        productGroup.product.id,
        {
          faq: {
            mode: "EXTEND",
            expectedVersion: 2,
            items: [
              expect.objectContaining({
                id: productItem.id,
                title: "Will it fit a narrow hallway?",
                position: 0,
              }),
            ],
          },
        },
      );
    });
  });

  it("duplicates a product question only on Save, preserving its group and version", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText(productGroup.product.name);
    await openProductGroup(user, productGroup.product.name);
    const row = productRegion().getByText(productItem.title).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: /More/ }));
    await user.click(screen.getByRole("button", { name: `Duplicate — ${productItem.title}` }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Question")).toHaveValue(`${productItem.title} (copy)`);
    expect(within(dialog).queryByLabelText("Category")).not.toBeInTheDocument();
    expect(adminApi.updateProduct).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(adminApi.updateProduct).toHaveBeenCalledOnce());
    const [id, payload] = vi.mocked(adminApi.updateProduct).mock.calls[0];
    expect(id).toBe(productGroup.product.id);
    expect(payload.faq).toMatchObject({ mode: "EXTEND", expectedVersion: 2 });
    expect(payload.faq?.items).toHaveLength(2);
    expect(payload.faq?.items[0]).toEqual(productItem);
    expect(payload.faq?.items[1]).toMatchObject({
      title: `${productItem.title} (copy)`, answer: productItem.answer,
      enabled: true, defaultOpen: false, position: 1,
    });
    expect(payload.faq?.items[1].id).not.toBe(productItem.id);
    expect(payload.faq?.items[1]).not.toHaveProperty("category");
    expect(payload.faq?.items[1]).not.toHaveProperty("updatedAt");
    expect(faqApi.updateShared).not.toHaveBeenCalled();
  });

  it("cancels a duplicate without writing and retains its draft on a version conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.updateProduct).mockRejectedValue(new AdminApiError("Conflict", 409));
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText(productGroup.product.name);
    await openProductGroup(user, productGroup.product.name);
    const openDuplicate = async () => {
      const row = productRegion().getByText(productItem.title).closest("tr")!;
      await user.click(within(row).getByRole("button", { name: /More/ }));
      await user.click(screen.getByRole("button", { name: `Duplicate — ${productItem.title}` }));
    };
    await openDuplicate();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(adminApi.updateProduct).not.toHaveBeenCalled();
    await openDuplicate();
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeVisible());
    expect(within(dialog).getByLabelText("Question")).toHaveValue(`${productItem.title} (copy)`);
    expect(productRegion().getByText(productItem.title)).toBeVisible();
    expect(faqApi.updateShared).not.toHaveBeenCalled();
  });

  it("changes the FAQ mode from the settings dialog without touching the items", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText("Narrow Storage Cart");

    await user.click(
      screen.getByRole("button", {
        name: "FAQ settings — Narrow Storage Cart",
      }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "FAQ settings" }),
    );
    await user.selectOptions(dialog.getByLabelText(/^FAQ mode/), "CUSTOM");
    await user.click(dialog.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(adminApi.updateProduct).toHaveBeenCalledWith(
        productGroup.product.id,
        {
          faq: { mode: "CUSTOM", items: [productItem], expectedVersion: 2 },
        },
      );
    });
  });

  it("keeps a version conflict inside the dialog and offers a reload", async () => {
    const user = userEvent.setup();
    vi.mocked(faqApi.updateShared).mockRejectedValue(
      new AdminApiError("Version 3 is stale (current version 4).", 409),
    );
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.click(
      screen.getByRole("button", { name: "Edit — How does delivery work?" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(faqApi.previewSharedImpact).toHaveBeenCalled(),
    );
    await confirmSharedImpact(user);

    const reopened = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    expect(
      await reopened.findByText(
        "This content changed elsewhere. Reload before saving.",
      ),
    ).toBeInTheDocument();
    const before = vi.mocked(faqApi.getShared).mock.calls.length;
    await user.click(reopened.getByRole("button", { name: "Reload" }));
    await waitFor(() => {
      expect(faqApi.getShared).toHaveBeenCalledTimes(before + 1);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("preserves raw spaces and blank lines while typing an answer in the dialog", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.click(
      screen.getByRole("button", { name: "Edit — How does delivery work?" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Edit shared question" }),
    );
    const answer = dialog.getByLabelText(/^Answer/);
    await user.clear(answer);
    await user.type(answer, "First paragraph.\n\n- One bullet\n- Two bullets");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(faqApi.previewSharedImpact).toHaveBeenCalled(),
    );
    await confirmSharedImpact(user);

    await waitFor(() => {
      const [items] = vi.mocked(faqApi.updateShared).mock.calls[0]!;
      const saved = items.find((item) => item.id === sharedItem.id);
      expect(saved?.answer).toEqual([
        { kind: "paragraph", text: "First paragraph." },
        { kind: "bullets", items: ["One bullet", "Two bullets"] },
      ]);
    });
  });

  it("pages the product list from the URL", async () => {
    const user = userEvent.setup();
    vi.mocked(faqApi.getProductGroups).mockResolvedValue({
      items: [productGroup],
      total: 25,
      page: 1,
      pageSize: 20,
    });
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText("Narrow Storage Cart");

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(faqApi.getProductGroups).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });
  });

  it("applies a deep-linked product filter from the URL", async () => {
    navState.searchParams = "view=product&product=product-1";
    vi.mocked(adminApi.listProducts).mockResolvedValue({
      items: [productGroup.product as unknown as AdminProduct],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText("Narrow Storage Cart");

    expect(faqApi.getProductGroups).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "product-1", page: 1 }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Product")).toHaveValue("product-1");
    });
  });

  it("blocks direct access without either permission and reads no FAQ data", () => {
    renderWorkspace({ canEditShared: false, canEditProducts: false });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your account does not have FAQ management permission.",
    );
    expect(faqApi.getShared).not.toHaveBeenCalled();
    expect(faqApi.getProductGroups).not.toHaveBeenCalled();
  });

  it("shows a product load failure inside the picker and lets the operator retry", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.getProduct).mockRejectedValueOnce(
      new Error("network down"),
    );
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText("Narrow Storage Cart");

    await user.click(screen.getByRole("button", { name: "+ New product FAQ" }));
    const picker = within(
      await screen.findByRole("dialog", { name: "Choose a product" }),
    );
    await user.click(
      await picker.findByRole("button", { name: /Compact Desk/ }),
    );

    expect(await picker.findByText("network down")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "New product question" }),
    ).not.toBeInTheDocument();

    await user.click(
      await picker.findByRole("button", { name: /Compact Desk/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "New product question" }),
    ).toBeInTheDocument();
  });
});

describe("FaqWorkspace URL filters", () => {
  beforeEach(() => {
    setAdminLang("en");
    vi.resetAllMocks();
    navState.searchParams = "";
    navState.listeners.clear();
    stubApi();
  });

  it("keeps the status filter working on both sections", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: true });
    await screen.findByText("Delivery & receiving");

    await user.selectOptions(screen.getByLabelText("Status"), "disabled");
    await waitFor(() => {
      expect(
        sharedRegion().queryByText("How does delivery work?"),
      ).not.toBeInTheDocument();
    });
    expect(sharedRegion().getByText("A legacy question?")).toBeInTheDocument();
    expect(
      productRegion().queryByText("Does it fit a narrow hallway?"),
    ).not.toBeInTheDocument();
  });

  it("writes the category filter into the URL and hides other groups", async () => {
    const user = userEvent.setup();
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Delivery & receiving");

    await user.selectOptions(
      screen.getByLabelText("Category"),
      "UNCATEGORIZED",
    );
    await waitFor(() => {
      expect(navState.searchParams).toContain("category=UNCATEGORIZED");
    });
    await waitFor(() => {
      expect(
        sharedRegion().queryByText("How does delivery work?"),
      ).not.toBeInTheDocument();
    });
    expect(sharedRegion().getByText("A legacy question?")).toBeInTheDocument();
  });
});

describe("FaqWorkspace permission split", () => {
  beforeEach(() => {
    setAdminLang("en");
    vi.resetAllMocks();
    navState.searchParams = "";
    navState.listeners.clear();
    vi.mocked(faqApi.getShared).mockResolvedValue({
      id: "shared",
      version: 1,
      items: [],
      usage: { productCount: 0 },
    });
    vi.mocked(faqApi.getProductGroups).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    vi.mocked(adminApi.listProducts).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
  });

  it("hides the shared section and reads no shared data without its permission", async () => {
    renderWorkspace({ canEditShared: false, canEditProducts: true });
    await screen.findByText("Product-specific questions");

    expect(
      screen.queryByRole("region", { name: "Shared questions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Shared FAQ" }),
    ).not.toBeInTheDocument();
    expect(faqApi.getShared).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "+ New shared FAQ" }),
    ).not.toBeInTheDocument();
  });

  it("hides the product section and reads no product data without its permission", async () => {
    renderWorkspace({ canEditShared: true, canEditProducts: false });
    await screen.findByText("Shared questions");

    expect(
      screen.queryByRole("region", { name: "Product-specific questions" }),
    ).not.toBeInTheDocument();
    expect(faqApi.getProductGroups).not.toHaveBeenCalled();
    expect(adminApi.listProducts).not.toHaveBeenCalled();
  });
});
