import { z } from 'zod';
import { HomepageSectionType } from '../../../generated/prisma/client.js';

/** In-app path/hash ("/collections", "#solutions") or absolute https URL. */
const inAppOrHttps = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      (value.startsWith('/') && !value.startsWith('//')) ||
      value.startsWith('#') ||
      value.startsWith('https://'),
    { message: 'Link must start with / or # (but not //), or be an https URL' },
  );

/** Absolute https media URL only (CDN/R2 presigned links). */
const mediaUrl = () =>
  z
    .string()
    .url()
    .max(2048)
    .refine((value) => value.startsWith('https://'), {
      message: 'Media URL must be an https:// URL',
    });

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
});

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
});

const productStoryPayloadSchema = z.object({
  imageUrl: mediaUrl().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
  ctaText: z.string().max(120).optional(),
  ctaLink: inAppOrHttps.optional(),
  productId: z.string().uuid().optional(),
});

const roomPayloadSchema = z.object({
  imageUrl: mediaUrl().optional(),
  heading: z.string().max(120).optional(),
  body: z.string().max(2000).optional(),
});

const ugcEntrySchema = z.object({
  imageUrl: mediaUrl().optional(),
  name: z.string().min(1).max(120),
  location: z.string().max(120).optional(),
  comment: z.string().min(1).max(1000),
  productId: z.string().uuid().optional(),
});

const ugcPayloadSchema = z.object({
  entries: z.array(ugcEntrySchema).max(6).optional(),
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
  [HomepageSectionType.UGC]: ugcPayloadSchema,
  [HomepageSectionType.BRAND_STORY]: textBlockPayloadSchema,
  [HomepageSectionType.CONFIDENCE]: textBlockPayloadSchema,
};

const homepageSectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.nativeEnum(HomepageSectionType).optional(),
  title: z.string().max(200).nullable().optional(),
  subtitle: z.string().max(500).nullable().optional(),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  // Validated per type inside HomepageService (it knows the row's type).
  payload: z.unknown().optional(),
});

export const saveHomepageSectionsSchema = z.object({
  sections: z.array(homepageSectionInputSchema).min(1).max(20),
});

export const setHomepageProductsSchema = z.object({
  rows: z
    .array(
      z.object({
        productId: z.string().uuid(),
        sortOrder: z.number().int().min(0).max(999),
        badge: z.string().max(20).nullable().optional(),
      }),
    )
    .max(24),
});

export type SaveHomepageSectionsInput = z.infer<typeof saveHomepageSectionsSchema>;
export type SetHomepageProductsInput = z.infer<typeof setHomepageProductsSchema>;
