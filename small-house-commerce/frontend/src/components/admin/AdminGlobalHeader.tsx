"use client";

import type { ReactNode } from "react";
import type { AdminUser } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";

export interface AdminGlobalHeaderProps {
  moduleTitle: string;
  admin: AdminUser;
  onLogout: () => void | Promise<void>;
  mobileMenuTrigger?: ReactNode;
  /** Phase B replaces this slot with the real command palette trigger. */
  searchControl?: ReactNode;
  /** Phase B replaces this slot with the real notification control. */
  notificationControl?: ReactNode;
}

function SearchBoundary(): ReactNode {
  const { t } = useAdminI18n();
  return (
    <div
      aria-label={t("admin_header_search_pending")}
      className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-admin-surface-secondary px-3 text-sm text-ink-muted"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4 shrink-0">
        <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <span>{t("admin_header_search_placeholder")}</span>
      <span className="ml-auto text-[11px] text-ink-muted">
        {t("admin_header_phase_b")}
      </span>
    </div>
  );
}

function NotificationBoundary(): ReactNode {
  const { t } = useAdminI18n();
  return (
    <span
      aria-label={t("admin_header_notifications_pending")}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-ink-muted"
      title={t("admin_header_notifications_pending")}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4">
        <path
          d="M6.5 9.5a5.5 5.5 0 0 1 11 0v3.25l1.5 2.5H5l1.5-2.5V9.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M10 18a2.2 2.2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function AdminGlobalHeader({
  moduleTitle,
  admin,
  onLogout,
  mobileMenuTrigger,
  searchControl,
  notificationControl,
}: AdminGlobalHeaderProps): ReactNode {
  const { lang, setLang, t } = useAdminI18n();
  const primaryRole = admin.roles[0]?.code ?? t("admin_header_no_role");
  const initial = admin.name.trim().charAt(0).toUpperCase() || "A";

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-4 md:px-6 xl:px-8">
      {mobileMenuTrigger}
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink lg:hidden">
        {moduleTitle}
      </p>

      <div className="hidden w-full min-w-[420px] max-w-[520px] lg:flex">
        {searchControl ?? <SearchBoundary />}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="hidden h-9 items-center rounded-lg border border-border bg-admin-surface-secondary px-3 text-xs font-medium text-ink-secondary xl:inline-flex">
          {t("admin_header_store_context")}
        </span>

        <button
          type="button"
          onClick={() => setLang(lang === "zh" ? "en" : "zh")}
          aria-label={t("admin_header_switch_language")}
          className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-border bg-card px-2 text-xs font-semibold text-ink-secondary hover:border-primary hover:text-cta"
        >
          {lang === "zh" ? "EN" : "中文"}
        </button>

        {notificationControl ?? <NotificationBoundary />}

        <details
          role="group"
          aria-label={t("admin_header_account_menu")}
          className="group relative"
        >
          <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card pl-1.5 pr-2 text-left hover:border-primary [&::-webkit-details-marker]:hidden">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-admin-primary-soft text-xs font-bold text-admin-primary">
              {initial}
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block max-w-32 truncate text-xs font-semibold leading-tight text-ink">
                {admin.name}
              </span>
              <span className="block max-w-32 truncate text-[10px] leading-tight text-ink-muted">
                {primaryRole}
              </span>
            </span>
            <span aria-hidden className="text-[10px] text-ink-muted">⌄</span>
          </summary>

          <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm font-semibold text-ink">{admin.name}</p>
            <p className="mt-0.5 text-xs text-ink-muted">{admin.email}</p>

            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                {t("admin_header_roles")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {admin.roles.length > 0 ? (
                  admin.roles.map((role) => (
                    <span
                      key={role.code}
                      className="rounded-full bg-admin-primary-soft px-2 py-1 text-[11px] font-semibold text-admin-primary"
                    >
                      {role.code}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-ink-muted">
                    {t("admin_header_no_role")}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                {t("admin_header_permissions")}
              </p>
              {admin.permissions.length > 0 ? (
                <ul className="mt-1.5 max-h-36 space-y-1 overflow-y-auto rounded-lg bg-admin-surface-secondary p-2">
                  {admin.permissions.map((permission) => (
                    <li key={permission} className="font-mono text-[11px] text-ink-secondary">
                      {permission}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-ink-muted">
                  {t("admin_header_no_permissions")}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void onLogout()}
              className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg border border-border text-xs font-semibold text-ink-secondary hover:border-primary hover:text-cta"
            >
              {t("admin_header_logout")}
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
