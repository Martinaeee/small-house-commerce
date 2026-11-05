import { z } from 'zod';

export const checkoutDraftCustomerSchema = z
  .object({
    name: z.string().max(120),
    phone: z.string().max(24),
    province: z.string().max(120),
    city: z.string().max(120),
    barangay: z.string().max(120),
    postalCode: z.string().max(20),
    streetAddress: z.string().max(255),
    landmark: z.string().max(255),
  })
  .strict();

export const checkoutDraftSaveSchema = z
  .object({
    revision: z.number().int().min(1).max(1_000_000),
    hasUserInput: z.boolean(),
    customer: checkoutDraftCustomerSchema,
    items: z
      .array(
        z.object({
          skuId: z.string().uuid(),
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .max(100),
    preferredDeliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    promoCodeInput: z.string().max(32),
    promoCodeApplied: z.string().max(32).nullable(),
    customerNote: z.string().max(200),
  })
  .strict();

export type CheckoutDraftSaveInput = z.infer<typeof checkoutDraftSaveSchema>;

export const CHECKOUT_DRAFT_FOLLOW_UP_STATUSES = [
  'TO_CONTACT',
  'NO_ANSWER',
  'FOLLOW_UP_LATER',
  'WANTS_TO_BUY',
  'DECLINED',
] as const;

export const checkoutDraftQuerySchema = z.object({
  search: z.string().max(255).optional(),
  status: z.enum(['OPEN', 'CONVERTED']).optional(),
  /** UNFOLLOWED = 还没分配或还没人记录过结果。 */
  followUpStatus: z.enum(['UNFOLLOWED', ...CHECKOUT_DRAFT_FOLLOW_UP_STATUSES]).optional(),
  assigneeId: z.string().uuid().optional(),
  dueOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CheckoutDraftQuery = z.infer<typeof checkoutDraftQuerySchema>;

export const checkoutDraftFollowUpSchema = z
  .object({
    status: z.enum(CHECKOUT_DRAFT_FOLLOW_UP_STATUSES),
    assigneeId: z.string().uuid().nullable().optional(),
    nextFollowUpAt: z.iso.datetime().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export type CheckoutDraftFollowUpInput = z.infer<typeof checkoutDraftFollowUpSchema>;
