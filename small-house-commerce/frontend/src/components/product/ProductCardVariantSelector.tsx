"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StorefrontOptionValue, StorefrontProductOption, StorefrontProductVariant } from "@/lib/api";
import { collapseCardOptions } from "@/lib/product-card-options";
import { comparePositionThenId, isCompatibleValue, isOutOfStockOnly, isSelectableVariant } from "@/lib/product-selection";
import { emitCommerceEvent, optionSelectEvent } from "@/lib/commerce-events";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import { ProductCardOptionPanel } from "./ProductCardOptionPanel";

const choiceClass = "relative inline-flex h-7 min-w-7 max-w-28 shrink-0 items-center justify-center rounded-sm border text-xs font-medium";

function isVisualChoice(option: StorefrontProductOption, value: StorefrontOptionValue) {
  return option.presentation === "SWATCH" || (option.presentation === "IMAGE" && Boolean(value.thumbnailUrl));
}

function ValueVisual({ option, value }: { option: StorefrontProductOption; value: StorefrontOptionValue }) {
  if (option.presentation === "SWATCH") return null;
  if (option.presentation === "IMAGE" && value.thumbnailUrl) return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={value.thumbnailUrl} alt="" className="h-full w-full rounded-[inherit] object-cover" />
  );
  return <span className="min-w-0 truncate">{value.label}</span>;
}

