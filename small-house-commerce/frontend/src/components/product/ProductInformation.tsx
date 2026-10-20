"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import styles from "./ProductInformation.module.css";
import type { Product } from "@/lib/api";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import {
  analyzePdpSpecifications,
  pdpBasisLabel,
  pdpInformationVisible,
  rowMatchesSelection,
  type PdpSpecGroup,
  type PdpSpecModel,
} from "./pdp-specification-display";

const FACT_LABEL_CLASS = "text-xs text-ink-muted";
const FACT_VALUE_CLASS = "mt-1 whitespace-pre-line text-base font-semibold leading-relaxed text-ink";
const CELL_CLASS =
  "border-b border-border px-2.5 py-3 align-top text-base leading-relaxed text-ink first:pl-0";
const HEAD_CLASS =
  "border-b border-border px-2.5 py-3 text-left align-top text-sm font-semibold leading-relaxed text-ink first:pl-0";

function CommonFacts({ product, model }: { product: Product; model: PdpSpecModel }) {
  const nonColor = product.options.filter((option) => option.kind !== "COLOR");
  const facts = model.common.filter((field) => !(
    field.key === "variant" && nonColor.length > 0 &&
    model.groups.some((group) => nonColor.every((option) => group.basis.includes(option.id)))
  ));
  return (
    <dl className={`${styles.facts} gap-x-6 gap-y-4 px-5 py-4`}>
      {facts.map((field) => {
        const text = model.formatCell(field.cell);
        const wide = field.key === "productName" || field.cell.type === "components" || text.length > 48;
        return (
          <div key={field.key} data-field={field.key} className={wide ? styles.full : text.length > 32 ? styles.mobileFull : undefined}>
            <dt className={FACT_LABEL_CLASS}>{field.label}</dt>
            <dd className={FACT_VALUE_CLASS}>{text}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function DifferenceTable({
  product,
  group,
  model,
  selectedValueIds,
  selectionComplete,
}: {
  product: Product;
  group: PdpSpecGroup;
  model: PdpSpecModel;
  selectedValueIds: Readonly<Record<string, string>>;
  selectionComplete: boolean;
}) {
  const materialOption = product.options.find((option) => option.kind === "MATERIAL");
  // A MATERIAL-owned value is already the row label.
  const ownerField = group.basis.length === 1 && group.basis[0] === materialOption?.id
    ? group.fields.find(
        (field) =>
          field.key === "materials" &&
          group.rows.every(
            (row) =>
              row.cells.materials.type === "material" &&
              row.cells.materials.status === "complete",
          ),
      )
    : undefined;
  const basisLabel = pdpBasisLabel(product, group.basis);
  const hasSelection = Object.keys(selectedValueIds).length > 0;
  const matchingRows = hasSelection
    ? model.rows.filter((row) => rowMatchesSelection(row, selectedValueIds))
    : [];
  const chosen =
    selectionComplete && matchingRows.length === 1 ? matchingRows[0] : null;

  return (
    <table
      className={styles.table}
      style={{ "--difference-fields": Math.max(1, group.fields.length - (ownerField ? 1 : 0)) } as CSSProperties}
    >
      <caption className="sr-only">
        {group.fields.map((field) => field.label).join(" and ")} by {basisLabel}
      </caption>
      <thead>
        <tr>
          {ownerField ? null : (
            <th
              scope="col"
              className="w-[28%] border-y border-border bg-background px-2.5 py-3 text-left text-xs font-medium text-ink-muted first:pl-0"
            >
              {basisLabel}
            </th>
          )}
          {group.fields.map((field) => (
            <th
              key={field.key}
              scope="col"
              data-field={field.key}
              className="border-y border-border bg-background px-2.5 py-3 text-left text-xs font-medium text-ink-muted first:pl-0"
            >
              {field.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {group.rows.map((row) => {
          const isSelected =
            chosen !== null && row.memberIds.includes(chosen.id);
          const isPartial =
            !isSelected &&
            !selectionComplete &&
            hasSelection &&
            matchingRows.some((match) => row.memberIds.includes(match.id));
          const label = (
            <>
              <span className="block">{row.labels.join(" · ")}</span>
              {isSelected && (
                <span className="mt-0.5 block text-xs font-normal text-ink-muted">
                  Selected
                </span>
              )}
            </>
          );
          return (
            <tr
              key={row.memberIds.join(",")}
              data-members={row.memberIds.join(",")}
              data-selection={isSelected ? "selected" : isPartial ? "partial" : undefined}
              className={
                isSelected
                  ? "bg-primary-light/40 shadow-[inset_3px_0_0_var(--color-cta)]"
                  : isPartial
                    ? "bg-background/60"
                    : undefined
              }
            >
              {ownerField ? null : (
                <th scope="row" className={HEAD_CLASS}>
                  {label}
                </th>
              )}
              {group.fields.map((field) =>
                field.key === ownerField?.key ? (
                  <th key={field.key} scope="row" data-field={field.key} data-label={field.label} className={HEAD_CLASS}>
                    {label}
                  </th>
                ) : (
                  <td
                    key={field.key}
                    data-field={field.key}
                    data-label={field.label}
                    className={CELL_CLASS}
                  >
                    {model.formatCell(row.cells[field.key])}
                  </td>
                ),
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ProductInformation({ product }: { product: Product }): ReactNode {
  const { primaryLine, primaryDerived } = usePdpPurchase();
  const model = useMemo(() => analyzePdpSpecifications(product), [product]);

  if (!pdpInformationVisible(product)) return null;

  return (
    <section
      id="specifications"
      aria-labelledby="product-information-title"
      className={`${styles.section} scroll-mt-32 overflow-hidden rounded-lg border border-border bg-card`}
    >
      <div className="border-b border-border px-5 py-4">
        <h2 id="product-information-title" className="text-2xl font-semibold text-ink">
          Product information
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Shared details shown once. Differences are listed below.
        </p>
      </div>
      {model.common.length > 0 && <CommonFacts product={product} model={model} />}
      {model.groups.map((group) => (
        <div
          key={group.basis.join("|")}
          className="border-b border-border px-5 py-4 last:border-b-0"
        >
          <DifferenceTable
            product={product}
            group={group}
            model={model}
            selectedValueIds={primaryLine.selectedValueIds}
            selectionComplete={primaryDerived.missingOptionIds.length === 0}
          />
        </div>
      ))}
    </section>
  );
}
