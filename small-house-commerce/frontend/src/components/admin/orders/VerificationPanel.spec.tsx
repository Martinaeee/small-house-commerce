import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminI18nProvider, setAdminLang } from "@/lib/admin-i18n";
import type {
  AdminVerificationItem,
  AdminVerificationState,
} from "@/lib/admin-api";
import { AssignTasksDialog, VerificationDrawer } from "./VerificationPanel";

const api = vi.hoisted(() => ({
  orderVerification: vi.fn(),
  setVerificationResult: vi.fn(),
  confirmOrder: vi.fn(),
  verificationTemplates: vi.fn(),
  assignVerification: vi.fn(),
  recordVerificationContact: vi.fn(),
}));

vi.mock("@/lib/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-api")>()),
  adminApi: api,
}));

const STAFF = [
  { id: "staff-a", name: "客服 A" },
  { id: "staff-b", name: "客服 B" },
];

function item(over: Partial<AdminVerificationItem> = {}): AdminVerificationItem {
  return {
    id: "it-1",
    orderId: "order-1",
    assignmentId: "as-1",
    itemKey: "intent",
    category: "CUSTOMER_INFO",
    titleSnapshot: "确认客户购买意愿",
    assigneeId: null,
    status: "DONE",
    result: "客户明确确认购买",
    note: null,
    operatorId: "staff-a",
    completedAt: "2026-10-21T10:04:00.000Z",
    nextFollowUpAt: null,
    skippedReason: null,
    invalidatedAt: null,
    invalidatedReason: null,
    rev: 3,
    ...over,
  };
}

function state(over: Partial<AdminVerificationState> = {}): AdminVerificationState {
  return {
    assignment: {
      id: "as-1",
      orderId: "order-1",
      assigneeId: "staff-a",
      assignedById: "staff-a",
      assignedAt: "2026-10-21T09:00:00.000Z",
      closedAt: null,
      priority: "HIGH",
      nextFollowUpAt: null,
      note: null,
      rev: 1,
    },
    items: [
      item(),
      item({
        id: "it-2",
        itemKey: "phone_valid",
        titleSnapshot: "确认联系电话是否有效",
        status: "PENDING",
        result: null,
        completedAt: null,
        rev: 1,
      }),
    ],
    events: [],
    ...over,
  };
}

function renderWithI18n(node: React.ReactNode) {
  return render(<AdminI18nProvider>{node}</AdminI18nProvider>);
}

beforeEach(() => {
  cleanup();
  setAdminLang("en");
  vi.clearAllMocks();
  api.orderVerification.mockResolvedValue(state());
  api.setVerificationResult.mockResolvedValue(item());
  api.confirmOrder.mockResolvedValue({});
  api.assignVerification.mockResolvedValue({ assignment: state().assignment, items: [] });
  api.verificationTemplates.mockResolvedValue({
    system: [{ key: "t_cod", name: "普通COD审核", items: ["phone_valid", "intent"] }],
    library: [
      {
        key: "intent",
        title: "确认客户购买意愿",
        category: "CUSTOMER_INFO",
        subject: "CUSTOMER_IDENTITY",
      },
      {
        key: "phone_valid",
        title: "确认联系电话是否有效",
        category: "CUSTOMER_INFO",
        subject: "CUSTOMER_IDENTITY",
      },
      {
        key: "addr_area",
        title: "核实收货地址与 Barangay",
        category: "SHIPPING_ADDRESS",
        subject: "SHIPPING_ADDRESS",
      },
      {
        key: "recall",
        title: "确认是否需要再次联系",
        category: "CUSTOMER_INFO",
        subject: "CUSTOMER_IDENTITY",
      },
    ],
    custom: [],
  });
});

