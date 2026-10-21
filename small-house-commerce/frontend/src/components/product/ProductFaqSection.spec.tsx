import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProductFaqSection } from "./ProductFaqSection";
import type { ProductFaqItem } from "@/lib/api";

const TWO_ITEMS: ProductFaqItem[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "How does COD work?",
    answer: [{ kind: "paragraph", text: "Pay the rider when your order arrives." }],
    enabled: true,
    position: 0,
    defaultOpen: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Returns",
    answer: [
      {
        kind: "bullets",
        items: ["Contact us within 48 hours.", "Include photos of the packaging."],
      },
    ],
    enabled: true,
    position: 1,
    defaultOpen: false,
  },
];

describe("ProductFaqSection", () => {
  it("renders items in order and keeps the shipping-faq anchor", () => {
    const { container } = render(<ProductFaqSection items={TWO_ITEMS} />);

    expect(container.querySelector("#shipping-faq")).not.toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Delivery, Returns & FAQs" }))
        .getAllByRole("group")
        .map((group) => group.textContent?.[0]),
    ).toEqual(["H", "R"]);
  });

  it("opens only the items marked defaultOpen", () => {
    render(<ProductFaqSection items={TWO_ITEMS} />);

    expect(screen.getByText("How does COD work?").closest("details")).toHaveAttribute(
      "open",
    );
    expect(screen.getByText("Returns").closest("details")).not.toHaveAttribute(
      "open",
    );
  });

  it("renders contact placeholders and safe inline links as React nodes", () => {
    render(
      <ProductFaqSection
        items={[
          {
            ...TWO_ITEMS[0],
            answer: [
              {
                kind: "paragraph",
                text: "Email {{supportEmail}} ({{supportHours}}). [Track delivery](https://example.com/track).",
              },
            ],
          },
        ]}
        supportEmail="help@luwag.ph"
        supportHours="Daily, 9am–6pm"
      />,
    );

    expect(screen.getByRole("link", { name: "help@luwag.ph" })).toHaveAttribute(
      "href",
      "mailto:help@luwag.ph",
    );
    expect(screen.getByText(/Daily, 9am–6pm/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Track delivery" })).toHaveAttribute(
      "href",
      "https://example.com/track",
    );
  });

  it("renders nothing when there is no content", () => {
    const { container } = render(<ProductFaqSection items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
