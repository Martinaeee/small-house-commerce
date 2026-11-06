import { z } from 'zod';

export const funnelReasons = ['VALIDATION','STOCK','NETWORK','SERVER','UNKNOWN'] as const;
const text = (max: number) => z.string().max(max).nullable().optional();
const base = z.object({
  step: z.enum(['form','confirm']), attemptId: text(120), retry: z.number().int().min(1).max(100000).optional(),
  skuIds: z.array(z.string().max(100)).max(100).default([]),
  quantities: z.array(z.number().int().min(1).max(100000)).max(100).default([]),
});
const failure = base.extend({
  reason: z.enum(funnelReasons), field: text(80), httpStatus: z.number().int().min(100).max(599).nullable().optional(),
  message: text(200), variantNames: z.array(text(80)).max(100).optional(), idempotencyKey: text(120),
  customer: z.object({
    name: text(300), phone: text(32), province: text(300), city: text(300), barangay: text(300),
    postalCode: text(300), streetAddress: text(300), landmark: text(300), note: text(200),
  }).optional(),
});

/** Public ingest is untrusted. Keep the diagnostic schema on the server too. */
export function checkoutMetadata(eventName: string, input: unknown): Record<string, unknown> | null {
  const parsed = (eventName === 'CHECKOUT_SUBMIT_FAILED' ? failure : base).safeParse(input);
  if (!parsed.success) return null;
  const out = parsed.data as Record<string, unknown>;
  if (typeof out.message === 'string') {
    let message = out.message;
    const customer = out.customer as Record<string, unknown> | undefined;
    for (const value of Object.values(customer ?? {})) {
      if (typeof value === 'string' && value.length >= 3) message = message.split(value).join('***');
    }
    out.message = message.replace(/(?:\+?\d[\d\s-]{7,}\d)/g,'***').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,'***').slice(0,200);
  }
  return Buffer.byteLength(JSON.stringify(out),'utf8') <= 16384 ? out : null;
}
