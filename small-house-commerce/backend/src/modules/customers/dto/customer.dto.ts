import { z } from 'zod';
import { RiskLevel } from '../../../generated/prisma/client.js';

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  // Loose shape on purpose: the service normalizes to E.164 and rejects
  // anything that is not a valid PH mobile number.
  phone: z.string().min(7).max(24),
  email: z.string().email().max(255).nullable().optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(120).nullable().optional(),
  phone: z.string().min(7).max(24).optional(),
  email: z.string().email().max(255).nullable().optional(),
  riskLevel: z.nativeEnum(RiskLevel).optional(),
});

export const customerAddressSchema = z.object({
  fullName: z.string().min(1).max(120),
  phone: z.string().min(7).max(24),
  province: z.string().min(1).max(120),
  city: z.string().min(1).max(120),
  barangay: z.string().max(120).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  streetAddress: z.string().min(1).max(255),
  landmark: z.string().max(255).nullable().optional(),
});

export const customerAddressUpdateSchema = customerAddressSchema.partial();

export const customerQuerySchema = z.object({
  search: z.string().max(255).optional(),
  riskLevel: z.nativeEnum(RiskLevel).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CustomerAddressInput = z.infer<typeof customerAddressSchema>;
export type CustomerAddressUpdateInput = z.infer<typeof customerAddressUpdateSchema>;
export type CustomerQuery = z.infer<typeof customerQuerySchema>;
