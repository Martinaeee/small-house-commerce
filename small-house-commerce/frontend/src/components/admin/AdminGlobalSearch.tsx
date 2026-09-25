"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { type AdminSearchHit } from "@/lib/admin-api";
import {
  adminSearchHitHref,
  adminSearchOptionId,
  flattenAdminSearchResults,
} from "@/lib/admin-search";
import { useAdminI18n } from "@/lib/admin-i18n";
import { AdminSearchResults } from "./AdminSearchResults";
import { useAdminSearch } from "./useAdminSearch";

const SEARCH_PERMISSIONS = new Set([
  "PRODUCT_MANAGE",
  "ORDER_VIEW_ALL",
  "CUSTOMER_MANAGE",
]);
const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function visibleDialogResults(response: ReturnType<typeof useAdminSearch>["response"]) {
  if (response === null) return [];
  const counts = new Map<string, number>();
  return flattenAdminSearchResults(response).filter(({ group }) => {
    const count = counts.get(group) ?? 0;
    counts.set(group, count + 1);
    return count < 5;
  });
}

export function AdminGlobalSearch({
  permissions,
}: {
  permissions: readonly string[];
}): ReactNode {
  const { t } = useAdminI18n();
  const router = useRouter();
  const resultsId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);
  const canSearch = permissions.some((permission) =>
    SEARCH_PERMISSIONS.has(permission),
  );
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  const queryLength = [...normalizedQuery].length;
  const search = useAdminSearch(query, {
    enabled: open && canSearch,
    limit: 5,
  });
  const visibleResults = useMemo(
    () => visibleDialogResults(search.response),
    [search.response],
  );
  const activeResult = visibleResults.find(
    ({ hit }) => adminSearchOptionId(hit) === activeOptionId,
  );
  const effectiveActiveId = activeResult
    ? adminSearchOptionId(activeResult.hit)
    : null;
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const openSearch = useCallback((opener: HTMLElement | null) => {
    openerRef.current = opener ?? triggerRef.current;
    setOpen(true);
  }, []);

  const closeSearch = useCallback((restoreFocus = true) => {
    setOpen(false);
    setQuery("");
    setActiveOptionId(null);
    if (restoreFocus) openerRef.current?.focus();
  }, []);

  const navigateTo = useCallback(
    (href: string) => {
      if (!href.startsWith("/admin/")) return;
      closeSearch(false);
      router.push(href);
    },
    [closeSearch, router],
  );

  const activate = useCallback(
    (hit: AdminSearchHit) => navigateTo(adminSearchHitHref(hit)),
    [navigateTo],
  );

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase("en-US") !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      if (open) {
        inputRef.current?.focus();
        return;
      }
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : triggerRef.current;
      openSearch(active);
    };
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, [open, openSearch]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (inputRef.current ?? closeRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (visibleResults.length === 0) return;
        event.preventDefault();
        const currentIndex = visibleResults.findIndex(
          ({ hit }) => adminSearchOptionId(hit) === effectiveActiveId,
        );
        const nextIndex =
          event.key === "ArrowDown"
            ? currentIndex < 0
              ? 0
              : (currentIndex + 1) % visibleResults.length
            : currentIndex < 0
              ? visibleResults.length - 1
              : (currentIndex - 1 + visibleResults.length) %
                visibleResults.length;
        setActiveOptionId(adminSearchOptionId(visibleResults[nextIndex]!.hit));
        return;
      }
      if (event.key === "Enter" && effectiveActiveId !== null) {
        const current = visibleResults.find(
          ({ hit }) => adminSearchOptionId(hit) === effectiveActiveId,
        );
        if (!current) return;
        event.preventDefault();
        activate(current.hit);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [
    activate,
    closeSearch,
    effectiveActiveId,
    open,
    visibleResults,
  ]);

  const viewAllHref =
    queryLength >= 2 && queryLength <= 100
      ? `/admin/search?q=${encodeURIComponent(normalizedQuery)}`
      : null;

  const dialog = open ? (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/45 px-4 pt-[8vh] sm:pt-[12vh]">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("admin_search_close")}
        className="absolute inset-0 cursor-default"
        onClick={() => closeSearch()}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("admin_search_dialog")}
        className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        {canSearch ? (
          <div className="flex items-center gap-2 border-b border-border p-3">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
              className="ml-1 h-5 w-5 shrink-0 text-ink-muted"
            >
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label={t("admin_search_input")}
              aria-expanded={open}
              aria-controls={resultsId}
              aria-autocomplete="list"
              aria-activedescendant={effectiveActiveId ?? undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveOptionId(null);
              }}
              placeholder={t("admin_search_input")}
              className="h-10 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
              autoComplete="off"
            />
            <button
              ref={closeRef}
              type="button"
              aria-label={t("admin_search_close")}
              onClick={() => closeSearch()}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted hover:border-primary hover:text-cta"
            >
              <span aria-hidden>Esc</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between border-b border-border p-4">
            <p className="font-semibold text-ink">{t("admin_search_dialog")}</p>
            <button
              ref={closeRef}
              type="button"
              aria-label={t("admin_search_close")}
              onClick={() => closeSearch()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink-secondary"
            >
              Esc
            </button>
          </div>
        )}

        {!canSearch ? (
          <p className="p-6 text-center text-sm text-ink-secondary">
            {t("admin_search_no_permission")}
          </p>
        ) : search.status === "idle" ? (
          <p
            id={resultsId}
            role="status"
            className="p-6 text-center text-sm text-ink-muted"
          >
            {t("admin_search_min_chars")}
          </p>
        ) : search.status === "loading" ? (
          <p
            id={resultsId}
            role="status"
            className="p-6 text-center text-sm text-ink-secondary"
          >
            {t("admin_search_loading")}
          </p>
        ) : search.status === "empty" ? (
          <p
            id={resultsId}
            role="status"
            className="p-6 text-center text-sm text-ink-secondary"
          >
            {t("admin_search_empty")}
          </p>
        ) : search.status === "error" ? (
          <div
            id={resultsId}
            role="alert"
            className="p-6 text-center text-sm text-error"
          >
            <p>
              {search.error === "QUERY_TOO_LONG"
                ? t("admin_search_too_long")
                : t("admin_search_error")}
            </p>
            {search.error === "REQUEST_FAILED" ? (
              <button
                type="button"
                onClick={search.retry}
                className="mt-3 rounded-lg border border-error px-3 py-1.5 text-xs font-semibold"
              >
                {t("admin_search_retry")}
              </button>
            ) : null}
          </div>
        ) : search.response ? (
          <AdminSearchResults
            id={resultsId}
            response={search.response}
            mode="dialog"
            activeOptionId={effectiveActiveId}
            onActivate={activate}
            onActiveOptionChange={setActiveOptionId}
          />
        ) : null}

        {canSearch && viewAllHref ? (
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => navigateTo(viewAllHref)}
              className="flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold text-cta hover:bg-admin-primary-soft"
            >
              {t("admin_search_view_all")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("admin_search_dialog")}
        aria-expanded={open}
        onClick={(event) => openSearch(event.currentTarget)}
        className="flex h-9 w-9 items-center justify-center gap-2 rounded-lg border border-border bg-admin-surface-secondary px-2 text-sm text-ink-muted hover:border-primary hover:text-cta lg:w-full lg:justify-start lg:px-3"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4 shrink-0">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <span className="hidden truncate lg:inline">{t("admin_search_dialog")}</span>
        <span className="ml-auto hidden text-[11px] text-ink-muted xl:inline">
          {t("admin_search_shortcut")}
        </span>
      </button>
      {mounted && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
