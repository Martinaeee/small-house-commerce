// src/modules/catalog/dto/review-feedback.dto.ts
import { z } from 'zod';

// PDP "Report" link. The reason is optional: Amazon-style flows allow a
// one-click report. Empty/whitespace is stored as null.
export const reportReviewSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type ReportReviewInput = z.infer<typeof reportReviewSchema>;
