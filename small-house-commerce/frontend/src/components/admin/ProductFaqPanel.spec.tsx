import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { faqApi } from "@/lib/faq-api";
import { FaqAnswerInput } from "./faq/FaqAnswerInput";
import { ProductFaqPanel } from "./ProductFaqPanel";
import type { AdminFaqItem, AdminProductFaq } from "@/lib/admin-api";

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/faq-api", () => ({
  faqApi: {
    getSharedPreview: vi.fn(),
  },
}));

const faq: AdminProductFaq = {
  mode: "CUSTOM",
  version: 2,
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Does it fit?",
      answer: [{ kind: "paragraph", text: "Yes." }],
      enabled: true,
      position: 0,
      defaultOpen: false,
    },
  ],
};

const sharedEnabled: AdminFaqItem = {
  id: "55555555-5555-4555-8555-555555555555",
  title: "How does delivery work?",
  answer: [{ kind: "paragraph", text: "Nationwide." }],
  enabled: true,
  position: 0,
  defaultOpen: false,
  category: "DELIVERY",
};

const sharedDisabled: AdminFaqItem = {
  ...sharedEnabled,
  id: "66666666-6666-4666-8666-666666666666",
  title: "Hidden shared question?",
  enabled: false,
  position: 1,
};

function StatefulPanel({
  initial,
  onChange,
}: {
  initial: AdminProductFaq;
  onChange: (value: AdminProductFaq) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ProductFaqPanel
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      savedValue={initial}
      productId="product-1"
    />
  );
}

