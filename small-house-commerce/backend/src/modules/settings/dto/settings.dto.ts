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

const supportPhoneSchema = z
  .string()
  .trim()
  .max(20)
  .refine(
    (value) => value === '' || /^[0-9+()\- ]{7,20}$/.test(value),
    {
      message:
        'supportPhone must be empty or contain 7–20 phone characters',
    },
  );

export const updateSettingsSchema = z.object({
  messengerUrl: messengerUrlSchema,
  supportPhone: supportPhoneSchema.optional(),
  // Footer support email/hours are owned by the Storefront Shell draft and
  // mirrored into SiteSetting only by an atomic shell publication.
  // Newsletter display config remains optional so the contact form and the
  // newsletter settings form can share this endpoint during the handoff.
  newsletterBandEnabled: z.boolean().optional(),
  newsletterPopupEnabled: z.boolean().optional(),
  newsletterPopupDelaySeconds: z.coerce.number().int().min(0).max(120).optional(),
  newsletterOfferTitle: z.string().trim().max(120).optional(),
  newsletterOfferBody: z.string().trim().max(500).optional(),
  newsletterEyebrow: z.string().trim().min(1).max(80).optional(),
  newsletterFormTitle: z.string().trim().min(1).max(120).optional(),
  newsletterEmailPlaceholder: z.string().trim().min(1).max(120).optional(),
  newsletterConsentText: z.string().trim().min(1).max(500).optional(),
  // Site-wide default for the PDP selling-point pills; products left on
  // INHERIT follow it, SHOW/HIDE on a product wins.
  hideSellingPoints: z.boolean().optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
