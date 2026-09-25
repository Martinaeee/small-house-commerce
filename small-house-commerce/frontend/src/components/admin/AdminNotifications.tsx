"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminNotificationList } from "./AdminNotificationList";
import { useAdminNotifications } from "./useAdminNotifications";

export function AdminNotifications() {
  const { t } = useAdminI18n();
  const { status, response, retry, refresh } = useAdminNotifications();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const totalCount = response?.totalCount ?? 0;
  const triggerLabel =
    totalCount > 0
      ? t("admin_notifications_trigger_count", { count: totalCount })
      : t("admin_notifications_trigger");

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !containerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    setOpen((current) => {
      if (!current) refresh();
      return !current;
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={toggle}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-ink-secondary hover:border-primary hover:text-cta"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4">
          <path
            d="M6.5 9.5a5.5 5.5 0 0 1 11 0v3.25l1.5 2.5H5l1.5-2.5V9.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M10 18a2.2 2.2 0 0 0 4 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {totalCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white"
          >
            {totalCount > 99 ? "99+" : totalCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("admin_notifications_title")}
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">
              {t("admin_notifications_title")}
            </h2>
          </div>

          <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
            {status === "loading" ? (
              <p role="status" className="px-4 py-8 text-center text-sm text-ink-muted">
                {t("admin_notifications_loading")}
              </p>
            ) : null}
            {status === "error" ? (
              <div role="alert" className="px-4 py-8 text-center">
                <p className="text-sm text-ink-secondary">
                  {t("admin_notifications_error")}
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-border px-3 text-xs font-semibold text-ink-secondary hover:border-primary hover:text-cta"
                >
                  {t("admin_notifications_retry")}
                </button>
              </div>
            ) : null}
            {status === "empty" ? (
              <p role="status" className="px-4 py-8 text-center text-sm text-ink-muted">
                {t("admin_notifications_empty")}
              </p>
            ) : null}
            {status === "ready" && response ? (
              <AdminNotificationList
                items={response.items}
                onNavigate={() => setOpen(false)}
              />
            ) : null}
          </div>

          <div className="border-t border-border p-2">
            <Link
              href="/admin/notifications"
              onClick={() => setOpen(false)}
              className="flex h-9 items-center justify-center rounded-lg text-xs font-semibold text-cta hover:bg-admin-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t("admin_notifications_view_all")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
