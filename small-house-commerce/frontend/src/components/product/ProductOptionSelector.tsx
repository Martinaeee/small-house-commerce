"use client";

import type {
  StorefrontProductOption,
  StorefrontOptionValue,
  StorefrontProductVariant,
} from "@/lib/api";
import { usePdpPurchase } from "./PdpPurchaseProvider";

function isSelectable(variant: StorefrontProductVariant): boolean {
  return variant.sku?.status === "ACTIVE" && variant.sku.price !== null;
}

function isCompatibleValue(
  productOptions: readonly StorefrontProductOption[],
  variants: readonly StorefrontProductVariant[],
  selectedValueIds: Readonly<Record<string, string>>,
  optionId: string,
  valueId: string,
): boolean {
  const selectedOption = productOptions.find(({ id }) => id === optionId);
  return variants.some((variant) => {
    const values = new Set(variant.optionValueIds);
    if (!values.has(valueId)) return false;
    return productOptions.every((option) => {
      if (
        option.id === optionId ||
        !selectedOption ||
        option.position >= selectedOption.position
      ) {
        return true;
      }
      const selected = selectedValueIds[option.id];
      return selected === undefined || values.has(selected);
    });
  });
}

function isOutOfStockOnly(
  productOptions: readonly StorefrontProductOption[],
  variants: readonly StorefrontProductVariant[],
  selectedValueIds: Readonly<Record<string, string>>,
  optionId: string,
  valueId: string,
): boolean {
  const selectedOption = productOptions.find(({ id }) => id === optionId);
  const matches = variants.filter((variant) => {
    const values = new Set(variant.optionValueIds);
    if (!values.has(valueId)) return false;
    return productOptions.every((option) => {
      if (
        option.id === optionId ||
        !selectedOption ||
        option.position >= selectedOption.position
      ) {
        return true;
      }
      const selected = selectedValueIds[option.id];
      return selected === undefined || values.has(selected);
    });
  });
  return (
    matches.length > 0 &&
    matches.every((variant) => (variant.sku?.availableInventory ?? 0) <= 0)
  );
}

function ValueVisual({
  option,
  value,
}: {
  option: StorefrontProductOption;
  value: StorefrontOptionValue;
}) {
  if (option.presentation === "IMAGE" && value.thumbnailUrl) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value.thumbnailUrl}
          alt={value.thumbnailAlt ?? value.label}
          className="h-12 w-12 rounded-md object-cover"
        />
        <span>{value.label}</span>
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
        <span>{value.label}</span>
      </>
    );
  }
  return <span>{value.label}</span>;
}

export function ProductOptionSelector({
  lineId,
  instanceId,
}: {
  lineId: string;
  instanceId?: string;
}) {
  const {
    product,
    orderLines,
    primaryDerived,
    selectOption,
    changeLineVariant,
  } = usePdpPurchase();
  const line = orderLines.find((candidate) => candidate.clientLineId === lineId);
  if (!line) return null;

  const variants = product.variants.filter(isSelectable);
  if (variants.length <= 1) return null;

  const options = [...product.options].sort(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );

  return (
    <div className="flex flex-col gap-4" data-selector-instance={instanceId}>
      {options.map((option) => {
        const selectedValueId = line.selectedValueIds[option.id];
        const selectedLabel = option.values.find(
          ({ id }) => id === selectedValueId,
        )?.label;
        const missing = primaryDerived.missingOptionIds.includes(option.id);
        return (
          <fieldset key={option.id} className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink-secondary">
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
                        const invalidatesConfirmedPrimary =
                          line === orderLines[0] &&
                          primaryDerived.purchaseConfirmed &&
                          line.selectedValueIds[option.id] !== value.id;
                        selectOption(lineId, option.id, value.id);
                        if (invalidatesConfirmedPrimary) {
                          changeLineVariant(lineId);
                        }
                      }}
                      disabled={!compatible}
                      aria-pressed={selected}
                      aria-label={value.label}
                      title={
                        !compatible
                          ? `${value.label} is unavailable with your current options`
                          : outOfStock
                            ? `${value.label} is out of stock`
                            : undefined
                      }
                      className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        selected
                          ? "border-cta bg-primary-light/40 text-cta"
                          : "border-border bg-card text-ink hover:border-primary"
                      }`}
                    >
                      <ValueVisual option={option} value={value} />
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
