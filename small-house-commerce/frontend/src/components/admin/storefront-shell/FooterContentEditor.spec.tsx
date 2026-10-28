import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FooterColumn,
  FooterLegalLink,
  FooterSocial,
  ShellIssue,
} from "@/lib/storefront-shell-document";
import { FooterContentEditor } from "./FooterContentEditor";

const apiMock = vi.hoisted(() => ({
  listProducts: vi.fn(),
  listCollections: vi.fn(),
  listCategories: vi.fn(),
  listLandingPages: vi.fn(),
  getProduct: vi.fn(),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));
vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({ t: (key: string) => key }),
}));

function contactColumn(id = "col-contact", title = "Contact"): FooterColumn {
  return {
    id,
    kind: "CONTACT",
    title,
    supportEmail: "help@luwag.test",
    supportHours: "Mon–Sat",
    trackOrderLabel: "Track order",
    trackOrderLink: { type: "INTERNAL", path: "/track-order" },
  };
}

function linksColumn(id: string, title: string): FooterColumn {
  return {
    id,
    kind: "LINKS",
    title,
    rows: [
      {
        id: `${id}-row-1`,
        kind: "LINK",
        label: "About us",
        link: { type: "INTERNAL", path: "/about" },
      },
      { id: `${id}-row-2`, kind: "TEXT", text: "Manila, Philippines" },
    ],
  };
}

type Props = Partial<Parameters<typeof FooterContentEditor>[0]>;

function Harness({
  columns = [contactColumn(), linksColumn("col-shop", "Shop")],
  issues = [],
  pendingUploads = new Set<"horizontal" | "square">(),
  ...rest
}: Props & { columns?: FooterColumn[] }) {
  const [state, setState] = useState({
    tagline: "Furniture for small homes",
    description: "We build pieces that fit Filipino homes.",
    columns: structuredClone(columns),
    copyrightBrand: "LUWAG",
    socials: [] as FooterSocial[],
    legal: [] as FooterLegalLink[],
    payments: [] as string[],
  });
  return (
    <>
      <FooterContentEditor
        {...rest}
        tagline={state.tagline}
        description={state.description}
        columns={state.columns}
        copyrightBrand={state.copyrightBrand}
        socials={state.socials}
        legal={state.legal}
        payments={state.payments}
        issues={issues}
        pendingUploads={pendingUploads}
        onChange={setState}
      />
      <output data-testid="footer-state">{JSON.stringify(state)}</output>
    </>
  );
}

function state() {
  return JSON.parse(screen.getByTestId("footer-state").textContent!);
}

function column(id: string): HTMLElement {
  return screen.getByTestId(`footer-column-${id}`);
}

