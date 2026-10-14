import { audienceAppliesTo } from './faq-content.js';
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
  /** Current product id; targeted shared questions only apply to their selection. */
  productId?: string | null;
}

export function resolveEffectiveFaq(input: ResolveFaqInput): EffectiveFaqItem[] {
  const mode: FaqMode = input.mode ?? 'SHARED';

  const select = (items: FaqItem[], origin: EffectiveFaqItem['origin']) =>
    [...items]
      .sort((left, right) => left.position - right.position)
      .filter((item) => item.enabled)
      .map((item) => {
        const clean = { ...item };
        delete clean.audience;
        return { ...clean, origin };
      });

  const shared = select(
    input.sharedItems.filter((item) =>
      audienceAppliesTo(item, input.productId ?? null),
    ),
    'shared',
  );
  const own = select(input.productItems, 'product');

  if (mode === 'SHARED') return shared;
  if (mode === 'CUSTOM') return own;
  return [...shared, ...own];
}
