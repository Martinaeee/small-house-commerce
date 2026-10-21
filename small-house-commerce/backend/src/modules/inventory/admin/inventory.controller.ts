import { Body, Controller, Get, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { InventoryService } from '../inventory.service.js';
import {
  inventoryAdjustSchema,
  inventoryBatchSetStockSchema,
  inventoryCostBatchSchema,
  inventorySetStockSchema,
  type InventoryAdjustInput,
  type InventoryBatchSetStockInput,
  type InventoryCostBatchInput,
  type InventorySetStockInput,
} from '../dto/inventory.dto.js';

/**
 * Manual stock adjustment (DATABASE.md §33 MANUAL_ADJUSTMENT, ADMIN_SPEC §13).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/inventory')
export class AdminInventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('adjust')
  @Permissions('INVENTORY_ADJUST')
  adjust(
    @Body(new ZodValidationPipe(inventoryAdjustSchema)) body: InventoryAdjustInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.inventoryService.adjust(body.skuId, body.quantity, body.reason ?? undefined, user.userId);
  }

  /** Absolute set from the product form (idempotent; audit trail preserved). */
  @Put('stock')
  @Permissions('INVENTORY_ADJUST')
  setStock(
    @Body(new ZodValidationPipe(inventorySetStockSchema)) body: InventorySetStockInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.inventoryService.setOnHand(body.skuId, body.onHand, body.reason ?? undefined, user.userId);
  }

  /**
   * Bounded batch of absolute sets (max 100 SKUs). Per-SKU settled results:
   * a failing row never rolls back the rows that already settled.
   */
  @Put('stock/batch')
  @Permissions('INVENTORY_ADJUST')
  setStockBatch(
    @Body(new ZodValidationPipe(inventoryBatchSetStockSchema))
    body: InventoryBatchSetStockInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.inventoryService.setOnHandBatch(body, user.userId);
  }

  /**
   * Cost backfill grid: every active SKU with its cost, stock and recent
   * sales. Reading and writing costs is catalog work, so it asks for
   * PRODUCT_MANAGE rather than inventory rights.
   */
  @Get('costs')
  @Permissions('PRODUCT_MANAGE')
  costs() {
    return this.inventoryService.costRows();
  }

  /** Bulk cost write; per-row settled results, no all-or-nothing rollback. */
  @Patch('costs')
  @Permissions('PRODUCT_MANAGE')
  setCosts(
    @Body(new ZodValidationPipe(inventoryCostBatchSchema)) body: InventoryCostBatchInput,
  ) {
    return this.inventoryService.setCosts(body.items);
  }
}
