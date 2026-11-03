import { z } from 'zod';

/**
 * The operator pastes a storefront URL; the server decides owner, code and
 * target. Anything else in the body is rejected instead of silently ignored.
 */
export const shortLinkCreateSchema = z
  .object({
    url: z.string().trim().min(1).max(2048),
  })
  .strict();

export type ShortLinkCreateInput = z.infer<typeof shortLinkCreateSchema>;
