import {
  Controller,
  Get,
  Header,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { LinkBuilderContextService } from '../link-builder-context.service.js';

@Controller('admin/link-builder')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('CAMPAIGN_LINK_BUILD')
export class AdminLinkBuilderController {
  constructor(private readonly context: LinkBuilderContextService) {}

  @Get('context')
  @Header('Cache-Control', 'private, no-store')
  getContext() {
    return this.context.getContext();
  }
}
