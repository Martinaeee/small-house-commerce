"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { Field, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminTokenStorage } from "@/lib/admin-auth";
import { adminApi } from "@/lib/admin-api";
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  generateAdminPassword,
} from "@/lib/admin-password";

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Self-service password change. The current password is required, so a
 * borrowed access token cannot lock the real owner out, and every other
 * session the account holds is revoked by the server.
 */
export function ChangePasswordDialog({
  open,
  onClose,
  onDone,
}: ChangePasswordDialogProps): ReactNode {
  const { t } = useAdminI18n();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setPassword("");
    setConfirm("");
    setError(null);
    setSaving(false);
  }, [open]);

  async function save(): Promise<void> {
    if (saving) return;
    if (!current) {
      setError(t("team_current_password_required"));
      return;
    }
    if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
      setError(t("team_password_too_short", { min: ADMIN_PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t("team_password_mismatch"));
      return;
    }
    if (password === current) {
      setError(t("team_password_unchanged"));
      return;
    }

    const refreshToken = adminTokenStorage.getRefresh();
    if (!refreshToken) {
      setError(t("team_session_expired"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await adminApi.changeAdminPassword({
        currentPassword: current,
        newPassword: password,
        refreshToken,
      });
      onDone();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("team_save_failed"),
      );
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("team_change_password_title")}
      width="sm"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-xs leading-relaxed text-ink-secondary">
          {t("team_change_password_note")}
        </p>

        <Field
          label={t("team_current_password")}
          htmlFor="team-change-current"
        >
          <TextInput
            id="team-change-current"
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>

        <Field label={t("team_new_password")} htmlFor="team-change-new">
          <div className="flex gap-2">
            <TextInput
              id="team-change-new"
              type="text"
              value={password}
              autoComplete="off"
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const next = generateAdminPassword();
                setPassword(next);
                setConfirm(next);
              }}
            >
              {t("team_generate_password")}
            </Button>
          </div>
        </Field>

        <Field
          label={t("team_confirm_password")}
          htmlFor="team-change-confirm"
        >
          <TextInput
            id="team-change-confirm"
            type="text"
            value={confirm}
            autoComplete="off"
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("team_cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t("team_saving") : t("team_save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
