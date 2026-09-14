import { z } from 'zod';
import { OrderStatus, SourceType } from '../../../generated/prisma/client.js';

export const checkoutSchema = z.object({
  customer: z.object({
    name: z.string().min(1).max(120),
    // Loose on purpose: normalized to E.164 in the service.
    phone: z.string().min(7).max(24),
    province: z.string().min(1).max(120),
    city: z.string().min(1).max(120),
    barangay: z.string().max(120).nullable().optional(),
    postalCode: z.string().max(20).nullable().optional(),
    streetAddress: z.string().min(1).max(255),
    landmark: z.string().max(255).nullable().optional(),
  }),
  items: z
    .array(
      z.object({
        skuId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1),
  attribution: z.object({
    sourceType: z.nativeEnum(SourceType).default('ORGANIC'),
    aid: z.string().max(64).nullable().optional(),
    optimizerId: z.string().uuid().nullable().optional(),
    facebookPostId: z.string().max(64).nullable().optional(),
    campaignId: z.string().max(64).nullable().optional(),
    adsetId: z.string().max(64).nullable().optional(),
    adId: z.string().max(64).nullable().optional(),
    landingPageId: z.string().uuid().nullable().optional(),
    utmSource: z.string().max(120).nullable().optional(),
    utmMedium: z.string().max(120).nullable().optional(),
    utmCampaign: z.string().max(120).nullable().optional(),
  }),
});

export const orderQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  search: z.string().max(255).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type OrderQuery = z.infer<typeof orderQuerySchema>;
