import { z } from 'zod';
import { siteMediaUrl } from '../../../common/site-media-url.js';
import { HomepageSectionType } from '../../../generated/prisma/client.js';
import { sectionLayoutSchemas } from '../homepage-document.js';
import { categoryNavigationShape, refineNavigationIds, ugcPayloadPublishSchema } from '../homepage-content-schema.js';

/** In-app path/hash ("/collections", "#solutions") or absolute https URL. */
const inAppOrHttps = z
  .string()
  .max(2048)
  .refine(
    (value) => {
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x1f || code === 0x7f || value[index] === '\\') {
          return false;
        }
      }
      if (value.startsWith('/') && !value.startsWith('//')) return true;
      if (value.startsWith('#')) return true;
      return z.url({ protocol: /^https$/ }).safeParse(value).success;
    },
    { message: 'Link must be a safe site path, anchor, or https URL' },
  );

/** Admin media URL: absolute http(s) link or site-relative /uploads path. */
const mediaUrl = () => siteMediaUrl();

const heroPayloadSchema = z.object({
  desktopImage: mediaUrl().optional(),
  mobileImage: mediaUrl().optional(),
  videoUrl: mediaUrl().optional(),
  posterImage: mediaUrl().optional(),
  ctaPrimaryText: z.string().min(1).max(120).optional(),
  ctaPrimaryLink: inAppOrHttps.optional(),
  ctaSecondaryText: z.string().min(1).max(120).optional(),
  ctaSecondaryLink: inAppOrHttps.optional(),
});

const uspItemSchema = z.object({
  icon: z.enum(['shield', 'home', 'lock', 'truck']).optional(),
  label: z.string().min(1).max(120),
  sub: z.string().max(200).optional(),
});

const uspPayloadSchema = z.object({
  items: z.array(uspItemSchema).max(4).optional(),
});

const categoryTilesPayloadSchema = z.object({
  categoryIds: z.array(z.string().uuid()).max(6).optional(),
  layout: sectionLayoutSchemas.CATEGORY_TILES.optional(),
}).extend(categoryNavigationShape).superRefine(refineNavigationIds);

const solutionItemSchema = z.object({
  title: z.string().min(1).max(120),
  blurb: z.string().max(300).optional(),
  link: inAppOrHttps,
});

const solutionsPayloadSchema = z.object({
  items: z.array(solutionItemSchema).max(6).optional(),
});

const productGridPayloadSchema = z.object({
  columns: z.union([z.literal(2), z.literal(4)]).optional(),
  layout: sectionLayoutSchemas.PRODUCT_GRID.optional(),
});

const productStoryPayloadSchema = z.object({
  layout: sectionLayoutSchemas.PRODUCT_STORY.optional(),
  imageUrl: mediaUrl().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
  ctaText: z.string().max(120).optional(),
  ctaLink: inAppOrHttps.optional(),
  productId: z.string().uuid().optional(),
});

const roomHotspotSchema = z.object({
  productId: z.string().uuid(),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
});

const roomSceneSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{8,16}$/),
  imageUrl: mediaUrl(),
  alt: z.string().max(120).optional(),
  hotspots: z
    .array(roomHotspotSchema)
    .max(8)
    .superRefine((hotspots, ctx) => {
      // Same product twice in one scene would stack two dots on one item.
      const seen = new Set<string>();
      hotspots.forEach((hotspot, index) => {
        if (seen.has(hotspot.productId)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'productId'],
            message: 'product appears twice in one scene',
          });
        }
        seen.add(hotspot.productId);
      });
    }),
});

const roomPayloadSchema = z.object({
  imageUrl: mediaUrl().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
  // Multi-scene hotspot gallery (spec 2026-09-15-room-scene-hotspots §2).
  scenes: z.array(roomSceneSchema).max(5).optional(),
});

const textBlockPayloadSchema = z.object({
  heading: z.string().max(120).optional(),
  body: z.string().max(3000).optional(),
  bullets: z.array(z.string().min(1).max(200)).max(6).optional(),
});

/** Per-type payload validation; service picks the schema by section.type. */
export const homepagePayloadSchemas: Record<HomepageSectionType, z.ZodType> = {
  [HomepageSectionType.HERO]: heroPayloadSchema,
  [HomepageSectionType.USP]: uspPayloadSchema,
  [HomepageSectionType.CATEGORY_TILES]: categoryTilesPayloadSchema,
  [HomepageSectionType.PRODUCT_GRID]: productGridPayloadSchema,
  [HomepageSectionType.SOLUTIONS]: solutionsPayloadSchema,
  [HomepageSectionType.PRODUCT_STORY]: productStoryPayloadSchema,
  [HomepageSectionType.ROOM_INSPIRATION]: roomPayloadSchema,
  [HomepageSectionType.UGC]: ugcPayloadPublishSchema,
  [HomepageSectionType.BRAND_STORY]: textBlockPayloadSchema,
  [HomepageSectionType.CONFIDENCE]: textBlockPayloadSchema,
};
