import { z } from 'zod';

/**
 * Storefront analytics payloads (dashboard §18).
 *
 * The endpoint is public, so every field is bounded and unknown keys are
 * rejected. `occurredAt` is accepted for ordering but never trusted as the
 * stored time: the server clock decides `created_at`, and the Manila
 * calendar day fixes impression dedupe.
 */
export const analyticsEventNames = [
  'PAGE_VIEW',
  'PRODUCT_VIEW',
  'ADD_TO_CART',
  'BEGIN_CHECKOUT',
  'PURCHASE',
  'HOMEPAGE_SECTION_IMPRESSION',
  'HOMEPAGE_SECTION_CLICK',
  'SEARCH',
] as const;

export const analyticsEventSchema = z
  .object({
    eventName: z.enum(analyticsEventNames),
    sessionId: z.string().min(8).max(100),
    pageUrl: z.string().max(1024).default(''),
    pagePath: z.string().max(512).default('/'),
    deviceType: z.enum(['desktop', 'tablet', 'mobile']).default('desktop'),
    referrer: z.string().max(1024).nullable().optional(),
    utmSource: z.string().max(120).nullable().optional(),
    utmMedium: z.string().max(120).nullable().optional(),
    utmCampaign: z.string().max(120).nullable().optional(),
    entityId: z.string().max(120).nullable().optional(),
    sectionId: z.string().max(120).nullable().optional(),
    sectionType: z.string().max(40).nullable().optional(),
    destination: z.string().max(1024).nullable().optional(),
    productId: z.uuid().nullable().optional(),
    campaignId: z.string().max(120).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** Signed marketing-touch credential. The server verifies the HMAC and
     *  keeps only the resolved campaign link id; the credential itself is
     *  never stored. */
    marketingCredential: z.string().max(8192).optional(),
  })
  .strict();

export const analyticsBatchSchema = z
  .object({
    events: z.array(analyticsEventSchema).min(1).max(20),
  })
  .strict();

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;
export type AnalyticsBatchInput = z.infer<typeof analyticsBatchSchema>;
