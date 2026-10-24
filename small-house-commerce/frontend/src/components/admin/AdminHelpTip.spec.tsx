import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AdminHelpTip } from "./AdminHelpTip";

describe("AdminHelpTip", () => {
  it("keeps the explanation in the DOM and toggles it from the question mark", async () => {
    const user = userEvent.setup();
    render(<AdminHelpTip text="Long explanation that used to sit under the field." />);

    const button = screen.getByRole("button", { name: "More info" });
    const tip = screen.getByRole("tooltip");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(tip).toHaveTextContent("Long explanation that used to sit under the field.");
    expect(tip).toHaveClass("sr-only");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(tip).not.toHaveClass("sr-only");

    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on hover and focus, then closes when the pointer leaves", async () => {
    const user = userEvent.setup();
    render(<AdminHelpTip text="Hover hint" />);
    const button = screen.getByRole("button", { name: "More info" });

    await user.hover(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.unhover(button);
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.focus(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("accepts a custom accessible label", () => {
    render(<AdminHelpTip text="Scoped hint" label="About detail media" />);
    expect(
      screen.getByRole("button", { name: "About detail media" }),
    ).toBeInTheDocument();
  });
});
