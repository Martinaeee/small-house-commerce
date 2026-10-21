import { z } from 'zod';
import { SourceType } from '../../../generated/prisma/client.js';

const adField = z.string().trim().max(64).nullable().default(null);
const utmField = z.string().trim().max(120).nullable().default(null);
export const campaignLinkCreateSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  landingPageId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  sourceType: z.nativeEnum(SourceType),
  campaignId: adField,
  adsetId: adField,
  adId: adField,
  utmSource: utmField,
  utmMedium: utmField,
  utmCampaign: utmField,
  utmContent: utmField,
  utmTerm: utmField,
}).strict();
export type CampaignLinkCreateInput = z.input<typeof campaignLinkCreateSchema>;
export const campaignLinkUpdateSchema = z.object({ name: z.string().trim().min(1).max(120), expectedVersion: z.number().int().nonnegative() }).strict();
export type CampaignLinkUpdateInput = z.infer<typeof campaignLinkUpdateSchema>;
export const campaignLinkVersionSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();
export const campaignLinkCloneSchema = campaignLinkCreateSchema.extend({
  campaignId: adField.removeDefault(),
  adsetId: adField.removeDefault(),
  adId: adField.removeDefault(),
  utmSource: utmField.removeDefault(),
  utmMedium: utmField.removeDefault(),
  utmCampaign: utmField.removeDefault(),
  utmContent: utmField.removeDefault(),
  utmTerm: utmField.removeDefault(),
}).partial();
export type CampaignLinkCloneInput = z.infer<typeof campaignLinkCloneSchema>;
export const campaignLinkQuerySchema = z.object({
  ownerUserId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  landingPageId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type CampaignLinkQuery = z.infer<typeof campaignLinkQuerySchema>;
