"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import { ProductOptionSelector } from "./ProductOptionSelector";

export function VariantPickerDialog({
  lineId,
  busy,
  onConfirm,
  onClose,
}: {
  lineId: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { primaryDerived } = usePdpPurchase();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="variant-picker-title"
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-card p-5 shadow-xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="variant-picker-title" className="text-xl font-semibold text-ink">
              Confirm your options
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              Check the selected options before continuing.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close options"
            onClick={onClose}
            disabled={busy}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-lg text-ink"
          >
            ✕
          </button>
        </div>

        <ProductOptionSelector lineId={lineId} instanceId="dialog" />

        {primaryDerived.resolvedVariant && (
          <p className="mt-5 text-sm text-ink-secondary">
            {primaryDerived.resolvedVariant.name}
            {primaryDerived.availableInventory <= 0 ? " · Out of stock" : ""}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy || primaryDerived.resolvedVariant === null}
            className="flex-1"
          >
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
