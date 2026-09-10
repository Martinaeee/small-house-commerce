import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { OrdersService } from '../orders.service.js';
import { orderQuerySchema, type OrderQuery } from '../dto/order.dto.js';

/**
 * Admin order operations (API_SPEC §21 list, §22 confirm/cancel).
 * Every handler requires JWT auth plus the specific permission.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Permissions('ORDER_VIEW_ALL')
  list(@Query(new ZodValidationPipe(orderQuerySchema)) query: OrderQuery) {
    return this.ordersService.list(query);
  }

  @Get(':id')
  @Permissions('ORDER_VIEW_ALL')
  get(@Param('id') id: string) {
    return this.ordersService.get(id);
  }

  @Post(':id/confirm')
  @Permissions('ORDER_CONFIRM')
  confirm(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.confirm(id, user.userId);
  }

  @Post(':id/cancel')
  @Permissions('ORDER_CANCEL')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.cancel(id, user.userId);
  }
}
