"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { Field, TextInput } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminRole,
  type AdminRoleCode,
  type AdminTeamMember,
} from "@/lib/admin-api";
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  generateAdminPassword,
} from "@/lib/admin-password";

interface TeamMemberDialogProps {
  open: boolean;
  /** "create" adds the initial password field; "edit" never shows it. */
  mode: "create" | "edit";
  member?: AdminTeamMember | null;
  roles: AdminRole[];
  /**
   * True when the member being edited is the signed-in administrator. The
   * server refuses role changes on your own account (it is how a back office
   * locks itself out), so the picker is disabled and roles are left out of
   * the request.
   */
  lockRoles?: boolean;
  onClose: () => void;
  onSaved: (member: AdminTeamMember) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function TeamMemberDialog({
  open,
  mode,
  member,
  roles,
  lockRoles = false,
  onClose,
  onSaved,
}: TeamMemberDialogProps): ReactNode {
  const { t } = useAdminI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleCodes, setRoleCodes] = useState<AdminRoleCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the dialog opens on a different member.
  useEffect(() => {
    if (!open) return;
    setName(member?.name ?? "");
    setEmail(member?.email ?? "");
    setPassword("");
    setRoleCodes(member?.roles.map((row) => row.role.code) ?? []);
    setError(null);
    setSaving(false);
  }, [open, member]);

  const selectedRoles = useMemo(
    () => roles.filter((role) => roleCodes.includes(role.code)),
    [roles, roleCodes],
  );

  // Several roles union their permissions, so the picker shows what the
  // member actually ends up with.
  const permissionCount = useMemo(() => {
    const codes = new Set<string>();
    for (const role of selectedRoles) {
      for (const code of role.permissionCodes) codes.add(code);
    }
    return codes.size;
  }, [selectedRoles]);

  function toggleRole(code: AdminRoleCode): void {
    setRoleCodes((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code],
    );
  }

  function validate(): string | null {
    if (!name.trim()) return t("team_name_required");
    if (!EMAIL_PATTERN.test(email.trim())) return t("team_email_invalid");
    if (mode === "create" && password.length < ADMIN_PASSWORD_MIN_LENGTH) {
      return t("team_password_too_short", { min: ADMIN_PASSWORD_MIN_LENGTH });
    }
    if (mode === "create" && roleCodes.length === 0) return t("team_role_required");
    return null;
  }

  async function save(): Promise<void> {
    if (saving) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved =
        mode === "create"
          ? await adminApi.createAdminUser({
              name: name.trim(),
              email: email.trim().toLowerCase(),
              password,
              roleCodes,
            })
          : await adminApi.updateAdminUser(member!.id, {
              name: name.trim(),
              email: email.trim().toLowerCase(),
              // Roles are omitted for your own account; the server would
              // refuse them anyway.
              ...(lockRoles ? {} : { roleCodes }),
            });
      onSaved(saved);
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
      title={
        mode === "create"
          ? t("team_member_dialog_create_title")
          : t("team_member_dialog_edit_title")
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label={t("team_name")} htmlFor="team-member-name">
          <TextInput
            id="team-member-name"
            value={name}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label={t("team_email")} htmlFor="team-member-email">
          <TextInput
            id="team-member-email"
            type="email"
            value={email}
            autoComplete="off"
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        {mode === "create" ? (
          <Field
            label={t("team_password")}
            htmlFor="team-member-password"
            hint={t("team_password_hint")}
            hintDisplay="inline"
          >
            <div className="flex gap-2">
              <TextInput
                id="team-member-password"
                type="text"
                value={password}
                autoComplete="off"
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPassword(generateAdminPassword())}
              >
                {t("team_generate_password")}
              </Button>
            </div>
          </Field>
        ) : null}

        <fieldset>
          <legend className="text-sm font-medium text-ink">
            {t("team_roles")}
            <span className="ml-2 text-xs font-normal text-ink-muted">
              {t("team_roles_hint")}
            </span>
          </legend>
          <div className="mt-2 space-y-2">
            {roles.map((role) => {
              const checked = roleCodes.includes(role.code);
              return (
                <label
                  key={role.code}
                  className={`flex gap-3 rounded-lg border p-3 ${
                    lockRoles ? "cursor-not-allowed opacity-70" : "cursor-pointer"
                  } ${checked ? "border-cta bg-primary-light/30" : "border-border"}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-cta)]"
                    checked={checked}
                    disabled={lockRoles}
                    onChange={() => toggleRole(role.code)}
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {role.name}
                      </span>
                      {role.code === "SUPER_ADMIN" ? (
                        <span className="rounded-full bg-admin-primary-soft px-2 py-0.5 text-[11px] font-semibold text-admin-primary">
                          {t("team_role_full_access")}
                        </span>
                      ) : null}
                    </span>
                    {role.description ? (
                      <span className="mt-1 block text-xs leading-relaxed text-ink-secondary">
                        {role.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
          {lockRoles ? (
            <p className="mt-2 text-xs text-ink-muted">{t("team_own_roles_locked")}</p>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">
              {t("team_permission_count", { count: permissionCount })}
            </p>
          )}
        </fieldset>

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
