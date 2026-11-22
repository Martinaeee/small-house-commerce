"use client";

import Link from "next/link";
import type { AdminI18n } from "@/lib/admin-i18n";
import { StatusBadge, Card } from "./StatusBadge";

/** Shared placeholder for modules that arrive in later phases (P1R shell). */
export function PhasePlaceholder({
  title,
  subtitle,
  phase,
  state = "NOT_ENABLED",
  t,
}: {
  title: string;
  subtitle: string;
  phase: string;
  state?: "NOT_ENABLED" | "NO_DATA";
  t: AdminI18n["t"];
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-admin-ink">{title}</h1>
        <p className="mt-1 text-sm text-admin-muted">{subtitle}</p>
      </div>
      <Card
        title={title}
        badge={<StatusBadge status={state === "NOT_ENABLED" ? "NOT_SUPPORTED" : "NO_DATA"} label={state === "NOT_ENABLED" ? t("health_not_enabled") : undefined} />}
      >
        <p className="mt-3 text-xs text-admin-muted">{t("health_phase_note", { phase })}</p>
        <Link href="/admin/observability" className="mt-3 inline-block text-xs font-medium text-cta hover:underline">
          ← {t("health_back_home")}
        </Link>
      </Card>
    </div>
  );
}
