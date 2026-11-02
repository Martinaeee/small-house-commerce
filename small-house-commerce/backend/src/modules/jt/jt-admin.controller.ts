import {
  ConflictException,
  Controller,
  Get,
  Header,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Permissions } from '../auth/permissions.decorator.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { JtTrackingService } from './jt-tracking.service.js';

/** Read-only worker health for the admin status page. */
@Controller('admin/jt')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class AdminJtController {
  constructor(private readonly tracking: JtTrackingService) {}

  @Get('status')
  @Header('Cache-Control', 'private, no-store')
  status() {
    return this.tracking.health();
  }
}

/**
 * On-demand refresh for one box. Lives here rather than in OrdersModule so the
 * dependency only flows one way: JtModule imports OrdersModule, never the
 * reverse.
 */
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JtShipmentTrackingController {
  constructor(private readonly tracking: JtTrackingService) {}

  @Post(':id/shipments/:shipmentId/tracking/refresh')
  @Permissions('SHIPMENT_CREATE')
  async refresh(@Param('id') id: string, @Param('shipmentId') shipmentId: string) {
    if (!this.tracking.enabled) {
      throw new ConflictException('J&T tracking is disabled');
    }
    return this.tracking.refreshShipment(id, shipmentId);
  }
}