describe("ProductFaqPanel", () => {
  beforeEach(() => {
    setAdminLang("en");
    vi.resetAllMocks();
    vi.mocked(faqApi.getSharedPreview).mockResolvedValue({
      items: [sharedEnabled, sharedDisabled],
    });
  });

  it("edits product FAQ mode and plain-text answer blocks", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <AdminI18nProvider>
        <StatefulPanel initial={faq} onChange={onChange} />
      </AdminI18nProvider>,
    );

    await user.selectOptions(screen.getByRole("combobox"), "EXTEND");
    expect((onChange.mock.calls[0]?.[0] as AdminProductFaq).mode).toBe("EXTEND");
    const answer = screen.getAllByRole("textbox")[1]!;
    await user.clear(answer);
    await user.type(answer, "First paragraph\n\n- One bullet");
    expect(answer).toHaveValue("First paragraph\n\n- One bullet");

    const last = onChange.mock.lastCall?.[0] as AdminProductFaq;
    expect(last.items[0]?.answer).toEqual([
      { kind: "paragraph", text: "First paragraph" },
      { kind: "bullets", items: ["One bullet"] },
    ]);
  });

  it("replaces the raw draft when an external answer is reloaded", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<FaqAnswerInput id="answer" answer={faq.items[0]!.answer} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Draft answer \n\n- Item ");
    expect(input).toHaveValue("Draft answer \n\n- Item ");

    rerender(<FaqAnswerInput id="answer" answer={[{ kind: "paragraph", text: "Answer loaded elsewhere." }]} onChange={onChange} />);
    expect(input).toHaveValue("Answer loaded elsewhere.");
  });

  it("removes product questions without changing the version lock", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const twoFaq: AdminProductFaq = {
      ...faq,
      items: [
        ...faq.items,
        {
          ...faq.items[0]!,
          id: "22222222-2222-4222-8222-222222222222",
          title: "Returns",
          position: 1,
        },
      ],
    };

    render(
      <AdminI18nProvider>
        <StatefulPanel initial={twoFaq} onChange={onChange} />
      </AdminI18nProvider>,
    );

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    const last = onChange.mock.lastCall?.[0] as AdminProductFaq;
    expect(last.items).toHaveLength(1);
    expect(last.version).toBe(2);
  });

  it("renders the targeted effective result as an unsaved customer preview", async () => {
    const matchingTarget: AdminFaqItem = {
      ...sharedEnabled,
      id: "77777777-7777-4777-8777-777777777777",
      title: "Assembly for this product?",
      position: 1,
      audience: {
        scope: "PRODUCTS",
        productIds: ["product-1", "product-2"],
      },
    };
    const otherTarget: AdminFaqItem = {
      ...matchingTarget,
      id: "88888888-8888-4888-8888-888888888888",
      title: "Only for another product?",
      position: 0,
      audience: {
        scope: "PRODUCTS",
        productIds: ["product-8", "product-9"],
      },
    };
    vi.mocked(faqApi.getSharedPreview).mockResolvedValue({
      items: [matchingTarget, otherTarget, sharedEnabled],
    });
    const draft: AdminProductFaq = {
      ...faq,
      mode: "EXTEND",
      items: [
        {
          ...faq.items[0]!,
          title: "Draft product question",
          position: 0,
        },
      ],
    };

    render(
      <AdminI18nProvider>
        <ProductFaqPanel
          value={draft}
          onChange={vi.fn()}
          savedValue={faq}
          productId="product-1"
        />
      </AdminI18nProvider>,
    );

    const preview = await screen.findByRole("region", {
      name: "Unsaved customer preview",
    });
    expect(screen.getByText("Unsaved customer preview")).toBeInTheDocument();
    expect(
      [...preview.querySelectorAll("summary")].map((node) => node.textContent),
    ).toEqual([
      "How does delivery work?",
      "Assembly for this product?",
      "Draft product question",
    ]);
    expect(
      within(preview).queryByText("Only for another product?"),
    ).not.toBeInTheDocument();
  });

  it("copies applicable shared questions into CUSTOM as independent draft items", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AdminI18nProvider>
        <StatefulPanel initial={faq} onChange={onChange} />
      </AdminI18nProvider>,
    );

    const copy = await screen.findByRole("button", {
      name: "Copy applicable shared questions",
    });
    expect(copy).toBeEnabled();
    await user.click(copy);

    const first = onChange.mock.lastCall?.[0] as AdminProductFaq;
    expect(first.mode).toBe("CUSTOM");
    expect(first.version).toBe(faq.version);
    expect(first.items[0]).toEqual(faq.items[0]);
    expect(first.items).toHaveLength(2);
    const firstCopy = first.items[1]!;
    expect(firstCopy.title).toBe(sharedEnabled.title);
    expect(Object.keys(firstCopy).sort()).toEqual(
      ["answer", "defaultOpen", "enabled", "id", "position", "title"].sort(),
    );
    expect(firstCopy).not.toHaveProperty("audience");
    expect(firstCopy).not.toHaveProperty("category");

    await user.click(
      screen.getByRole("button", {
        name: "Copy applicable shared questions",
      }),
    );
    const second = onChange.mock.lastCall?.[0] as AdminProductFaq;
    expect(second.items).toHaveLength(3);
    expect(second.items[0]).toEqual(faq.items[0]);
    expect(second.items[1]?.id).toBe(firstCopy.id);
    expect(second.items[2]?.id).not.toBe(firstCopy.id);
    expect(second.items.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(faqApi.getSharedPreview).toHaveBeenCalledTimes(1);
  });

  it.each(["SHARED", "EXTEND"] as const)(
    "does not offer shared copying in %s mode",
    async (mode) => {
      render(
        <AdminI18nProvider>
          <ProductFaqPanel
            value={{ ...faq, mode }}
            onChange={vi.fn()}
            savedValue={{ ...faq, mode }}
            productId="product-1"
          />
        </AdminI18nProvider>,
      );

      await within(
        screen.getByRole("region", { name: "Applied shared questions" }),
      ).findByText("How does delivery work?");
      expect(
        screen.queryByRole("button", {
          name: "Copy applicable shared questions",
        }),
      ).not.toBeInTheDocument();
    },
  );

  it("lists the enabled shared questions the product will render", async () => {
    render(
      <AdminI18nProvider>
        <ProductFaqPanel
          value={{ ...faq, mode: "EXTEND" }}
          onChange={vi.fn()}
          savedValue={{ ...faq, mode: "EXTEND" }}
          productId="product-1"
        />
      </AdminI18nProvider>,
    );

    const applied = within(
      screen.getByRole("region", { name: "Applied shared questions" }),
    );
    expect(await applied.findByText("How does delivery work?")).toBeInTheDocument();
    expect(applied.queryByText("Hidden shared question?")).not.toBeInTheDocument();
  });

  it("keeps targeted shared questions for other products out of the applied preview", async () => {
    vi.mocked(faqApi.getSharedPreview).mockResolvedValue({
      items: [
        sharedEnabled,
        {
          ...sharedEnabled,
          id: "77777777-7777-4777-8777-777777777777",
          title: "Only for delivery carts?",
          audience: {
            scope: "PRODUCTS",
            productIds: [
              "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            ],
          },
        },
      ],
    });

    render(
      <AdminI18nProvider>
        <ProductFaqPanel
          value={{ ...faq, mode: "EXTEND" }}
          onChange={vi.fn()}
          savedValue={{ ...faq, mode: "EXTEND" }}
          productId="product-1"
        />
      </AdminI18nProvider>,
    );

    const applied = within(
      screen.getByRole("region", { name: "Applied shared questions" }),
    );
    expect(await applied.findByText("How does delivery work?")).toBeInTheDocument();
    expect(applied.queryByText("Only for delivery carts?")).not.toBeInTheDocument();
  });

  it("shows a targeted shared question once it includes this product", async () => {
    vi.mocked(faqApi.getSharedPreview).mockResolvedValue({
      items: [
        {
          ...sharedEnabled,
          id: "77777777-7777-4777-8777-777777777777",
          title: "Cart-specific assembly note?",
          audience: {
            scope: "PRODUCTS",
            productIds: [
              "product-1",
              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            ],
          },
        },
      ],
    });

    render(
      <AdminI18nProvider>
        <ProductFaqPanel
          value={{ ...faq, mode: "EXTEND" }}
          onChange={vi.fn()}
          savedValue={{ ...faq, mode: "EXTEND" }}
          productId="product-1"
        />
      </AdminI18nProvider>,
    );

    const applied = within(
      screen.getByRole("region", { name: "Applied shared questions" }),
    );
    expect(
      await applied.findByText("Cart-specific assembly note?"),
    ).toBeInTheDocument();
  });

  it("explains that shared questions are not shown in the product-only mode", async () => {
    render(
      <AdminI18nProvider>
        <ProductFaqPanel value={faq} onChange={vi.fn()} savedValue={faq} productId="product-1" />
      </AdminI18nProvider>,
    );

    expect(
      await screen.findByText(
        "This product uses “Product questions only”, so shared questions are not shown.",
      ),
    ).toBeInTheDocument();
  });

  it("opens FAQ Management directly when the FAQ has no unsaved changes", async () => {
    const user = userEvent.setup();
    render(
      <AdminI18nProvider>
        <ProductFaqPanel value={faq} onChange={vi.fn()} savedValue={faq} productId="product-1" />
      </AdminI18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open in FAQ Management" }));
    expect(routerPush).toHaveBeenCalledWith("/admin/faq?view=product&product=product-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("warns that the management page shows the saved version before leaving with unsaved FAQ changes", async () => {
    const user = userEvent.setup();
    render(
      <AdminI18nProvider>
        <ProductFaqPanel
          value={{ ...faq, items: [{ ...faq.items[0]!, title: "Edited but unsaved?" }] }}
          onChange={vi.fn()}
          savedValue={faq}
          productId="product-1"
        />
      </AdminI18nProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open in FAQ Management" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Unsaved FAQ changes" }));
    expect(dialog.getByText(/shows the saved version/)).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Stay here" }));
    expect(routerPush).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open in FAQ Management" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Unsaved FAQ changes" })).getByRole(
        "button",
        { name: "Continue" },
      ),
    );
    expect(routerPush).toHaveBeenCalledWith("/admin/faq?view=product&product=product-1");
  });
});