async function renderSettled(ui: React.ReactElement): Promise<void> {
  await act(async () => {
    render(ui);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listCategories.mockResolvedValue([]);
  apiMock.listCollections.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  apiMock.listProducts.mockResolvedValue({ items: [] });
  apiMock.listLandingPages.mockResolvedValue({ items: [] });
  let id = 800;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () =>
      `00000000-0000-7000-8000-${String(++id).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FooterContentEditor copy", () => {
  it("no longer offers the legacy COD note field", async () => {
    await renderSettled(<Harness />);

    expect(
      within(column("col-contact")).queryByRole("textbox", {
        name: "storefront_shell_footer_cod_text",
      }),
    ).toBeNull();
  });

  it("bounds tagline, description, column title and row text", async () => {
    await renderSettled(<Harness />);

    expect(
      screen.getByRole("textbox", { name: "storefront_shell_footer_tagline" }),
    ).toHaveAttribute("maxLength", "100");
    expect(
      screen.getByRole("textbox", { name: "storefront_shell_footer_description" }),
    ).toHaveAttribute("maxLength", "300");
    expect(
      screen.getByRole("textbox", { name: "storefront_shell_footer_copyright" }),
    ).toHaveValue("LUWAG");

    const title = within(column("col-shop")).getByRole("textbox", {
      name: "storefront_shell_footer_column_title",
    });
    expect(title).toHaveAttribute("maxLength", "40");
    fireEvent.change(title, { target: { value: "Browse" } });
    expect(
      state().columns.find((entry: FooterColumn) => entry.id === "col-shop")
        .title,
    ).toBe("Browse");

    const textRow = within(column("col-shop")).getByRole("textbox", {
      name: "storefront_shell_footer_row_text",
    });
    expect(textRow).toHaveAttribute("maxLength", "120");
  });

  it("stores no year in the copyright brand", async () => {
    await renderSettled(<Harness />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "storefront_shell_footer_copyright" }),
      { target: { value: "LUWAG Furniture" } },
    );

    expect(state().copyrightBrand).toBe("LUWAG Furniture");
    expect(JSON.stringify(state())).not.toContain(String(new Date().getFullYear()));
  });
});

describe("FooterContentEditor columns", () => {
  it("adds and removes LINKS columns up to five total, reordering the rest", async () => {
    await renderSettled(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_footer_add_column" }),
    );
    expect(state().columns).toHaveLength(3);

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_footer_add_column" }),
    );
    expect(state().columns).toHaveLength(4);
    expect(
      screen.getByRole("button", { name: "storefront_shell_footer_add_column" }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_footer_add_column" }),
    );
    expect(state().columns).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: "storefront_shell_footer_add_column" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "storefront_shell_footer_column_limit",
    );

    const beforeMove = state().columns.map((entry: FooterColumn) => entry.id);
    const shop = column("col-shop");
    fireEvent.click(
      within(shop).getByRole("button", { name: "storefront_shell_footer_move_down" }),
    );
    expect(state().columns.map((entry: FooterColumn) => entry.id)).toEqual([
      beforeMove[0],
      beforeMove[2],
      "col-shop",
      beforeMove[3],
      beforeMove[4],
    ]);

    fireEvent.click(
      within(column("col-shop")).getByRole("button", {
        name: "storefront_shell_footer_remove_column",
      }),
    );
    expect(
      state().columns.some((entry: FooterColumn) => entry.id === "col-shop"),
    ).toBe(false);
  });

  it("allows the optional CONTACT column to move or be removed", async () => {
    await renderSettled(<Harness />);

    const contact = column("col-contact");
    expect(
      within(contact).getByRole("button", {
        name: "storefront_shell_footer_move_down",
      }),
    ).toBeEnabled();

    fireEvent.click(
      within(contact).getByRole("button", {
        name: "storefront_shell_footer_remove_column",
      }),
    );

    expect(
      state().columns.filter((entry: FooterColumn) => entry.kind === "CONTACT"),
    ).toHaveLength(0);
  });

  it("switches a LINKS row between LINK and TEXT without leaking stale fields", async () => {
    await renderSettled(<Harness />);
    const shop = column("col-shop");

    fireEvent.change(
      within(shop).getAllByRole("combobox", {
        name: "storefront_shell_footer_row_kind",
      })[0],
      { target: { value: "TEXT" } },
    );
    const rows = state().columns.find((entry: FooterColumn) => entry.id === "col-shop").rows;
    expect(rows[0]).toEqual({
      id: "col-shop-row-1",
      kind: "TEXT",
      text: "About us",
    });

    fireEvent.change(
      within(shop).getAllByRole("combobox", {
        name: "storefront_shell_footer_row_kind",
      })[0],
      { target: { value: "LINK" } },
    );
    const switched = state().columns.find(
      (entry: FooterColumn) => entry.id === "col-shop",
    ).rows[0];
    expect(switched).toEqual({
      id: "col-shop-row-1",
      kind: "LINK",
      label: "About us",
      link: { type: "INTERNAL", path: "/" },
    });
  });

  it("edits CONTACT fields and its structured Track Order link", async () => {
    await renderSettled(<Harness />);
    const contact = column("col-contact");

    fireEvent.change(
      within(contact).getByRole("textbox", {
        name: "storefront_shell_footer_support_email",
      }),
      { target: { value: "care@luwag.test" } },
    );
    fireEvent.change(
      within(contact).getByRole("textbox", {
        name: "storefront_shell_footer_support_hours",
      }),
      { target: { value: "Mon–Sun, 9am–9pm" } },
    );
    fireEvent.change(
      within(contact).getByRole("textbox", {
        name: "storefront_shell_footer_track_label",
      }),
      { target: { value: "Find my order" } },
    );

    const path = within(contact).getByRole("textbox", {
      name: "homepage_builder_link_internal_path",
    });
    fireEvent.change(path, { target: { value: "/orders/find" } });
    fireEvent.blur(path);

    await waitFor(() => {
      const saved = state().columns.find(
        (entry: FooterColumn) => entry.id === "col-contact",
      );
      expect(saved).toEqual({
        id: "col-contact",
        kind: "CONTACT",
        title: "Contact",
        supportEmail: "care@luwag.test",
        supportHours: "Mon–Sun, 9am–9pm",
        trackOrderLabel: "Find my order",
        trackOrderLink: { type: "INTERNAL", path: "/orders/find" },
      });
    });
  });

  it("surfaces an invalid support email inline without dropping the draft", async () => {
    await renderSettled(<Harness />);
    const contact = column("col-contact");

    fireEvent.change(
      within(contact).getByRole("textbox", {
        name: "storefront_shell_footer_support_email",
      }),
      { target: { value: "not-an-email" } },
    );

    expect(
      within(contact).getByText("storefront_shell_footer_support_email_invalid"),
    ).toBeVisible();
    expect(
      state().columns.find((entry: FooterColumn) => entry.id === "col-contact")
        .supportEmail,
    ).toBe("not-an-email");
  });

  it("focuses the addressed row from an unavailable-link issue", async () => {
    const issue: ShellIssue = {
      code: "FOOTER_LINK_UNAVAILABLE",
      path: ["footer", "columns", "1", "rows", "0", "link"],
      message: "This link target is unavailable",
      itemId: "col-shop-row-1",
    };
    await renderSettled(<Harness issues={[issue]} />);

    fireEvent.click(
      screen.getByRole("button", { name: "This link target is unavailable" }),
    );

    expect(document.activeElement).toBe(
      screen.getByTestId("footer-row-col-shop-row-1"),
    );
  });

  it("locks column and row mutations while a Logo upload is pending", async () => {
    await renderSettled(<Harness pendingUploads={new Set(["horizontal"])} />);

    expect(
      screen.getByRole("button", { name: "storefront_shell_footer_add_column" }),
    ).toBeDisabled();
    const shop = column("col-shop");
    for (const name of [
      "storefront_shell_footer_remove_column",
      "storefront_shell_footer_move_down",
      "storefront_shell_footer_add_row",
    ]) {
      const control = within(shop).queryByRole("button", { name });
      if (control) expect(control).toBeDisabled();
    }
    expect(
      within(shop).getAllByRole("combobox", {
        name: "storefront_shell_footer_row_kind",
      })[0],
    ).toBeDisabled();
    expect(
      within(shop).getAllByRole("button", {
        name: "storefront_shell_footer_remove_row",
      })[0],
    ).toBeDisabled();
  });

  it("does not overflow a narrow fieldset", async () => {
    await renderSettled(<Harness />);

    for (const fieldset of document.querySelectorAll("fieldset")) {
      expect(fieldset.className).toContain("min-w-0");
    }
    for (const input of screen.getAllByRole("textbox")) {
      expect(input.className).toContain("min-w-0");
    }
  });

  it("adds, edits and removes a social link", async () => {
    await renderSettled(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_footer_add_social" }),
    );
    expect(state().socials).toHaveLength(1);
    expect(state().socials[0].network).toBe("FACEBOOK");

    const url = screen.getByLabelText("storefront_shell_footer_social_url");
    fireEvent.change(url, {
      target: { value: "https://www.facebook.com/luwag" },
    });
    expect(state().socials[0].url).toBe("https://www.facebook.com/luwag");

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_footer_remove_social" }),
    );
    expect(state().socials).toHaveLength(0);
  });

  it("adds a legal link and stores its label and target", async () => {
    await renderSettled(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "storefront_shell_footer_add_legal" }),
    );
    expect(state().legal).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("storefront_shell_footer_legal_label"), {
      target: { value: "Terms" },
    });
    fireEvent.change(screen.getByLabelText("storefront_shell_footer_legal_href"), {
      target: { value: "/terms" },
    });
    expect(state().legal[0]).toMatchObject({ label: "Terms", href: "/terms" });
  });

  it("splits payment labels on commas and keeps at most six", async () => {
    await renderSettled(<Harness />);

    fireEvent.change(
      screen.getByLabelText("storefront_shell_footer_payments"),
      {
        target: {
          value: "VISA, Mastercard, GCash, A, B, C, D",
        },
      },
    );
    expect(state().payments).toEqual(["VISA", "Mastercard", "GCash", "A", "B", "C"]);
  });
});
