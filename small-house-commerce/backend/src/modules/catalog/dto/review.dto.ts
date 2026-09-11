// src/modules/catalog/dto/review.dto.ts
import { z } from 'zod';

// Admin enters reviews for cold start (PDP_SPEC §22). Photos are URLs, max 6.
const photoSchema = z.string().url().max(2048);

export const createAdminReviewSchema = z.object({
  authorName: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(200).optional(),
  comment: z.string().trim().min(1).max(5000),
  photos: z.array(photoSchema).max(6).default([]),
  isVisible: z.boolean().default(true),
});
export type CreateAdminReviewInput = z.infer<typeof createAdminReviewSchema>;

// PATCH: every field optional; no defaults here so an omitted field means
// "leave unchanged" (same partial-update convention as updateProductSchema).
export const updateAdminReviewSchema = createAdminReviewSchema
  .partial()
  .extend({
    // Allow explicitly clearing the optional text fields.
    location: z.string().trim().max(120).nullable().optional(),
    title: z.string().trim().max(200).nullable().optional(),
  });
export type UpdateAdminReviewInput = z.infer<typeof updateAdminReviewSchema>;
