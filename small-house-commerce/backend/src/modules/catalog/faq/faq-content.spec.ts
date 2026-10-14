import { describe, expect, it } from 'vitest';
import {
  MAX_FAQ_ANSWER,
  MAX_FAQ_ITEMS,
  MAX_FAQ_TITLE,
  blocksFromPlainText,
  faqItemsSchema,
  stampItemTimestamps,
  type FaqItem,
} from './faq-content.js';

export const VALID_ITEM: FaqItem = {
  id: '11111111-1111-7111-8111-111111111111',
  title: 'How does Cash on Delivery work?',
  answer: [{ kind: 'paragraph', text: 'Pay the rider when the order arrives.' }],
  enabled: true,
  position: 0,
  defaultOpen: false,
};

describe('blocksFromPlainText', () => {
  it('splits blank lines into paragraphs and dash lines into bullets', () => {
    expect(blocksFromPlainText('First para.\n\n- one\n- two')).toEqual([
      { kind: 'paragraph', text: 'First para.' },
      { kind: 'bullets', items: ['one', 'two'] },
    ]);
  });

  it('joins wrapped lines inside one paragraph', () => {
    expect(blocksFromPlainText('one\ntwo')).toEqual([{ kind: 'paragraph', text: 'one two' }]);
  });

  it('accepts * as a bullet marker too', () => {
    expect(blocksFromPlainText('* alpha\n* beta')).toEqual([
      { kind: 'bullets', items: ['alpha', 'beta'] },
    ]);
  });

  it('closes a bullet list before the next paragraph', () => {
    expect(blocksFromPlainText('- one\nThen prose.')).toEqual([
      { kind: 'bullets', items: ['one'] },
      { kind: 'paragraph', text: 'Then prose.' },
    ]);
  });

  it('returns nothing for blank input', () => {
    expect(blocksFromPlainText('   \n\n ')).toEqual([]);
  });
});

describe('faqItemsSchema', () => {
  it('accepts a well-formed item', () => {
    expect(faqItemsSchema.safeParse([VALID_ITEM]).success).toBe(true);
  });

  it('rejects an item with no answer', () => {
    expect(faqItemsSchema.safeParse([{ ...VALID_ITEM, answer: [] }]).success).toBe(false);
  });

  it('rejects a blank title', () => {
    expect(faqItemsSchema.safeParse([{ ...VALID_ITEM, title: '   ' }]).success).toBe(false);
  });

  it('rejects a title over 200 characters', () => {
    expect(
      faqItemsSchema.safeParse([{ ...VALID_ITEM, title: 'x'.repeat(MAX_FAQ_TITLE + 1) }]).success,
    ).toBe(false);
  });

  it('rejects an answer over the character budget', () => {
    const answer = [{ kind: 'paragraph' as const, text: 'x'.repeat(MAX_FAQ_ANSWER + 1) }];
    expect(faqItemsSchema.safeParse([{ ...VALID_ITEM, answer }]).success).toBe(false);
  });

  it('caps a library at 30 items', () => {
    const many = Array.from({ length: MAX_FAQ_ITEMS + 1 }, (_, index) => ({
      ...VALID_ITEM,
      id: `11111111-1111-7111-8111-${String(index).padStart(12, '0')}`,
      position: index,
    }));
    expect(faqItemsSchema.safeParse(many).success).toBe(false);
  });

  it('has no field that can carry executable markup', () => {
    const html = [{ ...VALID_ITEM, answer: [{ kind: 'html', html: '<script>x()</script>' }] }];
    expect(faqItemsSchema.safeParse(html).success).toBe(false);
  });

  it('rejects an unknown block kind inside a bullet list position', () => {
    const bad = [{ ...VALID_ITEM, answer: [{ kind: 'bullets', items: 'not-an-array' }] }];
    expect(faqItemsSchema.safeParse(bad).success).toBe(false);
  });
});

