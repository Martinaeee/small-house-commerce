import { z } from 'zod';

export const PAYMENT_METHOD_IDS = ['COD', 'CARD', 'GCASH', 'BPI'] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export const paymentMethodIdSchema = z.enum(PAYMENT_METHOD_IDS);

export const updatePaymentMethodsSchema = z.object({
  methods: z.array(z.object({ id: paymentMethodIdSchema, enabled: z.boolean() })).max(4),
  revision: z.number().int().min(0),
});
export type UpdatePaymentMethodsInput = z.infer<typeof updatePaymentMethodsSchema>;
