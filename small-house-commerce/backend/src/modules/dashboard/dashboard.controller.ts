import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard, type RequestUser } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { dashboardQuerySchema, type DashboardQuery } from './dto/dashboard.dto.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Operator dashboard (dashboard §2-§16, §21).
 *
 * Three grouped reads instead of one request per card: the page issues
 * `overview`, then `products` and `marketing`. Any authenticated operator may
 * call them; each group inside is gated by the permission that already
 * governs its source module, and an unreadable group comes back empty with a
 * `capabilities` flag rather than a 403 that would blank the whole page.
 */
@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ) {
    return this.dashboard.overview(user.userId, query);
  }

  @Get('products')
  products(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ) {
    return this.dashboard.products(user.userId, query);
  }

  @Get('marketing')
  marketing(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ) {
    return this.dashboard.marketing(user.userId, query);
  }
}
