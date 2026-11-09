import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import { DEFAULT_COLUMN_ORDER, type WorkbenchColumnKey } from "./columns";
import { ColumnOrderList } from "./ColumnOrderList";

/**
 * The column panel shows every column in the saved order (hidden ones keep
 * their slot), offers a drag handle per row, and still toggles visibility.
 */

beforeEach(() => {
  cleanup();
  setAdminLang("zh");
});

function renderList(
  overrides: {
    order?: WorkbenchColumnKey[];
    hidden?: WorkbenchColumnKey[];
    onToggle?: (key: WorkbenchColumnKey) => void;
    onMove?: (from: number, to: number) => void;
  } = {},
) {
  const order = overrides.order ?? DEFAULT_COLUMN_ORDER;
  return render(
    <AdminI18nProvider>
      <ColumnOrderList
        order={order}
        hidden={overrides.hidden ?? []}
        onToggle={overrides.onToggle ?? vi.fn()}
        onMove={overrides.onMove ?? vi.fn()}
      />
    </AdminI18nProvider>,
  );
}

describe("ColumnOrderList", () => {
  it("lists the columns in the order it was given", () => {
    const order: WorkbenchColumnKey[] = [
      "total",
      "no",
      ...DEFAULT_COLUMN_ORDER.filter((key) => key !== "total" && key !== "no"),
    ];
    renderList({ order });
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("data-column-row", "total");
    expect(rows[1]).toHaveAttribute("data-column-row", "no");
    expect(rows).toHaveLength(DEFAULT_COLUMN_ORDER.length);
  });

  it("gives every row a drag handle so the order can be changed", () => {
    renderList();
    expect(screen.getAllByTestId(/column-drag-/)).toHaveLength(
      DEFAULT_COLUMN_ORDER.length,
    );
  });

  it("keeps a hidden column in the list, unchecked, at its slot", () => {
    renderList({ hidden: ["phone"] });
    const row = screen.getByTestId("column-drag-phone").closest("li")!;
    const checkbox = within(row).getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    const rows = screen.getAllByRole("listitem");
    expect(rows[DEFAULT_COLUMN_ORDER.indexOf("phone")]).toHaveAttribute(
      "data-column-row",
      "phone",
    );
  });

  it("reports the visibility toggle for the column that was clicked", async () => {
    const onToggle = vi.fn();
    renderList({ onToggle });
    const row = screen.getByTestId("column-drag-total").closest("li")!;
    await userEvent.click(within(row).getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith("total");
  });
});
