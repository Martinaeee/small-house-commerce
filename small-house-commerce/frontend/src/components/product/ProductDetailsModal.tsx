// src/components/product/ProductDetailsModal.tsx
"use client";

import { useEffect, useMemo, useRef, type ReactNode, type TouchEvent } from "react";
import type { Product } from "@/lib/api";
import { emitCommerceEvent, optionSelectEvent } from "@/lib/commerce-events";
import { isCompatibleValue, isSelectableVariant } from "@/lib/product-selection";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import {
  analyzePdpSpecifications,
  formatLength,
  pdpBasisLabel,
  pdpFieldGroup,
  pdpFoldedGuideEntries,
  pdpSizeGuideRows,
  type PdpFoldedEntry,
  type PdpSpecModel,
  type PdpSizeGuideRow,
} from "./pdp-specification-display";

const SUBHEADING =
  "mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted first:mt-0";
const POLICY_ROW = "flex justify-between gap-4 border-b border-border py-2 last:border-0";
const POLICY_LABEL = "text-sm text-ink-secondary";
const POLICY_VALUE = "text-right text-sm font-medium text-ink";
const GUIDE_CELL = "border-b border-border px-1.5 py-2.5 text-left align-top text-sm text-ink first:pl-0 whitespace-pre-line";
const GUIDE_HEAD = "border-b border-border px-1.5 py-2.5 text-left align-top text-xs text-ink-muted first:pl-0";

const FOLDED_AXES = [
  { index: 0, label: "Width" },
  { index: 2, label: "Folded height" },
  { index: 1, label: "Folded depth" },
] as const;

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="border-b border-border py-4 last:border-0 [&_summary]:cursor-pointer"
    >
      <summary className="flex list-none items-center justify-between text-base font-semibold text-ink">
        {title}
        <span className="text-ink-muted">⌄</span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

