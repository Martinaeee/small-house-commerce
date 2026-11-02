"use client";

import { useState } from "react";
import { AdminApiError } from "@/lib/admin-auth";
import { useAdminI18n } from "@/lib/admin-i18n";
import { copyText } from "@/lib/clipboard";
import { marketingApi, type ShortLinkResult } from "@/lib/marketing-api";

const fieldClass =
  "w-full min-w-0 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm";

/**
 * One entrance, one exit: paste a storefront link, get /s/<code>. There is no
 * list, no click tracking and no custom code on purpose; the backend keeps the
 * mapping and rejects anything that is not a luwag.shop storefront path.
 */
export function ShortLinkTool() {
  const { t } = useAdminI18n();
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ShortLinkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read once on the client; the server pass only ever renders an empty result,
  // so this cannot cause a hydration mismatch.
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );

  const shortUrl = result
    ? origin
      ? new URL(result.path, origin).href
      : result.path
    : "";

  async function shorten(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      setResult(await marketingApi.createShortLink({ url }));
    } catch (reason) {
      setError(
        reason instanceof AdminApiError && reason.status === 400
          ? t("marketing_short_link_invalid")
          : t("marketing_short_link_failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    const copied = await copyText(shortUrl);
    setNotice(
      t(copied ? "marketing_short_link_copied" : "common_copy_failed_manual"),
    );
  }

  return (
    <section className="max-w-2xl rounded-xl border border-admin-border bg-white p-4 md:p-6">
      <h2 className="text-base font-semibold">{t("marketing_short_link_title")}</h2>
      <p className="mt-1 text-sm text-admin-muted">
        {t("marketing_short_link_hint")}
      </p>
      <form className="mt-4 space-y-2" onSubmit={(event) => void shorten(event)}>
        <label htmlFor="short-link-url" className="block text-sm font-medium">
          {t("marketing_short_link_url")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="short-link-url"
            className={fieldClass}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t("marketing_short_link_placeholder")}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={busy || url.trim() === ""}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-cta-foreground disabled:opacity-60"
          >
            {t("marketing_short_link_generate")}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-admin-border bg-slate-50 p-3">
          <p className="text-xs font-medium text-admin-muted">
            {t("marketing_short_link_result")}
          </p>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all text-sm">{shortUrl}</code>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex shrink-0 items-center justify-center rounded-lg border border-admin-border bg-white px-3 py-1.5 text-sm font-medium"
            >
              {t("marketing_short_link_copy")}
            </button>
          </div>
          <p className="mt-2 break-all text-xs text-admin-muted">
            {t("marketing_short_link_target")}: {result.target}
          </p>
          {notice && (
            <p role="status" className="mt-2 text-sm text-cta">
              {notice}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
