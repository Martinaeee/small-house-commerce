import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DecimalInput } from "@/components/admin/DecimalInput";

it("drops stale raw text when an external value returns to an earlier number", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  const view = render(
    <DecimalInput
      aria-label="Decimal"
      value={10}
      onValueChange={onValueChange}
    />,
  );

  await user.type(screen.getByLabelText("Decimal"), "5");
  expect(screen.getByLabelText("Decimal")).toHaveValue("105");
  view.rerender(
    <DecimalInput
      aria-label="Decimal"
      value={105}
      onValueChange={onValueChange}
    />,
  );
  view.rerender(
    <DecimalInput
      aria-label="Decimal"
      value={10}
      onValueChange={onValueChange}
    />,
  );

  expect(screen.getByLabelText("Decimal")).toHaveValue("10");
});
