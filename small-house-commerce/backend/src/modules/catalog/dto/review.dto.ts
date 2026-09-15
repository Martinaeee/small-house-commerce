// src/modules/catalog/dto/review.dto.ts
import { z } from 'zod';

// Admin enters reviews for cold start (PDP_SPEC §22). Photos are URLs, max 6.
const photoSchema = z.string().url().max(2048);

// Merchants may backdate reviews to spread cold-start content over time.
// Omitted = server now(). Future timestamps are rejected; ISO 8601 only
// (the client converts its datetime-local value with toISOString()).
const reviewCreatedAtSchema = z
  .iso.datetime()
  .refine((v) => Date.parse(v) >= Date.UTC(2000, 0, 1), {
    message: '评论时间不能早于 2000 年',
  })
  .refine((v) => Date.parse(v) <= Date.now() + 60_000, {
    message: '评论时间不能晚于当前时间',
  });

export const createAdminReviewSchema = z.object({
  authorName: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(200).optional(),
  comment: z.string().trim().min(1).max(5000),
  // Amazon-style option descriptor, e.g. "Color: Walnut Brown | Size: S".
  variant: z.string().trim().max(300).optional(),
  photos: z.array(photoSchema).max(6).default([]),
  isVisible: z.boolean().default(true),
  createdAt: reviewCreatedAtSchema.optional(),
});
export type CreateAdminReviewInput = z.infer<typeof createAdminReviewSchema>;

// PATCH: every field optional; no defaults may survive here so an omitted
// field means "leave unchanged". Zod 4's .partial() PRESERVES inner
// defaults, so omit the defaulted fields first and re-add them plain —
// the same convention as updateProductSchema in product.dto.ts.
export const updateAdminReviewSchema = createAdminReviewSchema
  .omit({ photos: true, isVisible: true })
  .partial()
  .extend({
    photos: z.array(photoSchema).max(6).optional(),
    isVisible: z.boolean().optional(),
    // Allow explicitly clearing the optional text fields.
    location: z.string().trim().max(120).nullable().optional(),
    title: z.string().trim().max(200).nullable().optional(),
    variant: z.string().trim().max(300).nullable().optional(),
  });
export type UpdateAdminReviewInput = z.infer<typeof updateAdminReviewSchema>;

// Rows are validated one-by-one against createAdminReviewSchema inside the
// service: the outer schema only bounds the batch size so a huge paste
// fails fast and row-level errors can point at the offending row.
export const batchReviewsSchema = z.object({
  items: z.array(z.unknown()).min(1).max(100),
});
export type BatchReviewsInput = z.infer<typeof batchReviewsSchema>;
