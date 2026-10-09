import type { FaqItem, FaqMode } from './faq-content.js';

/**
 * The single place that decides what a shopper actually sees.
 *
 * The PDP, the landing pages and the admin preview all call this, so "which
 * questions does this product show" cannot drift between surfaces. A product
 * with no stored configuration resolves as SHARED — the absence of a row means
 * "use the shared library", never "show nothing".
 */

export interface EffectiveFaqItem extends FaqItem {
  origin: 'shared' | 'product';
}

export interface ResolveFaqInput {
  mode: FaqMode | undefined;
  productItems: FaqItem[];
  sharedItems: FaqItem[];
}

export function resolveEffectiveFaq(input: ResolveFaqInput): EffectiveFaqItem[] {
  const mode: FaqMode = input.mode ?? 'SHARED';

  const select = (items: FaqItem[], origin: EffectiveFaqItem['origin']) =>
    [...items]
      .sort((left, right) => left.position - right.position)
      .filter((item) => item.enabled)
      .map((item) => ({ ...item, origin }));

  const shared = select(input.sharedItems, 'shared');
  const own = select(input.productItems, 'product');

  if (mode === 'SHARED') return shared;
  if (mode === 'CUSTOM') return own;
  return [...shared, ...own];
}
