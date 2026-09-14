import { z } from 'zod';

export const presignUploadSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  fileName: z.string().trim().min(1).max(255),
});
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;
