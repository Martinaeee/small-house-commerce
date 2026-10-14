"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { StorefrontProductOption, StorefrontProductVariant } from "@/lib/api";
import { comparePositionThenId, isCompatibleValue, isOutOfStockOnly } from "@/lib/product-selection";

export interface ProductCardOptionPanelProps {
  open: boolean;
  variants: readonly StorefrontProductVariant[];
  productOptions: readonly StorefrontProductOption[];
  selectedValueIds: Readonly<Record<string, string>>;
  disabled: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onSelect(optionId: string, valueId: string): void;
  onClose(): void;
}

export function ProductCardOptionPanel({ open, variants, productOptions, selectedValueIds,
  disabled, triggerRef, onSelect, onClose }: ProductCardOptionPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [query, setQuery] = useState("");
  const multiple = productOptions.length > 1;
  const groups = [...productOptions].sort(comparePositionThenId).map(option => ({
    option, values: [...option.values].sort(comparePositionThenId).filter(value => value.label.toLowerCase().includes(query.trim().toLowerCase())),
  }));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const trigger = triggerRef.current;
    const triggerGroup = trigger?.parentElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    const position = () => {
      const anchor = trigger?.getBoundingClientRect();
      const panelWidth = Math.min(360, window.innerWidth - 24);
      const height = dialog.getBoundingClientRect().height;
      const left = Math.max(12, Math.min(anchor?.left ?? 12, window.innerWidth - panelWidth - 12));
      const below = (anchor?.bottom ?? 12) + 8;
      const top = Math.max(12, Math.min(below, window.innerHeight - height - 12));
      dialog.style.setProperty("--panel-left", `${left}px`);
      dialog.style.setProperty("--panel-top", `${top}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(dialog);
    window.addEventListener("resize", position);
    dialog.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      dialog.close();
      document.body.style.overflow = previousOverflow;
      const returnTarget = trigger?.isConnected ? trigger : triggerGroup?.isConnected
        ? triggerGroup.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)') ?? triggerGroup.querySelector<HTMLButtonElement>("button:not(:disabled)")
        : null;
      returnTarget?.focus({ preventScroll: true });
    };
  }, [open, triggerRef]);

  if (!open) return null;
  return <dialog ref={dialogRef} aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}
    className="fixed bottom-0 left-0 top-auto m-0 max-h-[80dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-card p-4 text-ink shadow-xl backdrop:bg-black/30 sm:bottom-auto sm:left-[var(--panel-left)] sm:top-[var(--panel-top)] sm:w-[min(360px,calc(100vw-24px))] sm:rounded-xl sm:backdrop:bg-transparent">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 id={headingId} className="text-sm font-semibold">{multiple ? "Product options" : `${productOptions[0]?.name ?? "Product"} options`}</h3>
      <button type="button" aria-label="Close options" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-primary-light/40 focus-visible:outline-2 focus-visible:outline-cta">×</button>
    </div>
    {productOptions.some(option => option.values.length >= 12) ? <div className="mb-3 flex gap-2">
      <input type="search" aria-label="Search options" placeholder="Search options" value={query} onChange={event => setQuery(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-sm" />
      {query ? <button type="button" aria-label="Clear search" className="min-h-11 rounded-lg px-2 text-sm text-cta" onClick={() => setQuery("")}>Clear</button> : null}
    </div> : null}
    <div className="space-y-4">
      {groups.filter(group => group.values.length > 0).map(({ option, values }) => <div key={option.id}>
        {multiple ? <h4 className="mb-2 text-xs font-semibold">{option.name}: {option.values.find(value => value.id === selectedValueIds[option.id])?.label ?? `Choose ${option.name}`}</h4> : null}
        <div role="group" aria-label={`${option.name} options`} className="flex flex-col gap-2">
          {values.map(value => {
            const compatible = isCompatibleValue(productOptions, variants, selectedValueIds, option.id, value.id);
            const outOfStock = compatible && isOutOfStockOnly(productOptions, variants, selectedValueIds, option.id, value.id);
            const selected = selectedValueIds[option.id] === value.id;
            return <button key={value.id} type="button" aria-label={value.label} aria-pressed={selected}
              disabled={disabled || !compatible} onClick={() => { if (disabled || !compatible) return; onSelect(option.id, value.id); if (!multiple) onClose(); }}
              title={!compatible ? `${value.label} is unavailable with your current options` : outOfStock ? `${value.label} is out of stock` : undefined}
              className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cta ${selected ? "border-cta bg-primary-light/40" : "border-border hover:border-primary"}`}>
              {option.presentation === "SWATCH" ? <span aria-hidden="true" className="h-7 w-7 shrink-0 rounded-sm border border-black/15" style={{ backgroundColor: value.swatchHex ?? "transparent" }} /> : null}
              {option.presentation === "IMAGE" && value.thumbnailUrl ?
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={value.thumbnailUrl} alt={value.thumbnailAlt ?? ""} className="h-7 w-7 shrink-0 rounded-sm object-cover" /> : null}
              <span className="min-w-0 flex-1 break-words whitespace-normal">{value.label}</span>
              {outOfStock ? <span className="shrink-0 text-xs text-sale">Out of stock</span> : null}
            </button>;
          })}
        </div>
      </div>)}
      {groups.every(group => group.values.length === 0) ? <p className="py-4 text-sm text-ink-muted">No matching options</p> : null}
    </div>
    {multiple ? <button type="button" onClick={onClose} className="mt-4 min-h-11 w-full rounded-lg bg-cta px-3 text-sm font-semibold text-cta-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta">Done</button> : null}
  </dialog>;
}
