import { z } from 'zod';

/**
 * Query shape for GET /storefront/psgc/barangays. `city` is the PSGC
 * city/municipality NAME selected on the checkout form (not a code).
 */
export const barangayQuerySchema = z.object({
  city: z.string().min(1).max(120),
});

export type BarangayQuery = z.infer<typeof barangayQuerySchema>;
