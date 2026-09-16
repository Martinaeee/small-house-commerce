import { z } from 'zod';

/** Empty (feature hidden) or an absolute https:// URL, max 500 chars. */
const messengerUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      if (value === '') return true;
      if (!value.startsWith('https://')) return false;
      try {
        // Rejects malformed URLs; javascript:/http: are blocked by the prefix check.
        const url = new URL(value);
        return url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'messengerUrl must be empty or an absolute https:// URL' },
  );

export const updateSettingsSchema = z.object({
  messengerUrl: messengerUrlSchema,
  // Email is the guaranteed fallback channel, so it is required and non-empty.
  supportEmail: z.string().trim().min(1).email().max(200),
  supportHours: z.string().trim().min(1).max(100),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
