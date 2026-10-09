import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
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
