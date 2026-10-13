import { z } from 'zod';

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9-]{3,32}$/,
    'Code must be 3–32 characters of A–Z, 0–9 or hyphen.',
  );

const validFromSchema = z.string().datetime().nullable();
const validUntilSchema = z.string().datetime().nullable();

function addWindowIssue(
  value: { validFrom?: string | null; validUntil?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (
    value.validFrom &&
    value.validUntil &&
    new Date(value.validUntil) <= new Date(value.validFrom)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['validUntil'],
      message: 'validUntil must be after validFrom.',
    });
  }
}

export const createPromotionSchema = z
  .object({
    code: codeSchema,
    discountType: z.enum(['PERCENT', 'FIXED']),
    discountValue: z.number().positive(),
    minSpend: z.number().min(0).default(0),
    maxUses: z.number().int().min(1).nullable().default(null),
    perCustomerLimit: z.number().int().min(1).nullable().default(null),
    validFrom: validFromSchema.default(null),
    validUntil: validUntilSchema.default(null),
  })
  .superRefine((value, ctx) => {
    if (value.discountType === 'PERCENT' && value.discountValue > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'A percentage discount cannot exceed 100.',
      });
    }
    addWindowIssue(value, ctx);
  });

export const updatePromotionSchema = z
  .object({
    code: codeSchema.optional(),
    discountType: z.enum(['PERCENT', 'FIXED']).optional(),
    discountValue: z.number().positive().optional(),
    minSpend: z.number().min(0).optional(),
    maxUses: z.number().int().min(1).nullable().optional(),
    perCustomerLimit: z.number().int().min(1).nullable().optional(),
    validFrom: validFromSchema.optional(),
    validUntil: validUntilSchema.optional(),
  })
  .superRefine((value, ctx) => {
    addWindowIssue(value, ctx);
  });

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
