import { z } from 'zod';
import { siteMediaUrl } from '../../common/site-media-url.js';

export const variantCardImageSchema = z.object({
  type: z.literal('IMAGE'),
  url: siteMediaUrl(),
  altText: z.string().max(255).nullable(),
}).strict();

export const variantCardMediaSchema = z.object({
  cover: variantCardImageSchema.nullable(),
  hover: variantCardImageSchema.nullable(),
}).strict();

export type VariantCardImage = z.infer<typeof variantCardImageSchema>;
export type VariantCardMedia = z.infer<typeof variantCardMediaSchema>;
