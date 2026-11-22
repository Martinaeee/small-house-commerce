import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { REQUEST_ID_PATTERN } from '../../../common/request-id.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { JwtAuthGuard, type RequestUser } from '../../auth/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { PermissionsService } from '../../auth/permissions.service.js';
import { AlertService } from '../alert.service.js';
import { ObservabilityService } from '../observability.service.js';
import type { ObservabilityAccount } from '../observability.service.js';

/**
 * Storefront Health read endpoints (P1R minimal contract).
 *
 * Business analytics live in Dashboard / ProductFunnel / Orders; this module
 * only serves availability, issues, page experience and checkout health as
 * those sources are enabled in later phases.
 */
@Controller('admin/observability')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('OBSERVABILITY_VIEW')
export class AdminObservabilityController {
  constructor(
    private readonly observability: ObservabilityService,
    private readonly alerts: AlertService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('health')
  @Header('Cache-Control', 'private, no-store')
  async health(@CurrentUser() user: RequestUser) {
    const account: ObservabilityAccount = {
      id: user.userId,
      permissions: [...(await this.permissions.granted(user.userId))],
    };
    return this.observability.health(account);
  }

  @Get('availability')
  @Header('Cache-Control', 'private, no-store')
  availability() {
    return this.observability.availability();
  }

  @Get('api')
  @Header('Cache-Control', 'private, no-store')
  async apiDiagnostics(@CurrentUser() user: RequestUser) {
    return this.observability.apiDiagnostics(new Date(), {
      id: user.userId,
      permissions: [...(await this.permissions.granted(user.userId))],
    });
  }

  @Get('api/requests/:requestId')
  @Header('Cache-Control', 'private, no-store')
  async requestTrace(@Param('requestId') requestId: string, @CurrentUser() user: RequestUser) {
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw new BadRequestException('requestId must be 8-64 characters of [A-Za-z0-9_-]');
    }
    return this.observability.requestTrace(requestId, new Date(), {
      id: user.userId,
      permissions: [...(await this.permissions.granted(user.userId))],
    });
  }

  @Get('alerts')
  @Header('Cache-Control', 'private, no-store')
  async alertIssues() {
    return {
      issues: await this.alerts.list(),
      alertingEnabled: process.env.ALERT_ENABLED === 'true',
    };
  }

  @Patch('alerts/:id')
  @Permissions('SYSTEM_SETTINGS_EDIT')
  updateAlert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED' },
    @CurrentUser() user: RequestUser,
  ) {
    const status = body?.status;
    if (status !== 'OPEN' && status !== 'ACKNOWLEDGED' && status !== 'CLOSED') {
      throw new BadRequestException('status must be OPEN, ACKNOWLEDGED or CLOSED');
    }
    return this.alerts.updateStatus(id, status, user.userId);
  }
}
