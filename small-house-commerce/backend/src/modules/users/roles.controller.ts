import { Controller, Get, UseGuards } from '@nestjs/common';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { UsersService } from './users.service.js';

/**
 * The role catalogue. Read-only: the roles and their grants are seeded, and
 * the admin UI presents them as a picker rather than an editor.
 *
 * Same guard as user administration — SYSTEM_SETTINGS_EDIT is SUPER_ADMIN
 * only, so the catalogue exposes no more than the account list already does.
 */
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.listRoles();
  }
}
