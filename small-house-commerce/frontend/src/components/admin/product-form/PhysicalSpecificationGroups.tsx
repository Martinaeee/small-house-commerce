"use client";

import { useState } from "react";
import { Field } from "../Field";
import { DecimalInput } from "../DecimalInput";
import { SkuPackagingAssist } from "../SkuPackagingAssist";
import { useAdminI18n, type TKey } from "@/lib/admin-i18n";
import { entityRowKey, type AdminCatalogGraphDraft } from "@/lib/admin-product-graph";
import {
  PRODUCT_DIMENSION_FIELDS, SHIPPING_PHYSICAL_FIELDS,
  applyAdminPhysicalSpecificationPatch, deriveAdminPhysicalSpecificationGroups,
  type AdminPhysicalSpecificationGroup, type PhysicalField, type PhysicalPatch,
} from "@/lib/admin-physical-specs";

const LABELS: Record<PhysicalField, TKey> = {
  productWidth: "product_sku_product_width", productDepth: "product_sku_product_depth", productHeight: "product_sku_product_height",
  productWeight: "product_sku_product_weight", packageWidth: "product_sku_package_width", packageDepth: "product_sku_package_depth",
  packageHeight: "product_sku_package_height", packageWeight: "product_sku_package_weight", volumetricWeight: "product_sku_volumetric_weight",
};
interface Props {
  draft: AdminCatalogGraphDraft;
  onChange: (update: (draft: AdminCatalogGraphDraft) => void) => void;
  section: "dimensions" | "shipping";
  disabled?: boolean;
  productDimensions?: { width: number | null; depth: number | null; height: number | null } | null;
}

