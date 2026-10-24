import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Field,
  Select,
  TextInput,
  Textarea,
  inputCls,
  inputClsCompact,
} from "@/components/admin/Field";

describe("admin form density", () => {
  it("renders the compact control class for admin inputs", () => {
    render(
      <div>
        <TextInput aria-label="name" />
        <Select aria-label="kind">
          <option value="a">A</option>
        </Select>
        <Textarea aria-label="notes" />
      </div>,
    );

    for (const label of ["name", "kind", "notes"]) {
      const control = screen.getByLabelText(label);
      expect(control).toHaveClass("py-2", "text-sm");
      expect(control).not.toHaveClass("py-2.5", "text-base");
    }
  });

  it("keeps the compact and storefront control classes separate", () => {
    expect(inputClsCompact).toContain("py-2");
    expect(inputClsCompact).toContain("text-sm");
    expect(inputCls).toContain("py-2.5");
    expect(inputCls).toContain("text-base");
  });
});

describe("Field hints", () => {
  it("moves the hint behind a question mark by default", () => {
    render(
      <Field label="Slug" hint="Used in the product URL.">
        <input aria-label="slug" />
      </Field>,
    );

    expect(
      screen.getByRole("button", { name: "More info" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Used in the product URL.",
    );
  });

  it("keeps inline hints visible for format-critical guidance", () => {
    render(
      <Field label="Price" hint="Two decimals." hintDisplay="inline">
        <input aria-label="price" />
      </Field>,
    );

    expect(
      screen.queryByRole("button", { name: "More info" }),
    ).not.toBeInTheDocument();
    const hint = screen.getByText("Two decimals.");
    expect(hint.tagName).toBe("P");
    expect(hint).toHaveClass("text-xs");
  });
});
