import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { adminApi, type AdminQuestion } from "@/lib/admin-api";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { FaqQuestionsSection } from "./FaqQuestionsSection";

vi.mock("@/lib/admin-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin-api")>("@/lib/admin-api");
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      listQuestions: vi.fn(),
      convertQuestion: vi.fn(),
      dismissQuestion: vi.fn(),
    },
  };
});

const question: AdminQuestion = {
  id: "11111111-1111-4111-8111-111111111111",
  productId: "22222222-2222-4222-8222-222222222222",
  question: "Will this fit beside a queen bed?",
  askerName: "Ana",
  askerEmail: "ana@example.com",
  status: "PENDING",
  createdAt: "2026-10-19T04:30:00.000Z",
  product: { name: "Compact Bedside Desk", slug: "compact-bedside-desk" },
};

function renderSection(productId: string | null = null) {
  return render(
    <AdminI18nProvider>
      <FaqQuestionsSection productId={productId} />
    </AdminI18nProvider>,
  );
}

describe("FaqQuestionsSection", () => {
  beforeEach(() => {
    setAdminLang("en");
    vi.resetAllMocks();
    vi.mocked(adminApi.listQuestions).mockResolvedValue({
      items: [question],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    vi.mocked(adminApi.convertQuestion).mockResolvedValue({ ok: true });
    vi.mocked(adminApi.dismissQuestion).mockResolvedValue({ ok: true });
  });

  it("loads only pending submissions and applies the current product filter", async () => {
    renderSection(question.productId);

    expect(await screen.findByText(question.question)).toBeInTheDocument();
    expect(adminApi.listQuestions).toHaveBeenCalledWith({
      status: "PENDING",
      pageSize: 50,
      productId: question.productId,
    });
    expect(screen.getByText(/Compact Bedside Desk/)).toHaveTextContent("Ana");
    expect(screen.getByText(/Compact Bedside Desk/)).toHaveTextContent(
      "ana@example.com",
    );
  });

  it("requires an answer before converting a submission to a product FAQ", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Answer & add to FAQ" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Answer and add to the product FAQ",
    });
    await user.click(within(dialog).getByRole("button", { name: "Save & publish" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Please write an answer.",
    );
    expect(adminApi.convertQuestion).not.toHaveBeenCalled();
  });

  it("publishes the written answer through the conversion endpoint and removes the pending row", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(
      await screen.findByRole("button", { name: "Answer & add to FAQ" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Answer and add to the product FAQ",
    });
    await user.type(within(dialog).getByLabelText("Answer"), "  Yes, it needs 82 cm.  ");
    await user.click(within(dialog).getByRole("button", { name: "Save & publish" }));

    await waitFor(() =>
      expect(adminApi.convertQuestion).toHaveBeenCalledWith(
        question.id,
        "Yes, it needs 82 cm.",
      ),
    );
    expect(screen.queryByText(question.question)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Added to this product's FAQ.",
    );
  });

  it("dismisses a pending submission without publishing it", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(adminApi.dismissQuestion).toHaveBeenCalledWith(question.id),
    );
    expect(adminApi.convertQuestion).not.toHaveBeenCalled();
    expect(screen.queryByText(question.question)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Question dismissed.");
  });

  it("keeps a failed action visible and reports a retryable error", async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.dismissQuestion).mockRejectedValue(new Error("network"));
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That didn't work. Please retry.",
    );
    expect(screen.getByText(question.question)).toBeInTheDocument();
  });
});
