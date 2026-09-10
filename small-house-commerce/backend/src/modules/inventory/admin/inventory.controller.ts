import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { InventoryService } from '../inventory.service.js';
import { inventoryAdjustSchema, type InventoryAdjustInput } from '../dto/inventory.dto.js';

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
}
