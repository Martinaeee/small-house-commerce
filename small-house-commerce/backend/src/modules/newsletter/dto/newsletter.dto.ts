import { z } from 'zod';

export const subscribeSchema = z.object({
  email: z.string().trim().email().max(200),
  source: z.enum(['POPUP', 'FOOTER']),
});

export const unsubscribeQuerySchema = z.object({
  token: z.string().min(1).max(2_048),
});

export const subscriberQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['SUBSCRIBED', 'UNSUBSCRIBED']).optional(),
  source: z.enum(['POPUP', 'FOOTER']).optional(),
});

export const subscriberStatusSchema = z.object({
  status: z.enum(['SUBSCRIBED', 'UNSUBSCRIBED']),
});

export const promoPreviewSchema = z.object({
  code: z.string().trim().min(1).max(32),
  subtotal: z.number().min(0).max(10_000_000),
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;
export type UnsubscribeQuery = z.infer<typeof unsubscribeQuerySchema>;
export type SubscriberQuery = z.infer<typeof subscriberQuerySchema>;
export type SubscriberStatusInput = z.infer<typeof subscriberStatusSchema>;
export type PromoPreviewInput = z.infer<typeof promoPreviewSchema>;
