import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../../generated/prisma/client.js';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares the permission codes a handler requires. Read by PermissionsGuard,
 * which runs after JwtAuthGuard. An endpoint with no decorator is open to any
 * authenticated user.
 */
export const Permissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
