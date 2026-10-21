import { describe, expect, it } from 'vitest';
import { faqItemsSchema, stampItemTimestamps } from './faq-content.js';
import { resolveEffectiveFaq } from './faq-resolver.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const question = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Assembly?',
  answer: [{ kind: 'paragraph' as const, text: 'Assembly instructions included.' }],
  enabled: true, defaultOpen: false, position: 0,
};
const targeted = { ...question, audience: { scope: 'PRODUCTS' as const, productIds: [A, B] } };

describe('shared FAQ audience', () => {
  it('persists a selected audience instead of silently stripping it', () => {
    expect(faqItemsSchema.parse([targeted])[0]).toEqual(targeted);
  });

  it.each([[], [A], [A, A], [A, 'not-a-uuid']].map((productIds) => ({ productIds })))('rejects invalid selected product IDs $productIds', ({ productIds }) => {
    expect(faqItemsSchema.safeParse([{ ...question, audience: { scope: 'PRODUCTS', productIds } }]).success).toBe(false);
  });

  it('rejects contradictory all-product payloads and duplicate question IDs', () => {
    expect(faqItemsSchema.safeParse([{ ...question, audience: { scope: 'ALL', productIds: [A, B] } }]).success).toBe(false);
    expect(faqItemsSchema.safeParse([question, question]).success).toBe(false);
  });

  it.each([
    ['SHARED', A, ['shared']], ['EXTEND', B, ['shared', 'product']],
    ['CUSTOM', A, ['product']], ['SHARED', C, []], ['EXTEND', C, ['product']],
    ['SHARED', undefined, []],
  ] as const)('resolves mode=%s product=%s without leaking target IDs', (mode, productId, origins) => {
    const result = resolveEffectiveFaq({ mode, productId, sharedItems: [targeted], productItems: [question] });
    expect(result.map((item) => item.origin)).toEqual(origins);
    for (const item of result) expect(item).not.toHaveProperty('audience');
  });

  it('keeps legacy ALL questions on unrelated and newly created products', () => {
    expect(resolveEffectiveFaq({ mode: undefined, productId: C, sharedItems: [question], productItems: [] })).toHaveLength(1);
  });

  it('stamps changed membership but not membership order or legacy ALL normalization', () => {
    const oldTime = '2026-10-01T00:00:00.000Z';
    const now = new Date('2026-10-10T00:00:00.000Z');
    const old = { ...targeted, updatedAt: oldTime };
    expect(stampItemTimestamps([old], [{ ...targeted, audience: { scope: 'PRODUCTS', productIds: [B, C] } }], now)[0].updatedAt).toBe(now.toISOString());
    expect(stampItemTimestamps([old], [{ ...targeted, audience: { scope: 'PRODUCTS', productIds: [B, A] } }], now)[0].updatedAt).toBe(oldTime);
    expect(stampItemTimestamps([{ ...question, updatedAt: oldTime }], [{ ...question, audience: { scope: 'ALL' } }], now)[0].updatedAt).toBe(oldTime);
  });
});