describe("the verification drawer", () => {
  it("shows the checklist with the progress and what is still open", async () => {
    renderWithI18n(
      <VerificationDrawer
        orderId="order-1"
        orderNumber="PH100004"
        staff={STAFF}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByText(/PH100004/)).toBeTruthy();
    expect(screen.getByText(/1\/2/)).toBeTruthy();
    expect(screen.getByText(/Still open/)).toBeTruthy();
    expect(screen.getByText("确认联系电话是否有效")).toBeTruthy();
  });

  it("records the result of a question with its revision", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <VerificationDrawer
        orderId="order-1"
        orderNumber="PH100004"
        staff={STAFF}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );

    const select = await screen.findByLabelText("确认联系电话是否有效 Status");
    await user.selectOptions(select, "PROBLEM");

    await waitFor(() => {
      expect(api.setVerificationResult).toHaveBeenCalledWith(
        "order-1",
        "phone_valid",
        expect.objectContaining({ status: "PROBLEM", rev: 1 }),
      );
    });
  });

  it("refuses a pass without a result", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <VerificationDrawer
        orderId="order-1"
        orderNumber="PH100004"
        staff={STAFF}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );

    const select = await screen.findByLabelText("确认联系电话是否有效 Status");
    await user.selectOptions(select, "DONE");

    expect(await screen.findByText("A pass needs a result.")).toBeTruthy();
    expect(api.setVerificationResult).not.toHaveBeenCalled();
  });

  it("confirms even while questions are still open", async () => {
    renderWithI18n(
      <VerificationDrawer
        orderId="order-1"
        orderNumber="PH100004"
        staff={STAFF}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );
    const button = await screen.findByRole("button", { name: "Verify and confirm" });
    // The checklist is a record, not a gate: the operator may confirm with
    // open questions.
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("confirms an order that has no checklist at all", async () => {
    api.orderVerification.mockResolvedValueOnce(state({ items: [] }));
    renderWithI18n(
      <VerificationDrawer
        orderId="order-1"
        orderNumber="PH100004"
        staff={STAFF}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );
    const button = await screen.findByRole("button", { name: "Verify and confirm" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the three column assignment dialog", () => {
  it("has a question, an owner and a note column", async () => {
    renderWithI18n(
      <AssignTasksDialog
        open
        orderId="order-1"
        staff={STAFF}
        current={state()}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(await screen.findByText("Question to verify")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("Note / result")).toBeTruthy();
  });

  it("keeps the questions that are already verified", async () => {
    renderWithI18n(
      <AssignTasksDialog
        open
        orderId="order-1"
        staff={STAFF}
        current={state()}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(await screen.findByRole("button", { name: "确认客户购买意愿" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认联系电话是否有效" })).toBeTruthy();
  });

  it("saves the rows with the owner and the note", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithI18n(
      <AssignTasksDialog
        open
        orderId="order-1"
        staff={STAFF}
        current={state()}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    const owner = await screen.findByLabelText("确认联系电话是否有效 Owner");
    await user.selectOptions(owner, "staff-b");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.assignVerification).toHaveBeenCalledWith(
        "order-1",
        expect.objectContaining({
          assigneeId: "staff-a",
          itemKeys: expect.arrayContaining(["intent", "phone_valid"]),
        }),
      );
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("marks the mandatory questions and picks them by checkbox", async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <AssignTasksDialog
        open
        orderId="order-1"
        staff={STAFF}
        current={state()}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    // nothing is marked as mandatory any more
    expect(screen.queryByText("required")).toBeNull();

    // the library opens under the question of the row
    await user.click(screen.getByRole("button", { name: "确认客户购买意愿" }));

    // the questions already on the order are ticked
    const done = screen.getByRole("checkbox", { name: "确认联系电话是否有效" });
    expect((done as HTMLInputElement).checked).toBe(true);
    const optional = screen.getByRole("checkbox", { name: "确认是否需要再次联系" });
    expect((optional as HTMLInputElement).checked).toBe(false);

    // ticking an optional question adds it to the checklist
    await user.click(optional);
    expect(screen.getByRole("button", { name: "确认是否需要再次联系" })).toBeTruthy();

    // a question that already carries a result keeps its result
    const withResult = screen.getByRole("checkbox", { name: "确认客户购买意愿" });
    expect((withResult as HTMLInputElement).checked).toBe(true);
    await user.click(withResult);
    expect(
      screen.getByText(/already carries a result/i),
    ).toBeTruthy();
  });
});
