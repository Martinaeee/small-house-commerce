import { z } from 'zod';
import { DASHBOARD_RANGE_PRESETS } from '../dashboard-range.js';

/**
 * How the product-performance table is ranked.
 *
 * `revenue` is the default (the product that sold the most money); the other
 * three answer the other questions an operator asks — how many orders, how
 * well they were delivered (signed rate) and how many units moved.
 */
export const PRODUCT_PERFORMANCE_SORTS = [
  'revenue',
  'orders',
  'signed_rate',
  'units',
] as const;

export type ProductPerformanceSort = (typeof PRODUCT_PERFORMANCE_SORTS)[number];

/**
 * Dashboard query. `range` drives every date on the page; CUSTOM additionally
 * requires `from`/`to` (validated again when the window is resolved, so an
 * impossible range is rejected with a readable message).
 */
export const dashboardQuerySchema = z
  .object({
    range: z.enum(DASHBOARD_RANGE_PRESETS).default('LAST_7_DAYS'),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    sort: z.enum(PRODUCT_PERFORMANCE_SORTS).default('revenue'),
  })
  .strict();

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
