import { z } from 'zod';
import { manilaVisitDay } from '../marketing-attribution.js';

const today = () => manilaVisitDay(new Date()).toISOString().slice(0, 10);

export const marketingPerformanceQuerySchema = z.object({
  view: z.enum(['PRODUCT', 'OPTIMIZER']),
  productId: z.string().uuid().optional(),
  ownerUserId: z.string().uuid().optional(),
  landingPageId: z.string().uuid().optional(),
  trendPageId: z.string().uuid().optional(),
  effectiveStatus: z.enum(['DRAFT', 'LIVE', 'SCHEDULED', 'ENDED', 'DISABLED']).optional(),
  preset: z.enum(['LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_WEEK', 'LAST_WEEK', 'CUSTOM']).default('LAST_7_DAYS'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  interval: z.enum(['DAY', 'WEEK']).default('DAY'),
  compare: z.enum(['1', '0']).default('1').transform(value => value === '1'),
  sortBy: z.enum(['name', 'visits', 'validOrders', 'conversionRate', 'spendUsd', 'orderCpaUsd', 'signedRoas']).default('name'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().superRefine((query, context) => {
  if (query.view === 'PRODUCT' && !query.productId) {
    context.addIssue({ code: 'custom', path: ['productId'], message: 'The product view requires productId.' });
  }
  if (query.preset === 'CUSTOM') {
    if (!query.from || !query.to) {
      context.addIssue({ code: 'custom', path: ['from'], message: 'A custom range requires from and to.' });
    } else if (query.from > query.to || query.to > today()) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Custom dates must be ordered and cannot extend beyond Manila today.' });
    }
  } else if (query.from || query.to) {
    context.addIssue({ code: 'custom', path: ['from'], message: 'Only the custom preset accepts explicit dates.' });
  }
});
export type MarketingPerformanceQuery = z.infer<typeof marketingPerformanceQuerySchema>;

export const marketingPerformanceOptionsQuerySchema = z.object({
  ownerUserId: z.string().uuid().optional(),
}).strict();
export type MarketingPerformanceOptionsQuery = z.infer<typeof marketingPerformanceOptionsQuerySchema>;
