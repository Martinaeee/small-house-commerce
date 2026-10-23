import {
  Body,
  Controller,
  ForbiddenException,
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
import { OrderVerificationService } from '../verification.service.js';
import { PermissionsService } from '../../auth/permissions.service.js';
import {
  addCustomerNoteSchema,
  addOrderNoteSchema,
  addRiskFlagSchema,
  assignOrderSchema,
  checkoutSchema,
  confirmDecisionSchema,
  editOrderSchema,
  mergeOrdersSchema,
  orderQuerySchema,
  shipOrderSchema,
  updateOrderStatusSchema,
  type AddCustomerNoteInput,
  type AddOrderNoteInput,
  type AddRiskFlagInput,
  type AssignOrderInput,
  type CheckoutInput,
  type EditOrderInput,
  type MergeOrdersInput,
  type OrderQuery,
  type ShipOrderInput,
  type UpdateOrderStatusInput,
} from '../dto/order.dto.js';

/**
 * Admin order operations (API_SPEC §21 list, §22 confirm/cancel) plus the
 * order-workbench surface (2026-09-18 spec): assign, status, edit, notes,
 * risk flags, merge. Every handler requires JWT auth + a permission.
 *
 * Read is ORDER_VIEW_ALL; every write has its own permission
 * (ORDER_CONFIRM / ORDER_CANCEL / ORDER_ASSIGN / ORDER_NOTE_WRITE /
 * ORDER_RISK_WRITE / ORDER_MERGE / SHIPMENT_CREATE). Two routes also check
 * a second permission when the request turns destructive: a CANCEL decision
 * or a DENIED status needs ORDER_CANCEL on top of ORDER_CONFIRM.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly verificationService: OrderVerificationService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @Permissions('ORDER_VIEW_ALL')
  list(
    @Query(new ZodValidationPipe(orderQuerySchema)) query: OrderQuery,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.list(query, user.userId);
  }

  @Get('assignees')
  @Permissions('ORDER_VIEW_ALL')
  assignees() {
    return this.ordersService.assignees();
  }

  @Get('counts')
  @Permissions('ORDER_VIEW_ALL')
  counts(
    @Query(new ZodValidationPipe(orderQuerySchema)) query: OrderQuery,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.counts(query, user.userId);
  }

  @Get('sku-search')
  @Permissions('ORDER_VIEW_ALL')
  skuSearch(@Query('q') q: string) {
    return this.ordersService.skuSearch(q ?? '');
  }

  /** Manual order entry (phone orders): reuses the storefront checkout logic. */
  @Post()
  @Permissions('ORDER_CONFIRM')
  create(
    @Body(new ZodValidationPipe(checkoutSchema)) body: CheckoutInput,
    @CurrentUser() _user: { userId: string },
  ) {
    return this.ordersService.checkout(body);
  }

  /**
   * Every order of one phone number with the numbers the workbench needs to
   * judge the customer - how often they sign, what is on the way and what
   * was cancelled. It sits here (and not under admin/customers) because that
   * controller already owns a ":id" route that would swallow the name.
   */
  @Get('customer-history')
  @Permissions('ORDER_VIEW_ALL')
  customerOrderHistory(@Query('phone') phone: string) {
    return this.ordersService.customerOrderHistory(phone);
  }

  @Get(':id')
  @Permissions('ORDER_VIEW_ALL')
  get(@Param('id') id: string) {
    return this.ordersService.get(id);
  }

  @Post(':id/confirm')
  @Permissions('ORDER_CONFIRM')
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body(new ZodValidationPipe(confirmDecisionSchema)) body?: {
      decision: 'CONFIRM' | 'CANCEL' | 'REQUEST_INFO';
      note?: string;
    },
  ) {
    // A cancellation decision releases the same reservations as the cancel route.
    if (
      body?.decision === 'CANCEL' &&
      !(await this.permissions.has(user.userId, 'ORDER_CANCEL'))
    ) {
      throw new ForbiddenException('裁决「取消订单」需要 ORDER_CANCEL 权限');
    }
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
  @Permissions('ORDER_ASSIGN')
  assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignOrderSchema)) body: AssignOrderInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.assign(id, body.assignedToId, user.userId);
  }

  @Post(':id/status')
  @Permissions('ORDER_CONFIRM')
  async updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOrderStatusSchema)) body: UpdateOrderStatusInput,
    @CurrentUser() user: { userId: string },
  ) {
    // A denial releases the stock reservation, so it is a cancellation in
    // everything but the name and needs the cancel permission on top.
    if (body.status === 'DENIED' && !(await this.permissions.has(user.userId, 'ORDER_CANCEL'))) {
      throw new ForbiddenException('拒绝订单需要 ORDER_CANCEL 权限');
    }
    return this.ordersService.updateStatus(id, body.status, body.comment, user.userId);
  }

  @Patch(':id')
  @Permissions('ORDER_CONFIRM')
  async edit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(editOrderSchema)) body: EditOrderInput,
    @CurrentUser() user: { userId: string },
  ) {
    const updated = await this.ordersService.edit(id, body, user.userId);
    // A material change (address, items, quantity) invalidates the
    // verification results that depended on it; they have to be verified
    // again before the order can be confirmed.
    if (body.shippingAddress || body.items) {
      const reason = body.items
        ? '订单商品或数量已修改'
        : '收货地址已修改';
      await this.verificationService.invalidateForChange(id, user.userId, reason);
    }
    return updated;
  }

  @Post(':id/notes')
  @Permissions('ORDER_NOTE_WRITE')
  addNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addOrderNoteSchema)) body: AddOrderNoteInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.addNote(id, body.content, body.noteType, user.userId);
  }

  @Post(':id/risk-flags')
  @Permissions('ORDER_RISK_WRITE')
  addRiskFlag(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addRiskFlagSchema)) body: AddRiskFlagInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.addRiskFlag(id, body.flagType, body.reason, user.userId);
  }

  @Patch('risk-flags/:flagId/resolve')
  @Permissions('ORDER_RISK_WRITE')
  resolveRiskFlag(
    @Param('flagId') flagId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.resolveRiskFlag(flagId, user.userId);
  }

  @Post('merge')
  @Permissions('ORDER_MERGE')
  merge(
    @Body(new ZodValidationPipe(mergeOrdersSchema)) body: MergeOrdersInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.merge(body, user.userId);
  }

  /** §22.3 ship — partial shipments allowed, gates in the service. */
  @Post(':id/ship')
  @Permissions('SHIPMENT_CREATE')
  ship(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(shipOrderSchema)) body: ShipOrderInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.ship(id, body, user.userId);
  }

  /** §69 sign a shipment; the order becomes SIGNED once all boxes are signed. */
  @Post(':id/shipments/:shipmentId/sign')
  @Permissions('SHIPMENT_CREATE')
  sign(
    @Param('id') id: string,
    @Param('shipmentId') shipmentId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.sign(id, shipmentId, user.userId);
  }
}

/** Customer notes endpoint lives on its own controller to keep the routes clear. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post(':id/notes')
  @Permissions('ORDER_NOTE_WRITE')
  addCustomerNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addCustomerNoteSchema)) body: AddCustomerNoteInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.ordersService.addCustomerNote(id, body.note, body.orderId ?? null, user.userId);
  }
}
