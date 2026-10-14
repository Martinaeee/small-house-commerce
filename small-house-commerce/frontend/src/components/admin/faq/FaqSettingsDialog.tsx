"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/admin/Dialog";
import { Field, Select } from "@/components/admin/Field";
import { Button } from "@/components/ui/Button";
import { useAdminI18n } from "@/lib/admin-i18n";
import type { AdminFaqMode } from "@/lib/admin-api";

/** Small dialog for a product's FAQ mode; the list row only shows a badge. */
export function FaqSettingsDialog({
  productName,
  mode,
  saving,
  error,
  onReloadError,
  onCancel,
  onSave,
}: {
  productName: string;
  mode: AdminFaqMode;
  saving: boolean;
  error: string | null;
  /** Set when the error is a version conflict; reloads the list and closes. */
  onReloadError?: (() => void) | null;
  onCancel: () => void;
  onSave: (mode: AdminFaqMode) => void;
}): ReactNode {
  const { t } = useAdminI18n();
  const [draft, setDraft] = useState<AdminFaqMode>(mode);

  const hint =
    draft === "SHARED"
      ? t("product_faq_mode_shared_hint")
      : draft === "EXTEND"
        ? t("product_faq_mode_extend_hint")
        : t("product_faq_mode_custom_hint");

  return (
    <Dialog open title={t("faq_settings_title")} onClose={onCancel}>
      <div className="space-y-4">
        <p className="rounded-lg bg-background px-3 py-2 text-xs text-ink-secondary">
          {productName}
        </p>
        <Field label={t("faq_settings_mode_label")} htmlFor="faq-settings-mode" hint={hint}>
          <Select
            id="faq-settings-mode"
            value={draft}
            onChange={(event) => setDraft(event.target.value as AdminFaqMode)}
          >
            <option value="SHARED">{t("product_faq_mode_shared")}</option>
            <option value="EXTEND">{t("product_faq_mode_extend")}</option>
            <option value="CUSTOM">{t("product_faq_mode_custom")}</option>
          </Select>
        </Field>
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-sale/30 bg-sale/5 p-3 text-sm text-red-700">
            {error}
            {onReloadError ? (
              <Button
                variant="text"
                size="md"
                className="h-auto min-w-0 px-0 text-red-700"
                onClick={onReloadError}
              >
                {t("faq_reload")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={saving}>
            {t("faq_dialog_cancel")}
          </Button>
          <Button size="md" onClick={() => onSave(draft)} disabled={saving}>
            {saving ? t("faq_dialog_saving") : t("faq_settings_save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
