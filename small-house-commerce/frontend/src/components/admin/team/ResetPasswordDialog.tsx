"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { Field, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import { adminApi, type AdminTeamMember } from "@/lib/admin-api";
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  generateAdminPassword,
} from "@/lib/admin-password";

interface ResetPasswordDialogProps {
  open: boolean;
  member: AdminTeamMember | null;
  onClose: () => void;
  onDone: () => void;
}

export function ResetPasswordDialog({
  open,
  member,
  onClose,
  onDone,
}: ResetPasswordDialogProps): ReactNode {
  const { t } = useAdminI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setConfirm("");
    setError(null);
    setSaving(false);
  }, [open, member]);

  async function save(): Promise<void> {
    if (saving || !member) return;
    if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
      setError(t("team_password_too_short", { min: ADMIN_PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t("team_password_mismatch"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await adminApi.updateAdminUser(member.id, { password });
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
      title={t("team_reset_password_title", { name: member?.name ?? "" })}
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
          {t("team_reset_password_note")}
        </p>

        <Field label={t("team_new_password")} htmlFor="team-reset-password">
          <div className="flex gap-2">
            <TextInput
              id="team-reset-password"
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

        <Field label={t("team_confirm_password")} htmlFor="team-reset-confirm">
          <TextInput
            id="team-reset-confirm"
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
