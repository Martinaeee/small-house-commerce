import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchableSelect } from "./SearchableSelect";

describe("SearchableSelect optionLabel", () => {
  it("labels options through optionLabel while committing the raw value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchableSelect
        id="postal"
        testId="postal"
        value=""
        options={["1422", "1400"]}
        onChange={onChange}
        placeholder="Pick a postal code"
        searchPlaceholder="Search a ZIP code"
        ariaLabel="Pick a postal code"
        optionLabel={(zip) => `${zip} — Area ${zip}`}
      />,
    );
    await user.click(screen.getByTestId("postal"));
    await user.click(screen.getByRole("option", { name: "1422 — Area 1422" }));
    expect(onChange).toHaveBeenCalledWith("1422");
  });

  it("filters on the label text", async () => {
    const user = userEvent.setup();
    render(
      <SearchableSelect
        id="postal"
        testId="postal"
        value=""
        options={["1422", "1400"]}
        onChange={vi.fn()}
        placeholder="p"
        searchPlaceholder="s"
        ariaLabel="a"
        optionLabel={(zip) =>
          zip === "1422" ? "1422 — Novaliches" : "1400 — Tondo"
        }
      />,
    );
    await user.type(screen.getByTestId("postal"), "Novaliches");
    expect(screen.getByRole("option", { name: "1422 — Novaliches" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "1400 — Tondo" })).toBeNull();
  });

  it("keeps identity labelling when optionLabel is omitted", async () => {
    const user = userEvent.setup();
    render(
      <SearchableSelect
        id="p"
        testId="p"
        value="Manila"
        options={["Manila", "Cebu"]}
        onChange={vi.fn()}
        placeholder="p"
        searchPlaceholder="s"
        ariaLabel="a"
      />,
    );
    await user.click(screen.getByTestId("p"));
    expect(screen.getByRole("option", { name: "Manila" })).toBeInTheDocument();
  });
});
