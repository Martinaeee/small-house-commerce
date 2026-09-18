import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { OrdersService } from '../orders.service.js';
import {
  addCustomerNoteSchema,
  addOrderNoteSchema,
  addRiskFlagSchema,
  assignOrderSchema,
  confirmDecisionSchema,
  editOrderSchema,
  mergeOrdersSchema,
  orderQuerySchema,
  updateOrderStatusSchema,
  type AddCustomerNoteInput,
  type AddOrderNoteInput,
  type AddRiskFlagInput,
  type AssignOrderInput,
  type EditOrderInput,
  type MergeOrdersInput,
  type OrderQuery,
  type UpdateOrderStatusInput,
} from '../dto/order.dto.js';

/**
 * Admin order operations (API_SPEC §21 list, §22 confirm/cancel) plus the
 * order-workbench surface (2026-09-18 spec): assign, status, edit, notes,
 * risk flags, merge. Every handler requires JWT auth + a permission.
 *
 * Permission mapping: read = ORDER_VIEW_ALL, destructive/status ops reuse the
 * existing ORDER_CONFIRM / ORDER_CANCEL grants (no new roles in V1);
 * risk-flag resolution (a §8 "downgrade") requires ORDER_CHANGE_AID as the
 * admin-only signal.
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
    @Body(new ZodValidationPipe(confirmDecisionSchema)) body?: {
      decision: 'CONFIRM' | 'CANCEL' | 'REQUEST_INFO';
      note?: string;
    },
  ) {
    return this.ordersService.confirm(id, user.userId, body);
  }

  @Post(':id/cancel')
  @Permissions('ORDER_CANCEL')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.cancel(id, user.userId);
  }

  @Post(':id/assign')
  @Permissions('ORDER_CONFIRM')
  assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignOrderSchema)) body: AssignOrderInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.assign(id, body.assignedToId, user.userId);
  }

  @Post(':id/status')
  @Permissions('ORDER_CONFIRM')
  updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOrderStatusSchema)) body: UpdateOrderStatusInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.updateStatus(id, body.status, body.comment, user.userId);
  }

  @Patch(':id')
  @Permissions('ORDER_CONFIRM')
  edit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(editOrderSchema)) body: EditOrderInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.edit(id, body, user.userId);
  }

  @Post(':id/notes')
  @Permissions('ORDER_VIEW_ALL')
  addNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addOrderNoteSchema)) body: AddOrderNoteInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.addNote(id, body.content, body.noteType, user.userId);
  }

  @Post(':id/risk-flags')
  @Permissions('ORDER_VIEW_ALL')
  addRiskFlag(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addRiskFlagSchema)) body: AddRiskFlagInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.addRiskFlag(id, body.flagType, body.reason, user.userId);
  }

  @Patch('risk-flags/:flagId/resolve')
  @Permissions('ORDER_CHANGE_AID')
  resolveRiskFlag(
    @Param('flagId') flagId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.resolveRiskFlag(flagId, user.userId);
  }

  @Post('merge')
  @Permissions('ORDER_CONFIRM')
  merge(
    @Body(new ZodValidationPipe(mergeOrdersSchema)) body: MergeOrdersInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.merge(body, user.userId);
  }
}

/** Customer notes endpoint lives on its own controller to keep the routes clear. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post(':id/notes')
  @Permissions('ORDER_VIEW_ALL')
  addCustomerNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addCustomerNoteSchema)) body: AddCustomerNoteInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.addCustomerNote(id, body.note, body.orderId ?? null, user.userId);
  }
}
