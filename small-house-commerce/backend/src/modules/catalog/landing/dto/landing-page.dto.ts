import { z } from 'zod';
import { LandingPageStatus } from '../../../../generated/prisma/client.js';

export const landingImageOverrideSchema = z.object({
  url: z.string().url().max(2048),
  altText: z.string().trim().max(200).nullable().optional(),
});
export type LandingImageOverrideInput = z.infer<typeof landingImageOverrideSchema>;

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug 只能使用小写字母、数字、连字符，且不能以连字符开头或结尾');

// Cross-field rules shared by create/update: promo block needs its headline,
// and the schedule window must be ordered. Structurally typed so both the
// create output and the partial update output satisfy it.
interface LandingRuleFields {
  promoEnabled?: boolean;
  promoHeadline?: string | null;
  startAt?: string | null;
  endAt?: string | null;
}

function applyLandingRules(data: LandingRuleFields, ctx: z.RefinementCtx) {
  if (data.promoEnabled === true && !data.promoHeadline?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '开启促销块时必须填写促销标题',
      path: ['promoHeadline'],
    });
  }
  if (data.startAt && data.endAt && new Date(data.endAt).getTime() <= new Date(data.startAt).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '结束时间必须晚于开始时间', path: ['endAt'] });
  }
}

const landingPageBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  adCode: z.string().trim().max(64).nullable().optional(),
  titleOverride: z.string().trim().max(200).nullable().optional(),
  imagesOverride: z.array(landingImageOverrideSchema).max(10).nullable().optional(),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),
  promoEnabled: z.boolean().optional(),
  promoHeadline: z.string().trim().max(120).nullable().optional(),
  promoSubtext: z.string().trim().max(200).nullable().optional(),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.nativeEnum(LandingPageStatus).optional(),
  sortOrder: z.number().int().min(0).max(99999).optional(),
});

export const createLandingPageSchema = landingPageBaseSchema
  .extend({ slug: slugSchema })
  .superRefine(applyLandingRules);
export type CreateLandingPageInput = z.infer<typeof createLandingPageSchema>;

// Slug is immutable after creation.
export const updateLandingPageSchema = landingPageBaseSchema.partial().superRefine(applyLandingRules);
export type UpdateLandingPageInput = z.infer<typeof updateLandingPageSchema>;

export const adminLandingPageQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.nativeEnum(LandingPageStatus).optional(),
  effectiveStatus: z.enum(['DRAFT', 'LIVE', 'SCHEDULED', 'ENDED', 'DISABLED']).optional(),
  productId: z.string().uuid().optional(),
  ownerUserId: z.string().uuid().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  periodFrom: z.string().date().optional(),
  periodTo: z.string().date().optional(),
  sortBy: z.enum(['updatedAt', 'title']).default('updatedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).refine((query) => (!query.periodFrom && !query.periodTo) || Boolean(query.periodFrom && query.periodTo && query.periodFrom <= query.periodTo), { message: 'Provide both ordered accounting-period dates.', path: ['periodTo'] });
export type AdminLandingPageQuery = z.infer<typeof adminLandingPageQuerySchema>;

export const marketingProductPickerQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type MarketingProductPickerQuery = z.infer<typeof marketingProductPickerQuerySchema>;

export const bulkTitleLandingPagesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  titleOverride: z.string().trim().min(1).max(200),
});
export type BulkTitleLandingPagesInput = z.infer<typeof bulkTitleLandingPagesSchema>;

export const landingPageViewSchema = z.object({
  // Per-tab-session UUID generated in the browser; length guard only.
  visitKey: z.string().trim().min(8).max(100),
});
export type LandingPageViewInput = z.infer<typeof landingPageViewSchema>;

export const landingVersionSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();
export const landingDraftWriteSchema = landingVersionSchema.extend({
  content: z.record(z.string(), z.unknown()),
  name: z.string().trim().min(1).max(120).optional(),
}).strict();
export type LandingDraftWriteInput = z.infer<typeof landingDraftWriteSchema>;
export type LandingVersionInput = z.infer<typeof landingVersionSchema>;

export const landingDraftCreateSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  ownerUserId: z.string().uuid().optional(),
}).strict();
export type LandingDraftCreateInput = z.infer<typeof landingDraftCreateSchema>;

export const landingAssignOwnerSchema = landingVersionSchema.extend({ ownerUserId: z.string().uuid() }).strict();
export type LandingAssignOwnerInput = z.infer<typeof landingAssignOwnerSchema>;

export const landingSyncSchema = landingVersionSchema.extend({
  sourceKeys: z.array(z.string().min(1).max(200)).min(1).max(60).refine((keys) => new Set(keys).size === keys.length),
  insertBeforeId: z.string().min(1).max(100).nullable().optional(),
}).strict();
export type LandingSyncInput = z.infer<typeof landingSyncSchema>;
