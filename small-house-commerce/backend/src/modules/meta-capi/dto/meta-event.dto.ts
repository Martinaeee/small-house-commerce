import { z } from 'zod';

/**
 * Browser-to-server bridge payloads for the Meta Conversions API.
 *
 * The endpoint is public, so the event name and every piece of custom data
 * are whitelisted. Purchase is deliberately absent: only the backend order
 * flow may enqueue the money event. `consent` must be explicitly true — the
 * browser never sends an unconsented event, and anything else is refused.
 */
export const metaBridgeEventNames = [
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
] as const;

const metaCookie = (max: number) =>
  z.string().max(max).regex(/^fb\.\d+\.\d+\.[\w.-]+$/);

const contentEntry = z.object({
  id: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(99),
});

const customDataSchema = z.object({
  content_ids: z.array(z.string().min(1).max(100)).min(1).max(50),
  content_name: z.string().max(255).optional(),
  content_type: z.literal('product').default('product'),
  contents: z.array(contentEntry).max(50).optional(),
  value: z.number().finite().min(0).max(10_000_000).optional(),
  currency: z.literal('PHP').default('PHP'),
});

export const metaEventSchema = z
  .object({
    name: z.enum(metaBridgeEventNames),
    eventId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
    eventSourceUrl: z.string().url().max(1024),
    customData: customDataSchema,
    fbp: metaCookie(200).nullable().optional(),
    fbc: metaCookie(300).nullable().optional(),
    consent: z.boolean(),
  })
  .strict();

export type MetaEventInput = z.infer<typeof metaEventSchema>;
