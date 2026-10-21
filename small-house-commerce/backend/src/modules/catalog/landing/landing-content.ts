import { BadRequestException } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { siteMediaUrl } from '../../../common/site-media-url.js';

export const MAX_BLOCKS = 60;
export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const MAX_RICH_TEXT_BYTES = 20 * 1024;

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h3', 'h4'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        try {
          const protocol = new URL(attribs.href).protocol;
          if (!['http:', 'https:', 'mailto:'].includes(protocol)) delete attribs.href;
        } catch {
          delete attribs.href;
        }
        return { tagName, attribs };
      },
    },
  });
}

export const landingMediaSchema = siteMediaUrl().refine(
  (value) => Array.from(value).every((char) => char !== '\\' && char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127),
  'Media URLs cannot contain backslashes or control characters.',
);
const richText = z.string().refine(
  (value) => Buffer.byteLength(value, 'utf8') <= MAX_RICH_TEXT_BYTES,
  'Rich text is too large.',
).transform(sanitizeRichText);
const media = z.object({
  url: landingMediaSchema,
  type: z.enum(['IMAGE', 'VIDEO']),
  altText: z.string().max(200).nullable().default(null),
  optionValueId: z.string().uuid().nullable().default(null),
  variantId: z.string().uuid().nullable().default(null),
}).strict();
const identity = {
  id: z.string().min(1).max(100),
  sourceKey: z.string().min(1).max(200).nullable(),
};
const liveProps = z.object({}).strict();
const block = <T extends string, P extends z.ZodType>(type: T, props: P) =>
  z.object({ ...identity, type: z.literal(type), props }).strict();

export const landingBlockSchema = z.discriminatedUnion('type', [
  block('hero', z.object({
    title: z.string().trim().min(1).max(200),
    tagline: z.string().max(300).nullable().default(null),
    promoHeadline: z.string().max(120).nullable().default(null),
    promoSubtext: z.string().max(200).nullable().default(null),
  }).strict()),
  block('gallery', z.object({ media: z.array(media).max(500) }).strict()),
  block('buy', liveProps),
  block('richText', z.object({ html: richText }).strict()),
  block('custom', z.object({ html: richText }).strict()),
  block('detail', z.object({ media: z.array(media).max(500) }).strict()),
  block('facts', liveProps),
  block('reviews', liveProps),
  block('faq', liveProps),
]);
export const landingContentSchema = z.object({
  schemaVersion: z.literal(1),
  seoTitle: z.string().max(200).nullable().default(null),
  seoDescription: z.string().max(300).nullable().default(null),
  startAt: z.string().datetime({ offset: true }).nullable().default(null),
  endAt: z.string().datetime({ offset: true }).nullable().default(null),
  blocks: z.array(landingBlockSchema).min(1).max(MAX_BLOCKS),
}).strict().superRefine((content, ctx) => {
  if (content.startAt && content.endAt && new Date(content.endAt) <= new Date(content.startAt))
    ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'The end must be after the start.' });
  if (content.blocks.filter((item) => item.type === 'buy').length !== 1)
    ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'Exactly one live purchase block is required.' });
  if (new Set(content.blocks.map((item) => item.id)).size !== content.blocks.length)
    ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'Block IDs must be unique.' });
  const sources = content.blocks.flatMap((item) => item.sourceKey ? [item.sourceKey] : []);
  if (new Set(sources).size !== sources.length)
    ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'Source references must be unique.' });
});
export type LandingContent = z.output<typeof landingContentSchema>;
export type LandingBlock = LandingContent['blocks'][number];

export function normaliseLandingContent(input: unknown): LandingContent {
  const bytes = Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8');
  if (bytes > MAX_DOCUMENT_BYTES)
    throw new BadRequestException({ code: 'LANDING_CONTENT_TOO_LARGE', message: 'Landing content is too large.' });
  const result = landingContentSchema.safeParse(input);
  if (!result.success)
    throw new BadRequestException({ code: 'LANDING_CONTENT_INVALID', message: 'Invalid landing content.', issues: result.error.issues });
  return result.data;
}
