import { z } from 'zod';
import { funnelReasons } from '../../analytics/checkout-metadata.js';

export const funnelTraffic = z.enum(['ALL', 'ADS', 'ORGANIC']);
export const funnelSort = z.enum([
  'ORDER_COUNT',
  'VISITS',
  'CONVERSION',
  'ADD_TO_CART_RATE',
  'CHECKOUT_RATE',
  'SUBMIT_RATE',
  'FAILURE_RATE',
]);
const range = {
  from: z.iso.date(),
  to: z.iso.date(),
  traffic: funnelTraffic.default('ALL'),
  ownerUserId: z.uuid().optional(),
};
const validRange = (v: { from: string; to: string }) =>
  v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 < 93;
export const marketingFunnelQuerySchema = z
  .object({
    ...range,
    productId: z.uuid().optional(),
    q: z.string().trim().max(120).optional(),
    onlyAnomaly: z.enum(['true', 'false']).default('false'),
    sort: funnelSort.default('CONVERSION'),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine(validRange, { message: 'Select an ordered range of up to 93 days' });
export const marketingFunnelSessionsQuerySchema = z
  .object({
    ...range,
    productId: z.uuid(),
    reason: z.enum(funnelReasons).optional(),
    device: z.enum(['mobile', 'tablet', 'desktop']).optional(),
    source: z.enum(['FACEBOOK_POST', 'META_AD', 'OTHER', 'ORGANIC']).optional(),
    onlyFailures: z.enum(['true', 'false']).default('false'),
    cursor: z.string().max(250).optional(),
  })
  .strict()
  .refine(validRange, { message: 'Select an ordered range of up to 93 days' });
export type MarketingFunnelQuery = z.infer<typeof marketingFunnelQuerySchema>;
export type MarketingFunnelSessionsQuery = z.infer<
  typeof marketingFunnelSessionsQuerySchema
>;
