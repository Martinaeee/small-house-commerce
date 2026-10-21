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

/**
 * Controlled category codes for shared-library questions. Deliberately not
 * free text: the management list groups by these, and the label is translated
 * in the admin UI. Legacy items without a category are shown under
 * UNCATEGORIZED — never guessed from their content.
 */
export const FAQ_CATEGORIES = [
  'DELIVERY',
  'PAYMENT_COD',
  'RETURNS',
  'INSTALLATION',
  'UNCATEGORIZED',
] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

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

/**
 * The shape an operator may submit. `updatedAt` is deliberately absent: the
 * server stamps per-question timestamps from its own clock, and zod strips any
 * client-supplied value instead of storing a forged one.
 */
export const faqAudienceSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('ALL') }).strict(),
  z.object({
    scope: z.literal('PRODUCTS'),
    productIds: z.array(z.string().uuid()).min(2).max(1000)
      .refine((ids) => new Set(ids).size === ids.length, 'Select distinct products.'),
  }).strict(),
]);
export type FaqAudience = z.infer<typeof faqAudienceSchema>;

export const faqItemWriteSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(MAX_FAQ_TITLE),
  answer: faqAnswerSchema,
  enabled: z.boolean(),
  position: z.number().int().min(0),
  defaultOpen: z.boolean(),
  category: z.enum(FAQ_CATEGORIES).optional(),
  audience: faqAudienceSchema.optional(),
});
export type FaqItemWrite = z.infer<typeof faqItemWriteSchema>;

/** The stored shape: the write fields plus the server-maintained timestamp. */
export const faqItemSchema = faqItemWriteSchema.extend({
  updatedAt: z.string().datetime().optional(),
});
export type FaqItem = z.infer<typeof faqItemSchema>;

export const faqItemsSchema = z.array(faqItemWriteSchema).max(MAX_FAQ_ITEMS)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Question IDs must be unique.');

/**
 * Applies per-question timestamps by diffing the submitted list against the
 * stored one on the stable question id.
 *
 * New questions are stamped; a question whose content, status, order or
 * category changed is re-stamped; an unchanged question keeps the timestamp it
 * already had (including "no timestamp" for legacy items). Comparing treats a
 * missing category as UNCATEGORIZED, so an untouched legacy question is not
 * re-stamped just because the client echoed the default back.
 */
export function stampItemTimestamps(
  previous: readonly FaqItem[],
  next: readonly FaqItemWrite[],
  now: Date,
): FaqItem[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nowIso = now.toISOString();

  return next.map((item) => {
    const before = previousById.get(item.id);
    const unchanged = before !== undefined && sameContent(before, item);
    const stamped: FaqItem = unchanged
      ? { ...item, ...(before.updatedAt ? { updatedAt: before.updatedAt } : {}) }
      : { ...item, updatedAt: nowIso };
    return stamped;
  });
}

function sameContent(stored: FaqItem, submitted: FaqItemWrite): boolean {
  return (
    stored.title === submitted.title &&
    stored.enabled === submitted.enabled &&
    stored.position === submitted.position &&
    stored.defaultOpen === submitted.defaultOpen &&
    (stored.category ?? 'UNCATEGORIZED') === (submitted.category ?? 'UNCATEGORIZED') &&
    audienceEqual(stored.audience, submitted.audience) &&
    JSON.stringify(stored.answer) === JSON.stringify(submitted.answer)
  );
}

/**
 * Scope equality is set-based: {A,B} and {B,A} are the same assignment, so
 * Reordering a selection does not re-stamp the question. Missing audience and
 * ALL are equivalent for legacy questions.
 */
function audienceEqual(
  stored: FaqAudience | undefined,
  submitted: FaqAudience | undefined,
): boolean {
  if ((stored?.scope ?? 'ALL') !== (submitted?.scope ?? 'ALL')) return false;
  if (stored?.scope !== 'PRODUCTS') return true;
  if (submitted?.scope !== 'PRODUCTS') return false;
  return (
    stored.productIds.length === submitted.productIds.length &&
    new Set([...stored.productIds, ...submitted.productIds]).size ===
      stored.productIds.length
  );
}

/**
 * Whether this question applies to the given product.
 *
 * Absent audience (legacy) and `scope: 'ALL'` are the same thing: every
 * product that inherits the shared library, present or future. A targeted
 * list with a missing product id does NOT apply to everything — an unknown
 * product must not silently inherit a question it was never assigned.
 */
export function audienceAppliesTo(item: FaqItem, productId: string | null): boolean {
  const audience = item.audience;
  if (!productId) return !audience || audience.scope === 'ALL';
  if (!audience || audience.scope === 'ALL') return true;
  return audience.productIds.includes(productId);
}

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
