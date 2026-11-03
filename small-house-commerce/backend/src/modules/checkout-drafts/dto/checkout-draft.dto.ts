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

export const checkoutDraftQuerySchema = z.object({
  search: z.string().max(255).optional(),
  status: z.enum(['OPEN', 'CONVERTED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CheckoutDraftQuery = z.infer<typeof checkoutDraftQuerySchema>;
