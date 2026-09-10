import { z } from 'zod';
import { SupplierStatus } from '../../../generated/prisma/client.js';

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(255),
  contact: z.string().max(255).optional(),
  sourcePlatform: z.string().max(120).optional(),
  supplierUrl: z.string().url().max(2048).optional(),
  currency: z.string().max(8).optional(),
  status: z.nativeEnum(SupplierStatus).default('ACTIVE'),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
