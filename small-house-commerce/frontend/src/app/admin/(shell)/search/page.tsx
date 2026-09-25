"use client";

import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminSearchResults } from "@/components/admin/AdminSearchResults";
import { PageHeader } from "@/components/admin/PageHeader";
import { useAdminSearch } from "@/components/admin/useAdminSearch";
import { useAdminI18n } from "@/lib/admin-i18n";

function SearchPageContent(): ReactNode {
  const { t } = useAdminI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const normalizedQuery = urlQuery.trim().replace(/\s+/g, " ");
  const queryLength = [...normalizedQuery].length;
  const [draft, setDraft] = useState(urlQuery);
  const [syncedQuery, setSyncedQuery] = useState(urlQuery);

  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery);
    setDraft(urlQuery);
  }

  const search = useAdminSearch(normalizedQuery, {
    enabled: queryLength >= 2,
    limit: 20,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = draft.trim().replace(/\s+/g, " ");
    router.replace(
      nextQuery
        ? `/admin/search?q=${encodeURIComponent(nextQuery)}`
        : "/admin/search",
    );
  };

  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PageHeader
        title={t("admin_search_dialog")}
        subtitle={t("admin_search_input")}
      />

      <form
        onSubmit={submit}
        className="mt-6 flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row"
      >
        <label htmlFor="admin-search-page-query" className="sr-only">
          {t("admin_search_input")}
        </label>
        <input
          id="admin-search-page-query"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("admin_search_input")}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-admin-surface-secondary px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-primary"
          autoComplete="off"
        />
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          {t("common_search")}
        </button>
      </form>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {search.status === "idle" ? (
          <p role="status" className="p-8 text-center text-sm text-ink-muted">
            {t("admin_search_min_chars")}
          </p>
        ) : search.status === "loading" ? (
          <p role="status" className="p-8 text-center text-sm text-ink-secondary">
            {t("admin_search_loading")}
          </p>
        ) : search.status === "empty" ? (
          <p role="status" className="p-8 text-center text-sm text-ink-secondary">
            {t("admin_search_empty")}
          </p>
        ) : search.status === "error" ? (
          <div role="alert" className="p-8 text-center text-sm text-error">
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
          <AdminSearchResults response={search.response} mode="page" />
        ) : null}
      </div>
    </div>
  );
}

function SearchPageFallback(): ReactNode {
  const { t } = useAdminI18n();
  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <p role="status" className="text-sm text-ink-secondary">
        {t("common_loading")}
      </p>
    </div>
  );
}

export default function AdminSearchPage(): ReactNode {
  return (
    <Suspense fallback={<SearchPageFallback />}>
      <SearchPageContent />
    </Suspense>
  );
}