function OptionRow({ option, productOptions, variants, selectedValueIds, disabled, onSelect }: {
  option: StorefrontProductOption;
  productOptions: readonly StorefrontProductOption[];
  variants: readonly StorefrontProductVariant[];
  selectedValueIds: Readonly<Record<string, string>>;
  disabled: boolean;
  onSelect(optionId: string, valueId: string): void;
}) {
  const values = useMemo(() => [...option.values].sort(comparePositionThenId), [option.values]);
  const rootRef = useRef<HTMLDivElement>(null);
  const measurementsRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [measurements, setMeasurements] = useState<{ width: number; widths: Record<string, number>; more: number } | null>(null);
  const selectedValueId = selectedValueIds[option.id];
  const selected = values.find(value => value.id === selectedValueId);
  const hasAdditionalOptions = productOptions.length > 1;
  const estimatedWidths = Object.fromEntries(values.map(value => [value.id,
    isVisualChoice(option, value) ? 28 : Math.max(28, Math.min(112, value.label.length * 7 + 18)),
  ]));

  useEffect(() => {
    const root = rootRef.current;
    const measurementsRoot = measurementsRef.current;
    if (!root || !measurementsRoot) return;
    const measure = () => {
      const width = root.getBoundingClientRect().width;
      if (width <= 0) return;
      const widths = Object.fromEntries([...measurementsRoot.querySelectorAll<HTMLElement>("[data-card-value-measure]")]
        .map(node => [node.dataset.cardValueMeasure!, node.getBoundingClientRect().width]));
      const more = Math.max(...[...measurementsRoot.querySelectorAll<HTMLElement>("[data-card-more-measure]")].map(node => node.getBoundingClientRect().width));
      setMeasurements({ width, widths, more });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, [values, option.presentation, hasAdditionalOptions]);

  const widths = measurements?.widths ?? estimatedWidths;
  const available = measurements?.width ?? 160;
  const moreWidth = measurements?.more ?? 44;
  const { visibleValues, hiddenCount } = collapseCardOptions(values, selectedValueId, widths, available, moreWidth, 4, hasAdditionalOptions);
  const hasMore = hiddenCount > 0 || hasAdditionalOptions;
  const narrowSelected = hasMore && visibleValues.length === 1 && selected !== undefined &&
    visibleValues[0]!.id === selected.id && (widths[selected.id] ?? 28) + moreWidth + 4 > available;

  return <fieldset data-option-id={option.id} className="relative min-w-0">
    <legend className="sr-only">{option.name}: {selected?.label ?? `Choose ${option.name}`}</legend>
    <div ref={rootRef} role="group" aria-label={option.name} className="flex min-w-0 items-center gap-1">
      {visibleValues.map(value => {
        if (narrowSelected) return <span key={value.id} title={value.label} className="min-w-0 flex-1 truncate text-xs font-medium text-cta">{value.label}</span>;
        const compatible = isCompatibleValue(productOptions, variants, selectedValueIds, option.id, value.id);
        const outOfStock = compatible && isOutOfStockOnly(productOptions, variants, selectedValueIds, option.id, value.id);
        const visual = isVisualChoice(option, value);
        const pressed = selectedValueId === value.id;
        return <button key={value.id} type="button" aria-label={value.label} aria-pressed={pressed}
          disabled={disabled || !compatible} onClick={() => { if (!disabled && compatible) onSelect(option.id, value.id); }}
          title={!compatible ? `${value.label} is unavailable with your current options` : outOfStock ? `${value.label} is out of stock` : value.label}
          style={option.presentation === "SWATCH" ? { backgroundColor: value.swatchHex ?? "transparent" } : undefined}
          className={`${choiceClass} ${visual ? "w-7 p-0" : "px-2"} focus-visible:outline-2 focus-visible:outline-cta disabled:cursor-not-allowed disabled:opacity-40 ${pressed ? visual ? "border-card ring-2 ring-cta ring-offset-1" : "border-cta bg-primary-light/40 text-cta" : "border-border bg-card text-ink hover:border-primary"}`}>
          <ValueVisual option={option} value={value} />
          {outOfStock ? <span className="absolute bottom-0 right-0 rounded-sm bg-card/90 px-0.5 text-[9px] text-sale" aria-hidden="true">×</span> : null}
        </button>;
      })}
      {hasMore ? <button ref={moreRef} type="button" aria-haspopup="dialog" aria-expanded={open}
        aria-label={hasAdditionalOptions ? "More options" : `More ${option.name} options`} disabled={disabled} onClick={() => setOpen(true)}
        className={`${choiceClass} border-border px-2 text-ink hover:border-primary focus-visible:outline-2 focus-visible:outline-cta disabled:cursor-not-allowed disabled:opacity-40`}>{hiddenCount > 0 ? `+${hiddenCount}` : "More"}</button> : null}
    </div>
    <div ref={measurementsRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex h-0 gap-1 overflow-hidden">
      {values.map(value => <span key={value.id} data-card-value-measure={value.id} className={`${choiceClass} ${isVisualChoice(option, value) ? "w-7 p-0" : "px-2"}`}><ValueVisual option={option} value={value} /></span>)}
      <span data-card-more-measure className={`${choiceClass} px-2`}>+{values.length}</span>
      {hasAdditionalOptions ? <span data-card-more-measure className={`${choiceClass} px-2`}>More</span> : null}
    </div>
    {open ? <ProductCardOptionPanel open variants={variants} productOptions={productOptions}
      selectedValueIds={selectedValueIds} disabled={disabled} triggerRef={moreRef} onSelect={onSelect} onClose={() => setOpen(false)} /> : null}
  </fieldset>;
}

export function ProductCardVariantSelector({ lineId, disabled = false, preview = false }: { lineId: string; disabled?: boolean; preview?: boolean }) {
  const { product, orderLines, primaryDerived, purchaseLocked, selectOption, changeLineVariant } = usePdpPurchase();
  const line = orderLines.find(row => row.clientLineId === lineId);
  const variants = preview ? product.variants : product.variants.filter(isSelectableVariant);
  if (!line || variants.length <= 1) return null;
  const previewVariant = preview ? variants.find(row => row.id === product.cardMedia?.displayVariantId) : undefined;
  const selectedValueIds = previewVariant ? Object.fromEntries(product.options.flatMap(option => {
    const selected = option.values.find(value => previewVariant.optionValueIds.includes(value.id));
    return selected ? [[option.id, selected.id]] : [];
  })) : line.selectedValueIds;
  const options = [...product.options].sort(comparePositionThenId);
  const primary = options.find(option => option.kind === "COLOR") ?? options[0];
  if (!primary) return null;
  const busy = disabled || preview || purchaseLocked;
  return <OptionRow key={primary.id} option={primary} productOptions={product.options}
    variants={variants} selectedValueIds={selectedValueIds} disabled={busy}
    onSelect={(optionId, valueId) => {
      const option = product.options.find(row => row.id === optionId);
      if (!option || busy || !isCompatibleValue(product.options, variants, line.selectedValueIds, optionId, valueId)) return;
      const changed = line.selectedValueIds[optionId] !== valueId;
      selectOption(lineId, optionId, valueId);
      if (changed && line === orderLines[0] && primaryDerived.purchaseConfirmed) changeLineVariant(lineId);
      if (changed) emitCommerceEvent(optionSelectEvent({ productId: product.id, optionKind: option.kind, optionValueId: valueId, selectionSource: "USER" }));
    }} />;
}
