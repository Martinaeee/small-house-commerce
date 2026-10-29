import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

const apiMock = vi.hoisted(() => ({ changeAdminPassword: vi.fn() }));

vi.mock("@/lib/admin-i18n", () => ({
  useAdminI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (key === "team_password_too_short") return `密码至少 ${vars?.min} 位。`;
      return key;
    },
  }),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMock }));

vi.mock("@/lib/admin-auth", () => ({
  adminTokenStorage: { getRefresh: () => "refresh-1" },
}));

const onDone = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  apiMock.changeAdminPassword.mockReset().mockResolvedValue({ ok: true });
  onDone.mockReset();
  onClose.mockReset();
});

describe("ChangePasswordDialog", () => {
  it("requires the current password", async () => {
    render(<ChangePasswordDialog open onClose={onClose} onDone={onDone} />);

    await userEvent.type(screen.getByLabelText("team_new_password"), "longenough1");
    await userEvent.type(screen.getByLabelText("team_confirm_password"), "longenough1");
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "team_current_password_required",
    );
    expect(apiMock.changeAdminPassword).not.toHaveBeenCalled();
  });

  it("rejects two different passwords", async () => {
    render(<ChangePasswordDialog open onClose={onClose} onDone={onDone} />);

    await userEvent.type(screen.getByLabelText("team_current_password"), "oldpassword1");
    await userEvent.type(screen.getByLabelText("team_new_password"), "longenough1");
    await userEvent.type(screen.getByLabelText("team_confirm_password"), "otherpassword1");
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "team_password_mismatch",
    );
    expect(apiMock.changeAdminPassword).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password", async () => {
    render(<ChangePasswordDialog open onClose={onClose} onDone={onDone} />);

    await userEvent.type(screen.getByLabelText("team_current_password"), "samepassword1");
    await userEvent.type(screen.getByLabelText("team_new_password"), "samepassword1");
    await userEvent.type(screen.getByLabelText("team_confirm_password"), "samepassword1");
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "team_password_unchanged",
    );
  });

  it("sends the current session token with the change", async () => {
    render(<ChangePasswordDialog open onClose={onClose} onDone={onDone} />);

    await userEvent.type(screen.getByLabelText("team_current_password"), "oldpassword1");
    await userEvent.type(screen.getByLabelText("team_new_password"), "longenough1");
    await userEvent.type(screen.getByLabelText("team_confirm_password"), "longenough1");
    await userEvent.click(screen.getByRole("button", { name: "team_save" }));

    await waitFor(() => {
      expect(apiMock.changeAdminPassword).toHaveBeenCalledWith({
        currentPassword: "oldpassword1",
        newPassword: "longenough1",
        refreshToken: "refresh-1",
      });
    });
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("fills both password fields with a generated one", async () => {
    render(<ChangePasswordDialog open onClose={onClose} onDone={onDone} />);

    await userEvent.click(screen.getByRole("button", { name: "team_generate_password" }));

    const generated = (screen.getByLabelText("team_new_password") as HTMLInputElement)
      .value;
    const confirmed = (screen.getByLabelText("team_confirm_password") as HTMLInputElement)
      .value;
    expect(generated.length).toBeGreaterThanOrEqual(8);
    expect(confirmed).toBe(generated);
  });
});
