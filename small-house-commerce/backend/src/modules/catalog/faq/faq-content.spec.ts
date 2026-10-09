import { describe, expect, it } from 'vitest';
import {
  MAX_FAQ_ANSWER,
  MAX_FAQ_ITEMS,
  MAX_FAQ_TITLE,
  blocksFromPlainText,
  faqItemsSchema,
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
