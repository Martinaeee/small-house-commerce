import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  updateSettingsSchema,
  type UpdateSettingsInput,
} from '../dto/settings.dto.js';
import { SettingsService } from '../settings.service.js';

/**
 * Site contact settings. SYSTEM_SETTINGS_EDIT is granted to SUPER_ADMIN only
 * (ADMIN does not hold it) — same guard class as user administration.
 */
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getRow();
  }

  @Patch()
  update(
    @Body(new ZodValidationPipe(updateSettingsSchema))
    input: UpdateSettingsInput,
  ) {
    return this.settings.update(input);
  }
}
