"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  storefrontShellApi,
  type AdminShellPreviewResult,
} from "@/lib/storefront-shell-api";
import { StorefrontShellPreview } from "./StorefrontShellPreview";

type LoadState = { kind: "loading" } | { kind: "ready"; result: AdminShellPreviewResult } | { kind: "error"; message: string };

/**
 * Server-saved draft preview. It deliberately renders the draft the server has
 * stored (never the editor's local state) through an authenticated, private
 * request, so no reusable token or query credential is involved.
 *
 * The state lives in one discriminated value and is only ever assigned from the
 * request callbacks — never synchronously in the effect body
 * (react-hooks/set-state-in-effect, same convention as SiteSearch).
 */
export function SavedStorefrontShellPreview(): ReactNode {
  const { t } = useAdminI18n();
  const { status } = useAdminAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (status !== "authed") return;
    let active = true;
    storefrontShellApi
      .preview()
      .then((result) => {
        if (active) setState({ kind: "ready", result });
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setState({
          kind: "error",
          message:
            failure instanceof Error ? failure.message : String(failure),
        });
      });
    return () => {
      active = false;
    };
  }, [nonce, status]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setNonce((current) => current + 1);
  }, []);

  if (status !== "authed" || state.kind === "loading") {
    return (
      <div className="p-8" aria-busy="true">
        <p className="sr-only">{t("storefront_shell_loading")}</p>
        <div className="h-8 w-64 animate-pulse rounded bg-admin-border" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div
          role="alert"
          className="rounded-xl border border-admin-error bg-admin-error-soft p-6"
        >
          <p className="font-semibold text-admin-error">
            {t("storefront_shell_preview_error")}
          </p>
          <p className="mt-1 text-sm text-ink-secondary">{state.message}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 rounded-lg bg-admin-primary px-4 py-2 text-sm font-semibold text-white"
          >
            {t("storefront_shell_retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-admin-canvas p-6">
      <p className="mb-4 text-sm text-ink-secondary">
        {t("storefront_shell_preview_version", {
          version: state.result.version,
        })}
      </p>
      <StorefrontShellPreview shell={state.result.shell} device="desktop" />
    </div>
  );
}
