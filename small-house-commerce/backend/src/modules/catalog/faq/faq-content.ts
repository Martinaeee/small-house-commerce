import { z } from 'zod';

/**
 * Product FAQ content model.
 *
 * Answers are structured blocks, never HTML. That is the whole point: nothing
 * an operator types is ever parsed as markup, so the storefront renders text
 * and links as React nodes and there is no sanitiser to get wrong.
 *
 * Inline links and the support-placeholder syntax live in the plain text and
 * are resolved by the renderer, which is where the protocol allow-list applies.
 */

export const FAQ_MODES = ['SHARED', 'EXTEND', 'CUSTOM'] as const;
export type FaqMode = (typeof FAQ_MODES)[number];

export const MAX_FAQ_ITEMS = 30;
export const MAX_FAQ_TITLE = 200;
export const MAX_FAQ_ANSWER = 8000;
export const MAX_BULLET_ITEMS = 50;

const paragraphBlockSchema = z.object({
  kind: z.literal('paragraph'),
  text: z.string().trim().min(1).max(MAX_FAQ_ANSWER),
});

const bulletsBlockSchema = z.object({
  kind: z.literal('bullets'),
  items: z
    .array(z.string().trim().min(1).max(MAX_FAQ_ANSWER))
    .min(1)
    .max(MAX_BULLET_ITEMS),
});

/**
 * Discriminated on `kind`, so an unknown block type (a stray `html` block, for
 * instance) is rejected outright rather than silently stored.
 */
export const faqAnswerBlockSchema = z.discriminatedUnion('kind', [
  paragraphBlockSchema,
  bulletsBlockSchema,
]);
export type FaqAnswerBlock = z.infer<typeof faqAnswerBlockSchema>;

function answerLength(blocks: FaqAnswerBlock[]): number {
  return blocks.reduce(
    (total, block) =>
      total +
      (block.kind === 'paragraph' ? block.text.length : block.items.join('').length),
    0,
  );
}

const faqAnswerSchema = z
  .array(faqAnswerBlockSchema)
  .min(1)
  .superRefine((blocks, ctx) => {
    if (answerLength(blocks) > MAX_FAQ_ANSWER) {
      ctx.addIssue({
        code: 'custom',
        message: `Answer must be at most ${MAX_FAQ_ANSWER} characters.`,
      });
    }
  });

export const faqItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(MAX_FAQ_TITLE),
  answer: faqAnswerSchema,
  enabled: z.boolean(),
  position: z.number().int().min(0),
  defaultOpen: z.boolean(),
});
export type FaqItem = z.infer<typeof faqItemSchema>;

export const faqItemsSchema = z.array(faqItemSchema).max(MAX_FAQ_ITEMS);

/**
 * Parses the admin textarea into blocks: blank lines separate paragraphs, a
 * line starting with `-` or `*` opens a bullet list, and consecutive prose
 * lines wrap into one paragraph.
 */
export function blocksFromPlainText(raw: string): FaqAnswerBlock[] {
  const blocks: FaqAnswerBlock[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push({ kind: 'bullets', items: [...bullets] });
    bullets = [];
  };

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flushBullets();
      flushParagraph();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      const text = bullet[1].trim();
      if (text.length > 0) bullets.push(text);
      continue;
    }
    flushBullets();
    paragraph.push(trimmed);
  }

  flushBullets();
  flushParagraph();
  return blocks;
}
