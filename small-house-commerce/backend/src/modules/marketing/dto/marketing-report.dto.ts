import { z } from 'zod';
import { manilaVisitDay } from '../marketing-attribution.js';

const today = () => manilaVisitDay(new Date()).toISOString().slice(0, 10);
export const marketingReportQuerySchema = z.object({
  from: z.iso.date().default(() => new Date(manilaVisitDay(new Date()).getTime() - 6 * 864e5).toISOString().slice(0, 10)),
  to: z.iso.date().default(today),
  groupBy: z.enum(['LINK', 'PAGE', 'PRODUCT', 'OWNER']).default('LINK'),
  linkIds: z.string().max(3700).transform(value => value.split(',')).pipe(z.array(z.string().uuid()).min(1).max(100)).optional(),
  ownerUserId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  landingPageId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(query => query.from <= query.to && query.to <= today(), { message: 'Report dates must be ordered and cannot extend beyond Manila today.' });
export type MarketingReportQuery = z.infer<typeof marketingReportQuerySchema>;
