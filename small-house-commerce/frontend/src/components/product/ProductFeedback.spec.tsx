import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api, type Product } from "@/lib/api";
import { ProductFeedback } from "./ProductFeedback";

const product: Product = {
  id: "product-1",
  name: "Compact Desk",
  slug: "compact-desk",
  description: null,
  tagline: null,
  categoryId: "category-1",
  ratingAverage: 4.5,
  reviewCount: 1,
  reviews: [
    {
      id: "review-1",
      authorName: "Mika",
      location: "Quezon City",
      rating: 5,
      title: "Fits my room",
      comment: "The desk is sturdy and compact.",
      photos: [],
      createdAt: "2026-10-01T00:00:00.000Z",
      variant: "Walnut",
      helpfulCount: 0,
      verifiedPurchase: true,
    },
  ],
  room: null,
  internalRole: null,
  solutions: [],
  width: null,
  height: null,
  depth: null,
  foldedWidth: null,
  foldedHeight: null,
  foldedDepth: null,
  catalogGraphVersion: 1,
  options: [],
  defaultDisplayVariantId: null,
  effectiveCoverMedia: null,
  images: [],
  variants: [],
  effectiveFaq: [
    {
      id: "faq-delivery",
      title: "How long does delivery take?",
      answer: [{ kind: "paragraph", text: "Delivery takes three business days." }],
      enabled: true,
      position: 1,
      defaultOpen: true,
    },
    {
      id: "faq-assembly",
      title: "Does it need assembly?",
      answer: [
        {
          kind: "bullets",
          items: ["Attach the legs", "Use the included Allen key"],
        },
      ],
      enabled: true,
      position: 0,
      defaultOpen: true,
    },
    {
      id: "faq-hidden",
      title: "Internal answer",
      answer: [{ kind: "paragraph", text: "Do not publish." }],
      enabled: false,
      position: 2,
      defaultOpen: false,
    },
  ],
};

function renderFeedback() {
  return render(
    <ProductFeedback
      product={product}
      supportEmail="help@luwag.ph"
      supportHours="Daily, 9am–6pm"
    />,
  );
}

describe("ProductFeedback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens on Reviews and exposes Reviews and Q&A as one tab set", () => {
    renderFeedback();

    const tabs = screen.getByRole("tablist", { name: "Product feedback" });
    expect(within(tabs).getByRole("tab", { name: "Reviews (1)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(tabs).getByRole("tab", { name: "Q&A (2)" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByText("Fits my room")).toBeInTheDocument();
    expect(screen.queryByText("Does it need assembly?")).not.toBeInTheDocument();
  });

  it("shows only enabled questions with answers folded by default", async () => {
    const user = userEvent.setup();
    renderFeedback();

    await user.click(screen.getByRole("tab", { name: "Q&A (2)" }));

    const assembly = screen.getByText("Does it need assembly?").closest("details");
    const delivery = screen.getByText("How long does delivery take?").closest("details");
    expect(assembly).not.toHaveAttribute("open");
    expect(delivery).not.toHaveAttribute("open");
    expect(screen.queryByText("Internal answer")).not.toBeInTheDocument();

    await user.click(screen.getByText("Does it need assembly?"));
    expect(assembly).toHaveAttribute("open");
    expect(screen.getByText("Attach the legs")).toBeInTheDocument();
  });

  it("searches question and answer text without case sensitivity", async () => {
    const user = userEvent.setup();
    renderFeedback();
    await user.click(screen.getByRole("tab", { name: "Q&A (2)" }));

    const search = screen.getByRole("searchbox", { name: "Search questions" });
    await user.type(search, "ALLEN KEY");
    expect(screen.getByText("Does it need assembly?")).toBeInTheDocument();
    expect(screen.queryByText("How long does delivery take?")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "business days");
    expect(screen.getByText("How long does delivery take?")).toBeInTheDocument();
    expect(screen.queryByText("Does it need assembly?")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "missing phrase");
    expect(screen.getByText("No questions match your search.")).toBeInTheDocument();
  });

  it("submits a trimmed private question with optional contact fields", async () => {
    const user = userEvent.setup();
    const submit = vi.spyOn(api, "askProductQuestion").mockResolvedValue({ ok: true });
    renderFeedback();
    await user.click(screen.getByRole("tab", { name: "Q&A (2)" }));
    await user.click(screen.getByRole("button", { name: "Ask a question" }));

    await user.type(screen.getByLabelText("Your question"), "  Does this fit a 90 cm wall?  ");
    await user.type(screen.getByLabelText("Name (optional)"), "  Ana  ");
    await user.type(
      screen.getByLabelText("Email (optional, never shown)"),
      "  ana@example.com  ",
    );
    await user.click(screen.getByRole("button", { name: "Submit question" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("compact-desk", {
        question: "Does this fit a 90 cm wall?",
        name: "Ana",
        email: "ana@example.com",
      }),
    );
    expect(
      screen.getByText("Thanks! Your question is with us — we'll answer it after review."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Does this fit a 90 cm wall?")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Q&A (2)" })).toBeInTheDocument();
  });

  it("keeps invalid or failed submissions in the form and never publishes them", async () => {
    const user = userEvent.setup();
    const submit = vi
      .spyOn(api, "askProductQuestion")
      .mockRejectedValue(new Error("network"));
    renderFeedback();
    await user.click(screen.getByRole("tab", { name: "Q&A (2)" }));
    await user.click(screen.getByRole("button", { name: "Ask a question" }));

    const question = screen.getByLabelText("Your question");
    await user.type(question, "Four");
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 5 characters");
    expect(submit).not.toHaveBeenCalled();

    await user.clear(question);
    await user.type(question, "Will this fit beside my bed?");
    await user.click(screen.getByRole("button", { name: "Submit question" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "couldn't send your question",
    );
    expect(question).toHaveValue("Will this fit beside my bed?");
    expect(screen.getByRole("tab", { name: "Q&A (2)" })).toBeInTheDocument();
  });
});
