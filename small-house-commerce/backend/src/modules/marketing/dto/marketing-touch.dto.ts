import { z } from 'zod';
import { SourceType } from '../../../generated/prisma/client.js';

const adField = z.string().trim().max(64).nullable().optional();
const utmField = z.string().trim().max(120).nullable().optional();
const metadata = {
  facebookPostId: adField, campaignId: adField, adsetId: adField, adId: adField,
  utmSource: utmField, utmMedium: utmField, utmCampaign: utmField, utmContent: utmField, utmTerm: utmField,
};

export const marketingTouchSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  visitKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  path: z.string().min(1).max(512).refine((path) => path.startsWith('/') && !path.startsWith('//') && !/[?#\\]/.test(path)).optional(),
  productId: z.string().uuid().optional(),
  landingPageId: z.string().uuid().optional(),
  aid: z.string().max(64).optional(),
  sourceType: z.nativeEnum(SourceType).optional(),
  ...metadata,
}).strict();
export type MarketingTouchInput = z.infer<typeof marketingTouchSchema>;

export const marketingTouchClaimsSchema = z.object({
  purpose: z.literal('marketing-touch'),
  version: z.literal(1),
  ownerUserId: z.string().uuid(),
  aid: z.string().min(1).max(64),
  ownerName: z.string(),
  linkId: z.string().uuid().nullable(),
  productId: z.string().uuid().nullable(),
  productName: z.string().nullable(),
  productCode: z.string().nullable(),
  landingPageId: z.string().uuid().nullable(),
  publishedRevision: z.number().int().nonnegative().nullable(),
  sourceType: z.nativeEnum(SourceType),
  facebookPostId: z.string().nullable(), campaignId: z.string().nullable(), adsetId: z.string().nullable(), adId: z.string().nullable(),
  utmSource: z.string().nullable(), utmMedium: z.string().nullable(), utmCampaign: z.string().nullable(), utmContent: z.string().nullable(), utmTerm: z.string().nullable(),
  legacy: z.boolean(),
  touchedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
}).strict();
export type MarketingTouchClaims = z.infer<typeof marketingTouchClaimsSchema>;
