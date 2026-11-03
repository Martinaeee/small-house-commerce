"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  adminApi,
  type AdminRole,
  type AdminTeamMember,
  type AdminUserStatus,
} from "@/lib/admin-api";
import { ChangePasswordDialog } from "@/components/admin/ChangePasswordDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { TeamMemberDialog } from "./TeamMemberDialog";

type StatusFilter = "" | AdminUserStatus;
type DialogState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; member: AdminTeamMember }
  | { kind: "reset"; member: AdminTeamMember };

export function TeamMembersTable(): ReactNode {
  const { t } = useAdminI18n();
  const { admin } = useAdminAuth();
  const [members, setMembers] = useState<AdminTeamMember[] | null>(null);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([adminApi.listAdminUsers(), adminApi.listAdminRoles()])
      .then(([loadedMembers, loadedRoles]) => {
        if (!active) return;
        setMembers(loadedMembers);
        setRoles(loadedRoles);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : t("team_load_failed"),
        );
      });
    return () => {
      active = false;
    };
  }, [t]);

  const visible = useMemo(() => {
    if (!members) return [];
    const needle = search.trim().toLowerCase();
    return members.filter((member) => {
      if (status && member.status !== status) return false;
      if (!needle) return true;
      return (
        member.name.toLowerCase().includes(needle) ||
        member.email.toLowerCase().includes(needle)
      );
    });
  }, [members, search, status]);

  function upsert(member: AdminTeamMember): void {
    setMembers((current) => {
      if (!current) return [member];
      const index = current.findIndex((row) => row.id === member.id);
      if (index === -1) return [...current, member];
      const next = [...current];
      next[index] = member;
      return next;
    });
  }

  async function setMemberStatus(
    member: AdminTeamMember,
    next: AdminUserStatus,
  ): Promise<void> {
    if (busyId) return;
    setBusyId(member.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await adminApi.updateAdminUser(member.id, { status: next });
      upsert(updated);
      setNotice(
        next === "DISABLED"
          ? t("team_member_disabled", { name: member.name })
          : t("team_member_enabled", { name: member.name }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("team_save_failed"),
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-ink">
          {t("team_search")}
          <input
            type="search"
            aria-label={t("team_search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("team_search_placeholder")}
            className="mt-1 block h-10 w-56 rounded-lg border border-border bg-card px-3 text-sm"
          />
        </label>
        <label className="text-sm font-medium text-ink">
          {t("team_status_filter")}
          <select
            aria-label={t("team_status_filter")}
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            className="mt-1 block h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="">{t("team_filter_all")}</option>
            <option value="ACTIVE">{t("team_status_active")}</option>
            <option value="DISABLED">{t("team_status_disabled")}</option>
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPasswordOpen(true)}
          >
            {t("team_change_password_entry")}
          </Button>
          <Button type="button" onClick={() => setDialog({ kind: "create" })}>
            {t("team_add_member")}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-lg bg-primary-light/40 px-3 py-2 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

      {members === null ? (
        <div
          className="h-64 animate-pulse rounded-xl border border-border bg-card"
          aria-label={t("team_loading")}
        />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-ink-muted">
          {t("team_empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-background text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-3">{t("team_column_name")}</th>
                <th className="px-4 py-3">{t("team_column_email")}</th>
                <th className="px-4 py-3">{t("team_column_roles")}</th>
                <th className="px-4 py-3">{t("team_column_status")}</th>
                <th className="px-4 py-3">{t("team_column_created")}</th>
                <th className="px-4 py-3 text-right">{t("team_column_actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => {
                const isSelf = admin?.id === member.id;
                return (
                  <tr key={member.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-ink">
                      {member.name}
                      {isSelf ? (
                        <span className="ml-2 rounded-full bg-admin-primary-soft px-2 py-0.5 text-[11px] font-semibold text-admin-primary">
                          {t("team_self_badge")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{member.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {member.roles.map((row) => (
                          <span
                            key={row.role.code}
                            className="rounded-full bg-admin-primary-soft px-2 py-0.5 text-[11px] font-semibold text-admin-primary"
                          >
                            {row.role.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          member.status === "ACTIVE"
                            ? "text-ink-secondary"
                            : "text-ink-muted line-through"
                        }
                      >
                        {member.status === "ACTIVE"
                          ? t("team_status_active")
                          : t("team_status_disabled")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {new Date(member.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-3">
                        <button
                          type="button"
                          className="text-sm font-medium text-cta hover:underline"
                          onClick={() => setDialog({ kind: "edit", member })}
                        >
                          {t("team_action_edit")}
                        </button>
                        <button
                          type="button"
                          className="text-sm font-medium text-cta hover:underline"
                          onClick={() => setDialog({ kind: "reset", member })}
                        >
                          {t("team_action_reset_password")}
                        </button>
                        {isSelf ? (
                          <span className="text-sm text-ink-muted">
                            {t("team_action_self_locked")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId !== null}
                            className="text-sm font-medium text-cta hover:underline disabled:text-ink-muted"
                            onClick={() => {
                              void setMemberStatus(
                                member,
                                member.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                              );
                            }}
                          >
                            {member.status === "ACTIVE"
                              ? t("team_action_disable")
                              : t("team_action_enable")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TeamMemberDialog
        open={dialog.kind === "create" || dialog.kind === "edit"}
        mode={dialog.kind === "edit" ? "edit" : "create"}
        member={dialog.kind === "edit" ? dialog.member : null}
        roles={roles}
        lockRoles={dialog.kind === "edit" && admin?.id === dialog.member.id}
        onClose={() => setDialog({ kind: "none" })}
        onSaved={(member) => {
          upsert(member);
          setNotice(
            dialog.kind === "create"
              ? t("team_member_created", { name: member.name })
              : t("team_member_updated", { name: member.name }),
          );
        }}
      />

      <ResetPasswordDialog
        open={dialog.kind === "reset"}
        member={dialog.kind === "reset" ? dialog.member : null}
        onClose={() => setDialog({ kind: "none" })}
        onDone={() => setNotice(t("team_reset_password_done"))}
      />

      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onDone={() => setNotice(t("team_password_changed"))}
      />
    </div>
  );
}
