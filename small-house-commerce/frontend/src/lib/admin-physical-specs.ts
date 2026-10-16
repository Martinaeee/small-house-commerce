import {
  AdminCatalogGraphError,
  buildVariantCandidates,
  entityRowKey,
  type AdminCatalogGraphDraft,
} from "./admin-product-graph";

export const PHYSICAL_FIELDS = [
  "productWidth", "productDepth", "productHeight", "productWeight",
  "packageWidth", "packageDepth", "packageHeight", "packageWeight", "volumetricWeight",
] as const;
export type PhysicalField = typeof PHYSICAL_FIELDS[number];
export type PhysicalPatch = Partial<Record<PhysicalField, number | null>>;
export const PRODUCT_DIMENSION_FIELDS = ["productWidth", "productDepth", "productHeight"] as const;
export const SHIPPING_PHYSICAL_FIELDS = PHYSICAL_FIELDS.filter(field =>
  field !== "productWidth" && field !== "productDepth" && field !== "productHeight",
);
export interface AdminPhysicalSpecificationGroup {
  key: string;
  memberVariantKeys: string[];
  isBundle: boolean;
  label: string;
  colors: string[];
  uniform: PhysicalPatch;
  conflicts: PhysicalField[];
}

export function deriveAdminPhysicalSpecificationGroups(draft: AdminCatalogGraphDraft): AdminPhysicalSpecificationGroup[] {
  let candidates;
  try { candidates = buildVariantCandidates(draft); }
  catch (error) {
    if (error instanceof AdminCatalogGraphError) return [];
    throw error;
  }
  const byKey = new Map(candidates.map(candidate => [candidate.combinationKey, candidate]));
  const options = new Map(draft.options.map(option => [entityRowKey(option), option]));
  const values = new Map(draft.options.flatMap(option => option.values.map(value => [entityRowKey(value), value] as const)));
  const groups = new Map<string, AdminPhysicalSpecificationGroup>();
  for (const variant of draft.variants) {
    const sku = variant.sku;
    const candidate = byKey.get(variant.combinationKey);
    if (!sku || sku.status !== "ACTIVE" || !candidate) continue;
    const refs = new Set(variant.optionValueRefs.map(entityRowKey));
    if (refs.size !== candidate.pairs.length || variant.optionValueRefs.length !== candidate.pairs.length || candidate.pairs.some(pair => !refs.has(pair.valueId))) continue;
    const pairs = candidate.pairs.filter(pair => options.get(pair.optionId)!.kind !== "COLOR");
    const key = JSON.stringify([
      sku.isBundle ? "BUNDLE" : "SKU",
      ...pairs.map(pair => [pair.optionId, pair.valueId]).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)),
    ]);
    const group: AdminPhysicalSpecificationGroup = groups.get(key) ?? {
      key, memberVariantKeys: [], isBundle: sku.isBundle,
      label: pairs.map(pair => values.get(pair.valueId)!.label).join(" / "),
      colors: [], uniform: {}, conflicts: [],
    };
    group.memberVariantKeys.push(entityRowKey(variant));
    for (const pair of candidate.pairs.filter(pair => options.get(pair.optionId)!.kind === "COLOR")) {
      const label = values.get(pair.valueId)!.label;
      if (!group.colors.includes(label)) group.colors.push(label);
    }
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const members = draft.variants.filter(variant => group.memberVariantKeys.includes(entityRowKey(variant)));
    if (!group.label && members.length === 1) group.label = members[0].name;
    for (const field of group.isBundle ? SHIPPING_PHYSICAL_FIELDS : PHYSICAL_FIELDS) {
      const first = members[0].sku![field] ?? null;
      if (members.every(variant => Object.is(variant.sku![field] ?? null, first))) group.uniform[field] = first;
      else group.conflicts.push(field);
    }
  }
  return [...groups.values()];
}

export function applyAdminPhysicalSpecificationPatch(
  draft: AdminCatalogGraphDraft, groupKey: string, patch: PhysicalPatch,
): AdminCatalogGraphDraft {
  const next = structuredClone(draft);
  const group = deriveAdminPhysicalSpecificationGroups(next).find(group => group.key === groupKey);
  if (!group) return next;
  for (const variant of next.variants) {
    if (!variant.sku || !group.memberVariantKeys.includes(entityRowKey(variant))) continue;
    for (const field of group.isBundle ? SHIPPING_PHYSICAL_FIELDS : PHYSICAL_FIELDS) {
      if (Object.hasOwn(patch, field) && patch[field] !== undefined) variant.sku[field] = patch[field];
    }
  }
  return next;
}

export function inheritNewColorPhysicalSpecifications(
  draft: AdminCatalogGraphDraft, variantKey: string,
): { draft: AdminCatalogGraphDraft; conflicts: PhysicalField[] } {
  const variant = draft.variants.find(variant => entityRowKey(variant) === variantKey);
  if (!variant?.sku) return { draft, conflicts: [] };
  const group = deriveAdminPhysicalSpecificationGroups(draft).find(group => group.memberVariantKeys.includes(variantKey));
  if (!group) return { draft, conflicts: [] };
  const peers = { ...draft, variants: draft.variants.filter(row => entityRowKey(row) !== variantKey) };
  const source = deriveAdminPhysicalSpecificationGroups(peers).find(row => row.key === group.key);
  if (!source) return { draft, conflicts: [] };
  if (source.conflicts.length > 0) return { draft, conflicts: source.conflicts };
  const fields = group.isBundle ? SHIPPING_PHYSICAL_FIELDS : PHYSICAL_FIELDS;
  const conflicts = fields.filter(field =>
    (variant.sku!.id !== undefined || variant.sku![field] !== null) &&
    !Object.is(variant.sku![field], source.uniform[field]),
  );
  if (conflicts.length > 0) return { draft, conflicts };
  const next = structuredClone(draft);
  const target = next.variants.find(row => entityRowKey(row) === variantKey)!;
  Object.assign(target.sku!, source.uniform);
  return { draft: next, conflicts: [] };
}
