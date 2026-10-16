export const PHYSICAL_FIELDS = [
  'productWidth', 'productDepth', 'productHeight', 'productWeight',
  'packageWidth', 'packageDepth', 'packageHeight',
  'packageWeight', 'volumetricWeight',
] as const;

export type PhysicalField = typeof PHYSICAL_FIELDS[number];
export type PhysicalValues = Record<PhysicalField, number | null>;
export type PhysicalPatch = Partial<PhysicalValues>;
export interface PhysicalPair {
  optionKey: string;
  valueKey: string;
  kind: 'COLOR' | 'STYLE' | 'SIZE' | 'MATERIAL';
}
export interface PhysicalSpecRow {
  variantKey: string;
  skuKey: string;
  isBundle: boolean;
  shareable: boolean;
  pairs: readonly PhysicalPair[];
  values: PhysicalValues;
}
export interface PhysicalSpecConflict {
  groupKey: string;
  field: PhysicalField;
  skuKeys: string[];
}
export interface SharedPhysicalSpecInput {
  before: readonly PhysicalSpecRow[];
  after: readonly PhysicalSpecRow[];
  persistedValues: ReadonlyMap<string, PhysicalValues>;
  requested: ReadonlyMap<string, PhysicalPatch>;
  createdSkuKeys: ReadonlySet<string>;
}

const BUNDLE_FIELDS = PHYSICAL_FIELDS.filter(field =>
  field !== 'productWidth' && field !== 'productDepth' && field !== 'productHeight',
);

export function physicalSpecificationGroupKey(row: PhysicalSpecRow): string {
  const mode = row.isBundle ? 'BUNDLE' : 'SKU';
  if (!row.shareable) return JSON.stringify([mode, 'LEGACY', row.skuKey]);
  const pairs = row.pairs
    .filter(pair => pair.kind !== 'COLOR')
    .map(pair => [pair.optionKey, pair.valueKey])
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  return JSON.stringify([mode, ...pairs]);
}

export function planSharedPhysicalSpecUpdates(input: SharedPhysicalSpecInput): {
  updates: Map<string, PhysicalPatch>;
  conflicts: PhysicalSpecConflict[];
} {
  const beforeKeys = new Map(input.before.map(row => [row.skuKey, physicalSpecificationGroupKey(row)]));
  const groups = new Map<string, PhysicalSpecRow[]>();
  for (const row of input.after) {
    const key = physicalSpecificationGroupKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const updates = new Map<string, PhysicalPatch>();
  const conflicts: PhysicalSpecConflict[] = [];
  for (const [groupKey, rows] of groups) {
    const fields = rows[0].isBundle ? BUNDLE_FIELDS : PHYSICAL_FIELDS;
    const entrants = rows.some(row => beforeKeys.get(row.skuKey) !== groupKey);
    const created = rows.filter(row => input.createdSkuKeys.has(row.skuKey));
    const persisted = rows.filter(row => !input.createdSkuKeys.has(row.skuKey));
    for (const field of fields) {
      const deltas = new Set<number | null>();
      for (const row of persisted) {
        const write = input.requested.get(row.skuKey);
        const previous = input.persistedValues.get(row.skuKey);
        if (write && previous && Object.hasOwn(write, field) && write[field] !== undefined && !Object.is(write[field], previous[field])) {
          deltas.add(write[field]);
        }
      }
      let value: number | null;
      let conflict = deltas.size > 1;
      if (deltas.size === 1) {
        value = [...deltas][0];
        conflict = created.some(row => row.values[field] !== null && !Object.is(row.values[field], value));
      } else if (entrants) {
        const sources = persisted.length > 0
          ? persisted.map(row => row.values[field])
          : created.flatMap(row => row.values[field] === null ? [] : [row.values[field]]);
        const unique = new Set(sources);
        conflict ||= unique.size > 1;
        value = unique.size === 1 ? [...unique][0] : null;
        if (persisted.length > 0) {
          conflict ||= created.some(row => row.values[field] !== null && !Object.is(row.values[field], value));
        }
      } else {
        if (!conflict) continue;
        value = null;
      }
      if (conflict) {
        conflicts.push({ groupKey, field, skuKeys: rows.map(row => row.skuKey) });
        continue;
      }
      for (const row of rows) {
        if (Object.is(row.values[field], value)) continue;
        updates.set(row.skuKey, { ...updates.get(row.skuKey), [field]: value });
      }
    }
  }
  return { updates: conflicts.length > 0 ? new Map() : updates, conflicts };
}