function GroupEditor({ group, draft, onChange, section, disabled = false, productDimensions = null }: Props & { group: AdminPhysicalSpecificationGroup }) {
  const { t } = useAdminI18n();
  const [source, setSource] = useState<{ name: string; patch: PhysicalPatch } | null>(null);
  const fields: readonly PhysicalField[] = section === "dimensions" ? PRODUCT_DIMENSION_FIELDS : SHIPPING_PHYSICAL_FIELDS;
  const conflicts = group.conflicts.filter(field => fields.includes(field));
  const members = draft.variants.filter(row => group.memberVariantKeys.includes(entityRowKey(row)));
  const name = group.label || t("physical_group_shared");
  const apply = (patch: PhysicalPatch) => onChange(current => {
    Object.assign(current, applyAdminPhysicalSpecificationPatch(current, group.key, patch));
  });
  const display = (field: PhysicalField, value: number | null): string => {
    if (value !== null) return String(value);
    return PRODUCT_DIMENSION_FIELDS.includes(field as typeof PRODUCT_DIMENSION_FIELDS[number])
      ? t("physical_group_inherit") : t("physical_group_unprovided");
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 rounded-xl border border-border bg-background p-4" data-testid="physical-specification-group">
      <legend className="max-w-full break-words px-1 text-sm font-semibold text-ink">{name}</legend>
      {group.colors.length > 0 ? <p className="break-words text-xs text-ink-muted">{t("physical_group_colors", { colors: group.colors.join(", ") })}</p> : null}
      <p className="mt-1 break-words text-xs text-ink-muted">{t("physical_group_members", { skus: members.map(row => row.sku!.skuCode || row.name).join(", ") })}</p>
      {group.isBundle ? <p className="mt-2 text-xs text-ink-muted">{t("physical_group_bundle_packaging")}</p> : null}
      {conflicts.length > 0 ? (
        <div role="alert" className="mt-3 min-w-0 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="font-semibold">{t("physical_group_conflict")}</p>
          <p className="mt-1">{t("physical_group_conflict_hint")}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {members.map(row => <li key={entityRowKey(row)} className="min-w-0 break-words">
              <p className="font-medium">{row.name} · {row.sku!.skuCode}</p>
              <p>{conflicts.map(field => `${t(LABELS[field])}: ${display(field, row.sku![field] ?? null)}`).join(" · ")}</p>
              <button type="button" className="mt-1 min-h-10 rounded-lg border border-amber-400 bg-white px-3 font-medium" onClick={() => setSource({
                name: row.name,
                patch: Object.fromEntries(fields.map(field => [field, row.sku![field] ?? null])),
              })}>{t("physical_group_choose_source", { name: row.name })}</button>
            </li>)}
          </ul>
        </div>
      ) : null}
      {source ? <div className="mt-3 rounded-lg border border-border bg-card p-3" role="status">
        <p className="text-sm font-semibold">{t("physical_group_source_preview", { name: source.name })}</p>
        <dl className="mt-2 flex flex-col gap-1 text-xs">
          {fields.map(field => <div key={field} className="flex flex-wrap justify-between gap-2"><dt>{t(LABELS[field])}</dt><dd>{display(field, source.patch[field] ?? null)}</dd></div>)}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="min-h-10 rounded-lg bg-cta px-3 text-sm font-semibold text-white" onClick={() => { apply(source.patch); setSource(null); }}>{t("physical_group_apply")}</button>
          <button type="button" className="min-h-10 rounded-lg border border-border px-3 text-sm" onClick={() => setSource(null)}>{t("physical_group_cancel")}</button>
        </div>
      </div> : null}
      <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(field => {
          const parentKey = field === "productWidth" ? "width" : field === "productDepth" ? "depth" : field === "productHeight" ? "height" : null;
          const isMixed = group.conflicts.includes(field);
          return <Field key={field} label={t(LABELS[field])} hint={parentKey && !isMixed && group.uniform[field] === null
            ? `${t("physical_group_inherit")}: ${productDimensions?.[parentKey] ?? t("physical_group_unprovided")}${productDimensions?.[parentKey] != null ? " cm" : ""}` : undefined}>
            <DecimalInput
              aria-label={t("product_shipping_field_aria", { variant: name, field: t(LABELS[field]) })}
              className="min-w-0 w-full" inputMode="decimal" autoComplete="off"
              value={group.uniform[field] ?? null}
              placeholder={isMixed ? t("physical_group_mixed") : undefined}
              onValueChange={value => apply({ [field]: value })}
              disabled={disabled}
            />
          </Field>;
        })}
      </div>
      {section === "dimensions" ? <button type="button" className="mt-3 min-h-10 rounded-lg border border-border px-3 text-xs font-medium" onClick={() => apply({ productWidth: null, productDepth: null, productHeight: null })}>
        {t("physical_group_reset_dimensions")}
      </button> : <>
        {conflicts.length > 0 ? <p className="mt-3 text-xs text-ink-muted">{t("physical_group_parser_conflicts")}</p> : null}
        <SkuPackagingAssist value={{
          packageWidth: group.uniform.packageWidth ?? null, packageDepth: group.uniform.packageDepth ?? null,
          packageHeight: group.uniform.packageHeight ?? null, packageWeight: group.uniform.packageWeight ?? null,
        }} disabled={disabled} onApply={(parsed, mode) => onChange(current => {
          const patch: PhysicalPatch = { ...parsed };
          const live = deriveAdminPhysicalSpecificationGroups(current).find(row => row.key === group.key);
          if (mode === "fill-empty") for (const field of live?.conflicts ?? []) delete patch[field];
          Object.assign(current, applyAdminPhysicalSpecificationPatch(current, group.key, patch));
        })} />
      </>}
    </fieldset>
  );
}

export function PhysicalSpecificationGroups(props: Props) {
  const { t } = useAdminI18n();
  const groups = deriveAdminPhysicalSpecificationGroups(props.draft)
    .filter(group => props.section !== "dimensions" || !group.isBundle);
  if (groups.length === 0) return props.section === "shipping"
    ? <p className="text-sm text-ink-muted">{t("product_shipping_typed_empty")}</p> : null;
  return <div className="flex min-w-0 flex-col gap-3">
    {groups.map(group => <GroupEditor key={`${props.section}:${group.key}`} {...props} group={group} />)}
  </div>;
}
