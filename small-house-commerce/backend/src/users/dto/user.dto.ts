import { z } from 'zod';
import { RoleCode, UserStatus } from '../../generated/prisma/client.js';

export const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  roleCodes: z.array(z.nativeEnum(RoleCode)).min(1),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().max(255).optional(),
  password: z.string().min(8).max(128).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  roleCodes: z.array(z.nativeEnum(RoleCode)).min(1).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
