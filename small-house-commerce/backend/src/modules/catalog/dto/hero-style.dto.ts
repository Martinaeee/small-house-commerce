import { z } from 'zod';
import { siteMediaUrl } from '../../../common/site-media-url.js';
import { HeroBackgroundType } from '../../../generated/prisma/client.js';

/**
 * Hero appearance for category and collection landing pages. Shared by both
 * DTOs because the storefront renders either through the same component.
 *
 * Absence semantics on the parent schema: `undefined` = leave the stored style
 * untouched, `null` = remove it, an object = upsert it.
 */

/** #rrggbb only — that is exactly what the admin colour inputs emit. */
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'colour must be #rrggbb');

/** Fixed set; the storefront maps each key to a concrete font stack, so no
 *  arbitrary webfont can be loaded from the admin. */
export const HERO_FONTS = ['brand', 'sans', 'serif'] as const;

export const heroStyleSchema = z.object({
  titleOverride: z.string().max(120).nullable().optional(),
  titleColor: hexColor.nullable().optional(),
  titleSize: z.number().int().min(16).max(96).nullable().optional(),
  titleFont: z.enum(HERO_FONTS).nullable().optional(),
  backgroundType: z.nativeEnum(HeroBackgroundType).optional(),
  backgroundColor: hexColor.nullable().optional(),
  backgroundImageUrl: siteMediaUrl().nullable().optional(),
  backgroundBlur: z.number().int().min(0).max(24).optional(),
});

export type HeroStyleInput = z.infer<typeof heroStyleSchema>;
