import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

const apiMock = vi.hoisted(() => ({ updateAdminUser: vi.fn() }));

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (key === "team_password_too_short") return `密码至少 ${vars?.min} 位。`;
      if (key === "team_reset_password_title") return `重置密码 · ${vars?.name}`;
      return key;
    },
  }),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));

const member = {
  id: "member-1",
  name: "Casey",
  email: "casey@example.com",
  status: "ACTIVE" as const,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  roles: [{ role: { code: "WAREHOUSE" as const, name: "Warehouse" } }],
};

const onDone = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  apiMock.updateAdminUser.mockReset().mockResolvedValue(member);
  onDone.mockReset();
  onClose.mockReset();
});

describe("ResetPasswordDialog", () => {
  it("rejects a short password", async () => {
    render(
      <ResetPasswordDialog open member={member} onClose={onClose} onDone={onDone} />,
    );

    await userEvent.type(screen.getByLabelText("team_new_password"), "short");
    await userEvent.type(screen.getByLabelText("team_confirm_password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("密码至少 8 位。");
    expect(apiMock.updateAdminUser).not.toHaveBeenCalled();
  });

  it("rejects two different passwords", async () => {
    render(
      <ResetPasswordDialog open member={member} onClose={onClose} onDone={onDone} />,
    );

    await userEvent.type(screen.getByLabelText("team_new_password"), "longenough1");
    await userEvent.type(screen.getByLabelText("team_confirm_password"), "otherpassword1");
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "team_password_mismatch",
    );
    expect(apiMock.updateAdminUser).not.toHaveBeenCalled();
  });

  it("sends the new password", async () => {
    render(
      <ResetPasswordDialog open member={member} onClose={onClose} onDone={onDone} />,
    );

    await userEvent.type(screen.getByLabelText("team_new_password"), "longenough1");
    await userEvent.type(screen.getByLabelText("team_confirm_password"), "longenough1");
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    await waitFor(() => {
      expect(apiMock.updateAdminUser).toHaveBeenCalledWith("member-1", {
        password: "longenough1",
      });
    });
    expect(onDone).toHaveBeenCalled();
  });
});
