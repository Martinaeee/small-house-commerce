import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Match the codebase convention (auth.dto.ts): z.string().email().
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const storefrontRefreshSchema = z.object({
  refreshToken: z.string().min(10).max(400),
});

/** PATCH /me: at least one of name/phone must be present. */
export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(1).max(32).optional(),
  })
  .refine((value) => value.name !== undefined || value.phone !== undefined, {
    message: 'Nothing to update',
  });

export const customerOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type StorefrontRefreshInput = z.infer<typeof storefrontRefreshSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type CustomerOrdersQuery = z.infer<typeof customerOrdersQuerySchema>;
