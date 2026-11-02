"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminI18n } from "@/lib/admin-i18n";

export function ProductSaveFeedback({ message, tone, onClose }: {
  message: string;
  tone: "success" | "error";
  onClose?: () => void;
}) {
  const { t } = useAdminI18n();
  const [visible, setVisible] = useState(true);
  const close = useCallback(() => {
    setVisible(false);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (tone !== "success") return;
    const timer = window.setTimeout(close, 6000);
    return () => window.clearTimeout(timer);
  }, [tone, close]);

  if (!visible || typeof document === "undefined") return null;
  return createPortal(
    <div data-product-save-feedback className="pointer-events-none fixed inset-x-4 top-4 z-[110] flex justify-center">
      <div
        role={tone === "error" ? "alert" : "status"}
        aria-label={t("product_save_feedback_title")}
        className={`pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
      >
        <span aria-hidden="true" className="font-semibold">{tone === "error" ? "!" : "✓"}</span>
        <p className="min-w-0 flex-1 break-words">{message}</p>
        <button
          type="button"
          aria-label={t("product_save_feedback_close")}
          onClick={close}
          className="-m-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}
