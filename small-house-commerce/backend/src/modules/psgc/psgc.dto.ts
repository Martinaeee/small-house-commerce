import { z } from 'zod';

/**
 * Query shape for GET /storefront/psgc/barangays (ruling E-1). Both values
 * are PSGC names selected on the checkout form (not codes). Province context
 * is required because city/municipality names repeat across provinces
 * (e.g. "San Fernando" exists in seven provinces) and barangays.json itself
 * carries no province field.
 */
export const barangayQuerySchema = z.object({
  province: z.string().min(1).max(120),
  city: z.string().min(1).max(120),
});

export type BarangayQuery = z.infer<typeof barangayQuerySchema>;
