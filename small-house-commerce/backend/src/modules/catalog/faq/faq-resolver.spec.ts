import { describe, expect, it } from 'vitest';
import { resolveEffectiveFaq, type EffectiveFaqItem } from './faq-resolver.js';
import type { FaqItem } from './faq-content.js';

function item(overrides: Partial<FaqItem> & { id: string }): FaqItem {
  return {
    title: 'Title',
    answer: [{ kind: 'paragraph', text: 'Body.' }],
    enabled: true,
    position: 0,
    defaultOpen: false,
    ...overrides,
  };
}

const shared: FaqItem[] = [
  item({ id: 's1', title: 'How does COD work?', position: 0, defaultOpen: true }),
  item({ id: 's2', title: 'Returns', position: 1, enabled: false }),
];

const own: FaqItem[] = [item({ id: 'p1', title: 'Does it fit a 60cm gap?', position: 0 })];

const ids = (items: EffectiveFaqItem[]) => items.map((entry) => entry.id);

describe('resolveEffectiveFaq', () => {
  it('SHARED returns only the enabled shared items', () => {
    expect(ids(resolveEffectiveFaq({ mode: 'SHARED', productItems: own, sharedItems: shared }))).toEqual(
      ['s1'],
    );
  });

  it('EXTEND puts the shared items first, then the product items', () => {
    expect(ids(resolveEffectiveFaq({ mode: 'EXTEND', productItems: own, sharedItems: shared }))).toEqual(
      ['s1', 'p1'],
    );
  });

  it('CUSTOM ignores the shared library entirely', () => {
    expect(ids(resolveEffectiveFaq({ mode: 'CUSTOM', productItems: own, sharedItems: shared }))).toEqual(
      ['p1'],
    );
  });

  it('CUSTOM may legitimately be empty', () => {
    expect(resolveEffectiveFaq({ mode: 'CUSTOM', productItems: [], sharedItems: shared })).toEqual([]);
  });

  it('treats a missing configuration as SHARED', () => {
    expect(
      ids(resolveEffectiveFaq({ mode: undefined, productItems: own, sharedItems: shared })),
    ).toEqual(['s1']);
  });

  it('re-sorts by position instead of trusting stored order', () => {
    const shuffled = [shared[1], shared[0]];
    expect(ids(resolveEffectiveFaq({ mode: 'SHARED', productItems: [], sharedItems: shuffled }))).toEqual(
      ['s1'],
    );
  });

  it('marks which library each item came from', () => {
    const resolved = resolveEffectiveFaq({ mode: 'EXTEND', productItems: own, sharedItems: shared });
    expect(resolved.map((entry) => entry.origin)).toEqual(['shared', 'product']);
  });

  it('keeps disabled product items out of EXTEND', () => {
    const mixed = [item({ id: 'p1', position: 0 }), item({ id: 'p2', position: 1, enabled: false })];
    expect(ids(resolveEffectiveFaq({ mode: 'EXTEND', productItems: mixed, sharedItems: shared }))).toEqual(
      ['s1', 'p1'],
    );
  });

  it('never mutates the caller arrays', () => {
    const before = shared.map((entry) => entry.id);
    resolveEffectiveFaq({ mode: 'SHARED', productItems: [], sharedItems: shared });
    expect(shared.map((entry) => entry.id)).toEqual(before);
  });
});
