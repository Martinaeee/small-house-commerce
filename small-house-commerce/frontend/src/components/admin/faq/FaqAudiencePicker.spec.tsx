import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { faqApi } from "@/lib/faq-api";
import { FaqAudiencePicker } from "./FaqAudiencePicker";
import type { AdminFaqProductCandidate } from "@/lib/admin-api";

vi.mock("@/lib/faq-api", () => ({
  faqApi: { listProducts: vi.fn() },
}));

const CART: AdminFaqProductCandidate = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Curved Cart",
  slug: "curved-cart",
  productCode: "P-000021",
  status: "ACTIVE",
  thumbnailUrl: null,
  faqMode: "SHARED",
};

const DESK: AdminFaqProductCandidate = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Compact Desk",
  slug: "compact-desk",
  productCode: "P-000032",
  status: "ACTIVE",
  thumbnailUrl: null,
  faqMode: "CUSTOM",
};

function StatefulPicker() {
  const [ids, setIds] = useState<string[]>([]);
  return <FaqAudiencePicker ids={ids} onIdsChange={setIds} />;
}

describe("FaqAudiencePicker", () => {
  beforeEach(() => {
    setAdminLang("en");
    vi.resetAllMocks();
  });

  it("labels the pre-selected ids with their real names", async () => {
    vi.mocked(faqApi.listProducts).mockResolvedValue({
      items: [CART, DESK],
      total: 2,
    });

    render(
      <AdminI18nProvider>
        <FaqAudiencePicker
          ids={[CART.id, DESK.id]}
          onIdsChange={vi.fn()}
        />
      </AdminI18nProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Remove Curved Cart" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Compact Desk" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 products")).toBeInTheDocument();
    expect(faqApi.listProducts).toHaveBeenCalledWith({ ids: [CART.id, DESK.id], page: 1, pageSize: 100 });
  });

  it("keeps selections across catalogue pages and searches", async () => {
    const user = userEvent.setup();
    vi.mocked(faqApi.listProducts).mockImplementation(async (query) => ({
      items: query.search || query.page === 2 ? [DESK] : [CART], total: 21,
    }));
    render(<AdminI18nProvider><StatefulPicker /></AdminI18nProvider>);
    await user.click(await screen.findByRole("checkbox", { name: CART.name }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(await screen.findByRole("checkbox", { name: DESK.name }));
    expect(screen.getByRole("button", { name: `Remove ${CART.name}` })).toBeVisible();
    expect(screen.getByRole("button", { name: `Remove ${DESK.name}` })).toBeVisible();
    await user.type(screen.getByLabelText("Search products"), "desk");
    await waitFor(() => expect(faqApi.listProducts).toHaveBeenCalledWith({ search: "desk", page: 1, pageSize: 20 }));
    expect(screen.getByText("2 products")).toBeVisible();
    expect(await screen.findByRole("checkbox", { name: DESK.name })).toBeChecked();
    expect(screen.getByText("Product only")).toBeVisible();
  });

  it("does not let a slow initial request overwrite current search results", async () => {
    const user = userEvent.setup();
    let resolveInitial!: (value: { items: AdminFaqProductCandidate[]; total: number }) => void;
    vi.mocked(faqApi.listProducts).mockImplementation((query) => query.search
      ? Promise.resolve({ items: [DESK], total: 1 })
      : new Promise((resolve) => { resolveInitial = resolve; }));
    render(<AdminI18nProvider><StatefulPicker /></AdminI18nProvider>);
    await user.type(screen.getByLabelText("Search products"), "desk");
    expect(await screen.findByRole("checkbox", { name: DESK.name })).toBeVisible();
    await act(async () => resolveInitial({ items: [CART], total: 1 }));
    expect(screen.getByRole("checkbox", { name: DESK.name })).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: CART.name })).not.toBeInTheDocument();
  });

  it("shows a loading failure and lets a search retry without losing selected IDs", async () => {
    const user = userEvent.setup();
    vi.mocked(faqApi.listProducts).mockImplementation(async (query) => {
      if (!query.search) throw new Error("Network unavailable");
      return { items: [CART], total: 1 };
    });
    render(<AdminI18nProvider><FaqAudiencePicker ids={[CART.id, DESK.id]} onIdsChange={vi.fn()} /></AdminI18nProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    expect(screen.getByText("2 products")).toBeVisible();
    await user.type(screen.getByLabelText("Search products"), "cart");
    expect(await screen.findByRole("checkbox", { name: CART.name })).toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("emits id toggles without writing anything", async () => {
    vi.mocked(faqApi.listProducts).mockResolvedValue({
      items: [CART, DESK],
      total: 2,
    });
    const onChange = vi.fn();

    render(
      <AdminI18nProvider>
        <FaqAudiencePicker ids={[CART.id]} onIdsChange={onChange} />
      </AdminI18nProvider>,
    );

    const box = await screen.findByRole("checkbox", { name: "Curved Cart" });
    expect(box).toBeChecked();
    await screen.getByRole("checkbox", { name: "Compact Desk" }).click();
    expect(onChange).toHaveBeenCalledWith([CART.id, DESK.id]);
    await screen.getByRole("checkbox", { name: "Curved Cart" }).click();
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});