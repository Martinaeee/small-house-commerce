import { z } from 'zod';
import { CampaignLinkAttributionMode, SourceType } from '../../../generated/prisma/client.js';
import { isFacebookPostUrl } from '../marketing-post.js';

const adField = z.string().trim().max(64).nullable().default(null);
const utmField = z.string().trim().max(120).nullable().default(null);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date.');
const postUrlField = z.string().trim().max(2048).refine(isFacebookPostUrl, 'Use an HTTPS Facebook post URL.').nullable();
const postFields = { postDate: calendarDate.nullable().optional(), postUrl: postUrlField.optional() };
const archiveState = z.enum(['UNARCHIVED', 'ARCHIVED', 'ALL']).default('ALL');
const missingOnly = z.enum(['true', 'false']).transform((value) => value === 'true').optional();

const campaignLinkCreateBase = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  landingPageId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  sourceType: z.nativeEnum(SourceType),
  attributionMode: z.nativeEnum(CampaignLinkAttributionMode).optional(),
  campaignId: adField,
  adsetId: adField,
  adId: adField,
  utmSource: utmField,
  utmMedium: utmField,
  utmCampaign: utmField,
  utmContent: utmField,
  utmTerm: utmField,
  ...postFields,
}).strict();

export const campaignLinkCreateSchema = campaignLinkCreateBase.superRefine((value, ctx) => {
  const hasPostField = value.postDate !== undefined || value.postUrl !== undefined;
  if (hasPostField && value.sourceType !== 'FB_POST') {
    ctx.addIssue({ code: 'custom', path: ['postDate'], message: 'Post fields require FB_POST.' });
  }
  if (!value.name && !(value.sourceType === 'FB_POST' && value.postDate)) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'Name is required.' });
  }
  if (value.adId?.includes('{{')) {
    ctx.addIssue({ code: 'custom', path: ['adId'], message: 'Meta URL templates belong in Meta URL parameters, not the stored ad ID.' });
  }
  if (value.sourceType === 'FB_POST' && value.attributionMode === 'AID') {
    ctx.addIssue({ code: 'custom', path: ['attributionMode'], message: 'Facebook post links keep the cl attribution code.' });
  }
});
export type CampaignLinkCreateInput = z.input<typeof campaignLinkCreateSchema>;

export const campaignLinkUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  ...postFields,
  expectedVersion: z.number().int().nonnegative(),
}).strict().refine((value) => value.name !== undefined || value.postDate !== undefined || value.postUrl !== undefined, {
  message: 'At least one editable field is required.',
});
export type CampaignLinkUpdateInput = z.infer<typeof campaignLinkUpdateSchema>;

export const campaignLinkVersionSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();

export const campaignLinkCloneSchema = campaignLinkCreateBase.extend({
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

function refinePostFilters(value: {
  sourceType?: SourceType;
  postDateFrom?: string;
  postDateTo?: string;
  postDateMissingOnly?: boolean;
}, ctx: z.RefinementCtx) {
  if (value.postDateMissingOnly && (value.postDateFrom || value.postDateTo)) {
    ctx.addIssue({ code: 'custom', path: ['postDateMissingOnly'], message: 'Missing-only excludes a date range.' });
  }
  if (value.postDateFrom && value.postDateTo && value.postDateFrom > value.postDateTo) {
    ctx.addIssue({ code: 'custom', path: ['postDateTo'], message: 'Post date range must be ordered.' });
  }
  const hasPostDate = Boolean(value.postDateFrom || value.postDateTo || value.postDateMissingOnly);
  if (hasPostDate && value.sourceType && value.sourceType !== 'FB_POST') {
    ctx.addIssue({ code: 'custom', path: ['sourceType'], message: 'Post date filters require FB_POST.' });
  }
}

const campaignLinkFilterBase = z.object({
  ownerUserId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  landingPageId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  sourceType: z.nativeEnum(SourceType).optional(),
  archiveState,
  postDateFrom: calendarDate.optional(),
  postDateTo: calendarDate.optional(),
  postDateMissingOnly: missingOnly,
  orderBy: z.enum(['CREATED_AT_DESC', 'POST_DATE_DESC']).default('CREATED_AT_DESC'),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const campaignLinkQuerySchema = campaignLinkFilterBase.superRefine(refinePostFilters);
export type CampaignLinkQuery = z.infer<typeof campaignLinkQuerySchema>;

export const campaignLinkGroupQuerySchema = campaignLinkFilterBase.omit({ orderBy: true }).superRefine(refinePostFilters);
export type CampaignLinkGroupQuery = z.infer<typeof campaignLinkGroupQuerySchema>;
