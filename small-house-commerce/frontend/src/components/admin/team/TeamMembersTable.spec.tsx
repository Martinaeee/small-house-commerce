import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamMembersTable } from "./TeamMembersTable";

const apiMock = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  listAdminRoles: vi.fn(),
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  changeAdminPassword: vi.fn(),
}));

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (key === "team_member_disabled") return `成员 ${vars?.name} 已停用。`;
      if (key === "team_member_enabled") return `成员 ${vars?.name} 已恢复。`;
      return key;
    },
  }),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));

const authState = vi.hoisted(() => ({ id: "admin-1" }));
vi.mock("@/components/admin/AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    status: "authed",
    admin: { id: authState.id, name: "Owner", email: "owner@example.com", roles: [] },
    hasPermission: () => true,
    logout: vi.fn(),
  }),
}));

const roles = [
  {
    code: "SUPER_ADMIN" as const,
    name: "Super Admin",
    description: "Full access.",
    permissionCodes: ["SYSTEM_SETTINGS_EDIT", "ORDER_VIEW_ALL"],
  },
  {
    code: "WAREHOUSE" as const,
    name: "Warehouse",
    description: "Fulfillment.",
    permissionCodes: ["ORDER_VIEW_ALL"],
  },
];

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: "member-1",
    name: "Casey Support",
    email: "casey@example.com",
    status: "ACTIVE" as const,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    roles: [{ role: { code: "WAREHOUSE" as const, name: "Warehouse" } }],
    ...overrides,
  };
}

beforeEach(() => {
  authState.id = "admin-1";
  apiMock.listAdminUsers.mockReset().mockResolvedValue([
    member(),
    member({
      id: "admin-1",
      name: "Owner",
      email: "owner@example.com",
      roles: [{ role: { code: "SUPER_ADMIN", name: "Super Admin" } }],
    }),
    member({
      id: "member-3",
      name: "Disabled Person",
      email: "off@example.com",
      status: "DISABLED",
    }),
  ]);
  apiMock.listAdminRoles.mockReset().mockResolvedValue(roles);
  apiMock.updateAdminUser.mockReset().mockResolvedValue(member());
  apiMock.createAdminUser.mockReset();
  apiMock.changeAdminPassword.mockReset();
});

describe("TeamMembersTable", () => {
  it("lists the members with their roles", async () => {
    render(<TeamMembersTable />);

    expect(await screen.findByText("casey@example.com")).toBeInTheDocument();
    const row = screen.getByText("casey@example.com").closest("tr")!;
    expect(within(row).getByText("Warehouse")).toBeInTheDocument();
  });

  it("filters by status", async () => {
    render(<TeamMembersTable />);
    await screen.findByText("off@example.com");

    await userEvent.selectOptions(
      screen.getByLabelText("team_status_filter"),
      "DISABLED",
    );

    await waitFor(() => {
      expect(screen.queryByText("casey@example.com")).toBeNull();
    });
    expect(screen.getByText("off@example.com")).toBeInTheDocument();
  });

  it("searches by name", async () => {
    render(<TeamMembersTable />);
    await screen.findByText("casey@example.com");

    await userEvent.type(screen.getByLabelText("team_search"), "Casey");

    await waitFor(() => {
      expect(screen.queryByText("off@example.com")).toBeNull();
    });
    expect(screen.getByText("casey@example.com")).toBeInTheDocument();
  });

  it("marks the signed-in administrator and refuses to disable it", async () => {
    render(<TeamMembersTable />);
    await screen.findByText("owner@example.com");

    const row = screen.getByText("owner@example.com").closest("tr")!;
    expect(within(row).getByText("team_self_badge")).toBeInTheDocument();
    expect(within(row).getByText("team_action_self_locked")).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: "team_action_disable" }),
    ).toBeNull();
  });

  it("disables another member through the API", async () => {
    render(<TeamMembersTable />);
    await screen.findByText("casey@example.com");

    const row = screen.getByText("casey@example.com").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "team_action_disable" }));

    await waitFor(() => {
      expect(apiMock.updateAdminUser).toHaveBeenCalledWith("member-1", {
        status: "DISABLED",
      });
    });
  });

  it("opens the create dialog", async () => {
    render(<TeamMembersTable />);
    await screen.findByText("casey@example.com");

    await userEvent.click(screen.getByRole("button", { name: "team_add_member" }));

    expect(
      await screen.findByRole("dialog", { name: "team_member_dialog_create_title" }),
    ).toBeInTheDocument();
  });
});