function GuideTable({
  rows,
  model,
  chosenId,
}: {
  rows: PdpSizeGuideRow[];
  model: PdpSpecModel;
  chosenId: string | null;
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th scope="col" className={GUIDE_HEAD}>
            Variant
          </th>
          <th scope="col" className={GUIDE_HEAD}>
            Dimensions (in)
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const selected = chosenId !== null && row.memberIds.includes(chosenId);
          return (
            <tr key={row.memberIds.join(",")} data-selection={selected ? "selected" : undefined}>
              <th scope="row" className={`${GUIDE_CELL} font-semibold`}>
                <span className="block">{row.labels.join(" · ")}</span>
                {selected && (
                  <span className="mt-0.5 block text-xs font-normal text-ink-muted">
                    Selected
                  </span>
                )}
              </th>
              <td className={GUIDE_CELL}>{model.formatCell(row.cell)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FoldedBlock({ entries }: { entries: PdpFoldedEntry[] }) {
  return (
    <div data-block="folded">
      {entries.map((entry) => (
        <div key={entry.label ?? "product"}>
          {entry.label && (
            <h4 className="mb-1 mt-3 text-sm font-semibold text-ink">{entry.label}</h4>
          )}
          <dl>
            {FOLDED_AXES.map((axis) => (
              <div key={axis.label} className={POLICY_ROW}>
                <dt className={POLICY_LABEL}>{axis.label}</dt>
                <dd className={POLICY_VALUE}>{formatLength(entry.values[axis.index])}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function WeightBlock({
  product,
  model,
  chosenId,
}: {
  product: Product;
  model: PdpSpecModel;
  chosenId: string | null;
}) {
  const field = model.fields.find((candidate) => candidate.key === "weight");
  if (!field || field.classification === "D") return null;

  if (field.classification === "A") {
    return (
      <div>
        <h3 className={SUBHEADING}>Weight</h3>
        <dl>
          <div className={POLICY_ROW} data-field="weight">
            <dt className={POLICY_LABEL}>{field.label}</dt>
            <dd className={POLICY_VALUE}>{model.formatCell(field.cell)}</dd>
          </div>
        </dl>
      </div>
    );
  }

  const group = pdpFieldGroup(model, "weight");
  if (!group) return null;

  return (
    <div>
      <h3 className={SUBHEADING}>Weight</h3>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th scope="col" className={GUIDE_HEAD}>
              {pdpBasisLabel(product, group.basis)}
            </th>
            <th scope="col" className={GUIDE_HEAD}>
              {field.label}
            </th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => {
            const selected = chosenId !== null && row.memberIds.includes(chosenId);
            return (
              <tr key={row.memberIds.join(",")} data-selection={selected ? "selected" : undefined}>
                <th scope="row" className={`${GUIDE_CELL} font-semibold`}>
                  <span className="block">{row.labels.join(" · ")}</span>
                  {selected && (
                    <span className="mt-0.5 block text-xs font-normal text-ink-muted">
                      Selected
                    </span>
                  )}
                </th>
                <td className={GUIDE_CELL} data-field="weight">
                  {model.formatCell(row.cells.weight)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProductDetailsModal({
  product,
  onClose,
  preview = false,
}: {
  product: Product;
  onClose: () => void;
  preview?: boolean;
}) {
  const {
    primaryLine,
    primaryDerived,
    purchaseLocked,
    selectOption,
    changeLineVariant,
  } = usePdpPurchase();
  const model = useMemo(() => analyzePdpSpecifications(product), [product]);
  const guideRows = useMemo(() => pdpSizeGuideRows(product), [product]);
  const folded = useMemo(() => pdpFoldedGuideEntries(product), [product]);

  const selectedValueIds = primaryLine.selectedValueIds;
  const chosen = model.rows.find((row) => row.id === primaryDerived.resolvedVariant?.id) ?? null;

  const colorOption = product.options.find((option) => option.kind === "COLOR");
  const selectableVariants = product.variants.filter(isSelectableVariant);
  const missingOption = product.options.find((option) =>
    primaryDerived.missingOptionIds.includes(option.id),
  );
  const selectionHint = chosen
    ? `Selected configuration: ${chosen.name}`
    : missingOption
      ? `Choose a ${pdpBasisLabel(product, [missingOption.id]).toLowerCase()} to complete your selection.`
      : "This combination is not available.";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Mobile swipe-down-to-close (spec §5). The gesture lives on the grab bar
  // only, so the scrollable accordion content keeps normal touch scrolling.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const snapTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(snapTimerRef.current), []);

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    // A re-grab inside the snap-back window must not let its cleanup strip
    // the transform mid-drag.
    window.clearTimeout(snapTimerRef.current);
    dragStartYRef.current = e.touches[0].clientY;
    const panel = sheetRef.current;
    if (panel) panel.style.transition = "none";
  };

  const handleTouchCancel = () => {
    dragStartYRef.current = null;
    const panel = sheetRef.current;
    if (panel) panel.style.transform = "";
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    if (e.touches.length !== 1) {
      handleTouchCancel();
      return;
    }
    const dy = Math.max(0, e.touches[0].clientY - dragStartYRef.current);
    const panel = sheetRef.current;
    if (panel) panel.style.transform = `translateY(${dy}px)`;
  };

  const snapBack = () => {
    const panel = sheetRef.current;
    if (!panel) return;
    panel.style.transition = "transform 200ms ease";
    panel.style.transform = "translateY(0px)";
    window.clearTimeout(snapTimerRef.current);
    snapTimerRef.current = window.setTimeout(() => {
      panel.style.transition = "";
      panel.style.transform = "";
    }, 200);
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const startY = dragStartYRef.current;
    dragStartYRef.current = null;
    const dy = Math.max(0, e.changedTouches[0].clientY - startY);
    if (dy >= 80) {
      onClose();
    } else {
      snapBack();
    }
  };

  const hasDetails = Boolean(product.description?.trim()) || Boolean(colorOption?.values.length) ||
    model.fields.some((field) => field.key === "weight" && field.classification !== "D");
  const chosenId = chosen?.id ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Product details"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl bg-background sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile swipe-down affordance (spec §5); gesture is bound to the bar. */}
        <div className="flex justify-center pt-3 sm:hidden">
          <div
            aria-hidden="true"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            className="h-1 w-10 shrink-0 cursor-grab touch-none rounded-full bg-border active:cursor-grabbing"
          />
        </div>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">Product details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product details"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-ink-secondary hover:bg-border/50"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-6">
          {(guideRows.length > 0 || folded.length > 0) && (
            <Section title="Dimensions" defaultOpen>
              {guideRows.length > 0 && (
                <>
                  <h3 className={SUBHEADING}>Product size</h3>
                  <GuideTable rows={guideRows} model={model} chosenId={chosenId} />
                </>
              )}
              {folded.length > 0 && (
                <>
                  <h3 className={SUBHEADING}>Folded size</h3>
                  <FoldedBlock entries={folded} />
                </>
              )}
              <p className="mt-3 text-xs text-ink-muted">
                Measurements may vary slightly. Measure your doorway before delivery.
              </p>
            </Section>
          )}

          {hasDetails && <Section title="Details">
            {product.description && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
                {product.description}
              </p>
            )}
            <WeightBlock product={product} model={model} chosenId={chosenId} />
            {colorOption && (
              <div>
                <h3 className={SUBHEADING}>{pdpBasisLabel(product, [colorOption.id])}</h3>
                <div
                  role="group"
                  aria-label={pdpBasisLabel(product, [colorOption.id])}
                  className="flex flex-wrap gap-2"
                >
                  {[...colorOption.values]
                    .sort(
                      (left, right) =>
                        left.position - right.position || left.id.localeCompare(right.id),
                    )
                    .map((value) => {
                      const selected = selectedValueIds[colorOption.id] === value.id;
                      const compatible = isCompatibleValue(
                        product.options,
                        selectableVariants,
                        selectedValueIds,
                        colorOption.id,
                        value.id,
                      );
                      return (
                        <button
                          key={value.id}
                          type="button"
                          disabled={purchaseLocked || !compatible}
                          aria-pressed={selected}
                          aria-label={value.label}
                          title={
                            compatible
                              ? undefined
                              : `${value.label} is unavailable with your current options`
                          }
                          onClick={() => {
                            if (!preview && !selected) {
                              emitCommerceEvent(
                                optionSelectEvent({
                                  productId: product.id,
                                  optionKind: colorOption.kind,
                                  optionValueId: value.id,
                                  selectionSource: "USER",
                                }),
                              );
                            }
                            const invalidatesConfirmedPrimary =
                              primaryDerived.purchaseConfirmed && !selected;
                            selectOption(primaryLine.clientLineId, colorOption.id, value.id);
                            if (invalidatesConfirmedPrimary) {
                              changeLineVariant(primaryLine.clientLineId);
                            }
                          }}
                          className={`inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            selected
                              ? "border-cta bg-primary-light/40 text-cta"
                              : "border-border bg-card text-ink hover:border-primary"
                          }`}
                        >
                          {value.label}
                        </button>
                      );
                    })}
                </div>
                <p className="mt-2.5 text-xs text-ink-muted">{selectionHint}</p>
              </div>
            )}
          </Section>}

          <Section title="Delivery, warranty and returns">
            <dl>
              <div className={POLICY_ROW}>
                <dt className={POLICY_LABEL}>Delivery</dt>
                <dd className={POLICY_VALUE}>
                  Metro Manila 3–5 days, provinces 5–7 days
                </dd>
              </div>
              <div className={POLICY_ROW}>
                <dt className={POLICY_LABEL}>Payment</dt>
                <dd className={POLICY_VALUE}>Cash on Delivery</dd>
              </div>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