describe('faq item management metadata', () => {
  it('accepts a controlled category code and rejects a free-text category', () => {
    expect(faqItemsSchema.safeParse([{ ...VALID_ITEM, category: 'DELIVERY' }]).success).toBe(true);
    expect(faqItemsSchema.safeParse([{ ...VALID_ITEM, category: 'Shipping stuff' }]).success).toBe(
      false,
    );
  });

  it('strips a client-supplied updatedAt so the server stays the only timestamp source', () => {
    const parsed = faqItemsSchema.safeParse([
      { ...VALID_ITEM, updatedAt: '2001-01-01T00:00:00.000Z' },
    ]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.hasOwn(parsed.data[0]!, 'updatedAt')).toBe(false);
  });
});

describe('stampItemTimestamps', () => {
  const NOW = new Date('2026-10-10T08:00:00.000Z');
  const OLD = '2026-10-01T00:00:00.000Z';
  const SECOND_ID = '22222222-2222-7222-8222-222222222222';

  const stored: FaqItem[] = [
    { ...VALID_ITEM, updatedAt: OLD },
    { ...VALID_ITEM, id: SECOND_ID, title: 'Second?', position: 1, updatedAt: OLD },
  ];

  it('stamps a newly added question with the server time', () => {
    const next = [...stored, { ...VALID_ITEM, id: '33333333-3333-7333-8333-333333333333', title: 'Third?', position: 2 }];
    const stamped = stampItemTimestamps(stored, next, NOW);
    expect(stamped[2]!.updatedAt).toBe(NOW.toISOString());
  });

  it('keeps the stored timestamp for an unchanged question', () => {
    const stamped = stampItemTimestamps(stored, stored, NOW);
    expect(stamped[0]!.updatedAt).toBe(OLD);
    expect(stamped[1]!.updatedAt).toBe(OLD);
  });

  it('re-stamps only the question whose title changed', () => {
    const next = [{ ...stored[0]!, title: 'Changed?' }, stored[1]!];
    const stamped = stampItemTimestamps(stored, next, NOW);
    expect(stamped[0]!.updatedAt).toBe(NOW.toISOString());
    expect(stamped[1]!.updatedAt).toBe(OLD);
  });

  it('re-stamps on a status change and on a reorder', () => {
    const disabled = [{ ...stored[0]!, enabled: false }, stored[1]!];
    expect(stampItemTimestamps(stored, disabled, NOW)[0]!.updatedAt).toBe(NOW.toISOString());

    const reordered = [stored[1]!, { ...stored[0]!, position: 1 }, { ...stored[1]!, position: 0 }];
    const stamped = stampItemTimestamps(stored, [reordered[1]!, reordered[2]!], NOW);
    expect(stamped[0]!.updatedAt).toBe(NOW.toISOString());
    expect(stamped[1]!.updatedAt).toBe(NOW.toISOString());
  });

  it('treats a legacy item with no category as UNCATEGORIZED when comparing', () => {
    const stamped = stampItemTimestamps(stored, [
      { ...stored[0]!, category: 'UNCATEGORIZED' },
      stored[1]!,
    ], NOW);
    expect(stamped[0]!.updatedAt).toBe(OLD);
  });

  it('re-stamps when the category actually changes', () => {
    const stamped = stampItemTimestamps(stored, [
      { ...stored[0]!, category: 'DELIVERY' },
      stored[1]!,
    ], NOW);
    expect(stamped[0]!.updatedAt).toBe(NOW.toISOString());
  });

  it('does not stamp an unchanged legacy question that has no stored timestamp', () => {
    const legacy: FaqItem[] = [{ ...VALID_ITEM }];
    const stamped = stampItemTimestamps(legacy, legacy, NOW);
    expect(stamped[0]!.updatedAt).toBeUndefined();
  });

  it('drops a question that was removed from the library', () => {
    const stamped = stampItemTimestamps(stored, [stored[1]!], NOW);
    expect(stamped).toHaveLength(1);
    expect(stamped[0]!.id).toBe(SECOND_ID);
  });
});
