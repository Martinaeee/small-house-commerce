"use client";

import { useId } from "react";

import type {
  StorefrontProductOption,
  StorefrontOptionValue,
  StorefrontProductVariant,
  Product,
} from "@/lib/api";
import { emitCommerceEvent, optionSelectEvent } from "@/lib/commerce-events";
import { resolveSkuProductDimensions } from "./pdp-facts";
import { formatCentimeters } from "./pdp-specification-display";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import { optimizedUploadImage } from "@/lib/image-url";

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
          src={optimizedUploadImage(value.thumbnailUrl, 96)}
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

/** Separate an explicit measurement suffix only when a real size is displayed. */
function sizeCardName(label: string): string {
  return label.replace(/\s*·\s*\d+(?:\.\d+)?\s*(?:cm|mm|in|m)\s*$/i, "").trim();
}

interface SizeCardMeasurement {
  name: string;
  dimension: string | null;
}

/** Never guess a SKU while other choices are incomplete or incompatible. */
function sizeCardMeasurements(
  product: Pick<Product, "width" | "depth" | "height">,
  variants: readonly StorefrontProductVariant[],
  option: StorefrontProductOption,
  selectedValueIds: Readonly<Record<string, string>>,
): Map<string, SizeCardMeasurement> {
  const axes = [
    { key: "width", letter: "W" },
    { key: "height", letter: "H" },
    { key: "depth", letter: "D" },
  ] as const;
  const rows = option.values.map((value) => {
    const candidates = variants.filter((candidate) =>
      candidate.optionValueIds.includes(value.id) &&
      Object.entries(selectedValueIds).every(
        ([optionId, valueId]) =>
          optionId === option.id || candidate.optionValueIds.includes(valueId),
      ),
    );
    const dimensions = candidates.map((candidate) =>
      candidate.sku?.specificationSource === "BUNDLE_COMPONENTS"
        ? { width: null, height: null, depth: null }
        : resolveSkuProductDimensions(product, candidate.sku),
    );
    const first = dimensions[0];
    const dims = first && dimensions.every((other) =>
      axes.every(({ key }) => other[key] === first[key]),
    ) ? first : { width: null, height: null, depth: null };
    return { value, dims };
  });
  const varyingAxes = axes.filter(({ key }) =>
    new Set(rows.map(({ dims }) => dims[key])).size > 1,
  );
  const displayedAxes = varyingAxes.length ? varyingAxes : axes;

  return new Map(rows.map(({ value, dims }) => {
    const parts = displayedAxes.flatMap(({ key, letter }) => {
      const cm = dims[key];
      return cm == null ? [] : [
        `${formatCentimeters(cm)}${displayedAxes.length > 1 ? letter : ""}`,
      ];
    });
    const dimension = parts.length ? `${parts.join(" × ")} cm` : null;
    return [value.id, {
      name: dimension ? sizeCardName(value.label) : value.label,
      dimension,
    }];
  }));
}

export function ProductOptionSelector({
  lineId,
  instanceId,
  preview = false,
  sizeCards = false,
}: {
  lineId: string;
  instanceId?: string;
  preview?: boolean;
  /** PDP-only compact image cards for SIZE options with real thumbnails. */
  sizeCards?: boolean;
}) {
  const selectorId = useId();
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

  const variants = product.variants.filter(isSelectable);
  if (variants.length === 0 || (variants.length === 1 && primaryDerived.resolvedVariant !== null)) return null;

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
        const sortedValues = [...option.values].sort(
          (left, right) =>
            left.position - right.position || left.id.localeCompare(right.id),
        );
        const asSizeCards =
          sizeCards &&
          option.kind === "SIZE" &&
          sortedValues.length > 0 &&
          sortedValues.every((value) => value.thumbnailUrl);
        const measurements = asSizeCards
          ? sizeCardMeasurements(
              product,
              variants,
              option,
              line.selectedValueIds,
            )
          : null;
        // The legend repeats the size card's display name, so an operator
        // label that carries its own measurement suffix ("Tall · 121.5 cm")
        // cannot contradict the centimetre dimension printed on the card.
        const selectedDisplayName = selectedValueId
          ? measurements?.get(selectedValueId)?.name ?? selectedLabel
          : selectedLabel;
        return (
          <fieldset key={option.id} className={asSizeCards ? "@container flex min-w-0 flex-col gap-2" : "flex flex-col gap-2"}>
            <legend className="text-sm font-medium text-ink-secondary">
              {option.name}: {selectedDisplayName ?? `Choose ${option.name}`}
            </legend>
            <div
              role="group"
              aria-label={option.name}
              className={
                asSizeCards
                  ? `grid gap-2 ${
                      sortedValues.length === 1 ? "grid-cols-1" : "grid-cols-1 @min-[21rem]:grid-cols-2"
                    }`
                  : "flex flex-wrap gap-2"
              }
            >
              {sortedValues.map((value) => {
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
                const measurement = measurements?.get(value.id);
                const dimensionId = measurement?.dimension
                  ? `${selectorId}-${value.id}-dimension`
                  : undefined;
                return (
                  <button
                    key={value.id}
                    type="button"
                    onClick={() => {
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
                    disabled={purchaseLocked || !compatible}
                    aria-pressed={selected}
                    aria-label={measurement?.name ?? value.label}
                    aria-describedby={dimensionId}
                    title={
                      !compatible
                        ? `${value.label} is unavailable with your current options`
                        : outOfStock
                          ? `${value.label} is out of stock`
                          : undefined
                    }
                    className={
                      asSizeCards
                        ? `relative flex min-h-[64px] min-w-0 items-center gap-2.5 rounded-xl border-2 p-2 pr-7 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            selected
                              ? "border-cta bg-primary-light/40"
                              : "border-border bg-card hover:border-primary"
                          }`
                        : `inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            selected
                              ? "border-cta bg-primary-light/40 text-cta"
                              : "border-border bg-card text-ink hover:border-primary"
                          }`
                    }
                  >
                    {asSizeCards && measurement ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={optimizedUploadImage(value.thumbnailUrl!, 96)}
                          alt={value.thumbnailAlt ?? value.label}
                          loading="lazy"
                          className="h-10 w-10 shrink-0 rounded-lg object-cover"
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="break-words text-sm font-semibold leading-tight text-ink">
                            {measurement.name}
                          </span>
                          {measurement.dimension ? (
                            <span id={dimensionId} className="text-[13px] text-ink-secondary">
                              {measurement.dimension}
                            </span>
                          ) : null}
                          {outOfStock ? (
                            <span className="text-xs text-sale">Out of stock</span>
                          ) : null}
                        </span>
                        {selected ? (
                          <span
                            aria-hidden="true"
                            data-testid="option-selected-check"
                            className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-cta text-cta-foreground"
                          >
                            <svg
                              viewBox="0 0 16 16"
                              className="h-3 w-3"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2.2}
                            >
                              <path
                                d="m3.5 8.5 3 3 6-6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <ValueVisual option={option} value={value} />
                        {outOfStock && (
                          <span className="text-xs text-sale">Out of stock</span>
                        )}
                      </>
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
