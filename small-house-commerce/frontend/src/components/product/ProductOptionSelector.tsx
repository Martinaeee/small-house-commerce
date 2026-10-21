"use client";

import type {
  StorefrontProductOption,
  StorefrontOptionValue,
} from "@/lib/api";
import { isCompatibleValue, isOutOfStockOnly, isSelectableVariant } from "@/lib/product-selection";
import { emitCommerceEvent, optionSelectEvent } from "@/lib/commerce-events";
import { usePdpPurchase } from "./PdpPurchaseProvider";

function ValueVisual({
  option,
  value,
  compact,
}: {
  option: StorefrontProductOption;
  value: StorefrontOptionValue;
  compact: boolean;
}) {
  if (option.presentation === "IMAGE" && value.thumbnailUrl) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value.thumbnailUrl}
          alt={value.thumbnailAlt ?? value.label}
          className={compact ? "h-8 w-8 shrink-0 rounded-md object-cover" : "h-12 w-12 rounded-md object-cover"}
        />
        <span className={compact ? "min-w-0 break-words" : undefined}>{value.label}</span>
      </>
    );
  }
  if (option.presentation === "SWATCH") {
    return (
      <>
        <span
          aria-hidden="true"
          className="h-5 w-5 rounded-full border border-black/15"
          style={{ backgroundColor: value.swatchHex ?? "transparent" }}
        />
        <span className={compact ? "min-w-0 break-words" : undefined}>{value.label}</span>
      </>
    );
  }
  return <span className={compact ? "min-w-0 break-words" : undefined}>{value.label}</span>;
}

export function ProductOptionSelector({
  lineId,
  instanceId,
  preview = false,
  density = "regular",
  disabled = false,
}: {
  lineId: string;
  instanceId?: string;
  preview?: boolean;
  density?: "regular" | "compact";
  disabled?: boolean;
}) {
  const {
    product,
    orderLines,
    primaryDerived,
    purchaseLocked,
    selectOption,
    changeLineVariant,
  } = usePdpPurchase();
  const line = orderLines.find((candidate) => candidate.clientLineId === lineId);
  if (!line) return null;

  const variants = product.variants.filter(isSelectableVariant);
  if (variants.length === 0 || (variants.length === 1 && primaryDerived.resolvedVariant !== null)) return null;

  const options = [...product.options].sort(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );

  const compact = density === "compact";
  return (
    <div className={`flex min-w-0 flex-col ${compact ? "gap-2" : "gap-4"}`} data-selector-instance={instanceId}>
      {options.map((option) => {
        const selectedValueId = line.selectedValueIds[option.id];
        const selectedLabel = option.values.find(
          ({ id }) => id === selectedValueId,
        )?.label;
        const missing = primaryDerived.missingOptionIds.includes(option.id);
        return (
          <fieldset key={option.id} data-option-id={option.id} className="flex min-w-0 flex-col gap-2">
            <legend className={`${compact ? "text-xs" : "text-sm"} font-medium text-ink-secondary`}>
              {option.name}: {selectedLabel ?? `Choose ${option.name}`}
            </legend>
            <div
              role="group"
              aria-label={option.name}
              className="flex flex-wrap gap-2"
            >
              {[...option.values]
                .sort(
                  (left, right) =>
                    left.position - right.position || left.id.localeCompare(right.id),
                )
                .map((value) => {
                  const compatible = isCompatibleValue(
                    product.options,
                    variants,
                    line.selectedValueIds,
                    option.id,
                    value.id,
                  );
                  const outOfStock =
                    compatible &&
                    isOutOfStockOnly(
                      product.options,
                      variants,
                      line.selectedValueIds,
                      option.id,
                      value.id,
                    );
                  const selected = selectedValueId === value.id;
                  return (
                    <button
                      key={value.id}
                      type="button"
                      onClick={() => {
                        if (disabled || purchaseLocked || !compatible) return;
                        // option_select is the engagement event for an actual
                        // option change on the shared purchase island (PDP,
                        // Quick Add, cart Change Options) — never a conversion.
                        if (!preview && selectedValueId !== value.id) {
                          emitCommerceEvent(
                            optionSelectEvent({
                              productId: product.id,
                              optionKind: option.kind,
                              optionValueId: value.id,
                              selectionSource: "USER",
                            }),
                          );
                        }
                        const invalidatesConfirmedPrimary =
                          line === orderLines[0] &&
                          primaryDerived.purchaseConfirmed &&
                          line.selectedValueIds[option.id] !== value.id;
                        selectOption(lineId, option.id, value.id);
                        if (invalidatesConfirmedPrimary) {
                          changeLineVariant(lineId);
                        }
                      }}
                      disabled={disabled || purchaseLocked || !compatible}
                      aria-pressed={selected}
                      aria-label={value.label}
                      title={
                        !compatible
                          ? `${value.label} is unavailable with your current options`
                          : outOfStock
                            ? `${value.label} is out of stock`
                            : undefined
                      }
                      className={`inline-flex min-h-11 items-center gap-2 rounded-lg border ${compact ? "max-w-full px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"} font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        selected
                          ? "border-cta bg-primary-light/40 text-cta"
                          : "border-border bg-card text-ink hover:border-primary"
                      }`}
                    >
                      <ValueVisual option={option} value={value} compact={compact} />
                      {outOfStock && (
                        <span className="text-xs text-sale">Out of stock</span>
                      )}
                    </button>
                  );
                })}
            </div>
            {missing && line.explicitlyTouchedOptionIds.length > 0 && (
              <p className="text-xs text-sale">Choose {option.name}</p>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
