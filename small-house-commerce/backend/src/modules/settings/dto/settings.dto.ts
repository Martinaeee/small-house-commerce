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
  newsletterBandEnabled: z.boolean().optional(),
  newsletterPopupEnabled: z.boolean().optional(),
  newsletterPopupDelaySeconds: z.coerce.number().int().min(0).max(120).optional(),
  newsletterOfferTitle: z.string().trim().max(120).optional(),
  newsletterOfferBody: z.string().trim().max(500).optional(),
  newsletterEyebrow: z.string().trim().min(1).max(80).optional(),
  newsletterFormTitle: z.string().trim().min(1).max(120).optional(),
  newsletterEmailPlaceholder: z.string().trim().min(1).max(120).optional(),
  newsletterConsentText: z.string().trim().min(1).max(500).optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
