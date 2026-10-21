"use client";

import { LinkPicker } from "@/components/admin/homepage/LinkPicker";
import { useAdminI18n } from "@/lib/admin-i18n";
import {
  SHELL_LIMITS,
  type StructuredLink,
} from "@/lib/storefront-shell-document";

export type ShellLinkEditorProps = {
  label: string;
  link: StructuredLink;
  disabled?: boolean;
  onLabelChange: (label: string) => void;
  onLinkChange: (link: StructuredLink) => void;
};

export function ShellLinkEditor({
  label,
  link,
  disabled = false,
  onLabelChange,
  onLinkChange,
}: ShellLinkEditorProps) {
  const { t } = useAdminI18n();

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="sr-only">{t("storefront_shell_link")}</legend>
      <label className="block min-w-0 text-sm font-medium text-ink">
        {t("storefront_shell_link_label")}
        <input
          type="text"
          value={label}
          maxLength={SHELL_LIMITS.label}
          aria-label={t("storefront_shell_link_label")}
          onChange={(event) => onLabelChange(event.target.value)}
          className="mt-1 block w-full min-w-0 rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-ink"
        />
      </label>
      <LinkPicker
        value={link}
        allowExternal
        allowInternal
        onChange={(next) => {
          if (next) onLinkChange(next);
        }}
      />
    </fieldset>
  );
}
