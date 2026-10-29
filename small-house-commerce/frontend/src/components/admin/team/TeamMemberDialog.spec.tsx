import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamMemberDialog } from "./TeamMemberDialog";

const apiMock = vi.hoisted(() => ({
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
}));

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (key === "team_password_too_short") return `密码至少 ${vars?.min} 位。`;
      if (key === "team_permission_count") return `合计 ${vars?.count} 项权限`;
      return key;
    },
  }),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));

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
  {
    code: "FINANCE" as const,
    name: "Finance",
    description: "Read-only.",
    permissionCodes: ["REPORT_PROFIT_VIEW"],
  },
];

const onSaved = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  apiMock.createAdminUser.mockReset().mockResolvedValue({ id: "new-1" });
  apiMock.updateAdminUser.mockReset().mockResolvedValue({ id: "member-1" });
  onSaved.mockReset();
  onClose.mockReset();
});

describe("TeamMemberDialog — create", () => {
  it("asks for a name, an email and an initial password", () => {
    render(
      <TeamMemberDialog
        open
        mode="create"
        roles={roles}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByLabelText("team_name")).toBeInTheDocument();
    expect(screen.getByLabelText("team_email")).toBeInTheDocument();
    expect(screen.getByLabelText(/team_password/)).toBeInTheDocument();
  });

  it("refuses to save without a name", async () => {
    render(
      <TeamMemberDialog
        open
        mode="create"
        roles={roles}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("team_name_required");
    expect(apiMock.createAdminUser).not.toHaveBeenCalled();
  });

  it("refuses to save with a short password", async () => {
    render(
      <TeamMemberDialog
        open
        mode="create"
        roles={roles}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    await userEvent.type(screen.getByLabelText("team_name"), "Casey");
    await userEvent.type(screen.getByLabelText("team_email"), "casey@example.com");
    await userEvent.type(screen.getByLabelText(/team_password/), "short");
    await userEvent.click(screen.getByRole("checkbox", { name: /Warehouse/ }));
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("密码至少 8 位。");
    expect(apiMock.createAdminUser).not.toHaveBeenCalled();
  });

  it("creates the member with the selected roles", async () => {
    render(
      <TeamMemberDialog
        open
        mode="create"
        roles={roles}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    await userEvent.type(screen.getByLabelText("team_name"), "Casey");
    await userEvent.type(screen.getByLabelText("team_email"), "casey@example.com");
    await userEvent.type(screen.getByLabelText(/team_password/), "longenough1");
    await userEvent.click(screen.getByRole("checkbox", { name: /Warehouse/ }));
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    await waitFor(() => {
      expect(apiMock.createAdminUser).toHaveBeenCalledWith({
        name: "Casey",
        email: "casey@example.com",
        password: "longenough1",
        roleCodes: ["WAREHOUSE"],
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("fills the password with a generated one", async () => {
    render(
      <TeamMemberDialog
        open
        mode="create"
        roles={roles}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "team_generate_password" }));

    const value = (screen.getByLabelText(/team_password/) as HTMLInputElement).value;
    expect(value.length).toBeGreaterThanOrEqual(8);
  });

  it("counts the union of the selected roles", async () => {
    render(
      <TeamMemberDialog
        open
        mode="create"
        roles={roles}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByText("合计 0 项权限")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /Warehouse/ }));
    expect(screen.getByText("合计 1 项权限")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /Super Admin/ }));
    expect(screen.getByText("合计 2 项权限")).toBeInTheDocument();
  });
});

describe("TeamMemberDialog — edit", () => {
  const existing = {
    id: "member-1",
    name: "Casey",
    email: "casey@example.com",
    status: "ACTIVE" as const,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    roles: [{ role: { code: "WAREHOUSE" as const, name: "Warehouse" } }],
  };

  it("never shows the password field", () => {
    render(
      <TeamMemberDialog
        open
        mode="edit"
        member={existing}
        roles={roles}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    expect(screen.queryByLabelText("team_password")).toBeNull();
  });

  it("sends the new roles", async () => {
    render(
      <TeamMemberDialog
        open
        mode="edit"
        member={existing}
        roles={roles}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /Finance/ }));
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    await waitFor(() => {
      expect(apiMock.updateAdminUser).toHaveBeenCalledWith("member-1", {
        name: "Casey",
        email: "casey@example.com",
        roleCodes: ["WAREHOUSE", "FINANCE"],
      });
    });
  });

  it("locks the roles of your own account and leaves them out of the request", async () => {
    render(
      <TeamMemberDialog
        open
        mode="edit"
        member={existing}
        roles={roles}
        lockRoles
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /Finance/ });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText("team_own_roles_locked")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    await waitFor(() => {
      expect(apiMock.updateAdminUser).toHaveBeenCalledWith("member-1", {
        name: "Casey",
        email: "casey@example.com",
      });
    });
  });
});
