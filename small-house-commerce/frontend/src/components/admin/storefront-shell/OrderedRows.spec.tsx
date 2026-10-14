import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderedRows, type RowControls } from "./OrderedRows";

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

type Item = { id: string; label: string; enabled: boolean };

const INITIAL: Item[] = [
  { id: "row-a", label: "Alpha", enabled: true },
  { id: "row-b", label: "Beta", enabled: true },
  { id: "row-c", label: "Gamma", enabled: false },
];

const ROW_HEIGHT = 48;

function rect(top: number): DOMRect {
  return {
    top,
    bottom: top + ROW_HEIGHT,
    left: 0,
    right: 240,
    width: 240,
    height: ROW_HEIGHT,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockGeometry(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      const row = this.closest("[data-ordered-row]");
      if (!row?.parentElement) return rect(0);
      const index = Array.from(row.parentElement.children).indexOf(row);
      return rect(index * ROW_HEIGHT);
    },
  );
}

function Harness({
  initial = INITIAL,
  maxItems = 6,
  disabled = false,
}: {
  initial?: readonly Item[];
  maxItems?: number;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<Item[]>(() => [...initial]);

  const renderItem = (item: Item, _index: number, controls: RowControls) => (
    <div className="flex gap-1">
      <button
        type="button"
        {...controls.dragHandleProps}
        aria-label={`Drag ${item.label}`}
      >
        Drag
      </button>
      <input
        aria-label={`Label ${item.id}`}
        value={item.label}
        onChange={(event) =>
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? { ...entry, label: event.target.value }
                : entry,
            ),
          )
        }
      />
      <button
        type="button"
        disabled={controls.disabled || !controls.canMoveUp}
        onClick={controls.moveUp}
      >
        Move {item.label} up
      </button>
      <button
        type="button"
        disabled={controls.disabled || !controls.canMoveDown}
        onClick={controls.moveDown}
      >
        Move {item.label} down
      </button>
      <button
        type="button"
        disabled={controls.disabled}
        onClick={() =>
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? { ...entry, enabled: !entry.enabled }
                : entry,
            ),
          )
        }
      >
        {item.enabled ? `Hide ${item.label}` : `Enable ${item.label}`}
      </button>
      <button
        type="button"
        disabled={controls.disabled}
        onClick={controls.remove}
      >
        Delete {item.label}
      </button>
    </div>
  );

  return (
    <>
      <OrderedRows
        items={items}
        maxItems={maxItems}
        disabled={disabled}
        labelFor={(item) => item.label}
        onChange={setItems}
        renderItem={renderItem}
      />
      <output data-testid="order">{items.map((item) => item.id).join(",")}</output>
      <output data-testid="state">{JSON.stringify(items)}</output>
    </>
  );
}

async function keyboardDrag(handle: HTMLElement, key: "ArrowDown" | "ArrowUp") {
  fireEvent.keyDown(handle, { code: "Space", key: " " });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.keyDown(document, { code: key, key });
  fireEvent.keyDown(document, { code: "Space", key: " " });
  await act(async () => {});
}

describe("OrderedRows", () => {
  beforeEach(() => mockGeometry());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reorders through pointer drag without changing stable row ids", async () => {
    const view = render(<Harness />);
    const handle = screen.getByRole("button", { name: "Drag Alpha" });

    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      buttons: 1,
      clientX: 12,
      clientY: 12,
      isPrimary: true,
    });
    // dnd-kit activates the drag on the first move past the distance
    // constraint and only measures collisions on the moves after it, so the
    // gesture needs a nudge before travelling to the target row.
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      buttons: 1,
      clientX: 12,
      clientY: 30,
      isPrimary: true,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      buttons: 1,
      clientX: 12,
      clientY: 72,
      isPrimary: true,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 1,
      button: 0,
      clientX: 12,
      clientY: 72,
      isPrimary: true,
    });
    await act(async () => {});

    expect(screen.getByTestId("order")).toHaveTextContent(
      "row-b,row-a,row-c",
    );
    expect(JSON.parse(screen.getByTestId("state").textContent!)).toEqual([
      expect.objectContaining({ id: "row-b" }),
      expect.objectContaining({ id: "row-a" }),
      expect.objectContaining({ id: "row-c" }),
    ]);
    // The pointer sensor keeps a capture-phase document click interceptor
    // until its `detach()` runs; dnd-kit defers that removal by 50 ms, so the
    // gesture must be allowed to settle or the interceptor swallows the next
    // test's clicks.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    view.unmount();
  });

  it("supports dnd-kit keyboard ordering", async () => {
    render(<Harness />);

    await keyboardDrag(
      screen.getByRole("button", { name: "Drag Alpha" }),
      "ArrowDown",
    );

    expect(screen.getByTestId("order")).toHaveTextContent(
      "row-b,row-a,row-c",
    );
  });

  it("moves, announces, retains focus, toggles and deletes without mutating the controlled input", () => {
    const frozen = INITIAL.map((item) => Object.freeze({ ...item }));
    Object.freeze(frozen);
    render(<Harness initial={frozen} />);

    const move = screen.getByRole("button", { name: "Move Beta up" });
    move.focus();
    fireEvent.click(move);

    expect(screen.getByTestId("order")).toHaveTextContent(
      "row-b,row-a,row-c",
    );
    expect(document.activeElement).toBe(move);
    expect(screen.getByTestId("ordered-rows-announcement")).toHaveTextContent(
      "storefront_shell_order_position",
    );
    expect(frozen.map((item) => item.id)).toEqual([
      "row-a",
      "row-b",
      "row-c",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Enable Gamma" }));
    expect(screen.getByRole("button", { name: "Hide Gamma" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    expect(screen.getByTestId("order")).toHaveTextContent("row-b,row-c");
  });

  it("enforces a configurable absolute bound and locks every destructive control when disabled", () => {
    const { rerender } = render(<Harness maxItems={2} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "storefront_shell_order_too_many",
    );
    expect(
      screen.getByRole("button", { name: "Move Alpha down" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Delete Alpha" }),
    ).toBeEnabled();

    rerender(<Harness disabled />);
    const first = screen.getByRole("listitem", { name: "Alpha" });
    for (const button of within(first).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
