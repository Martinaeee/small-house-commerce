"use client";

import { useState, type ReactNode } from "react";
import { useAdminI18n } from "@/lib/admin-i18n";
import type {
  AdminProductIssue,
  AdminProductIssueAction,
} from "@/lib/admin-product-issues";

/**
 * The editor's persistent problem rail.
 *
 * It lives inside the sticky header, so the number of blocking problems stays
 * on screen while the operator scrolls through the form. Collapsed it is one
 * line; expanded it lists every problem with a one-click repair, a jump link to
 * the offending row, and a copy action for anything the client cannot explain.
 */
export function ProductFormErrorRail({
  issues,
  onAction,
  onJump,
}: {
  issues: AdminProductIssue[];
  onAction: (action: AdminProductIssueAction) => void;
  onJump: (issue: AdminProductIssue) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const [expanded, setExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (issues.length === 0) return null;
  const first = issues[0];

  const runAction = async (
    issue: AdminProductIssue,
    action: AdminProductIssueAction,
  ): Promise<void> => {
    if (action.kind !== "copy") {
      onAction(action);
      return;
    }
    try {
      await navigator.clipboard.writeText(issue.message);
      setCopiedId(issue.id);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div
      id="pf-problem-rail"
      role="alert"
      className="mt-3 rounded-lg border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-red-700"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">
          ⚠ {t("product_issue_rail_count", { count: issues.length })}
        </span>
        <span className="min-w-0 flex-1 truncate">{first?.message}</span>
        <button
          type="button"
          className="shrink-0 rounded-md border border-sale/40 bg-card px-2.5 py-1 text-xs font-semibold text-red-700 hover:border-sale"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t("product_issue_rail_hide")
            : t("product_issue_rail_show")}
        </button>
      </div>

      {expanded ? (
        <ul className="mt-2 flex flex-col gap-2">
          {issues.map((issue) => (
            <li
              key={issue.id}
              className="rounded-lg border border-sale/30 bg-card p-3"
            >
              <p className="text-sm font-semibold text-ink">{issue.message}</p>
              {issue.detail ? (
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                  {issue.detail}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {issue.actions.map((action) => (
                  <button
                    key={action.kind}
                    type="button"
                    className="h-8 rounded-lg bg-cta px-3 text-xs font-semibold text-white hover:bg-cta-hover"
                    onClick={() => {
                      void runAction(issue, action);
                    }}
                  >
                    {action.kind === "copy" && copiedId === issue.id
                      ? t("product_issue_copied")
                      : action.label}
                  </button>
                ))}
                {issue.highlightKey ? (
                  <button
                    type="button"
                    className="h-8 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-cta hover:border-primary"
                    onClick={() => onJump(issue)}
                  >
                    {t("product_issue_rail_jump")} →
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
