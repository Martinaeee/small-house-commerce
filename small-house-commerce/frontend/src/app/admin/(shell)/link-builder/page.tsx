"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CampaignLinkBuilder } from "@/components/admin/CampaignLinkBuilder";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/Button";
import { adminApi, type AdminLinkBuilderContext } from "@/lib/admin-api";
import { useAdminI18n } from "@/lib/admin-i18n";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; context: AdminLinkBuilderContext };

export default function AdminLinkBuilderPage(): ReactNode {
  const { t } = useAdminI18n();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    adminApi
      .getLinkBuilderContext()
      .then((context) => {
        if (active) setState({ status: "ready", context });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setNonce((value) => value + 1);
  }, []);

  return (
    <div className="w-full max-w-none px-4 py-6 md:px-8">
      <PageHeader
        title={t("link_builder_title")}
        subtitle={t("link_builder_subtitle")}
      />

      {state.status === "loading" ? (
        <p role="status" className="mt-10 text-sm text-ink-secondary">
          {t("link_builder_loading")}
        </p>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="mt-10 rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-admin-error">
            {t("link_builder_load_error")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="mt-4"
            onClick={retry}
          >
            {t("common_retry")}
          </Button>
        </div>
      ) : null}

      {state.status === "ready" && state.context.products.length === 0 ? (
        <p className="mt-10 rounded-xl border border-border bg-card p-6 text-sm text-ink-secondary">
          {t("link_builder_empty")}
        </p>
      ) : null}

      {state.status === "ready" && state.context.products.length > 0 ? (
        <CampaignLinkBuilder context={state.context} />
      ) : null}
    </div>
  );
}
