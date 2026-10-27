import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { SystemStatusService } from './system-status.service.js';

/**
 * Read-only host/system snapshot for the admin status page.
 *
 * The snapshot is produced by the host (certificate, containers, disk, backup,
 * database, media) and mounted read-only into this container; there is nothing
 * writable here and no secret is included.
 */
@Controller('admin/system-status')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class SystemStatusController {
  constructor(private readonly status: SystemStatusService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get() {
    return this.status.getStatus();
  }
}
