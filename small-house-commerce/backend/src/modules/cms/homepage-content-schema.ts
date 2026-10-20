import { z } from 'zod';
import { siteMediaUrl } from '../../common/site-media-url.js';

const navigationLinkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CATEGORY'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('COLLECTION'), id: z.string().uuid() }).strict(),
]);

export const navigationEntrySchema = z.object({
  id: z.string().uuid(),
  label: z.string().max(120).optional(),
  imageUrl: siteMediaUrl().optional(),
  link: navigationLinkSchema.nullable(),
});

export const categoryNavigationShape = {
  entries: z.array(navigationEntrySchema).max(6).optional(),
  presentation: z.enum(['TILES', 'CIRCLES']).optional(),
};

export function refineNavigationIds(
  payload: { entries?: { id: string }[] },
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  payload.entries?.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: 'Duplicate entry identity' });
    }
    seen.add(entry.id);
  });
}

export const categoryNavigationDraftSchema = z.object(categoryNavigationShape)
  .passthrough().superRefine(refineNavigationIds);

export const ugcEntryDraftSchema = z.object({
  id: z.string().uuid().optional(),
  imageUrl: siteMediaUrl().optional(),
  name: z.string().max(120),
  location: z.string().max(120).optional(),
  comment: z.string().max(1000),
  productId: z.string().uuid().optional(),
  // Focal point of the photo in percent; the storefront crops around it.
  focalX: z.number().min(0).max(100).optional(),
  focalY: z.number().min(0).max(100).optional(),
});

export const ugcPresentationSchema = z.object({
  layout: z.enum(['CARDS', 'COLLAGE']),
  // How the photos sit next to the large one; GRID is the default.
  collageVariant: z.enum(['GRID', 'STRIP', 'PORTRAIT']).optional(),
  featuredEntryId: z.string().uuid().optional(),
  showQuote: z.boolean().optional(),
  overlay: z.enum(['SOFT', 'STRONG']).optional(),
}).strict();

export const ugcContentDraftSchema = z.object({
  entries: z.array(ugcEntryDraftSchema).max(12).optional(),
  presentation: ugcPresentationSchema.optional(),
}).passthrough().superRefine((payload, ctx) => {
  const seen = new Set<string>();
  (payload.entries ?? []).forEach((entry, index) => {
    if (!entry.id && payload.presentation?.layout === 'COLLAGE') {
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: 'Collage photo identity required' });
    }
    if (entry.id && seen.has(entry.id)) {
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: 'Duplicate photo identity' });
    }
    if (entry.id) seen.add(entry.id);
  });
  const featured = payload.presentation?.featuredEntryId;
  if (featured !== undefined && !seen.has(featured)) {
    ctx.addIssue({ code: 'custom', path: ['presentation', 'featuredEntryId'], message: 'Featured photo is not in this section' });
  }
});

export const ugcPayloadPublishSchema = ugcContentDraftSchema.superRefine((payload, ctx) => {
  if (payload.presentation?.layout === 'COLLAGE') return;
  payload.entries?.forEach((entry, index) => {
    for (const field of ['name', 'comment'] as const) {
      if (entry[field].length === 0) {
        ctx.addIssue({ code: 'custom', path: ['entries', index, field], message: 'Card content required' });
      }
    }
  });
});
